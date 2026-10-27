import { conflict, badRequest } from "../core/errors.js";
import type { DocumentData, DocumentSnapshot, DomainEvent } from "../core/types.js";
import {
  documentDeliveryRetryDue,
  type DocumentDeliveryOutboxRecord,
  type DocumentDeliveryOutboxState
} from "./document-delivery-outbox-events.js";

export const DOCUMENT_DELIVERY_OUTBOX_DEFAULT_CLAIM_LIMIT = 25;
export const DOCUMENT_DELIVERY_OUTBOX_MAX_CLAIM_LIMIT = 100;

export type DocumentDeliveryOutboxRecordLookupDecision =
  | { readonly status: "found"; readonly record: DocumentDeliveryOutboxRecord }
  | { readonly status: "missing"; readonly message: string };

export function documentDeliveryOutboxPayload(
  event: DomainEvent,
  snapshot: DocumentSnapshot | null | undefined
): DocumentData {
  return {
    event: event as unknown as DocumentData,
    ...(snapshot === undefined || snapshot === null ? {} : { snapshot: snapshot as unknown as DocumentData })
  };
}

export function documentDeliveryOutboxClaimLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DOCUMENT_DELIVERY_OUTBOX_DEFAULT_CLAIM_LIMIT;
  }
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > DOCUMENT_DELIVERY_OUTBOX_MAX_CLAIM_LIMIT) {
    throw badRequest(
      `Delivery outbox claim limit must be an integer between 1 and ${String(
        DOCUMENT_DELIVERY_OUTBOX_MAX_CLAIM_LIMIT
      )}`
    );
  }
  return limit;
}

export function documentDeliveryOutboxRecordLookup(
  state: DocumentDeliveryOutboxState,
  outboxId: string
): DocumentDeliveryOutboxRecordLookupDecision {
  const record = state.records.get(outboxId);
  if (record === undefined) {
    return {
      status: "missing",
      message: `Document delivery outbox record '${outboxId}' was not found`
    };
  }
  return { status: "found", record };
}

export function claimableDocumentDeliveryOutboxRecords(
  state: DocumentDeliveryOutboxState,
  now: string,
  limit: number,
  claimLeaseSeconds?: number
): readonly DocumentDeliveryOutboxRecord[] {
  return [...state.records.values()]
    .filter((record) =>
      record.status === "pending" ||
      (record.status === "failed" && documentDeliveryRetryDue(record, now)) ||
      (claimLeaseSeconds !== undefined && documentDeliveryClaimExpired(record, now, claimLeaseSeconds))
    )
    .sort((left, right) => left.enqueuedAt.localeCompare(right.enqueuedAt) || left.id.localeCompare(right.id))
    .slice(0, limit);
}

/**
 * True for a record claimed longer ago than the lease.
 *
 * Without a lease a claim is forever: a consumer that dies between claiming and
 * completing leaves the record `claimed`, and nothing claims it again. That was
 * acceptable for notifications, which are best-effort; a projection delivery
 * that is never retried is a list that never shows the write. Reclaiming hands
 * the record a new claim id, so the original consumer — if it was only slow —
 * fails its completion with a conflict instead of completing twice.
 */
export function documentDeliveryClaimExpired(
  record: DocumentDeliveryOutboxRecord,
  now: string,
  claimLeaseSeconds: number
): boolean {
  if (record.status !== "claimed" || record.claimedAt === undefined) {
    return false;
  }
  return Date.parse(record.claimedAt) + claimLeaseSeconds * 1000 <= Date.parse(now);
}

export function documentDeliveryOutboxClaimLeaseSeconds(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw badRequest("Delivery outbox claimLeaseSeconds must be a positive integer");
  }
  return value;
}

export function ensureDocumentDeliveryOutboxClaimed(record: DocumentDeliveryOutboxRecord, claimId: string): void {
  if (record.status !== "claimed" || record.claimId !== claimId) {
    throw conflict(`Document delivery outbox record '${record.id}' is not claimed by '${claimId}'`);
  }
}

export function documentDeliveryOutboxFailureError(error: string): string {
  const normalized = error.trim();
  if (normalized.length === 0) {
    throw badRequest("Delivery failure error is required");
  }
  return normalized;
}
