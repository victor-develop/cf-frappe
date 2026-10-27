import { conflict } from "../../core/errors.js";
import type {
  DocumentSnapshot,
  DomainEvent,
  NewDomainEvent,
  StreamName
} from "../../core/types.js";
import type { AuditDocumentEventQuery, AuditEventQuery, AuditEventStore } from "../../ports/audit-event-store.js";
import {
  afterProjectionHandoff,
  projectionHandoffEvents,
  type DocumentCommit,
  type DocumentCommitBatchEntry,
  type DocumentCommitBatchProjection,
  type DocumentStore,
  type DocumentStoreProjectionOptions,
  type ProjectionHandoff,
  type ReadStreamOptions
} from "../../ports/document-store.js";
import { cloneDocumentSnapshot } from "../../core/document-snapshots.js";
import { isD1ConstraintError } from "./constraint-error.js";
import { readD1AuditDocumentEvents, readD1EventStream, searchD1AuditEvents } from "./event-reader.js";
import { insertEventAtHeadStatement, insertEventStatements, sequenceEvents } from "./event-writer.js";
import { automationRunIndexUpsertStatement } from "./automation-run-index.js";
import { D1_DOCUMENTS_TABLE, D1_EVENTS_TABLE } from "./tables.js";

export class D1DocumentStore implements DocumentStore, AuditEventStore {
  private readonly projectionHandoff: ProjectionHandoff | undefined;

  /**
   * With no options this writes projection rows inline, in the commit's own
   * batch — the single-database layout. `projectionHandoff` is the split
   * layout from issue #13: the rows leave as events instead, and this database
   * holds no projection writes at all.
   */
  constructor(
    private readonly db: D1Database,
    options: DocumentStoreProjectionOptions = {}
  ) {
    this.projectionHandoff = options.projectionHandoff;
  }

  async commit(
    stream: StreamName,
    expectedVersion: number,
    events: readonly NewDomainEvent[],
    project: (events: readonly DomainEvent[]) => DocumentSnapshot
  ): Promise<DocumentCommit> {
    return this.commitBatch([{ stream, expectedVersion, events }], (saved) => ({ snapshot: project(saved) }));
  }

  async commitBatch(
    entries: readonly DocumentCommitBatchEntry[],
    project: (events: readonly DomainEvent[]) => DocumentCommitBatchProjection
  ): Promise<DocumentCommit> {
    for (const entry of entries) {
      const current = await this.currentVersion(entry.stream);
      if (current !== entry.expectedVersion) {
        throw conflict(`Expected stream '${entry.stream}' at version ${entry.expectedVersion}, found ${current}`);
      }
    }

    const saved = entries.flatMap((entry) => sequenceEvents(entry.expectedVersion, entry.events));
    const projection = project(saved);
    const snapshots = [projection.snapshot, ...(projection.auxiliarySnapshots ?? [])];
    try {
      await this.db.batch([
        ...insertEventStatements(this.db, saved),
        ...(this.projectionHandoff === undefined
          ? snapshots.flatMap((snapshot) => documentProjectionStatements(this.db, snapshot))
          : projectionHandoffEvents(this.projectionHandoff, entries, saved, snapshots).map((event) =>
              insertEventAtHeadStatement(this.db, event)
            ))
      ]);
    } catch (error) {
      if (isD1ConstraintError(error)) {
        throw conflict("One or more streams changed while committing");
      }
      throw error;
    }
    if (this.projectionHandoff !== undefined) {
      await afterProjectionHandoff(this.projectionHandoff, snapshots);
    }
    return { events: saved, snapshot: projection.snapshot };
  }

  async readStream(stream: StreamName, options: ReadStreamOptions = {}): Promise<readonly DomainEvent[]> {
    return readD1EventStream(this.db, stream, options);
  }

  async currentVersion(stream: StreamName): Promise<number> {
    const row = await this.db
      .prepare(`SELECT COALESCE(MAX(sequence), 0) AS version FROM ${D1_EVENTS_TABLE} WHERE stream = ?`)
      .bind(stream)
      .first<{ version: number }>();
    // A MAX aggregate returns exactly one row even for a stream that has no
    // events, so the version is always present.
    return Number(row!.version);
  }

  async searchEvents(query: AuditEventQuery): Promise<readonly DomainEvent[]> {
    return searchD1AuditEvents(this.db, query);
  }

  async readDocumentEvents(query: AuditDocumentEventQuery): Promise<readonly DomainEvent[]> {
    return readD1AuditDocumentEvents(this.db, query);
  }
}

function documentProjectionStatements(db: D1Database, snapshot: DocumentSnapshot): D1PreparedStatement[] {
  return [
    documentUpsertStatement(db, snapshot),
    automationRunIndexUpsertStatement(db, snapshot)
  ].filter((statement): statement is D1PreparedStatement => statement !== undefined);
}

function documentUpsertStatement(db: D1Database, snapshot: DocumentSnapshot): D1PreparedStatement {
  const normalized = cloneDocumentSnapshot(snapshot);
  return db
    .prepare(
      `INSERT INTO ${D1_DOCUMENTS_TABLE}
       (tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, doctype, name)
       DO UPDATE SET
         version = excluded.version,
         docstatus = excluded.docstatus,
         data_json = excluded.data_json,
         updated_at = excluded.updated_at`
    )
    .bind(
      normalized.tenantId,
      normalized.doctype,
      normalized.name,
      normalized.version,
      normalized.docstatus,
      JSON.stringify(normalized.data),
      normalized.createdAt,
      normalized.updatedAt
    );
}
