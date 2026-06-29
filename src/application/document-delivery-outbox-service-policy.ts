import { conflict, badRequest } from "../core/errors.js";
import type { DocumentData, DocumentSnapshot, DomainEvent } from "../core/types.js";
import {
  documentDeliveryRetryDue,
  type DocumentDeliveryOutboxRecord,
  type DocumentDeliveryOutboxState
} from "./document-delivery-outbox-events.js";

export const DOCUMENT_DELIVERY_OUTBOX_DEFAULT_CLAIM_LIMIT = 25;
export const DOCUMENT_DELIVERY_OUTBOX_MAX_CLAIM_LIMIT = 100;

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

export function claimableDocumentDeliveryOutboxRecords(
  state: DocumentDeliveryOutboxState,
  now: string,
  limit: number
): readonly DocumentDeliveryOutboxRecord[] {
  return [...state.records.values()]
    .filter((record) => record.status === "pending" || (record.status === "failed" && documentDeliveryRetryDue(record, now)))
    .sort((left, right) => left.enqueuedAt.localeCompare(right.enqueuedAt) || left.id.localeCompare(right.id))
    .slice(0, limit);
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
