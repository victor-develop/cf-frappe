import { foldDocument } from "../../src";
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
});
