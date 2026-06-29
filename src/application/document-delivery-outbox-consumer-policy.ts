import { hasDomainEventPayloadKind } from "../core/domain-events.js";
import { badRequest, notFound } from "../core/errors.js";
import type { DocumentData, DocumentSnapshot, DomainEvent, TenantId } from "../core/types.js";
import type { DocumentDeliveryOutboxRecord, DocumentDeliveryOutboxTarget } from "./document-delivery-outbox-events.js";

export const DOCUMENT_DELIVERY_OUTBOX_DEFAULT_DRAIN_LIMIT = 25;
export const DOCUMENT_DELIVERY_OUTBOX_MAX_DRAIN_LIMIT = 100;

export interface DocumentDeliveryOutboxDeliveryOutcome {
  readonly outboxId: string;
  readonly target: DocumentDeliveryOutboxTarget;
  readonly status: "delivered" | "failed";
  readonly attempts: number;
  readonly error?: string;
  readonly retryAt?: string;
}

export interface DocumentDeliveryOutboxDrainResult {
  readonly tenantId: TenantId;
  readonly claimed: number;
  readonly delivered: number;
  readonly failed: number;
  readonly outcomes: readonly DocumentDeliveryOutboxDeliveryOutcome[];
}

export function ensureDocumentDeliveryOutboxConsumerAvailable<T>(consumer: T | undefined): asserts consumer is T {
  if (consumer === undefined) {
    throw notFound("Document delivery outbox consumer is not available");
  }
}

export function documentDeliveryOutboxErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function hasQueuedDocumentDeliveryEmailMessageId<TDelivery extends {
  readonly status: string;
  readonly messageId?: string;
}>(delivery: TDelivery): delivery is TDelivery & { readonly messageId: string } {
  return delivery.status === "queued" && delivery.messageId !== undefined;
}

export function documentDeliveryOutboxDrainLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DOCUMENT_DELIVERY_OUTBOX_DEFAULT_DRAIN_LIMIT;
  }
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > DOCUMENT_DELIVERY_OUTBOX_MAX_DRAIN_LIMIT) {
    throw badRequest(
      `Document delivery outbox drain limit must be an integer between 1 and ${DOCUMENT_DELIVERY_OUTBOX_MAX_DRAIN_LIMIT}`
    );
  }
  return limit;
}

export function parseDocumentDeliveryOutboxDrainJobLimit(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number") {
    throw badRequest("Document delivery outbox drain job limit is invalid");
  }
  return documentDeliveryOutboxDrainLimit(value);
}

export function parseDocumentDeliveryOutboxDrainJobClaimId(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw badRequest("Document delivery outbox drain job claimId is invalid");
  }
  return value;
}

export function documentDeliveryOutboxDrainResultJson(result: DocumentDeliveryOutboxDrainResult): DocumentData {
  return {
    tenantId: result.tenantId,
    claimed: result.claimed,
    delivered: result.delivered,
    failed: result.failed,
    outcomes: result.outcomes.map((outcome) => ({
      outboxId: outcome.outboxId,
      target: outcome.target,
      status: outcome.status,
      attempts: outcome.attempts,
      ...(outcome.error === undefined ? {} : { error: outcome.error }),
      ...(outcome.retryAt === undefined ? {} : { retryAt: outcome.retryAt })
    }))
  };
}

export function documentDeliveryOutboxRecordClaimId(record: DocumentDeliveryOutboxRecord): string {
  if (record.claimId === undefined || record.claimId.trim().length === 0) {
    throw badRequest(`Document delivery outbox record '${record.id}' is not claimed`);
  }
  return record.claimId;
}

export function documentDeliveryOutboxRetryDelaySeconds(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw badRequest(`${label} must be a positive integer`);
  }
  return value;
}

export function documentDeliveryOutboxRetryAt(command: {
  readonly now: string;
  readonly attempts: number;
  readonly baseDelaySeconds: number;
  readonly maxDelaySeconds: number;
}): string {
  const delaySeconds = Math.min(
    command.maxDelaySeconds,
    command.baseDelaySeconds * 2 ** Math.max(0, command.attempts - 1)
  );
  return new Date(Date.parse(command.now) + delaySeconds * 1000).toISOString();
}

export function documentDeliveryOutboxSourceFromRecord(record: DocumentDeliveryOutboxRecord): {
  readonly event: DomainEvent;
  readonly snapshot: DocumentSnapshot | null;
} {
  const event = record.payload.event;
  if (!isDomainEvent(event)) {
    throw badRequest(`Document delivery outbox record '${record.id}' does not contain a source domain event`);
  }
  const snapshot = record.payload.snapshot;
  if (snapshot === undefined || snapshot === null) {
    return { event, snapshot: null };
  }
  if (!isDocumentSnapshot(snapshot)) {
    throw badRequest(`Document delivery outbox record '${record.id}' contains an invalid source snapshot`);
  }
  return { event, snapshot };
}

function isDomainEvent(value: unknown): value is DomainEvent {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.id === "string" &&
    typeof value.tenantId === "string" &&
    typeof value.stream === "string" &&
    typeof value.sequence === "number" &&
    typeof value.type === "string" &&
    typeof value.doctype === "string" &&
    typeof value.documentName === "string" &&
    typeof value.actorId === "string" &&
    typeof value.occurredAt === "string" &&
    hasDomainEventPayloadKind(value) &&
    isRecord(value.metadata)
  );
}

function isDocumentSnapshot(value: unknown): value is DocumentSnapshot {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.tenantId === "string" &&
    typeof value.doctype === "string" &&
    typeof value.name === "string" &&
    typeof value.version === "number" &&
    typeof value.docstatus === "string" &&
    isRecord(value.data) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
