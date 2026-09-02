import { domainEventPayloadKind } from "../core/domain-events.js";
import type { DocumentData, DocumentName, DocTypeName, DomainEvent, TenantId } from "../core/types.js";

export type DocumentDeliveryOutboxTarget = "notification" | "realtime" | "email";

export type DocumentDeliveryOutboxStatus = "pending" | "claimed" | "delivered" | "failed";

export type DocumentDeliveryOutboxEventPayload =
  | {
      readonly kind: "DocumentDeliveryOutboxEnqueued";
      readonly outboxId: string;
      readonly target: DocumentDeliveryOutboxTarget;
      readonly sourceEventId: string;
      readonly sourceEventType: string;
      readonly payloadKind: string;
      readonly doctype: DocTypeName;
      readonly documentName: DocumentName;
      readonly actorId: string;
      readonly payload?: DocumentData;
    }
  | {
      readonly kind: "DocumentDeliveryOutboxClaimed";
      readonly outboxId: string;
      readonly claimId: string;
    }
  | {
      readonly kind: "DocumentDeliveryOutboxDelivered";
      readonly outboxId: string;
      readonly claimId: string;
    }
  | {
      readonly kind: "DocumentDeliveryOutboxFailed";
      readonly outboxId: string;
      readonly claimId: string;
      readonly error: string;
      readonly retryAt?: string;
    }
  | {
      /**
       * Everything in this stream at or below `upToSequence` is terminal except
       * the records named in `carryOver`, so a fold can start here instead of at
       * sequence 1. The one payload kind that is about the stream rather than
       * about a record, hence no `outboxId`.
       */
      readonly kind: "DocumentDeliveryOutboxCheckpointed";
      /**
       * The stream version this checkpoint summarises — the head *before* the
       * commit that carries it, so the checkpoint's own sequence is
       * `upToSequence + 1` and a reader resuming at `upToSequence + 1` always
       * finds it. Deliberately not the delivered event's sequence: that would
       * put the checkpoint at `upToSequence + 2` and leave the delivery itself
       * outside a window that starts at the checkpoint.
       */
      readonly upToSequence: number;
      /**
       * Outbox ids still in flight at `upToSequence`. A reader rehydrates each
       * one from its own events, which is why a permanently failing target does
       * not stop history compacting — it is carried, not waited for.
       */
      readonly carryOver: readonly string[];
    };

export type DocumentDeliveryOutboxPayloadKind = DocumentDeliveryOutboxEventPayload["kind"];

/** Payload kinds that name a single outbox record; every kind but the checkpoint. */
export type DocumentDeliveryOutboxRecordEventPayload = Extract<
  DocumentDeliveryOutboxEventPayload,
  { readonly outboxId: string }
>;

export type DocumentDeliveryOutboxCheckpointPayload = Extract<
  DocumentDeliveryOutboxEventPayload,
  { readonly kind: "DocumentDeliveryOutboxCheckpointed" }
>;

export const DOCUMENT_DELIVERY_OUTBOX_CHECKPOINT_KIND = "DocumentDeliveryOutboxCheckpointed";

/**
 * `documentName` the compaction checkpoint is written under.
 *
 * Outbox records share one stream per tenant and are told apart by
 * `documentName = outboxId`, so the checkpoint needs a name no record can take.
 * Outbox ids are always `${eventId}:${target}` and therefore always contain a
 * colon; this cannot collide. It is also what makes the checkpoint lookup cheap:
 * `idx_cf_frappe_events_document_name` serves it in 2.0 µs on a 50k-event stream
 * with checkpoints present and 0.6 µs with none (an empty index range), instead
 * of the 6–14 ms backwards scan a `type` or `json_extract` filter costs when no
 * checkpoint is there to stop the scan early.
 */
export const DOCUMENT_DELIVERY_OUTBOX_CHECKPOINT_DOCUMENT_NAME = "__checkpoint";

