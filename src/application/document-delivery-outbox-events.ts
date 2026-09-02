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
    };

export type DocumentDeliveryOutboxPayloadKind = DocumentDeliveryOutboxEventPayload["kind"];

export const DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KINDS = Object.freeze([
  "DocumentDeliveryOutboxEnqueued",
  "DocumentDeliveryOutboxClaimed",
  "DocumentDeliveryOutboxDelivered",
  "DocumentDeliveryOutboxFailed"
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
    if (!isDocumentDeliveryOutboxEvent(event) || event.payload.outboxId !== outboxId) {
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
