import { conflict } from "../../core/errors.js";
import type {
  DocumentSnapshot,
  DomainEvent,
  NewDomainEvent,
  StreamName
} from "../../core/types.js";
import type { AuditDocumentEventQuery, AuditEventQuery, AuditEventStore } from "../../ports/audit-event-store.js";
import type {
  DocumentCommit,
  DocumentCommitBatchEntry,
  DocumentCommitBatchProjection,
  DocumentStore,
  ReadStreamOptions
} from "../../ports/document-store.js";
import { auditDocumentEventQuery, auditEventQuery } from "./audit-event-query.js";
import { cloneDocumentSnapshot } from "../../core/document-snapshots.js";
import { isD1ConstraintError } from "./constraint-error.js";
import { insertEventStatements, sequenceEvents } from "./event-writer.js";
import { eventStreamQuery } from "./read-stream-query.js";
import { eventFromRow, type EventRow } from "./serde.js";

export class D1DocumentStore implements DocumentStore, AuditEventStore {
  constructor(private readonly db: D1Database) {}

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
    try {
      await this.db.batch([
        ...insertEventStatements(this.db, saved),
        ...[projection.snapshot, ...(projection.auxiliarySnapshots ?? [])].map((snapshot) =>
          documentUpsertStatement(this.db, snapshot)
        )
      ]);
    } catch (error) {
      if (isD1ConstraintError(error)) {
        throw conflict("One or more streams changed while committing");
      }
      throw error;
    }
    return { events: saved, snapshot: projection.snapshot };
  }

  async readStream(stream: StreamName, options: ReadStreamOptions = {}): Promise<readonly DomainEvent[]> {
    const query = eventStreamQuery(options);
    const result = await this.db
      .prepare(query.sql)
      .bind(stream, ...query.params)
      .all<EventRow>();
    const events = (result.results ?? []).map(eventFromRow);
    return query.reverseResults ? [...events].reverse() : events;
  }

  async currentVersion(stream: StreamName): Promise<number> {
    const row = await this.db
      .prepare("SELECT COALESCE(MAX(sequence), 0) AS version FROM cf_frappe_events WHERE stream = ?")
      .bind(stream)
      .first<{ version: number }>();
    return Number(row?.version ?? 0);
  }

  async searchEvents(query: AuditEventQuery): Promise<readonly DomainEvent[]> {
    const prepared = auditEventQuery(query);
    const result = await this.db
      .prepare(prepared.sql)
      .bind(...prepared.params)
      .all<EventRow>();
    return (result.results ?? []).map(eventFromRow);
  }

  async readDocumentEvents(query: AuditDocumentEventQuery): Promise<readonly DomainEvent[]> {
    const prepared = auditDocumentEventQuery(query);
    const result = await this.db
      .prepare(prepared.sql)
      .bind(...prepared.params)
      .all<EventRow>();
    return (result.results ?? []).map(eventFromRow);
  }
}

function documentUpsertStatement(db: D1Database, snapshot: DocumentSnapshot): D1PreparedStatement {
  const normalized = cloneDocumentSnapshot(snapshot);
  return db
    .prepare(
      `INSERT INTO cf_frappe_documents
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