export const DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KINDS = Object.freeze([
  "DocumentDeliveryOutboxEnqueued",
  "DocumentDeliveryOutboxClaimed",
  "DocumentDeliveryOutboxDelivered",
  "DocumentDeliveryOutboxFailed",
  // The checkpoint has to be in this set even though it mutates no record.
  // `state.version` is the optimistic-concurrency expectation and is folded from
  // whatever this filter returns, so a checkpoint the filter hides is a version
  // below the true stream head — and then every append for that tenant fails
  // with a conflict no retry can clear. The service's own commits never leave a
  // checkpoint at the head (it rides ahead of the delivery it summarises), so
  // this is not reachable through them today; nothing enforces that, which is
  // why "keeps working when a checkpoint is the newest event in the stream"
  // writes one by hand.
  "DocumentDeliveryOutboxCheckpointed"
] as const satisfies readonly DocumentDeliveryOutboxPayloadKind[]);

const DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KIND_SET = new Set<string>(DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KINDS);

export interface DocumentDeliveryOutboxRecord {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly target: DocumentDeliveryOutboxTarget;
  readonly sourceEventId: string;
  readonly sourceEventType: string;
  readonly payloadKind: string;
  readonly doctype: string;
  readonly documentName: string;
  readonly actorId: string;
  readonly payload: DocumentData;
  readonly status: DocumentDeliveryOutboxStatus;
  readonly attempts: number;
  readonly enqueuedAt: string;
  readonly claimedAt?: string;
  readonly claimId?: string;
  readonly deliveredAt?: string;
  readonly failedAt?: string;
  readonly error?: string;
  readonly retryAt?: string;
}

export interface DocumentDeliveryOutboxState {
  readonly tenantId: TenantId;
  readonly version: number;
  readonly records: ReadonlyMap<string, DocumentDeliveryOutboxRecord>;
}

export function documentDeliveryOutboxRecordId(eventId: string, target: DocumentDeliveryOutboxTarget): string {
  return `${eventId}:${target}`;
}

export function documentDeliveryOutboxEventType(
  payload: DocumentDeliveryOutboxEventPayload
): DocumentDeliveryOutboxPayloadKind {
  return payload.kind;
}

export function isDocumentDeliveryOutboxPayloadKind(kind: string): kind is DocumentDeliveryOutboxPayloadKind {
  return DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KIND_SET.has(kind);
}

export function isDocumentDeliveryOutboxEvent(
  event: DomainEvent
): event is DomainEvent<DocumentDeliveryOutboxEventPayload> {
  return isDocumentDeliveryOutboxPayloadKind(domainEventPayloadKind(event));
}

/**
 * Narrows away the checkpoint, which is the only outbox payload with no
 * `outboxId`.
 *
 * Every per-record fold has to go through this before touching `outboxId`.
 * A `case` for the checkpoint inside the switch is not enough: the guard that
 * skips other records' events reads `payload.outboxId` *before* the switch.
 */
export function isDocumentDeliveryOutboxRecordPayload(
  payload: DocumentDeliveryOutboxEventPayload
): payload is DocumentDeliveryOutboxRecordEventPayload {
  return payload.kind !== DOCUMENT_DELIVERY_OUTBOX_CHECKPOINT_KIND;
}

/** The compaction checkpoint carried by `event`, or null when it is not one. */
export function documentDeliveryOutboxCheckpoint(
  event: DomainEvent
): DocumentDeliveryOutboxCheckpointPayload | null {
  if (!isDocumentDeliveryOutboxEvent(event) || event.payload.kind !== DOCUMENT_DELIVERY_OUTBOX_CHECKPOINT_KIND) {
    return null;
  }
  return event.payload;
}

export function foldDocumentDeliveryOutbox(
  tenantId: TenantId,
  events: readonly DomainEvent[]
): DocumentDeliveryOutboxState {
  return foldDocumentDeliveryOutboxFrom(null, tenantId, events);
}

