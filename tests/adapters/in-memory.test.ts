import { conflict, documentStream, InMemoryEventStore, InMemoryProjectionStore } from "../../src";
import type { NewDomainEvent } from "../../src";

describe("in-memory adapters", () => {
  const stream = documentStream("acme", "Note", "One");
  const event: NewDomainEvent = {
    id: "evt1",
    tenantId: "acme",
    stream,
    type: "DocumentCreated",
    doctype: "Note",
    documentName: "One",
    actorId: "owner",
    occurredAt: "2026-01-01T00:00:00.000Z",
    payload: { kind: "DocumentCreated", data: { title: "One" }, docstatus: "draft" },
    metadata: {}
  };

  it("assigns stream sequence numbers on append", async () => {
    const store = new InMemoryEventStore();

    await expect(store.append(stream, 0, [event])).resolves.toMatchObject([{ sequence: 1 }]);
  });

  it("rejects unexpected versions", async () => {
    const store = new InMemoryEventStore();
    await store.append(stream, 0, [event]);

    await expect(store.append(stream, 0, [{ ...event, id: "evt2" }])).rejects.toMatchObject({
      code: conflict("Expected").code
    });
  });

  it("lists projections in updated order", async () => {
    const projections = new InMemoryProjectionStore();
    await projections.save({
      tenantId: "acme",
      doctype: "Note",
      name: "Old",
      version: 1,
      docstatus: "draft",
      data: { title: "Old" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await projections.save({
      tenantId: "acme",
      doctype: "Note",
      name: "New",
      version: 1,
      docstatus: "draft",
      data: { title: "New" },
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z"
    });

    await expect(projections.list({ tenantId: "acme", doctype: "Note" })).resolves.toMatchObject({
      data: [{ name: "New" }, { name: "Old" }]
    });
  });

  it("applies projection list filters before paging", async () => {
    const projections = new InMemoryProjectionStore();
    await projections.save({
      tenantId: "acme",
      doctype: "Note",
      name: "High",
      version: 1,
      docstatus: "draft",
      data: { title: "High", priority: "High", count: 5 },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await projections.save({
      tenantId: "acme",
      doctype: "Note",
      name: "Low",
      version: 1,
      docstatus: "draft",
      data: { title: "Low", priority: "Low", count: 1 },
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z"
    });

    await expect(
      projections.list({
        tenantId: "acme",
        doctype: "Note",
        filters: [
          { field: "priority", value: "High" },
          { field: "count", operator: "gte", value: 2 }
        ],
        limit: 1
      })
    ).resolves.toMatchObject({
      data: [{ name: "High" }],
      total: 1
    });
  });

  it("does not match missing projection values for scalar operators", async () => {
    const projections = new InMemoryProjectionStore();
    await projections.save({
      tenantId: "acme",
      doctype: "Note",
      name: "Missing Count",
      version: 1,
      docstatus: "draft",
      data: { title: "Missing Count" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await projections.save({
      tenantId: "acme",
      doctype: "Note",
      name: "Low Count",
      version: 1,
      docstatus: "draft",
      data: { title: "Low Count", count: 1 },
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z"
    });

    await expect(
      projections.list({
        tenantId: "acme",
        doctype: "Note",
        filters: [{ field: "count", operator: "lte", value: 2 }]
      })
    ).resolves.toMatchObject({
      data: [{ name: "Low Count" }],
      total: 1
    });

    await expect(
      projections.list({
        tenantId: "acme",
        doctype: "Note",
        filters: [{ field: "body", operator: "contains", value: "" }]
      })
    ).resolves.toMatchObject({
      data: [],
      total: 0
    });
  });
});
