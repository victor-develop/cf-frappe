import { conflict } from "../../core/errors";
import type {
  DocumentSnapshot,
  DomainEvent,
  NewDomainEvent,
  StreamName
} from "../../core/types";
import type { DocumentCommit, DocumentStore, ReadStreamOptions } from "../../ports/document-store";
import { isD1ConstraintError } from "./constraint-error";
import { eventStreamQuery } from "./read-stream-query";
import { eventFromRow, type EventRow } from "./serde";

export class D1DocumentStore implements DocumentStore {
  constructor(private readonly db: D1Database) {}

  async commit(
    stream: StreamName,
    expectedVersion: number,
    events: readonly NewDomainEvent[],
    project: (events: readonly DomainEvent[]) => DocumentSnapshot
  ): Promise<DocumentCommit> {
    const current = await this.currentVersion(stream);
    if (current !== expectedVersion) {
      throw conflict(`Expected stream '${stream}' at version ${expectedVersion}, found ${current}`);
    }

    const saved = events.map((event, index) => ({
      ...event,
      sequence: expectedVersion + index + 1
    }));
    const snapshot = project(saved);
    try {
      await this.db.batch([
        ...saved.map((event) =>
          this.db
            .prepare(
              `INSERT INTO cf_frappe_events
               (id, tenant_id, stream, sequence, type, doctype, document_name, actor_id, occurred_at, payload_json, metadata_json)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .bind(
              event.id,
              event.tenantId,
              event.stream,
              event.sequence,
              event.type,
              event.doctype,
              event.documentName,
              event.actorId,
              event.occurredAt,
              JSON.stringify(event.payload),
              JSON.stringify(event.metadata)
            )
        ),
        this.db
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
            snapshot.tenantId,
            snapshot.doctype,
            snapshot.name,
            snapshot.version,
            snapshot.docstatus,
            JSON.stringify(snapshot.data),
            snapshot.createdAt,
            snapshot.updatedAt
          )
      ]);
    } catch (error) {
      if (isD1ConstraintError(error)) {
        throw conflict(`Stream '${stream}' changed while committing`);
      }
      throw error;
    }
    return { events: saved, snapshot };
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
}
