import { describe, expect, it } from "vitest";

import {
  documentCreatedPayload,
  documentDeletedPayload,
  documentStatusChangedPayload,
  documentUpdatedPayload,
  snapshotFromCommittedDocumentEvent,
  snapshotFromDocumentCreatedEvent,
  type DocumentLifecycleEventPayload,
  type DocumentSnapshot,
  type DomainEvent
} from "../../src";

describe("document lifecycle events", () => {
  it("builds document-created payloads for event-sourced document starts", () => {
    const payload = lifecyclePayload(documentCreatedPayload({ title: "First" }, "draft"));

    expect(payload).toEqual({
      kind: "DocumentCreated",
      data: { title: "First" },
      docstatus: "draft"
    });
  });

  it("builds update payloads without empty unset noise", () => {
    expect(documentUpdatedPayload({ title: "Renamed" })).toEqual({
      kind: "DocumentUpdated",
      patch: { title: "Renamed" }
    });
  });

  it("builds update payloads with explicit unset fields", () => {
    expect(documentUpdatedPayload({ title: "Renamed" }, ["body"])).toEqual({
      kind: "DocumentUpdated",
      patch: { title: "Renamed" },
      unset: ["body"]
    });
  });

  it("builds terminal lifecycle payloads", () => {
    expect(documentDeletedPayload()).toEqual({ kind: "DocumentDeleted" });
    expect(documentStatusChangedPayload("DocumentSubmitted")).toEqual({ kind: "DocumentSubmitted" });
    expect(documentStatusChangedPayload("DocumentCancelled")).toEqual({ kind: "DocumentCancelled" });
  });

  it("projects a document-created event into a document snapshot", () => {
    expect(snapshotFromDocumentCreatedEvent(createdEvent)).toEqual({
      tenantId: "tenant_a",
      doctype: "Note",
      name: "NOTE-1",
      version: 1,
      docstatus: "draft",
      data: { title: "First" },
      createdAt: "2026-06-28T01:00:00.000Z",
      updatedAt: "2026-06-28T01:00:00.000Z"
    });
  });

  it("rejects non-create events for create snapshot projection", () => {
    expect(() =>
      snapshotFromDocumentCreatedEvent({
        ...createdEvent,
        payload: documentUpdatedPayload({ title: "Second" })
      })
    ).toThrow("Expected DocumentCreated event");
  });

  it("projects committed document events without replacing data or status", () => {
    expect(snapshotFromCommittedDocumentEvent(existingSnapshot, updatedEvent)).toEqual({
      ...existingSnapshot,
      version: 4,
      updatedAt: "2026-06-28T02:00:00.000Z"
    });
  });

  it("projects committed document events with explicit data and status changes", () => {
    expect(
      snapshotFromCommittedDocumentEvent(existingSnapshot, updatedEvent, {
        data: { title: "Submitted" },
        docstatus: "submitted"
      })
    ).toEqual({
      ...existingSnapshot,
      version: 4,
      docstatus: "submitted",
      data: { title: "Submitted" },
      updatedAt: "2026-06-28T02:00:00.000Z"
    });
  });
});

function lifecyclePayload(payload: DocumentLifecycleEventPayload): DocumentLifecycleEventPayload {
  return payload;
}

const createdEvent: DomainEvent = {
  id: "evt_1",
  tenantId: "tenant_a",
  stream: "tenant_a:Note:NOTE-1",
  sequence: 1,
  type: "NoteCreated",
  doctype: "Note",
  documentName: "NOTE-1",
  actorId: "owner@example.com",
  occurredAt: "2026-06-28T01:00:00.000Z",
  payload: documentCreatedPayload({ title: "First" }, "draft"),
  metadata: {}
};

const existingSnapshot: DocumentSnapshot = {
  tenantId: "tenant_a",
  doctype: "Note",
  name: "NOTE-1",
  version: 3,
  docstatus: "draft",
  data: { title: "First" },
  createdAt: "2026-06-28T01:00:00.000Z",
  updatedAt: "2026-06-28T01:30:00.000Z"
};

const updatedEvent: DomainEvent = {
  ...createdEvent,
  id: "evt_4",
  sequence: 4,
  type: "NoteUpdated",
  occurredAt: "2026-06-28T02:00:00.000Z",
  payload: documentUpdatedPayload({ title: "Submitted" })
};
