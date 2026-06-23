import {
  createDataPatchApplyJob,
  createJobRegistry,
  DataPatchQueueService,
  DataPatchService,
  defineDataPatch,
  deterministicIds,
  fixedClock,
  InMemoryDataPatchLog,
  InMemoryJobQueue,
  JobDispatcher,
  JobExecutor,
  SYSTEM_MANAGER_ROLE
} from "../../src";
import { guest, now } from "../helpers";

describe("DataPatchService", () => {
  it("projects patch dashboard state and applies pending patches for admins", async () => {
    const resources = { touched: [] as string[] };
    const log = new InMemoryDataPatchLog();
    const service = new DataPatchService({
      log,
      resources,
      patches: [
        defineDataPatch<typeof resources>({
          id: "core.seed",
          label: "Seed Core",
          checksum: "v1",
          run: ({ resources }) => {
            resources.touched.push("core");
            return { touched: 1 };
          }
        }),
        defineDataPatch<typeof resources>({
          id: "crm.backfill",
          checksum: "v1",
          run: ({ resources }) => {
            resources.touched.push("crm");
          }
        })
      ],
      clock: fixedClock(now),
      ids: deterministicIds(["claim-core", "claim-crm"])
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

    await expect(service.dashboard(admin)).resolves.toEqual({
      patches: [
        { id: "core.seed", label: "Seed Core", checksum: "v1", status: "not_applied" },
        { id: "crm.backfill", checksum: "v1", status: "not_applied" }
      ],
      totals: { total: 2, notApplied: 2, pending: 0, applied: 0, failed: 0 }
    });

    await expect(service.apply(admin)).resolves.toEqual({
      applied: [
        { id: "core.seed", checksum: "v1", appliedAt: now, result: { touched: 1 } },
        { id: "crm.backfill", checksum: "v1", appliedAt: now }
      ],
      skipped: []
    });
    expect(resources.touched).toEqual(["core", "crm"]);

    await expect(service.dashboard(admin)).resolves.toEqual({
      patches: [
        { id: "core.seed", label: "Seed Core", checksum: "v1", status: "applied", appliedAt: now, result: { touched: 1 } },
        { id: "crm.backfill", checksum: "v1", status: "applied", appliedAt: now }
      ],
      totals: { total: 2, notApplied: 0, pending: 0, applied: 2, failed: 0 }
    });
    await expect(service.apply(admin)).resolves.toMatchObject({
      applied: [],
      skipped: [{ id: "core.seed" }, { id: "crm.backfill" }]
    });
  });

  it("blocks non-admins and surfaces pending or failed journal state", async () => {
    const log = new InMemoryDataPatchLog();
    const pending = defineDataPatch({ id: "core.pending", checksum: "v1", run: () => undefined });
    const failed = defineDataPatch({ id: "core.failed", checksum: "v1", run: () => undefined });
    const service = new DataPatchService({
      log,
      resources: {},
      patches: [pending, failed]
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    await log.claimDataPatch({ id: "core.pending", checksum: "v1", claimId: "claim-pending", claimedAt: now });
    await log.claimDataPatch({ id: "core.failed", checksum: "v1", claimId: "claim-failed", claimedAt: now });
    await log.failDataPatch({
      id: "core.failed",
      checksum: "v1",
      claimId: "claim-failed",
      failedAt: now,
      error: "boom"
    });

    await expect(service.dashboard(guest)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(service.apply(guest)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(service.dashboard(admin)).resolves.toEqual({
      patches: [
        { id: "core.pending", checksum: "v1", status: "pending", claimedAt: now },
        { id: "core.failed", checksum: "v1", status: "failed", failedAt: now, error: "boom" }
      ],
      totals: { total: 2, notApplied: 0, pending: 1, applied: 0, failed: 1 }
    });
    await expect(service.apply(admin)).rejects.toMatchObject({ code: "DATA_PATCH_PENDING" });
  });

  it("applies bounded pending batches and selected patches in registry order", async () => {
    const resources = { touched: [] as string[] };
    const service = new DataPatchService({
      log: new InMemoryDataPatchLog(),
      resources,
      patches: [
        defineDataPatch<typeof resources>({
          id: "core.first",
          checksum: "v1",
          run: ({ resources }) => {
            resources.touched.push("first");
          }
        }),
        defineDataPatch<typeof resources>({
          id: "crm.second",
          checksum: "v1",
          run: ({ resources }) => {
            resources.touched.push("second");
          }
        }),
        defineDataPatch<typeof resources>({
          id: "crm.third",
          checksum: "v1",
          run: ({ resources }) => {
            resources.touched.push("third");
          }
        })
      ],
      clock: fixedClock(now),
      ids: deterministicIds(["claim-first", "claim-second", "claim-third"])
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

    await expect(service.apply(admin, { patchIds: ["crm.third"] })).rejects.toMatchObject({
      code: "DATA_PATCH_ORDER_VIOLATION",
      status: 409
    });
    await expect(service.apply(admin, { limit: 1 })).resolves.toMatchObject({
      applied: [{ id: "core.first" }],
      skipped: []
    });
    await expect(service.apply(admin, { patchIds: ["crm.third", "crm.second"] })).resolves.toMatchObject({
      applied: [{ id: "crm.second" }, { id: "crm.third" }],
      skipped: []
    });
    await expect(service.apply(admin, { limit: 1 })).resolves.toEqual({ applied: [], skipped: [] });
    await expect(service.apply(admin, { patchIds: ["crm.missing"] })).rejects.toMatchObject({
      code: "DATA_PATCH_NOT_FOUND",
      status: 404
    });
    expect(resources.touched).toEqual(["first", "second", "third"]);
  });

  it("plans data patch application without claiming or running patches", async () => {
    const resources = { touched: [] as string[] };
    const service = new DataPatchService({
      log: new InMemoryDataPatchLog(),
      resources,
      patches: [
        defineDataPatch<typeof resources>({
          id: "core.first",
          checksum: "v1",
          run: ({ resources }) => {
            resources.touched.push("first");
          }
        }),
        defineDataPatch<typeof resources>({
          id: "crm.second",
          checksum: "v1",
          run: ({ resources }) => {
            resources.touched.push("second");
          }
        })
      ]
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

    await expect(service.planApply(admin, { limit: 1 })).resolves.toEqual({
      patchIds: ["core.first"],
      limit: 1
    });

    expect(resources.touched).toEqual([]);
    await expect(service.dashboard(admin)).resolves.toMatchObject({
      totals: { notApplied: 2, pending: 0, applied: 0, failed: 0 }
    });
  });

  it("plans only pending patches and surfaces blocked journal states", async () => {
    const resources = { touched: [] as string[] };
    const log = new InMemoryDataPatchLog();
    const patches = [
      defineDataPatch<typeof resources>({
        id: "core.first",
        checksum: "v1",
        run: ({ resources }) => {
          resources.touched.push("first");
        }
      }),
      defineDataPatch<typeof resources>({
        id: "crm.second",
        checksum: "v1",
        run: ({ resources }) => {
          resources.touched.push("second");
        }
      })
    ];
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    const service = new DataPatchService({
      log,
      resources,
      patches,
      clock: fixedClock(now),
      ids: deterministicIds(["claim-first", "claim-second"])
    });

    await service.apply(admin, { patchIds: ["core.first"] });

    await expect(service.planApply(admin)).resolves.toEqual({
      patchIds: ["crm.second"]
    });
    await expect(service.planApply(admin, { patchIds: ["core.first"] })).resolves.toEqual({
      patchIds: [],
      requestedPatchIds: ["core.first"]
    });
    expect(resources.touched).toEqual(["first"]);

    await log.claimDataPatch({ id: "crm.second", checksum: "v1", claimId: "claim-second", claimedAt: now });
    await expect(service.planApply(admin)).rejects.toMatchObject({ code: "DATA_PATCH_PENDING", status: 409 });
    await log.failDataPatch({
      id: "crm.second",
      checksum: "v1",
      claimId: "claim-second",
      failedAt: now,
      error: "boom"
    });
    await expect(service.planApply(admin)).rejects.toMatchObject({ code: "DATA_PATCH_FAILED", status: 409 });
  });

  it("enqueues validated data patch plans and executes them through the built-in job", async () => {
    const resources = { touched: [] as string[] };
    const log = new InMemoryDataPatchLog();
    const service = new DataPatchService({
      log,
      resources,
      patches: [
        defineDataPatch<typeof resources>({
          id: "core.first",
          checksum: "v1",
          run: ({ resources }) => {
            resources.touched.push("first");
            return { touched: resources.touched.length };
          }
        }),
        defineDataPatch<typeof resources>({
          id: "crm.second",
          checksum: "v1",
          run: ({ resources }) => {
            resources.touched.push("second");
          }
        })
      ],
      clock: fixedClock(now),
      ids: deterministicIds(["claim-first", "claim-second"])
    });
    const registry = createJobRegistry<{ readonly dataPatches: DataPatchService<typeof resources> }>({
      jobs: [createDataPatchApplyJob()]
    });
    const queue = new InMemoryJobQueue();
    const dispatcher = new JobDispatcher({
      registry,
      queue,
      clock: fixedClock(now),
      ids: deterministicIds(["patch-001"])
    });
    const queueService = new DataPatchQueueService({
      dataPatches: service,
      dispatcher
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

    await expect(
      queueService.enqueue(admin, {
        limit: 1,
        delaySeconds: 30,
        idempotencyKey: "patches:first",
        metadata: { source: "test" }
      })
    ).resolves.toMatchObject({
      plan: { patchIds: ["core.first"], limit: 1 },
      message: {
        tenantId: "acme",
        jobName: "cf-frappe.data-patches.apply",
        runId: "job_patch-001",
        idempotencyKey: "patches:first",
        payload: {
          actor: { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
          patchIds: ["core.first"]
        },
        metadata: {
          source: "test",
          dispatchSource: "data-patches",
          requestedBy: "admin@example.com"
        }
      }
    });
    expect(queue.queued()).toEqual([
      expect.objectContaining({
        delaySeconds: 30,
        message: expect.objectContaining({ idempotencyKey: "patches:first" })
      })
    ]);
    expect(resources.touched).toEqual([]);

    const executor = new JobExecutor({
      registry,
      resources: { dataPatches: service },
      clock: fixedClock(now)
    });
    await expect(executor.execute(queue.queued()[0]!.message)).resolves.toEqual({
      status: "succeeded",
      result: {
        applied: [{ id: "core.first", checksum: "v1", appliedAt: now, result: { touched: 1 } }],
        skipped: []
      }
    });
    expect(resources.touched).toEqual(["first"]);
  });

  it("does not enqueue empty data patch plans", async () => {
    const service = new DataPatchService({
      log: new InMemoryDataPatchLog(),
      resources: {},
      patches: []
    });
    const registry = createJobRegistry({ jobs: [createDataPatchApplyJob()] });
    const queueService = new DataPatchQueueService({
      dataPatches: service,
      dispatcher: new JobDispatcher({
        registry,
        queue: new InMemoryJobQueue(),
        clock: fixedClock(now),
        ids: deterministicIds(["patch-001"])
      })
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

    await expect(queueService.enqueue(admin)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "No pending data patches to enqueue"
    });
  });
});
