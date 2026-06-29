import {
  documentDeliveryOutboxDrainLimit,
  documentDeliveryOutboxDrainResultJson,
  documentDeliveryOutboxErrorMessage,
  documentDeliveryOutboxRecordClaimId,
  documentDeliveryOutboxRetryAt,
  documentDeliveryOutboxRetryDelaySeconds,
  documentDeliveryOutboxSourceFromRecord,
  hasQueuedDocumentDeliveryEmailMessageId,
  parseDocumentDeliveryOutboxDrainJobClaimId,
  parseDocumentDeliveryOutboxDrainJobLimit
} from "../../src/application/document-delivery-outbox-consumer-policy.js";
import type { DocumentDeliveryOutboxRecord } from "../../src/application/document-delivery-outbox-events.js";
import type { DocumentData, DomainEvent, DocumentSnapshot } from "../../src/core/types.js";

const now = "2026-01-01T00:00:00.000Z";

describe("document delivery outbox consumer policy", () => {
  it("normalizes thrown delivery failures into retryable error messages", () => {
    expect(documentDeliveryOutboxErrorMessage(new Error("provider down"))).toBe("provider down");
    expect(documentDeliveryOutboxErrorMessage("plain failure")).toBe("plain failure");
    expect(documentDeliveryOutboxErrorMessage(undefined)).toBe("undefined");
  });

  it("selects queued email deliveries that can be enqueued by message id", () => {
    const deliveries = [
      { status: "queued" },
      { status: "queued", messageId: "msg_ready" },
      { status: "skipped", messageId: "msg_skipped" }
    ];

    expect(deliveries.filter(hasQueuedDocumentDeliveryEmailMessageId)).toEqual([
      { status: "queued", messageId: "msg_ready" }
    ]);
  });

  it("normalizes drain limits with bounded defaults", () => {
    expect(documentDeliveryOutboxDrainLimit(undefined)).toBe(25);
    expect(documentDeliveryOutboxDrainLimit(100)).toBe(100);
    expect(() => documentDeliveryOutboxDrainLimit(0)).toThrow(
      "Document delivery outbox drain limit must be an integer between 1 and 100"
    );
    expect(() => documentDeliveryOutboxDrainLimit(101)).toThrow(
      "Document delivery outbox drain limit must be an integer between 1 and 100"
    );
  });

  it("parses drain job payload fields", () => {
    expect(parseDocumentDeliveryOutboxDrainJobLimit(undefined)).toBeUndefined();
    expect(parseDocumentDeliveryOutboxDrainJobLimit(7)).toBe(7);
    expect(parseDocumentDeliveryOutboxDrainJobClaimId(undefined)).toBeUndefined();
    expect(parseDocumentDeliveryOutboxDrainJobClaimId("claim-1")).toBe("claim-1");
    expect(() => parseDocumentDeliveryOutboxDrainJobLimit("7")).toThrow(
      "Document delivery outbox drain job limit is invalid"
    );
    expect(() => parseDocumentDeliveryOutboxDrainJobClaimId(" ")).toThrow(
      "Document delivery outbox drain job claimId is invalid"
    );
  });

  it("shapes drain results as job JSON", () => {
    expect(
      documentDeliveryOutboxDrainResultJson({
        tenantId: "acme",
        claimed: 2,
        delivered: 1,
        failed: 1,
        outcomes: [
          { outboxId: "evt_1:email", target: "email", status: "delivered", attempts: 1 },
          {
            outboxId: "evt_2:realtime",
            target: "realtime",
            status: "failed",
            attempts: 3,
            error: "publish failed",
            retryAt: "2026-01-01T00:05:00.000Z"
          }
        ]
      })
    ).toEqual({
      tenantId: "acme",
      claimed: 2,
      delivered: 1,
      failed: 1,
      outcomes: [
        { outboxId: "evt_1:email", target: "email", status: "delivered", attempts: 1 },
        {
          outboxId: "evt_2:realtime",
          target: "realtime",
          status: "failed",
          attempts: 3,
          error: "publish failed",
          retryAt: "2026-01-01T00:05:00.000Z"
        }
      ]
    });
  });

  it("requires claimed records before delivery completion", () => {
    expect(documentDeliveryOutboxRecordClaimId(record({ claimId: "claim-1" }))).toBe("claim-1");
    expect(() => documentDeliveryOutboxRecordClaimId(record())).toThrow(
      "Document delivery outbox record 'evt_source:email' is not claimed"
    );
    expect(() => documentDeliveryOutboxRecordClaimId(record({ claimId: " " }))).toThrow(
      "Document delivery outbox record 'evt_source:email' is not claimed"
    );
  });

  it("computes retry delays with exponential caps", () => {
    expect(documentDeliveryOutboxRetryDelaySeconds(30, "retry base")).toBe(30);
    expect(() => documentDeliveryOutboxRetryDelaySeconds(0, "retry base")).toThrow(
      "retry base must be a positive integer"
    );
    expect(
      documentDeliveryOutboxRetryAt({
        now,
        attempts: 1,
        baseDelaySeconds: 30,
        maxDelaySeconds: 90
      })
    ).toBe("2026-01-01T00:00:30.000Z");
    expect(
      documentDeliveryOutboxRetryAt({
        now,
        attempts: 3,
        baseDelaySeconds: 30,
        maxDelaySeconds: 90
      })
    ).toBe("2026-01-01T00:01:30.000Z");
  });

  it("extracts replayed source events and validates source snapshots", () => {
    const source = documentDeliveryOutboxSourceFromRecord(record());

    expect(source).toEqual({ event: domainEvent(), snapshot: snapshot() });
    expect(
      documentDeliveryOutboxSourceFromRecord(record({ payload: outboxPayload({ event: domainEvent() }) })).snapshot
    ).toBeNull();
    expect(() =>
      documentDeliveryOutboxSourceFromRecord(
        record({ payload: outboxPayload({ event: { ...domainEvent(), payload: {} } }) })
      )
    ).toThrow("Document delivery outbox record 'evt_source:email' does not contain a source domain event");
    expect(() =>
      documentDeliveryOutboxSourceFromRecord(
        record({ payload: outboxPayload({ event: domainEvent(), snapshot: { ...snapshot(), version: "1" } }) })
      )
    ).toThrow("Document delivery outbox record 'evt_source:email' contains an invalid source snapshot");
  });
});

function record(overrides: Partial<DocumentDeliveryOutboxRecord> = {}): DocumentDeliveryOutboxRecord {
  return {
    id: "evt_source:email",
    tenantId: "acme",
    target: "email",
    sourceEventId: "evt_source",
    sourceEventType: "NoteCreated",
    payloadKind: "DocumentCreated",
    doctype: "Note",
    documentName: "One",
    actorId: "owner@example.com",
    payload: outboxPayload({ event: domainEvent(), snapshot: snapshot() }),
    status: "claimed",
    attempts: 1,
    enqueuedAt: now,
    claimedAt: now,
    ...overrides
  };
}

function outboxPayload(value: unknown): DocumentData {
  return value as DocumentData;
}

function domainEvent(): DomainEvent {
  return {
    id: "evt_source",
    tenantId: "acme",
    stream: "acme:Note:One",
    sequence: 1,
    type: "NoteCreated",
    doctype: "Note",
    documentName: "One",
    actorId: "owner@example.com",
    occurredAt: now,
    payload: { kind: "DocumentCreated", data: { title: "One" }, docstatus: "draft" },
    metadata: {}
  };
}

function snapshot(): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Note",
    name: "One",
    version: 1,
    docstatus: "draft",
    data: { title: "One" },
    createdAt: now,
    updatedAt: now
  };
}
