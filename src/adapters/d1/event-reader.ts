import type { DomainEvent, StreamName } from "../../core/types.js";
import type { AuditDocumentEventQuery, AuditEventQuery } from "../../ports/audit-event-store.js";
import type { ReadStreamOptions } from "../../ports/document-store.js";
import { auditDocumentEventQuery, auditEventQuery } from "./audit-event-query.js";
import { eventStreamQuery } from "./read-stream-query.js";
import { eventFromRow, type EventRow } from "./serde.js";

export async function readD1EventStream(
  db: D1Database,
  stream: StreamName,
  options: ReadStreamOptions = {}
): Promise<readonly DomainEvent[]> {
  const query = eventStreamQuery(options);
  const result = await db
    .prepare(query.sql)
    .bind(stream, ...query.params)
    .all<EventRow>();
  const events = (result.results ?? []).map(eventFromRow);
  return query.reverseResults ? [...events].reverse() : events;
}

export async function searchD1AuditEvents(
  db: D1Database,
  query: AuditEventQuery
): Promise<readonly DomainEvent[]> {
  const prepared = auditEventQuery(query);
  const result = await db
    .prepare(prepared.sql)
    .bind(...prepared.params)
    .all<EventRow>();
  return (result.results ?? []).map(eventFromRow);
}

export async function readD1AuditDocumentEvents(
  db: D1Database,
  query: AuditDocumentEventQuery
): Promise<readonly DomainEvent[]> {
  const prepared = auditDocumentEventQuery(query);
  const result = await db
    .prepare(prepared.sql)
    .bind(...prepared.params)
    .all<EventRow>();
  return (result.results ?? []).map(eventFromRow);
}
