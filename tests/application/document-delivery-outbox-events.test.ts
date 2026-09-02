import {
  DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KINDS,
  documentDeliveryOutboxEventType,
  documentDeliveryOutboxRecordId,
  documentDeliveryRetryDue,
  foldDocumentDeliveryOutbox,
  foldDocumentDeliveryOutboxRecord,
  isDocumentDeliveryOutboxEvent,
  isDocumentDeliveryOutboxPayloadKind,
  selectedDocumentDeliveryOutboxRecords,
  sortedDocumentDeliveryOutboxRecords
} from "../../src";
import type { DomainEvent } from "../../src";

describe("document delivery outbox events", () => {
  it("derives document delivery outbox event types from payload identity", () => {
    const outboxId = documentDeliveryOutboxRecordId("evt_source", "email");

    expect(documentDeliveryOutboxEventType({
      kind: "DocumentDeliveryOutboxEnqueued",
      outboxId,
      target: "email",
      sourceEventId: "evt_source",
      sourceEventType: "NoteUpdated",
      payloadKind: "DocumentUpdated",
      doctype: "Note",
      documentName: "One",
      actorId: "owner@example.com"
    })).toBe("DocumentDeliveryOutboxEnqueued");
    expect(documentDeliveryOutboxEventType({
      kind: "DocumentDeliveryOutboxClaimed",
      outboxId,
      claimId: "claim-1"
    })).toBe("DocumentDeliveryOutboxClaimed");
    expect(documentDeliveryOutboxEventType({
      kind: "DocumentDeliveryOutboxDelivered",
      outboxId,
      claimId: "claim-1"
    })).toBe("DocumentDeliveryOutboxDelivered");
    expect(documentDeliveryOutboxEventType({
      kind: "DocumentDeliveryOutboxFailed",
      outboxId,
      claimId: "claim-1",
      error: "queue unavailable"
    })).toBe("DocumentDeliveryOutboxFailed");
  });

  it("exposes the bounded document delivery outbox payload kind set", () => {
    expect(DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KINDS).toEqual([
      "DocumentDeliveryOutboxEnqueued",
      "DocumentDeliveryOutboxClaimed",
      "DocumentDeliveryOutboxDelivered",
      "DocumentDeliveryOutboxFailed"
    ]);
  });

  it("narrows document delivery outbox events by payload kind when event type names are custom", () => {
    const event = {
      ...enqueuedEvent(
        1,
        documentDeliveryOutboxRecordId("evt_source", "email"),
        "email",
        "2026-01-01T00:00:00.000Z"
      ),
      type: "DeliveryIntentRecorded"
    };

    expect(isDocumentDeliveryOutboxPayloadKind("DocumentDeliveryOutboxEnqueued")).toBe(true);
    expect(isDocumentDeliveryOutboxPayloadKind("DocumentDeleted")).toBe(false);
    expect(isDocumentDeliveryOutboxEvent(event)).toBe(true);
    expect(isDocumentDeliveryOutboxEvent(otherEvent({ kind: "DocumentDeleted" }))).toBe(false);
  });

  it("folds document delivery outbox events by payload kind instead of event type name", () => {
    const outboxId = documentDeliveryOutboxRecordId("evt_source", "email");
    const misleadingUnrelated = otherEvent({ kind: "DocumentDeleted" }, "DocumentDeliveryOutboxEnqueued");
    const customTypedEnqueued = {
      ...enqueuedEvent(2, outboxId, "email", "2026-01-01T00:00:00.000Z"),
      type: "DeliveryIntentRecorded"
    };

    const state = foldDocumentDeliveryOutbox("acme", [misleadingUnrelated, customTypedEnqueued]);

    expect(state.version).toBe(2);
    expect(state.records.size).toBe(1);
    expect(state.records.get(outboxId)).toMatchObject({
      id: outboxId,
      status: "pending",
      sourceEventId: "evt_source"
    });
  });

  it("folds claim, failure, and retry transitions", () => {
    const outboxId = documentDeliveryOutboxRecordId("evt_source", "email");
    const state = foldDocumentDeliveryOutbox("acme", [
      enqueuedEvent(1, outboxId, "email", "2026-01-01T00:00:00.000Z"),
      claimedEvent(2, outboxId, "claim-1", "2026-01-01T00:01:00.000Z"),
      failedEvent(3, outboxId, "claim-1", "queue unavailable", "2026-01-01T00:05:00.000Z"),
      claimedEvent(4, outboxId, "claim-2", "2026-01-01T00:05:00.000Z")
    ]);

    expect(state.version).toBe(4);
    expect(state.records.get(outboxId)).toMatchObject({
      id: outboxId,
      status: "claimed",
      attempts: 2,
      claimId: "claim-2",
      claimedAt: "2026-01-01T00:05:00.000Z"
    });
    expect(state.records.get(outboxId)).not.toHaveProperty("error");
    expect(state.records.get(outboxId)).not.toHaveProperty("retryAt");
  });

  it("drops delivered records from the working set", () => {
    // The working set is folded on every outbox operation, so keeping delivered
    // records made it grow with the tenant's entire delivery history (#28).
    const outboxId = documentDeliveryOutboxRecordId("evt_source", "email");
    const state = foldDocumentDeliveryOutbox("acme", [
      enqueuedEvent(1, outboxId, "email", "2026-01-01T00:00:00.000Z"),
      claimedEvent(2, outboxId, "claim-1", "2026-01-01T00:01:00.000Z"),
      deliveredEvent(3, outboxId, "claim-1", "2026-01-01T00:06:00.000Z")
    ]);

    expect(state.version).toBe(3);
    expect(state.records.size).toBe(0);
  });

  it("folds one record's own events into terminal delivered state", () => {
    // What the working set gives up, this recovers — bounded by one record's
    // history instead of the tenant's.
    const outboxId = documentDeliveryOutboxRecordId("evt_source", "email");
    const record = foldDocumentDeliveryOutboxRecord("acme", outboxId, [
      enqueuedEvent(1, outboxId, "email", "2026-01-01T00:00:00.000Z"),
      claimedEvent(2, outboxId, "claim-1", "2026-01-01T00:01:00.000Z"),
      failedEvent(3, outboxId, "claim-1", "queue unavailable", "2026-01-01T00:05:00.000Z"),
      claimedEvent(4, outboxId, "claim-2", "2026-01-01T00:05:00.000Z"),
      deliveredEvent(5, outboxId, "claim-2", "2026-01-01T00:06:00.000Z")
    ]);

    expect(record).toMatchObject({
      id: outboxId,
      status: "delivered",
      attempts: 2,
      claimId: "claim-2",
      deliveredAt: "2026-01-01T00:06:00.000Z"
    });
    expect(record).not.toHaveProperty("error");
    expect(record).not.toHaveProperty("retryAt");
  });

  it("returns null for a record with no events", () => {
    expect(foldDocumentDeliveryOutboxRecord("acme", "evt_source:email", [])).toBeNull();
  });

  it("ignores events belonging to another record in the shared stream", () => {
    // Outbox records share one stream per tenant, so a fold that trusted
    // whatever it was handed would apply one record's delivery to another.
    const mine = documentDeliveryOutboxRecordId("evt_source", "email");
    const theirs = documentDeliveryOutboxRecordId("evt_other", "email");
    const events = [
      enqueuedEvent(1, mine, "email", "2026-01-01T00:00:00.000Z"),
      enqueuedEvent(2, theirs, "email", "2026-01-01T00:01:00.000Z"),
      deliveredEvent(3, theirs, "claim-1", "2026-01-01T00:02:00.000Z")
    ];

    expect(foldDocumentDeliveryOutboxRecord("acme", mine, events)).toMatchObject({
      id: mine,
      status: "pending"
    });
    expect(foldDocumentDeliveryOutboxRecord("acme", theirs, events)).toMatchObject({
      id: theirs,
      status: "delivered"
    });
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

function otherEvent(payload: DomainEvent["payload"], type: string = payload.kind): DomainEvent {
  return {
    id: "evt_other",
    tenantId: "acme",
    stream: "acme:Note:One",
    sequence: 1,
    type,
    doctype: "Note",
    documentName: "One",
    actorId: "owner@example.com",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload,
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