export function foldDocumentDeliveryOutboxFrom(
  initial: DocumentDeliveryOutboxState | null,
  tenantId: TenantId,
  events: readonly DomainEvent[]
): DocumentDeliveryOutboxState {
  const records = new Map<string, DocumentDeliveryOutboxRecord>(initial?.records ?? []);
  let version = initial?.version ?? 0;
  for (const event of events) {
    version = Math.max(version, event.sequence);
    if (!isDocumentDeliveryOutboxEvent(event)) {
      continue;
    }
    switch (event.payload.kind) {
      case "DocumentDeliveryOutboxEnqueued":
        records.set(event.payload.outboxId, {
          id: event.payload.outboxId,
          tenantId,
          target: event.payload.target,
          sourceEventId: event.payload.sourceEventId,
          sourceEventType: event.payload.sourceEventType,
          payloadKind: event.payload.payloadKind,
          doctype: event.payload.doctype,
          documentName: event.payload.documentName,
          actorId: event.payload.actorId,
          payload: event.payload.payload ?? {},
          status: "pending",
          attempts: 0,
          enqueuedAt: event.occurredAt
        });
        break;
      case "DocumentDeliveryOutboxClaimed": {
        const current = records.get(event.payload.outboxId);
        if (current) {
          const { error: _error, retryAt: _retryAt, ...claimable } = current;
          records.set(current.id, {
            ...claimable,
            status: "claimed",
            attempts: current.attempts + 1,
            claimId: event.payload.claimId,
            claimedAt: event.occurredAt
          });
        }
        break;
      }
      case "DocumentDeliveryOutboxDelivered":
        // Delivered records leave the working set. Keeping them made this state
        // grow with every delivery the tenant had ever made, and every outbox
        // operation folds it — see issue #28. The delivery is still in the event
        // stream; `foldDocumentDeliveryOutboxRecord` reads one back.
        records.delete(event.payload.outboxId);
        break;
      case "DocumentDeliveryOutboxFailed": {
        const current = records.get(event.payload.outboxId);
        if (current) {
          records.set(current.id, {
            ...current,
            status: "failed",
            claimId: event.payload.claimId,
            failedAt: event.occurredAt,
            error: event.payload.error,
            ...(event.payload.retryAt === undefined ? {} : { retryAt: event.payload.retryAt })
          });
        }
        break;
      }
      case "DocumentDeliveryOutboxCheckpointed":
        // A checkpoint changes no record: it only records where a *reader* may
        // start. It still has to reach this fold, because the version it carries
        // the stream to is the optimistic-concurrency expectation. Spelt out
        // rather than left to the missing `default` — this switch silently skips
        // kinds it does not name, so an omission here would not be a type error.
        break;
    }
  }
  return { tenantId, version, records };
}

export function documentDeliveryRetryDue(record: DocumentDeliveryOutboxRecord, now: string): boolean {
  return record.retryAt === undefined || record.retryAt <= now;
}

export function sortedDocumentDeliveryOutboxRecords(
  state: DocumentDeliveryOutboxState
): readonly DocumentDeliveryOutboxRecord[] {
  return [...state.records.values()].sort(
    (left, right) => left.enqueuedAt.localeCompare(right.enqueuedAt) || left.id.localeCompare(right.id)
  );
}

export function selectedDocumentDeliveryOutboxRecords(
  state: DocumentDeliveryOutboxState,
  recordIds: readonly string[] | undefined
): readonly DocumentDeliveryOutboxRecord[] {
  if (recordIds === undefined) {
    return sortedDocumentDeliveryOutboxRecords(state);
  }
  return recordIds.flatMap((id) => {
    const record = state.records.get(id);
    return record ? [record] : [];
  });
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly DocumentDeliveryOutboxEnqueued: Extract<
      DocumentDeliveryOutboxEventPayload,
      { readonly kind: "DocumentDeliveryOutboxEnqueued" }
    >;
    readonly DocumentDeliveryOutboxClaimed: Extract<
      DocumentDeliveryOutboxEventPayload,
      { readonly kind: "DocumentDeliveryOutboxClaimed" }
    >;
    readonly DocumentDeliveryOutboxDelivered: Extract<
      DocumentDeliveryOutboxEventPayload,
      { readonly kind: "DocumentDeliveryOutboxDelivered" }
    >;
    readonly DocumentDeliveryOutboxFailed: Extract<
      DocumentDeliveryOutboxEventPayload,
      { readonly kind: "DocumentDeliveryOutboxFailed" }
    >;
    readonly DocumentDeliveryOutboxCheckpointed: DocumentDeliveryOutboxCheckpointPayload;
  }
}

