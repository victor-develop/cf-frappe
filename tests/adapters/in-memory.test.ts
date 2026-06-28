import { conflict, documentStream, InMemoryEventStore, InMemoryJobExecutionLog, InMemoryProjectionStore } from "../../src";
import type { DocumentData, JobMessage, NewDomainEvent } from "../../src";

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

  it("filters stream reads by payload kind before limiting", async () => {
    const store = new InMemoryEventStore();
    await store.append(stream, 0, [
      event,
      { ...event, id: "evt2", payload: { kind: "DocumentUpdated", patch: { title: "Two" } } },
      { ...event, id: "evt3", payload: { kind: "DocumentAssigned", assigneeId: "amy@example.com" } },
      { ...event, id: "evt4", payload: { kind: "DocumentUnassigned", assigneeId: "amy@example.com" } },
      { ...event, id: "evt5", payload: { kind: "DocumentUpdated", patch: { title: "Five" } } }
    ]);

    const events = await store.readStream(stream, {
      payloadKinds: ["DocumentAssigned", "DocumentUnassigned"],
      limit: 1
    });

    expect(events.map((item) => item.sequence)).toEqual([4]);
    expect(events.map((item) => item.payload.kind)).toEqual(["DocumentUnassigned"]);
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

  it("orders projections by metadata fields with stable fallbacks", async () => {
    const projections = new InMemoryProjectionStore();
    await projections.save({
      tenantId: "acme",
      doctype: "Note",
      name: "Missing",
      version: 1,
      docstatus: "draft",
      data: { title: "missing" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z"
    });
    await projections.save({
      tenantId: "acme",
      doctype: "Note",
      name: "Low",
      version: 1,
      docstatus: "draft",
      data: { title: "Zebra", count: 1 },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z"
    });
    await projections.save({
      tenantId: "acme",
      doctype: "Note",
      name: "High",
      version: 1,
      docstatus: "draft",
      data: { title: "apple", count: 5 },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });
    await projections.save({
      tenantId: "acme",
      doctype: "Note",
      name: "a",
      version: 1,
      docstatus: "draft",
      data: { title: "same", count: 9 },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-04T00:00:00.000Z"
    });
    await projections.save({
      tenantId: "acme",
      doctype: "Note",
      name: "B",
      version: 1,
      docstatus: "draft",
      data: { title: "same", count: 9 },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-04T00:00:00.000Z"
    });

    await expect(
      projections.list({ tenantId: "acme", doctype: "Note", orderBy: "count", order: "asc" })
    ).resolves.toMatchObject({
      data: [{ name: "Low" }, { name: "High" }, { name: "B" }, { name: "a" }, { name: "Missing" }]
    });

    await expect(
      projections.list({ tenantId: "acme", doctype: "Note", orderBy: "name", order: "desc" })
    ).resolves.toMatchObject({
      data: [{ name: "a" }, { name: "Missing" }, { name: "Low" }, { name: "High" }, { name: "B" }]
    });

    await expect(
      projections.list({ tenantId: "acme", doctype: "Note", orderBy: "title", order: "asc" })
    ).resolves.toMatchObject({
      data: [{ name: "Low" }, { name: "High" }, { name: "Missing" }, { name: "B" }, { name: "a" }]
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
          { field: "priority", operator: "ne", value: "Low" },
          { field: "count", operator: "gt", value: 2 },
          { field: "count", operator: "lt", value: 10 }
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

  it("snapshots job execution message data by value", async () => {
    const log = new InMemoryJobExecutionLog();
    const payload = { nested: { count: 1 } };
    const metadata = { source: "test" };
    const message: JobMessage = {
      tenantId: "acme",
      jobName: "reports.daily",
      payload,
      runId: "job_001",
      idempotencyKey: "reports.daily:job_001",
      enqueuedAt: "2026-01-01T00:00:00.000Z",
      metadata
    };

    await log.begin(message, "2026-01-01T00:01:00.000Z");
    payload.nested.count = 2;
    metadata.source = "mutated";

    const firstRead = await log.get("reports.daily:job_001", { tenantId: "acme" });
    expect(firstRead).toMatchObject({
      payload: { nested: { count: 1 } },
      metadata: { source: "test" }
    });

    (firstRead!.payload as DocumentData).nested = { count: 3 };
    (firstRead!.metadata as DocumentData).source = "read mutation";

    await expect(log.get("reports.daily:job_001", { tenantId: "acme" })).resolves.toMatchObject({
      payload: { nested: { count: 1 } },
      metadata: { source: "test" }
    });
  });

  it("rejects non-JSON in-memory job execution payloads before recording history", async () => {
    const log = new InMemoryJobExecutionLog();
    const message: JobMessage = {
      tenantId: "acme",
      jobName: "reports.daily",
      payload: { count: Number.POSITIVE_INFINITY } as never,
      runId: "job_001",
      idempotencyKey: "reports.daily:job_001",
      enqueuedAt: "2026-01-01T00:00:00.000Z",
      metadata: {}
    };

    await expect(log.begin(message, "2026-01-01T00:01:00.000Z")).rejects.toMatchObject({
      code: "JOB_EXECUTION_INVALID",
      status: 409
    });
    await expect(log.get("reports.daily:job_001", { tenantId: "acme" })).resolves.toBeUndefined();
  });

  it("rejects non-JSON in-memory job execution results before recording success", async () => {
    const log = new InMemoryJobExecutionLog();
    const message: JobMessage = {
      tenantId: "acme",
      jobName: "reports.daily",
      payload: {},
      runId: "job_001",
      idempotencyKey: "reports.daily:job_001",
      enqueuedAt: "2026-01-01T00:00:00.000Z",
      metadata: {}
    };
    await log.begin(message, "2026-01-01T00:01:00.000Z");

    await expect(
      log.complete(message, "2026-01-01T00:02:00.000Z", Number.POSITIVE_INFINITY as never)
    ).rejects.toMatchObject({
      code: "JOB_EXECUTION_INVALID",
      status: 409
    });
    await expect(log.get("reports.daily:job_001", { tenantId: "acme" })).resolves.toMatchObject({
      status: "running"
    });
  });
});
