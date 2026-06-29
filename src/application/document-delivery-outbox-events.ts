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
): DocumentDeliveryOutboxEventPayload["kind"] {
  return payload.kind;
}

export function foldDocumentDeliveryOutbox(
  tenantId: TenantId,
  events: readonly DomainEvent[]
): DocumentDeliveryOutboxState {
  const records = new Map<string, DocumentDeliveryOutboxRecord>();
  let version = 0;
  for (const event of events) {
    version = Math.max(version, event.sequence);
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
      case "DocumentDeliveryOutboxDelivered": {
        const current = records.get(event.payload.outboxId);
        if (current) {
          const { error: _error, retryAt: _retryAt, ...deliverable } = current;
          records.set(current.id, {
            ...deliverable,
            status: "delivered",
            claimId: event.payload.claimId,
            deliveredAt: event.occurredAt
          });
        }
        break;
      }
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
