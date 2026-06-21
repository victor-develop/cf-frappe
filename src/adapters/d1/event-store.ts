import { conflict } from "../../core/errors";
import type { DomainEvent, NewDomainEvent, StreamName } from "../../core/types";
import type { EventStore } from "../../ports/event-store";
import { eventFromRow, type EventRow } from "./serde";

export class D1EventStore implements EventStore {
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
    return saved;
  }

  async readStream(stream: StreamName): Promise<readonly DomainEvent[]> {
    const result = await this.db
      .prepare(
        `SELECT id, tenant_id, stream, sequence, type, doctype, document_name, actor_id, occurred_at, payload_json, metadata_json
         FROM cf_frappe_events
         WHERE stream = ?
         ORDER BY sequence ASC`
      )
      .bind(stream)
      .all<EventRow>();
    return (result.results ?? []).map(eventFromRow);
  }

  async currentVersion(stream: StreamName): Promise<number> {
    const row = await this.db
      .prepare("SELECT COALESCE(MAX(sequence), 0) AS version FROM cf_frappe_events WHERE stream = ?")
      .bind(stream)
      .first<{ version: number }>();
    return Number(row?.version ?? 0);
  }
}