/**
 * Folds one outbox record's own events, keeping terminal state.
 *
 * {@link foldDocumentDeliveryOutboxFrom} drops delivered records so the working
 * set stays bounded, which means it cannot answer "did this already finish?".
 * This can, and it is bounded by that record's own history rather than the
 * tenant's.
 */
export function foldDocumentDeliveryOutboxRecord(
  tenantId: TenantId,
  outboxId: string,
  events: readonly DomainEvent[]
): DocumentDeliveryOutboxRecord | null {
  return foldDocumentDeliveryOutboxRecordFrom(null, tenantId, outboxId, events);
}

/** Resumable form, so a snapshot can stand in for the head of the record's events. */
export function foldDocumentDeliveryOutboxRecordFrom(
  initial: DocumentDeliveryOutboxRecord | null,
  tenantId: TenantId,
  outboxId: string,
  events: readonly DomainEvent[]
): DocumentDeliveryOutboxRecord | null {
  let record: DocumentDeliveryOutboxRecord | null = initial;
  for (const event of events) {
    if (
      !isDocumentDeliveryOutboxEvent(event) ||
      // Compaction checkpoints share the stream and belong to no record, so
      // they are skipped before `outboxId` is even read — the union member has
      // no such field.
      !isDocumentDeliveryOutboxRecordPayload(event.payload) ||
      event.payload.outboxId !== outboxId
    ) {
      // The outbox id is a required input rather than something inferred from
      // the first event: outbox records share one stream per tenant, so a fold
      // that took whatever it was handed would apply one record's terminal
      // event to another. Callers cannot get that wrong here.
      continue;
    }
    switch (event.payload.kind) {
      case "DocumentDeliveryOutboxEnqueued":
        record = {
          id: event.payload.outboxId,
          tenantId,
          target: event.payload.target,
          sourceEventId: event.payload.sourceEventId,
          sourceEventType: event.payload.sourceEventType,
          payloadKind: event.payload.payloadKind,
          doctype: event.payload.doctype,
          documentName: event.payload.documentName,
          actorId: event.payload.actorId,
          payload: event.payload.payload ?? {},
          status: "pending",
          attempts: 0,
          enqueuedAt: event.occurredAt
        };
        break;
      case "DocumentDeliveryOutboxClaimed":
        if (record) {
          const { error: _error, retryAt: _retryAt, ...claimable } = record;
          record = {
            ...claimable,
            status: "claimed",
            attempts: record.attempts + 1,
            claimId: event.payload.claimId,
            claimedAt: event.occurredAt
          };
        }
        break;
      case "DocumentDeliveryOutboxDelivered":
        if (record) {
          const { error: _error, retryAt: _retryAt, ...deliverable } = record;
          record = {
            ...deliverable,
            status: "delivered",
            claimId: event.payload.claimId,
            deliveredAt: event.occurredAt
          };
        }
        break;
      case "DocumentDeliveryOutboxFailed":
        if (record) {
          record = {
            ...record,
            status: "failed",
            claimId: event.payload.claimId,
            failedAt: event.occurredAt,
            error: event.payload.error,
            ...(event.payload.retryAt === undefined ? {} : { retryAt: event.payload.retryAt })
          };
        }
        break;
    }
  }
  return record;
}
