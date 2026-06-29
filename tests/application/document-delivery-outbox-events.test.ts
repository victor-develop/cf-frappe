import {
  documentDeliveryOutboxRecordId,
  documentDeliveryRetryDue,
  foldDocumentDeliveryOutbox,
  selectedDocumentDeliveryOutboxRecords,
  sortedDocumentDeliveryOutboxRecords
} from "../../src";
import type { DomainEvent } from "../../src";

describe("document delivery outbox events", () => {
  it("folds claim, failure, retry, and delivery transitions", () => {
    const outboxId = documentDeliveryOutboxRecordId("evt_source", "email");
    const state = foldDocumentDeliveryOutbox("acme", [
      enqueuedEvent(1, outboxId, "email", "2026-01-01T00:00:00.000Z"),
      claimedEvent(2, outboxId, "claim-1", "2026-01-01T00:01:00.000Z"),
      failedEvent(3, outboxId, "claim-1", "queue unavailable", "2026-01-01T00:05:00.000Z"),
      claimedEvent(4, outboxId, "claim-2", "2026-01-01T00:05:00.000Z"),
      deliveredEvent(5, outboxId, "claim-2", "2026-01-01T00:06:00.000Z")
    ]);

    expect(state.version).toBe(5);
    expect(state.records.get(outboxId)).toMatchObject({
      id: outboxId,
      status: "delivered",
      attempts: 2,
      claimId: "claim-2",
      deliveredAt: "2026-01-01T00:06:00.000Z"
    });
    expect(state.records.get(outboxId)).not.toHaveProperty("error");
    expect(state.records.get(outboxId)).not.toHaveProperty("retryAt");
  });

  it("sorts and selects records deterministically", () => {
    const emailId = documentDeliveryOutboxRecordId("evt_source", "email");
    const realtimeId = documentDeliveryOutboxRecordId("evt_source", "realtime");
    const notificationId = documentDeliveryOutboxRecordId("evt_source", "notification");
    const state = foldDocumentDeliveryOutbox("acme", [
      enqueuedEvent(1, realtimeId, "realtime", "2026-01-01T00:02:00.000Z"),
      enqueuedEvent(2, emailId, "email", "2026-01-01T00:01:00.000Z"),
      enqueuedEvent(3, notificationId, "notification", "2026-01-01T00:01:00.000Z")
    ]);

    expect(sortedDocumentDeliveryOutboxRecords(state).map((record) => record.id)).toEqual([
      emailId,
      notificationId,
      realtimeId
    ]);
    expect(selectedDocumentDeliveryOutboxRecords(state, [realtimeId, "missing", emailId]).map((record) => record.id)).toEqual([
      realtimeId,
      emailId
    ]);
  });

  it("classifies retry eligibility by retryAt", () => {
    const outboxId = documentDeliveryOutboxRecordId("evt_source", "email");
    const state = foldDocumentDeliveryOutbox("acme", [
      enqueuedEvent(1, outboxId, "email", "2026-01-01T00:00:00.000Z"),
      claimedEvent(2, outboxId, "claim-1", "2026-01-01T00:01:00.000Z"),
      failedEvent(3, outboxId, "claim-1", "queue unavailable", "2026-01-01T00:05:00.000Z")
    ]);
    const record = state.records.get(outboxId);

    expect(record).toMatchObject({ status: "failed", retryAt: "2026-01-01T00:05:00.000Z" });
    expect(record === undefined ? undefined : documentDeliveryRetryDue(record, "2026-01-01T00:04:59.000Z")).toBe(false);
    expect(record === undefined ? undefined : documentDeliveryRetryDue(record, "2026-01-01T00:05:00.000Z")).toBe(true);
  });
});

function enqueuedEvent(
  sequence: number,
  outboxId: string,
  target: "notification" | "realtime" | "email",
  occurredAt: string
): DomainEvent {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: "acme:__DocumentDeliveryOutbox:deliveries",
    sequence,
    type: "DocumentDeliveryOutboxEnqueued",
    doctype: "__DocumentDeliveryOutbox",
    documentName: outboxId,
    actorId: "owner@example.com",
    occurredAt,
    payload: {
      kind: "DocumentDeliveryOutboxEnqueued",
      outboxId,
      target,
      sourceEventId: "evt_source",
      sourceEventType: "NoteUpdated",
      payloadKind: "DocumentUpdated",
      doctype: "Note",
      documentName: "One",
      actorId: "owner@example.com",
      payload: {
        event: {
          id: "evt_source",
          payload: { kind: "DocumentUpdated" }
        }
      }
    },
    metadata: {}
  };
}

function claimedEvent(sequence: number, outboxId: string, claimId: string, occurredAt: string): DomainEvent {
  return stateEvent(sequence, outboxId, {
    kind: "DocumentDeliveryOutboxClaimed",
    outboxId,
    claimId
  }, occurredAt);
}

function failedEvent(sequence: number, outboxId: string, claimId: string, error: string, retryAt: string): DomainEvent {
  return stateEvent(sequence, outboxId, {
    kind: "DocumentDeliveryOutboxFailed",
    outboxId,
    claimId,
    error,
    retryAt
  }, "2026-01-01T00:03:00.000Z");
}

function deliveredEvent(sequence: number, outboxId: string, claimId: string, occurredAt: string): DomainEvent {
  return stateEvent(sequence, outboxId, {
    kind: "DocumentDeliveryOutboxDelivered",
    outboxId,
    claimId
  }, occurredAt);
}

function stateEvent(sequence: number, outboxId: string, payload: DomainEvent["payload"], occurredAt: string): DomainEvent {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: "acme:__DocumentDeliveryOutbox:deliveries",
    sequence,
    type: payload.kind,
    doctype: "__DocumentDeliveryOutbox",
    documentName: outboxId,
    actorId: "system",
    occurredAt,
    payload,
    metadata: {}
  };
}
