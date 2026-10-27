import { conflict, FrameworkError } from "../../core/errors.js";
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
import { cloneDocumentSnapshot } from "../../core/document-snapshots.js";
import { isD1ConstraintError } from "./constraint-error.js";
import { readD1AuditDocumentEvents, readD1EventStream, searchD1AuditEvents } from "./event-reader.js";
import { insertEventStatements, sequenceEvents } from "./event-writer.js";
import { automationRunIndexUpsertStatement } from "./automation-run-index.js";
import { D1_DOCUMENTS_TABLE, D1_EVENTS_TABLE } from "./tables.js";
import {
  d1TypedProjectionUpsertStatement,
  isD1CheckConstraintError,
  type D1TypedProjectionPlan
} from "./typed-projection-store.js";

export interface D1DocumentStoreOptions {
  /**
   * Typed per-DocType projection tables to maintain on every commit (issue
   * #15). Omitted — the default — a commit writes exactly what it always has:
   * the events and the shared `cf_frappe_documents` row.
   */
  readonly typedProjections?: D1TypedProjectionPlan;
}

export class D1DocumentStore implements DocumentStore, AuditEventStore {
  private readonly typedProjections: D1TypedProjectionPlan | undefined;

  constructor(private readonly db: D1Database, options: D1DocumentStoreOptions = {}) {
    this.typedProjections = options.typedProjections;
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
        ...snapshots.flatMap((snapshot) => documentProjectionStatements(this.db, snapshot)),
        ...this.typedProjectionStatements(snapshots, "active")
      ]);
    } catch (error) {
      // Checked first: a typed column's CHECK is a constraint error too, and
      // reporting it as a concurrency conflict would invite a retry that can
      // only fail the same way.
      if (this.typedProjections !== undefined && isD1CheckConstraintError(error)) {
        throw new FrameworkError(
          "D1_TYPED_PROJECTION_CONSTRAINT_FAILED",
          `A typed projection column rejected '${projection.snapshot.doctype}/${projection.snapshot.name}': ` +
            `a promoted field holds a value that does not fit its declared type (${errorMessage(error)})`,
          { status: 409 }
        );
      }
      if (isD1ConstraintError(error)) {
        throw conflict("One or more streams changed while committing");
      }
      throw error;
    }
    await this.writeShadowTypedProjections(snapshots);
    return { events: saved, snapshot: projection.snapshot };
  }

  private typedProjectionStatements(
    snapshots: readonly DocumentSnapshot[],
    mode: "active" | "shadow"
  ): D1PreparedStatement[] {
    const plan = this.typedProjections;
    if (plan === undefined) {
      return [];
    }
    return snapshots.flatMap((snapshot) => {
      const layout = plan.mode(snapshot.doctype) === mode ? plan.layout(snapshot.doctype) : undefined;
      return layout === undefined ? [] : [d1TypedProjectionUpsertStatement(this.db, layout, snapshot)];
    });
  }

  /**
   * Writes `shadow` typed rows after the commit, as their own batch.
   *
   * Outside the commit's atomic boundary on purpose: a table that is still
   * being verified must not be able to fail a document write, and widening
   * the transaction to include it would do exactly that. A failure is reported
   * and swallowed; the rebuild and the parity check are what repair and catch
   * it.
   */
  private async writeShadowTypedProjections(snapshots: readonly DocumentSnapshot[]): Promise<void> {
    const plan = this.typedProjections;
    const statements = this.typedProjectionStatements(snapshots, "shadow");
    if (plan === undefined || statements.length === 0) {
      return;
    }
    try {
      await this.db.batch(statements);
    } catch (error) {
      for (const snapshot of snapshots) {
        const layout = plan.mode(snapshot.doctype) === "shadow" ? plan.layout(snapshot.doctype) : undefined;
        if (layout === undefined) {
          continue;
        }
        plan.onShadowWriteFailure({
          table: layout.table,
          tenantId: snapshot.tenantId,
          doctype: snapshot.doctype,
          name: snapshot.name,
          version: snapshot.version,
          reason: errorMessage(error)
        });
      }
    }
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
