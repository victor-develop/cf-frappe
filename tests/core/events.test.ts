import { foldDocument, foldDocumentFollowers, foldDocumentTags } from "../../src";
import type { DomainEvent } from "../../src";

describe("event folding", () => {
  const base = {
    id: "evt",
    tenantId: "acme",
    stream: "acme:Note:One",
    doctype: "Note",
    documentName: "One",
    actorId: "owner",
    occurredAt: "2026-01-01T00:00:00.000Z",
    metadata: {}
  };

  it("returns null for an empty stream", () => {
    expect(foldDocument([])).toBeNull();
  });

  it("folds created and updated events in sequence order", () => {
    const events: DomainEvent[] = [
      {
        ...base,
        id: "evt2",
        sequence: 2,
        type: "DocumentUpdated",
        payload: { kind: "DocumentUpdated", patch: { body: "updated" } }
      },
      {
        ...base,
        id: "evt1",
        sequence: 1,
        type: "DocumentCreated",
        payload: { kind: "DocumentCreated", data: { title: "One" }, docstatus: "draft" }
      }
    ];

    expect(foldDocument(events)).toMatchObject({
      name: "One",
      version: 2,
      data: { title: "One", body: "updated" }
    });
  });

  it("folds explicit field unsets from update events", () => {
    const events: DomainEvent[] = [
      {
        ...base,
        sequence: 1,
        type: "DocumentCreated",
        payload: { kind: "DocumentCreated", data: { title: "One", body: "draft", legacy: "old" }, docstatus: "draft" }
      },
      {
        ...base,
        id: "evt2",
        sequence: 2,
        type: "DocumentUpdated",
        payload: { kind: "DocumentUpdated", patch: { body: "updated" }, unset: ["legacy"] }
      }
    ];

    expect(foldDocument(events)).toMatchObject({
      version: 2,
      data: { title: "One", body: "updated" }
    });
    expect(foldDocument(events)?.data).not.toHaveProperty("legacy");
  });

  it("marks a document deleted without losing its data", () => {
    const events: DomainEvent[] = [
      {
        ...base,
        sequence: 1,
        type: "DocumentCreated",
        payload: { kind: "DocumentCreated", data: { title: "One" }, docstatus: "draft" }
      },
      {
        ...base,
        id: "evt2",
        sequence: 2,
        type: "DocumentDeleted",
        payload: { kind: "DocumentDeleted" }
      }
    ];

    expect(foldDocument(events)).toMatchObject({
      docstatus: "deleted",
      data: { title: "One" }
    });
  });

  it("folds submit and cancel lifecycle events without changing document data", () => {
    const events: DomainEvent[] = [
      {
        ...base,
        sequence: 1,
        type: "DocumentCreated",
        payload: { kind: "DocumentCreated", data: { title: "One" }, docstatus: "draft" }
      },
      {
        ...base,
        id: "evt2",
        sequence: 2,
        type: "DocumentSubmitted",
        payload: { kind: "DocumentSubmitted" }
      },
      {
        ...base,
        id: "evt3",
        sequence: 3,
        type: "DocumentCancelled",
        payload: { kind: "DocumentCancelled" }
      }
    ];

    expect(foldDocument(events)).toMatchObject({
      version: 3,
      docstatus: "cancelled",
      data: { title: "One" }
    });
  });

  it("folds feed activity without changing document data or status", () => {
    const events: DomainEvent[] = [
      {
        ...base,
        sequence: 1,
        type: "DocumentCreated",
        payload: { kind: "DocumentCreated", data: { title: "One" }, docstatus: "draft" }
      },
      {
        ...base,
        id: "evt2",
        sequence: 2,
        type: "DocumentAssigned",
        payload: { kind: "DocumentAssigned", assigneeId: "support@example.com" }
      },
      {
        ...base,
        id: "evt3",
        sequence: 3,
        type: "DocumentActivityRecorded",
        payload: {
          kind: "DocumentActivityRecorded",
          activityType: "email",
          subject: "Follow-up sent",
          detail: "Sent to customer@example.com"
        }
      },
      {
        ...base,
        id: "evt4",
        sequence: 4,
        type: "DocumentUnassigned",
        payload: { kind: "DocumentUnassigned", assigneeId: "support@example.com" }
      },
      {
        ...base,
        id: "evt5",
        sequence: 5,
        type: "DocumentTagged",
        payload: { kind: "DocumentTagged", tag: "Urgent" }
      },
      {
        ...base,
        id: "evt6",
        sequence: 6,
        type: "DocumentUntagged",
        payload: { kind: "DocumentUntagged", tag: "Urgent" }
      },
      {
        ...base,
        id: "evt7",
        sequence: 7,
        type: "DocumentFollowed",
        payload: { kind: "DocumentFollowed", followerId: "owner@example.com" }
      },
      {
        ...base,
        id: "evt8",
        sequence: 8,
        type: "DocumentUnfollowed",
        payload: { kind: "DocumentUnfollowed", followerId: "owner@example.com" }
      },
      {
        ...base,
        id: "evt9",
        sequence: 9,
        type: "DocumentShared",
        payload: { kind: "DocumentShared", userId: "collab@example.com", permissions: ["read"] }
      },
      {
        ...base,
        id: "evt10",
        sequence: 10,
        type: "DocumentShareRevoked",
        payload: { kind: "DocumentShareRevoked", userId: "collab@example.com" }
      }
    ];

    expect(foldDocument(events)).toMatchObject({
      version: 10,
      docstatus: "draft",
      data: { title: "One" }
    });
  });

  it("folds current document tags from tag events", () => {
    const events: DomainEvent[] = [
      {
        ...base,
        sequence: 1,
        type: "DocumentTagged",
        payload: { kind: "DocumentTagged", tag: "Urgent" }
      },
      {
        ...base,
        id: "evt2",
        sequence: 2,
        type: "DocumentTagged",
        payload: { kind: "DocumentTagged", tag: "Customer" }
      },
      {
        ...base,
        id: "evt3",
        sequence: 3,
        type: "DocumentUntagged",
        payload: { kind: "DocumentUntagged", tag: "Urgent" }
      }
    ];

    expect(foldDocumentTags(events)).toEqual(["Customer"]);
  });

  it("folds current document followers from follow events", () => {
    const events: DomainEvent[] = [
      {
        ...base,
        sequence: 1,
        type: "DocumentFollowed",
        payload: { kind: "DocumentFollowed", followerId: "owner@example.com" }
      },
      {
        ...base,
        id: "evt2",
        sequence: 2,
        type: "DocumentFollowed",
        payload: { kind: "DocumentFollowed", followerId: "amy@example.com" }
      },
      {
        ...base,
        id: "evt3",
        sequence: 3,
        type: "DocumentUnfollowed",
        payload: { kind: "DocumentUnfollowed", followerId: "owner@example.com" }
      }
    ];

    expect(foldDocumentFollowers(events)).toEqual(["amy@example.com"]);
  });
});
