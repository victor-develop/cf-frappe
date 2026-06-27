import type { DomainEvent, NewDomainEvent } from "../../core/types.js";

export function sequenceEvents(
  expectedVersion: number,
  events: readonly NewDomainEvent[]
): readonly DomainEvent[] {
  return events.map((event, index) => ({
    ...event,
    sequence: expectedVersion + index + 1
  }));
}

export function insertEventStatement(db: D1Database, event: DomainEvent): D1PreparedStatement {
  return db
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
    );
}

export function insertEventStatements(
  db: D1Database,
  events: readonly DomainEvent[]
): readonly D1PreparedStatement[] {
  return events.map((event) => insertEventStatement(db, event));
}
