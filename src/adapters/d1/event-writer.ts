import { cloneDomainEvent } from "../../core/domain-events.js";
import type { DomainEvent } from "../../core/types.js";

export { sequenceEvents } from "../../core/domain-events.js";

export function insertEventStatement(db: D1Database, event: DomainEvent): D1PreparedStatement {
  const normalized = cloneDomainEvent(event);
  return db
    .prepare(
      `INSERT INTO cf_frappe_events
       (id, tenant_id, stream, sequence, type, doctype, document_name, actor_id, occurred_at, payload_json, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      normalized.id,
      normalized.tenantId,
      normalized.stream,
      normalized.sequence,
      normalized.type,
      normalized.doctype,
      normalized.documentName,
      normalized.actorId,
      normalized.occurredAt,
      JSON.stringify(normalized.payload),
      JSON.stringify(normalized.metadata)
    );
}

export function insertEventStatements(
  db: D1Database,
  events: readonly DomainEvent[]
): readonly D1PreparedStatement[] {
  return events.map((event) => insertEventStatement(db, event));
}
