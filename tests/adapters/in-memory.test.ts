import {
  conflict,
  documentStream,
  InMemoryDataPatchLog,
  InMemoryEventStore,
  InMemoryJobExecutionLog,
  InMemoryProjectionStore
} from "../../src";
import type { DocumentData, DocumentSnapshot, JobMessage, NewDomainEvent } from "../../src";

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

  it("snapshots event payloads and metadata by value on append and read", async () => {
    const store = new InMemoryEventStore();
    const payload = { kind: "DocumentUpdated", patch: { title: "One" } };
    const metadata = { source: "test" };
    const [saved] = await store.append(stream, 0, [{ ...event, payload: payload as never, metadata }]);

    payload.patch.title = "mutated";
    metadata.source = "mutated";
    (saved!.payload as unknown as { patch: { title: string } }).patch.title = "returned mutation";
    (saved!.metadata as DocumentData).source = "returned mutation";

    const [read] = await store.readStream(stream);
    expect(read).toMatchObject({
      payload: { kind: "DocumentUpdated", patch: { title: "One" } },
      metadata: { source: "test" }
    });

    (read!.payload as unknown as { patch: { title: string } }).patch.title = "read mutation";
    (read!.metadata as DocumentData).source = "read mutation";

    await expect(store.readStream(stream)).resolves.toMatchObject([
      {
        payload: { kind: "DocumentUpdated", patch: { title: "One" } },
        metadata: { source: "test" }
      }
    ]);
  });

  it("rejects non-JSON event payloads before appending", async () => {
    const store = new InMemoryEventStore();

    await expect(
      store.append(stream, 0, [
        {
          ...event,
          payload: { kind: "DocumentUpdated", patch: { count: Number.POSITIVE_INFINITY } } as never
        }
      ])
    ).rejects.toMatchObject({
      code: "EVENT_INVALID",
      status: 409
    });
    await expect(store.readStream(stream)).resolves.toEqual([]);
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

  it("snapshots in-memory projections by value on save, get, and list", async () => {
    const projections = new InMemoryProjectionStore();
    const snapshot: DocumentSnapshot = {
      tenantId: "acme",
      doctype: "Note",
      name: "One",
      version: 1,
      docstatus: "draft",
      data: { title: "One", nested: { count: 1 } },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    };

    await projections.save(snapshot);
    (snapshot.data.nested as DocumentData).count = 2;

    const saved = await projections.get("acme", "Note", "One");
    expect(saved).toMatchObject({ data: { title: "One", nested: { count: 1 } } });

    (saved!.data.nested as DocumentData).count = 3;
    await expect(projections.get("acme", "Note", "One")).resolves.toMatchObject({
      data: { title: "One", nested: { count: 1 } }
    });

    const listed = await projections.list({ tenantId: "acme", doctype: "Note" });
    (listed.data[0]!.data.nested as DocumentData).count = 4;
    await expect(projections.get("acme", "Note", "One")).resolves.toMatchObject({
      data: { title: "One", nested: { count: 1 } }
    });
  });

  it("rejects non-JSON in-memory projection data before saving", async () => {
    const projections = new InMemoryProjectionStore();

    await expect(
      projections.save({
        tenantId: "acme",
        doctype: "Note",
        name: "Bad",
        version: 1,
        docstatus: "draft",
        data: { count: Number.POSITIVE_INFINITY } as never,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      })
    ).rejects.toMatchObject({
      code: "DOCUMENT_INVALID",
      status: 409
    });
    await expect(projections.get("acme", "Note", "Bad")).resolves.toBeNull();
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

  it("snapshots in-memory data-patch apply results by value", async () => {
    const log = new InMemoryDataPatchLog();
    const result = { nested: { count: 1 } };

    await log.claimDataPatch({
      id: "patch.apply",
      checksum: "v1",
      claimId: "claim-1",
      claimedAt: "2026-01-01T00:00:00.000Z"
    });
    await log.completeDataPatch({
      id: "patch.apply",
      checksum: "v1",
      claimId: "claim-1",
      appliedAt: "2026-01-01T00:01:00.000Z",
      result
    });
    result.nested.count = 2;

    const [firstRead] = await log.appliedDataPatches();
    expect(firstRead).toMatchObject({ result: { nested: { count: 1 } } });

    (firstRead!.result as DocumentData).nested = { count: 3 };
    await expect(log.appliedDataPatches()).resolves.toMatchObject([
      { result: { nested: { count: 1 } } }
    ]);
  });

  it("snapshots in-memory data-patch rollback results by value", async () => {
    const log = new InMemoryDataPatchLog();
    const rollbackResult = { nested: { undone: 1 } };

    await log.claimDataPatch({
      id: "patch.rollback",
      checksum: "v1",
      claimId: "claim-apply",
      claimedAt: "2026-01-01T00:00:00.000Z"
    });
    await log.completeDataPatch({
      id: "patch.rollback",
      checksum: "v1",
      claimId: "claim-apply",
      appliedAt: "2026-01-01T00:01:00.000Z",
      result: { touched: 1 }
    });
    await log.claimDataPatchRollback({
      id: "patch.rollback",
      checksum: "v1",
      claimId: "claim-rollback",
      claimedAt: "2026-01-01T00:02:00.000Z"
    });
    await log.completeDataPatchRollback({
      id: "patch.rollback",
      checksum: "v1",
      claimId: "claim-rollback",
      rolledBackAt: "2026-01-01T00:03:00.000Z",
      result: rollbackResult
    });
    rollbackResult.nested.undone = 2;

    const [firstRead] = await log.recordedDataPatches();
    expect(firstRead).toMatchObject({ rollbackResult: { nested: { undone: 1 } } });

    (firstRead as { rollbackResult: DocumentData }).rollbackResult.nested = { undone: 3 };
    await expect(log.recordedDataPatches()).resolves.toMatchObject([
      { rollbackResult: { nested: { undone: 1 } } }
    ]);
  });

  it("rejects non-JSON in-memory data-patch results before recording journals", async () => {
    const log = new InMemoryDataPatchLog();
    await log.claimDataPatch({
      id: "patch.bad",
      checksum: "v1",
      claimId: "claim-1",
      claimedAt: "2026-01-01T00:00:00.000Z"
    });

    await expect(log.completeDataPatch({
      id: "patch.bad",
      checksum: "v1",
      claimId: "claim-1",
      appliedAt: "2026-01-01T00:01:00.000Z",
      result: Number.POSITIVE_INFINITY as never
    })).rejects.toMatchObject({
      code: "DATA_PATCH_INVALID",
      status: 409
    });
    await expect(log.recordedDataPatches()).resolves.toMatchObject([{ status: "pending" }]);
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
