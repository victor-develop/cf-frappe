import {
  claimableDocumentDeliveryOutboxRecords,
  documentDeliveryOutboxClaimLimit,
  documentDeliveryOutboxFailureError,
  documentDeliveryOutboxPayload,
  ensureDocumentDeliveryOutboxClaimed
} from "../../src/application/document-delivery-outbox-service-policy.js";
import type {
  DocumentDeliveryOutboxRecord,
  DocumentDeliveryOutboxState
} from "../../src/application/document-delivery-outbox-events.js";
import type { DomainEvent, DocumentSnapshot } from "../../src/core/types.js";

const now = "2026-01-01T00:00:00.000Z";

describe("document delivery outbox service policy", () => {
  it("shapes source event and optional snapshot payloads", () => {
    expect(documentDeliveryOutboxPayload(domainEvent(), snapshot())).toEqual({
      event: domainEvent(),
      snapshot: snapshot()
    });
    expect(documentDeliveryOutboxPayload(domainEvent(), undefined)).toEqual({
      event: domainEvent()
    });
    expect(documentDeliveryOutboxPayload(domainEvent(), null)).toEqual({
      event: domainEvent()
    });
  });

  it("normalizes claim limits with bounded defaults", () => {
    expect(documentDeliveryOutboxClaimLimit(undefined)).toBe(25);
    expect(documentDeliveryOutboxClaimLimit(100)).toBe(100);
    expect(() => documentDeliveryOutboxClaimLimit(0)).toThrow(
      "Delivery outbox claim limit must be an integer between 1 and 100"
    );
    expect(() => documentDeliveryOutboxClaimLimit(101)).toThrow(
      "Delivery outbox claim limit must be an integer between 1 and 100"
    );
  });

  it("selects pending and retry-due failed records in deterministic order", () => {
    const selected = claimableDocumentDeliveryOutboxRecords(
      state([
        record("evt_later:email", { status: "pending", enqueuedAt: "2026-01-01T00:01:00.000Z" }),
        record("evt_due:email", { status: "failed", retryAt: now, enqueuedAt: "2026-01-01T00:00:00.000Z" }),
        record("evt_not_due:email", {
          status: "failed",
          retryAt: "2026-01-01T00:10:00.000Z",
          enqueuedAt: "2026-01-01T00:00:00.000Z"
        }),
        record("evt_claimed:email", { status: "claimed", claimId: "claim-1" }),
        record("evt_delivered:email", { status: "delivered" }),
        record("evt_same_time_b:email", { status: "pending", enqueuedAt: "2026-01-01T00:00:30.000Z" }),
        record("evt_same_time_a:email", { status: "pending", enqueuedAt: "2026-01-01T00:00:30.000Z" })
      ]),
      now,
      3
    );

    expect(selected.map((item) => item.id)).toEqual([
      "evt_due:email",
      "evt_same_time_a:email",
      "evt_same_time_b:email"
    ]);
  });

  it("guards terminal events by active claim", () => {
    expect(() =>
      ensureDocumentDeliveryOutboxClaimed(
        record("evt_source:email", { status: "claimed", claimId: "claim-1", claimedAt: now }),
        "claim-1"
      )
    ).not.toThrow();
    expect(() => ensureDocumentDeliveryOutboxClaimed(record("evt_source:email"), "claim-1")).toThrow(
      "Document delivery outbox record 'evt_source:email' is not claimed by 'claim-1'"
    );
    expect(() =>
      ensureDocumentDeliveryOutboxClaimed(
        record("evt_source:email", { status: "claimed", claimId: "claim-2", claimedAt: now }),
        "claim-1"
      )
    ).toThrow("Document delivery outbox record 'evt_source:email' is not claimed by 'claim-1'");
  });

  it("normalizes failure errors", () => {
    expect(documentDeliveryOutboxFailureError("  queue unavailable  ")).toBe("queue unavailable");
    expect(() => documentDeliveryOutboxFailureError(" ")).toThrow("Delivery failure error is required");
  });
});

function state(records: readonly DocumentDeliveryOutboxRecord[]): DocumentDeliveryOutboxState {
  return {
    tenantId: "acme",
    version: 1,
    records: new Map(records.map((item) => [item.id, item]))
  };
}

function record(
  id: string,
  overrides: Partial<DocumentDeliveryOutboxRecord> = {}
): DocumentDeliveryOutboxRecord {
  return {
    id,
    tenantId: "acme",
    target: "email",
    sourceEventId: "evt_source",
    sourceEventType: "NoteCreated",
    payloadKind: "DocumentCreated",
    doctype: "Note",
    documentName: "One",
    actorId: "owner@example.com",
    payload: {},
    status: "pending",
    attempts: 0,
    enqueuedAt: now,
    ...overrides
  };
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
