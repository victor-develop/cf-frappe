import { conflict } from "../../core/errors";
import type { DomainEvent, NewDomainEvent, StreamName } from "../../core/types";
import type { AuditDocumentEventQuery, AuditEventQuery, AuditEventStore } from "../../ports/audit-event-store";
import type { EventStore } from "../../ports/event-store";
import type { ReadStreamOptions } from "../../ports/document-store";
import { auditDocumentEventQuery, auditEventQuery } from "./audit-event-query";
import { isD1ConstraintError } from "./constraint-error";
import { eventStreamQuery } from "./read-stream-query";
import { eventFromRow, type EventRow } from "./serde";

export class D1EventStore implements EventStore, AuditEventStore {
  constructor(private readonly db: D1Database) {}

  async append(
    stream: StreamName,
    expectedVersion: number,
    events: readonly NewDomainEvent[]
  ): Promise<readonly DomainEvent[]> {
    const current = await this.currentVersion(stream);
    if (current !== expectedVersion) {
      throw conflict(`Expected stream '${stream}' at version ${expectedVersion}, found ${current}`);
    }

    const saved = events.map((event, index) => ({
      ...event,
      sequence: expectedVersion + index + 1
    }));
    try {
      await this.db.batch(
        saved.map((event) =>
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
        )
      );
    } catch (error) {
      if (isD1ConstraintError(error)) {
        throw conflict(`Stream '${stream}' changed while appending`);
      }
      throw error;
    }
    return saved;
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
