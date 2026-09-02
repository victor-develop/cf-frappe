import type { DomainEvent } from "../../core/types.js";
import { documentStream } from "../../core/streams.js";
import type { AuditDocumentEventQuery, AuditEventQuery } from "../../ports/audit-event-store.js";

export function searchInMemoryAuditEvents(
  streams: Iterable<readonly DomainEvent[]>,
  query: AuditEventQuery
): readonly DomainEvent[] {
  const payloadKinds = query.payloadKinds === undefined ? undefined : new Set(query.payloadKinds);
  const events = [...streams]
    .flatMap((stream) => [...stream])
    .filter((event) => event.tenantId === query.tenantId)
    .filter((event) => query.doctype === undefined || event.doctype === query.doctype)
    .filter((event) => query.documentName === undefined || event.documentName === query.documentName)
    .filter((event) => query.actorId === undefined || event.actorId === query.actorId)
    .filter((event) => query.since === undefined || event.occurredAt >= query.since)
    .filter((event) => query.until === undefined || event.occurredAt <= query.until)
    .filter((event) => payloadKinds === undefined || payloadKinds.has(event.payload.kind))
    .sort(byAuditOrder);
  return query.limit === undefined ? events : events.slice(0, query.limit);
}

export function readInMemoryAuditDocumentEvents(
  streams: ReadonlyMap<string, readonly DomainEvent[]>,
  query: AuditDocumentEventQuery
): readonly DomainEvent[] {
  // Mirror the D1 adapter: the document's own stream by default, or a
  // column match inside one explicitly named stream.
  const stream = query.stream ?? documentStream(query.tenantId, query.doctype, query.documentName);
  const candidates = [...(streams.get(stream) ?? [])];
  const events = (
    query.stream === undefined
      ? candidates
      : candidates.filter(
          (event) =>
            event.tenantId === query.tenantId &&
            event.doctype === query.doctype &&
            event.documentName === query.documentName
        )
  ).sort((left, right) => left.sequence - right.sequence);
  return query.limit === undefined ? events : events.slice(0, query.limit);
}

function byAuditOrder(left: DomainEvent, right: DomainEvent): number {
  const time = right.occurredAt.localeCompare(left.occurredAt);
  if (time !== 0) {
    return time;
  }
  const stream = left.stream.localeCompare(right.stream);
  if (stream !== 0) {
    return stream;
  }
  return right.sequence - left.sequence;
}
