import { cloneDomainEvent } from "../../core/domain-events.js";
import type { DomainEvent, NewDomainEvent } from "../../core/types.js";
import { D1_EVENTS_TABLE } from "./tables.js";

export { sequenceEvents } from "../../core/domain-events.js";

export function insertEventStatement(db: D1Database, event: DomainEvent): D1PreparedStatement {
  const normalized = cloneDomainEvent(event);
  return db
    .prepare(
      `INSERT INTO ${D1_EVENTS_TABLE}
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

/**
 * Appends one event at the head of its stream, taking the sequence inside the
 * statement instead of from an expected version.
 *
 * Only for streams that many writers append to and none of them reads before
 * appending — the projection handoff (`ProjectionHandoff`). Inside a D1 batch
 * the statements run one after another in one transaction on a single writer,
 * so `MAX(sequence) + 1` is race-free, and two such statements in the same
 * batch see each other. `UNIQUE(stream, sequence)` still stands behind it: a
 * compare-and-swap appender that read the old head fails on its insert and
 * retries, exactly as it does against any other writer.
 *
 * The `sequence` the caller holds is ignored, which is why this takes a
 * `NewDomainEvent`: the true one is only known once the batch has run.
 */
export function insertEventAtHeadStatement(db: D1Database, event: NewDomainEvent): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO ${D1_EVENTS_TABLE}
       (id, tenant_id, stream, sequence, type, doctype, document_name, actor_id, occurred_at, payload_json, metadata_json)
       SELECT ?, ?, ?, COALESCE(MAX(sequence), 0) + 1, ?, ?, ?, ?, ?, ?, ?
       FROM ${D1_EVENTS_TABLE}
       WHERE stream = ?`
    )
    .bind(
      event.id,
      event.tenantId,
      event.stream,
      event.type,
      event.doctype,
      event.documentName,
      event.actorId,
      event.occurredAt,
      JSON.stringify(event.payload),
      JSON.stringify(event.metadata),
      event.stream
    );
}
