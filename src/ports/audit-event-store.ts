import type {
  DocTypeName,
  DocumentEventPayload,
  DocumentName,
  DomainEvent,
  StreamName,
  TenantId
} from "../core/types.js";

export interface AuditEventQuery {
  readonly tenantId: TenantId;
  readonly doctype?: DocTypeName;
  readonly documentName?: DocumentName;
  readonly actorId?: string;
  readonly payloadKinds?: readonly DocumentEventPayload["kind"][];
  readonly since?: string;
  readonly until?: string;
  readonly limit?: number;
}

export interface AuditDocumentEventQuery {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly documentName: DocumentName;
  readonly limit?: number;
  /**
   * Stream the events live in, when it is not the document's own stream.
   *
   * Omitted, this reads `documentStream(tenantId, doctype, documentName)` and
   * nothing else — a document's authoritative history is only ever in its own
   * stream, and an event elsewhere claiming its doctype and name must not be
   * read back as part of it. `tests/application/audit-service.test.ts` guards
   * that with a forged off-stream delete.
   *
   * Passed explicitly, the events are matched by `(tenantId, doctype,
   * documentName)` **within that one stream**. That is for event kinds which
   * carry a doctype and document name while living in a shared stream — the
   * delivery outbox writes every tenant record into
   * `documentDeliveryOutboxStream(tenantId)`. The stream stays a required input
   * rather than being inferred, so widening this cannot widen the guard above.
   */
  readonly stream?: StreamName;
  /**
   * Sequence order the events come back in. Defaults to `"asc"`, which is the
   * order a fold needs.
   *
   * `"desc"` exists so `limit` can take the *tail* of a document's history
   * instead of its head. The delivery outbox needs the last compaction
   * checkpoint out of a document name that accumulates one per delivery: taking
   * the first would compact almost nothing, and reading them all is the cost
   * that lookup exists to avoid (12.5k rows on a 50k-event outbox stream).
   * `idx_cf_frappe_events_document_name` serves it in either direction, so
   * newest-first costs the same 2.0 µs there.
   */
  readonly order?: "asc" | "desc";
}

export interface AuditEventStore {
  searchEvents(query: AuditEventQuery): Promise<readonly DomainEvent[]>;
  readDocumentEvents(query: AuditDocumentEventQuery): Promise<readonly DomainEvent[]>;
}
