import {
  createDataPatchApplyJob,
  createDataPatchRollbackJob,
  createDataPatchRollbackRetryJob,
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
  SYSTEM_MANAGER_ROLE,
  type DataPatchLog
} from "../../src";
import { DataPatchRunner } from "../../src/application/data-patch-runner.js";
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
      totals: {
        total: 2,
        notApplied: 2,
        pending: 0,
        applied: 0,
        failed: 0,
        rollbackPending: 0,
        rolledBack: 0,
        rollbackFailed: 0
      }
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
      totals: {
        total: 2,
        notApplied: 0,
        pending: 0,
        applied: 2,
        failed: 0,
        rollbackPending: 0,
        rolledBack: 0,
        rollbackFailed: 0
      }
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
      totals: {
        total: 2,
        notApplied: 0,
        pending: 1,
        applied: 0,
        failed: 1,
        rollbackPending: 0,
        rolledBack: 0,
        rollbackFailed: 0
      }
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

  it("plans applied rollback batches in reverse order without running rollback code", async () => {
    const resources = { applied: [] as string[], rolledBack: [] as string[] };
    const service = new DataPatchService({
      log: new InMemoryDataPatchLog(),
      resources,
      patches: [
        defineDataPatch<typeof resources>({
          id: "core.first",
          checksum: "v1",
          run: ({ resources }) => {
            resources.applied.push("first");
          },
          rollback: {
            label: "Undo Core",
            run: ({ resources }) => {
              resources.rolledBack.push("first");
            }
          }
        }),
        defineDataPatch<typeof resources>({
          id: "crm.second",
          checksum: "v1",
          run: ({ resources }) => {
            resources.applied.push("second");
          },
          rollback: {
            run: ({ resources }) => {
              resources.rolledBack.push("second");
            }
          }
        })
      ],
      clock: fixedClock(now),
      ids: deterministicIds(["claim-first", "claim-second"])
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    await service.apply(admin);

    await expect(service.planRollback(admin)).resolves.toEqual({
      patchIds: ["crm.second", "core.first"]
    });
    await expect(service.planRollback(admin, { limit: 1 })).resolves.toEqual({
      patchIds: ["crm.second"],
      limit: 1
    });
    await expect(service.planRollback(admin, { patchIds: ["core.first", "crm.second"] })).resolves.toEqual({
      patchIds: ["crm.second", "core.first"],
      requestedPatchIds: ["core.first", "crm.second"]
    });
    await expect(service.dashboard(admin)).resolves.toMatchObject({
      patches: [
        { id: "core.first", rollbackable: true, rollbackLabel: "Undo Core" },
        { id: "crm.second", rollbackable: true }
      ]
    });
    expect(resources).toEqual({ applied: ["first", "second"], rolledBack: [] });
  });

  it("executes rollback batches in reverse order and projects rolled-back dashboard state", async () => {
    const resources = { applied: [] as string[], rolledBack: [] as string[] };
    const service = new DataPatchService({
      log: new InMemoryDataPatchLog(),
      resources,
      patches: [
        defineDataPatch<typeof resources>({
          id: "core.first",
          checksum: "v1",
          run: ({ resources }) => {
            resources.applied.push("first");
          },
          rollback: {
            run: ({ resources }) => {
              resources.rolledBack.push("first");
              return { rolledBack: resources.rolledBack.length };
            }
          }
        }),
        defineDataPatch<typeof resources>({
          id: "crm.second",
          checksum: "v1",
          run: ({ resources }) => {
            resources.applied.push("second");
          },
          rollback: {
            run: ({ resources }) => {
              resources.rolledBack.push("second");
              return { rolledBack: resources.rolledBack.length };
            }
          }
        })
      ],
      clock: fixedClock(now),
      ids: deterministicIds(["claim-first", "claim-second", "rollback-second", "rollback-first"])
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    await service.apply(admin);

    await expect(service.rollback(admin)).resolves.toEqual({
      rolledBack: [
        { id: "crm.second", checksum: "v1", rolledBackAt: now, result: { rolledBack: 1 } },
        { id: "core.first", checksum: "v1", rolledBackAt: now, result: { rolledBack: 2 } }
      ],
      skipped: []
    });
    await expect(service.dashboard(admin)).resolves.toMatchObject({
      patches: [
        { id: "core.first", status: "rolled_back", rolledBackAt: now, rollbackResult: { rolledBack: 2 } },
        { id: "crm.second", status: "rolled_back", rolledBackAt: now, rollbackResult: { rolledBack: 1 } }
      ],
      totals: { applied: 0, rolledBack: 2, rollbackPending: 0, rollbackFailed: 0 }
    });
    await expect(service.rollback(guest)).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
    expect(resources).toEqual({ applied: ["first", "second"], rolledBack: ["second", "first"] });
  });

  it("rejects rollback plans that skip later applied patches or lack rollback definitions", async () => {
    const service = new DataPatchService({
      log: new InMemoryDataPatchLog(),
      resources: {},
      patches: [
        defineDataPatch({
          id: "core.first",
          checksum: "v1",
          run: () => undefined,
          rollback: { run: () => undefined }
        }),
        defineDataPatch({
          id: "crm.second",
          checksum: "v1",
          run: () => undefined,
          rollback: { run: () => undefined }
        }),
        defineDataPatch({ id: "crm.third", checksum: "v1", run: () => undefined })
      ],
      clock: fixedClock(now),
      ids: deterministicIds(["claim-first", "claim-second", "claim-third"])
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    await service.apply(admin);

    await expect(service.planRollback(admin)).resolves.toEqual({ patchIds: [] });
    await expect(service.planRollback(admin, { patchIds: ["crm.third"] })).rejects.toMatchObject({
      code: "DATA_PATCH_ROLLBACK_UNAVAILABLE",
      message: "Data patch 'crm.third' does not declare a rollback",
      status: 409
    });
    await expect(service.planRollback(admin, { patchIds: ["crm.second"] })).rejects.toMatchObject({
      code: "DATA_PATCH_ORDER_VIOLATION",
      message: "Data patch 'crm.second' cannot roll back before later patch 'crm.third' is rolled back",
      status: 409
    });
    await expect(service.planRollback(guest)).rejects.toMatchObject({ code: "PERMISSION_DENIED", status: 403 });
  });

  it("rejects rollback plans for unapplied, pending, failed, missing, and checksum-drifted patches", async () => {
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    const unapplied = new DataPatchService({
      log: new InMemoryDataPatchLog(),
      resources: {},
      patches: [defineDataPatch({ id: "core.unapplied", checksum: "v1", run: () => undefined, rollback: { run: () => undefined } })]
    });
    await expect(unapplied.planRollback(admin, { patchIds: ["core.unapplied"] })).rejects.toMatchObject({
      code: "DATA_PATCH_ROLLBACK_UNAVAILABLE",
      status: 409
    });
    await expect(unapplied.planRollback(admin, { patchIds: ["missing.patch"] })).rejects.toMatchObject({
      code: "DATA_PATCH_NOT_FOUND",
      status: 404
    });

    const pendingLog = new InMemoryDataPatchLog();
    await pendingLog.claimDataPatch({ id: "core.pending", checksum: "v1", claimId: "claim-pending", claimedAt: now });
    const pending = new DataPatchService({
      log: pendingLog,
      resources: {},
      patches: [defineDataPatch({ id: "core.pending", checksum: "v1", run: () => undefined, rollback: { run: () => undefined } })]
    });
    await expect(pending.planRollback(admin)).rejects.toMatchObject({ code: "DATA_PATCH_PENDING", status: 409 });

    const pendingSuccessorLog = new InMemoryDataPatchLog();
    await pendingSuccessorLog.claimDataPatch({ id: "core.first", checksum: "v1", claimId: "claim-first", claimedAt: now });
    await pendingSuccessorLog.completeDataPatch({ id: "core.first", checksum: "v1", claimId: "claim-first", appliedAt: now });
    await pendingSuccessorLog.claimDataPatch({ id: "crm.pending", checksum: "v1", claimId: "claim-pending", claimedAt: now });
    const pendingSuccessor = new DataPatchService({
      log: pendingSuccessorLog,
      resources: {},
      patches: [
        defineDataPatch({ id: "core.first", checksum: "v1", run: () => undefined, rollback: { run: () => undefined } }),
        defineDataPatch({ id: "crm.pending", checksum: "v1", run: () => undefined, rollback: { run: () => undefined } })
      ]
    });
    await expect(pendingSuccessor.planRollback(admin, { patchIds: ["core.first"] })).rejects.toMatchObject({
      code: "DATA_PATCH_PENDING",
      status: 409
    });

    const failedLog = new InMemoryDataPatchLog();
    await failedLog.claimDataPatch({ id: "core.failed", checksum: "v1", claimId: "claim-failed", claimedAt: now });
    await failedLog.failDataPatch({
      id: "core.failed",
      checksum: "v1",
      claimId: "claim-failed",
      failedAt: now,
      error: "boom"
    });
    const failed = new DataPatchService({
      log: failedLog,
      resources: {},
      patches: [defineDataPatch({ id: "core.failed", checksum: "v1", run: () => undefined, rollback: { run: () => undefined } })]
    });
    await expect(failed.planRollback(admin)).rejects.toMatchObject({ code: "DATA_PATCH_FAILED", status: 409 });

    const failedSuccessorLog = new InMemoryDataPatchLog();
    await failedSuccessorLog.claimDataPatch({ id: "core.first", checksum: "v1", claimId: "claim-first", claimedAt: now });
    await failedSuccessorLog.completeDataPatch({ id: "core.first", checksum: "v1", claimId: "claim-first", appliedAt: now });
    await failedSuccessorLog.claimDataPatch({ id: "crm.failed", checksum: "v1", claimId: "claim-failed", claimedAt: now });
    await failedSuccessorLog.failDataPatch({
      id: "crm.failed",
      checksum: "v1",
      claimId: "claim-failed",
      failedAt: now,
      error: "boom"
    });
    const failedSuccessor = new DataPatchService({
      log: failedSuccessorLog,
      resources: {},
      patches: [
        defineDataPatch({ id: "core.first", checksum: "v1", run: () => undefined, rollback: { run: () => undefined } }),
        defineDataPatch({ id: "crm.failed", checksum: "v1", run: () => undefined, rollback: { run: () => undefined } })
      ]
    });
    await expect(failedSuccessor.planRollback(admin, { patchIds: ["core.first"] })).rejects.toMatchObject({
      code: "DATA_PATCH_FAILED",
      status: 409
    });

    const checksumLog = new InMemoryDataPatchLog();
    await checksumLog.claimDataPatch({ id: "core.drift", checksum: "v1", claimId: "claim-drift", claimedAt: now });
    await checksumLog.completeDataPatch({ id: "core.drift", checksum: "v1", claimId: "claim-drift", appliedAt: now });
    const checksum = new DataPatchService({
      log: checksumLog,
      resources: {},
      patches: [defineDataPatch({ id: "core.drift", checksum: "v2", run: () => undefined, rollback: { run: () => undefined } })]
    });
    await expect(checksum.planRollback(admin)).rejects.toMatchObject({
      code: "DATA_PATCH_CHECKSUM_MISMATCH",
      status: 409
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

  it("retries failed data patches by clearing the failed journal and re-entering the runner", async () => {
    const resources = { attempts: 0 };
    const log = new InMemoryDataPatchLog();
    const service = new DataPatchService({
      log,
      resources,
      patches: [
        defineDataPatch<typeof resources>({
          id: "core.retry",
          checksum: "v1",
          run: ({ resources }) => {
            resources.attempts += 1;
            if (resources.attempts === 1) {
              throw new Error("boom");
            }
            return { attempts: resources.attempts };
          }
        })
      ],
      clock: fixedClock(now),
      ids: deterministicIds(["claim-failed", "claim-retry"])
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

    await expect(service.apply(admin)).rejects.toThrow("boom");
    await expect(service.dashboard(admin)).resolves.toMatchObject({
      patches: [{ id: "core.retry", status: "failed", error: "boom" }],
      totals: { failed: 1, applied: 0 }
    });

    await expect(service.retryFailed(admin, "core.retry")).resolves.toEqual({
      applied: [{ id: "core.retry", checksum: "v1", appliedAt: now, result: { attempts: 2 } }],
      skipped: []
    });
    await expect(service.dashboard(admin)).resolves.toMatchObject({
      patches: [{ id: "core.retry", status: "applied", result: { attempts: 2 } }],
      totals: { failed: 0, applied: 1 }
    });
    expect(resources.attempts).toBe(2);
  });

  it("rejects failed data patch retry when the journal state is not retryable", async () => {
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    const appliedLog = new InMemoryDataPatchLog();
    const appliedService = new DataPatchService({
      log: appliedLog,
      resources: {},
      patches: [defineDataPatch({ id: "core.applied", checksum: "v1", run: () => undefined })],
      clock: fixedClock(now),
      ids: deterministicIds(["claim-applied"])
    });
    await appliedService.apply(admin);
    await expect(appliedService.retryFailed(admin, "core.applied")).rejects.toMatchObject({
      code: "DATA_PATCH_RETRY_UNAVAILABLE",
      status: 409
    });
    await expect(appliedService.retryFailed(guest, "core.applied")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      status: 403
    });
    await expect(appliedService.retryFailed(admin, "core.missing")).rejects.toMatchObject({
      code: "DATA_PATCH_NOT_FOUND",
      status: 404
    });

    const pendingLog = new InMemoryDataPatchLog();
    const pendingService = new DataPatchService({
      log: pendingLog,
      resources: {},
      patches: [defineDataPatch({ id: "core.pending", checksum: "v1", run: () => undefined })]
    });
    await pendingLog.claimDataPatch({ id: "core.pending", checksum: "v1", claimId: "claim-pending", claimedAt: now });
    await expect(pendingService.retryFailed(admin, "core.pending")).rejects.toMatchObject({
      code: "DATA_PATCH_PENDING",
      status: 409
    });

    const checksumLog = new InMemoryDataPatchLog();
    const checksumService = new DataPatchService({
      log: checksumLog,
      resources: {},
      patches: [defineDataPatch({ id: "core.failed", checksum: "v2", run: () => undefined })]
    });
    await checksumLog.claimDataPatch({ id: "core.failed", checksum: "v1", claimId: "claim-failed", claimedAt: now });
    await checksumLog.failDataPatch({
      id: "core.failed",
      checksum: "v1",
      claimId: "claim-failed",
      failedAt: now,
      error: "boom"
    });
    await expect(checksumService.retryFailed(admin, "core.failed")).rejects.toMatchObject({
      code: "DATA_PATCH_CHECKSUM_MISMATCH",
      status: 409
    });

    const orderedLog = new InMemoryDataPatchLog();
    const orderedService = new DataPatchService({
      log: orderedLog,
      resources: {},
      patches: [
        defineDataPatch({ id: "core.first", checksum: "v1", run: () => undefined }),
        defineDataPatch({ id: "crm.second", checksum: "v1", run: () => undefined })
      ]
    });
    await orderedLog.claimDataPatch({ id: "crm.second", checksum: "v1", claimId: "claim-second", claimedAt: now });
    await orderedLog.failDataPatch({
      id: "crm.second",
      checksum: "v1",
      claimId: "claim-second",
      failedAt: now,
      error: "boom"
    });
    await expect(orderedService.retryFailed(admin, "crm.second")).rejects.toMatchObject({
      code: "DATA_PATCH_ORDER_VIOLATION",
      status: 409
    });
  });

  it("rejects invalid data patch ids before retry selection", async () => {
    const service = new DataPatchService({
      log: new InMemoryDataPatchLog(),
      resources: {},
      patches: [defineDataPatch({ id: "core.retry", checksum: "v1", run: () => undefined })]
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

    await expect(service.retryFailed(admin, "")).rejects.toMatchObject({
      code: "DATA_PATCH_INVALID",
      status: 400
    });
  });

  it("rejects rollback retries for patches without rollback declarations", async () => {
    const runner = new DataPatchRunner({
      log: new InMemoryDataPatchLog(),
      resources: {}
    });

    await expect(runner.retryRollbackFailed(
      defineDataPatch({ id: "core.no_rollback", checksum: "v1", run: () => undefined })
    )).rejects.toMatchObject({
      code: "DATA_PATCH_ROLLBACK_UNAVAILABLE",
      status: 409
    });
  });

  it("retries failed data patch rollbacks by restoring applied state and re-entering the runner", async () => {
    const resources = { applied: [] as string[], rollbackAttempts: 0, rolledBack: [] as string[] };
    const service = new DataPatchService({
      log: new InMemoryDataPatchLog(),
      resources,
      patches: [
        defineDataPatch<typeof resources>({
          id: "core.rollback_retry",
          checksum: "v1",
          run: ({ resources }) => {
            resources.applied.push("core");
            return { applied: resources.applied.length };
          },
          rollback: {
            run: ({ resources }) => {
              resources.rollbackAttempts += 1;
              if (resources.rollbackAttempts === 1) {
                throw new Error("rollback boom");
              }
              resources.rolledBack.push("core");
              return { attempts: resources.rollbackAttempts };
            }
          }
        })
      ],
      clock: fixedClock(now),
      ids: deterministicIds(["claim-apply", "rollback-failed", "rollback-retry"])
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    await service.apply(admin);

    await expect(service.rollback(admin, { patchIds: ["core.rollback_retry"] })).rejects.toThrow("rollback boom");
    await expect(service.dashboard(admin)).resolves.toMatchObject({
      patches: [
        {
          id: "core.rollback_retry",
          status: "rollback_failed",
          result: { applied: 1 },
          rollbackError: "rollback boom"
        }
      ],
      totals: { applied: 0, rollbackFailed: 1, rolledBack: 0 }
    });
    await expect(service.retryRollbackFailed(guest, "core.rollback_retry")).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      status: 403
    });

    await expect(service.retryRollbackFailed(admin, "core.rollback_retry")).resolves.toEqual({
      rolledBack: [{ id: "core.rollback_retry", checksum: "v1", rolledBackAt: now, result: { attempts: 2 } }],
      skipped: []
    });
    await expect(service.dashboard(admin)).resolves.toMatchObject({
      patches: [
        {
          id: "core.rollback_retry",
          status: "rolled_back",
          result: { applied: 1 },
          rollbackResult: { attempts: 2 }
        }
      ],
      totals: { applied: 0, rollbackFailed: 0, rolledBack: 1 }
    });
    expect(resources).toEqual({ applied: ["core"], rollbackAttempts: 2, rolledBack: ["core"] });
  });

  it("keeps rollback retry claimed while concurrent successors try to apply", async () => {
    const resources = { applied: [] as string[], rollbackAttempts: 0, concurrentApplyBlocked: false };
    const innerLog = new InMemoryDataPatchLog();
    let onRollbackRetryClaim: (() => Promise<void>) | undefined;
    const log: DataPatchLog = {
      recordedDataPatches: () => innerLog.recordedDataPatches(),
      appliedDataPatches: () => innerLog.appliedDataPatches(),
      claimDataPatch: (patch) => innerLog.claimDataPatch(patch),
      completeDataPatch: (patch) => innerLog.completeDataPatch(patch),
      failDataPatch: (patch) => innerLog.failDataPatch(patch),
      retryFailedDataPatch: (patch) => innerLog.retryFailedDataPatch(patch),
      claimDataPatchRollback: (patch) => innerLog.claimDataPatchRollback(patch),
      completeDataPatchRollback: (patch) => innerLog.completeDataPatchRollback(patch),
      failDataPatchRollback: (patch) => innerLog.failDataPatchRollback(patch),
      retryFailedDataPatchRollback: async (patch) => {
        const claim = await innerLog.retryFailedDataPatchRollback(patch);
        await onRollbackRetryClaim?.();
        return claim;
      }
    };
    const service = new DataPatchService({
      log,
      resources,
      patches: [
        defineDataPatch<typeof resources>({
          id: "core.first",
          checksum: "v1",
          run: ({ resources }) => {
            resources.applied.push("first");
          },
          rollback: {
            run: ({ resources }) => {
              resources.rollbackAttempts += 1;
              if (resources.rollbackAttempts === 1) {
                throw new Error("rollback boom");
              }
            }
          }
        }),
        defineDataPatch<typeof resources>({
          id: "crm.second",
          checksum: "v1",
          run: ({ resources }) => {
            resources.applied.push("second");
          }
        })
      ],
      clock: fixedClock(now),
      ids: deterministicIds(["claim-first", "rollback-failed", "rollback-retry"])
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    await service.apply(admin, { patchIds: ["core.first"] });
    await expect(service.rollback(admin, { patchIds: ["core.first"] })).rejects.toThrow("rollback boom");
    onRollbackRetryClaim = async () => {
      await expect(service.apply(admin, { patchIds: ["crm.second"] })).rejects.toMatchObject({
        code: "DATA_PATCH_ORDER_VIOLATION",
        status: 409
      });
      resources.concurrentApplyBlocked = true;
    };

    await expect(service.retryRollbackFailed(admin, "core.first")).resolves.toEqual({
      rolledBack: [{ id: "core.first", checksum: "v1", rolledBackAt: now }],
      skipped: []
    });
    expect(resources).toEqual({ applied: ["first"], rollbackAttempts: 2, concurrentApplyBlocked: true });
  });

  it("rejects rollback retry when journal state or rollback order is not retryable", async () => {
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    const appliedService = new DataPatchService({
      log: new InMemoryDataPatchLog(),
      resources: {},
      patches: [
        defineDataPatch({
          id: "core.applied",
          checksum: "v1",
          run: () => undefined,
          rollback: { run: () => undefined }
        })
      ],
      clock: fixedClock(now),
      ids: deterministicIds(["claim-applied"])
    });
    await appliedService.apply(admin);
    await expect(appliedService.retryRollbackFailed(admin, "core.applied")).rejects.toMatchObject({
      code: "DATA_PATCH_ROLLBACK_RETRY_UNAVAILABLE",
      status: 409
    });
    await expect(appliedService.retryRollbackFailed(admin, "core.missing")).rejects.toMatchObject({
      code: "DATA_PATCH_NOT_FOUND",
      status: 404
    });

    const pendingRollbackLog = new InMemoryDataPatchLog();
    await pendingRollbackLog.claimDataPatch({
      id: "core.pending_rollback",
      checksum: "v1",
      claimId: "claim-apply",
      claimedAt: now
    });
    await pendingRollbackLog.completeDataPatch({
      id: "core.pending_rollback",
      checksum: "v1",
      claimId: "claim-apply",
      appliedAt: now
    });
    await pendingRollbackLog.claimDataPatchRollback({
      id: "core.pending_rollback",
      checksum: "v1",
      claimId: "rollback-pending",
      claimedAt: now
    });
    const pendingRollbackService = new DataPatchService({
      log: pendingRollbackLog,
      resources: {},
      patches: [
        defineDataPatch({
          id: "core.pending_rollback",
          checksum: "v1",
          run: () => undefined,
          rollback: { run: () => undefined }
        })
      ]
    });
    await expect(pendingRollbackService.retryRollbackFailed(admin, "core.pending_rollback")).rejects.toMatchObject({
      code: "DATA_PATCH_ROLLBACK_PENDING",
      status: 409
    });

    const checksumLog = new InMemoryDataPatchLog();
    await checksumLog.claimDataPatch({ id: "core.drift", checksum: "v1", claimId: "claim-apply", claimedAt: now });
    await checksumLog.completeDataPatch({ id: "core.drift", checksum: "v1", claimId: "claim-apply", appliedAt: now });
    await checksumLog.claimDataPatchRollback({
      id: "core.drift",
      checksum: "v1",
      claimId: "rollback-failed",
      claimedAt: now
    });
    await checksumLog.failDataPatchRollback({
      id: "core.drift",
      checksum: "v1",
      claimId: "rollback-failed",
      failedAt: now,
      error: "boom"
    });
    const checksumService = new DataPatchService({
      log: checksumLog,
      resources: {},
      patches: [
        defineDataPatch({
          id: "core.drift",
          checksum: "v2",
          run: () => undefined,
          rollback: { run: () => undefined }
        })
      ]
    });
    await expect(checksumService.retryRollbackFailed(admin, "core.drift")).rejects.toMatchObject({
      code: "DATA_PATCH_CHECKSUM_MISMATCH",
      status: 409
    });

    const orderedLog = new InMemoryDataPatchLog();
    await orderedLog.claimDataPatch({ id: "core.first", checksum: "v1", claimId: "claim-first", claimedAt: now });
    await orderedLog.completeDataPatch({ id: "core.first", checksum: "v1", claimId: "claim-first", appliedAt: now });
    await orderedLog.claimDataPatch({ id: "crm.second", checksum: "v1", claimId: "claim-second", claimedAt: now });
    await orderedLog.completeDataPatch({ id: "crm.second", checksum: "v1", claimId: "claim-second", appliedAt: now });
    await orderedLog.claimDataPatchRollback({
      id: "core.first",
      checksum: "v1",
      claimId: "rollback-first",
      claimedAt: now
    });
    await orderedLog.failDataPatchRollback({
      id: "core.first",
      checksum: "v1",
      claimId: "rollback-first",
      failedAt: now,
      error: "boom"
    });
    const orderedService = new DataPatchService({
      log: orderedLog,
      resources: {},
      patches: [
        defineDataPatch({ id: "core.first", checksum: "v1", run: () => undefined, rollback: { run: () => undefined } }),
        defineDataPatch({ id: "crm.second", checksum: "v1", run: () => undefined, rollback: { run: () => undefined } })
      ]
    });
    await expect(orderedService.retryRollbackFailed(admin, "core.first")).rejects.toMatchObject({
      code: "DATA_PATCH_ORDER_VIOLATION",
      status: 409
    });
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

  it("enqueues validated data patch rollback plans and executes them through the built-in job", async () => {
    const resources = { applied: [] as string[], rolledBack: [] as string[] };
    const log = new InMemoryDataPatchLog();
    const service = new DataPatchService({
      log,
      resources,
      patches: [
        defineDataPatch<typeof resources>({
          id: "core.first",
          checksum: "v1",
          run: ({ resources }) => {
            resources.applied.push("first");
          },
          rollback: {
            run: ({ resources }) => {
              resources.rolledBack.push("first");
              return { rolledBack: resources.rolledBack.length };
            }
          }
        }),
        defineDataPatch<typeof resources>({
          id: "crm.second",
          checksum: "v1",
          run: ({ resources }) => {
            resources.applied.push("second");
          },
          rollback: {
            run: ({ resources }) => {
              resources.rolledBack.push("second");
              return { rolledBack: resources.rolledBack.length };
            }
          }
        })
      ],
      clock: fixedClock(now),
      ids: deterministicIds(["claim-first", "claim-second", "rollback-second"])
    });
    const registry = createJobRegistry<{ readonly dataPatches: DataPatchService<typeof resources> }>({
      jobs: [createDataPatchRollbackJob()]
    });
    const queue = new InMemoryJobQueue();
    const dispatcher = new JobDispatcher({
      registry,
      queue,
      clock: fixedClock(now),
      ids: deterministicIds(["patch-rollback-001"])
    });
    const queueService = new DataPatchQueueService({
      dataPatches: service,
      dispatcher
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    await service.apply(admin);

    await expect(
      queueService.enqueueRollback(admin, {
        limit: 1,
        delaySeconds: 45,
        idempotencyKey: "patches:rollback-second",
        metadata: { source: "test" }
      })
    ).resolves.toMatchObject({
      plan: { patchIds: ["crm.second"], limit: 1 },
      message: {
        tenantId: "acme",
        jobName: "cf-frappe.data-patches.rollback",
        runId: "job_patch-rollback-001",
        idempotencyKey: "patches:rollback-second",
        payload: {
          actor: { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
          patchIds: ["crm.second"]
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
        delaySeconds: 45,
        message: expect.objectContaining({ idempotencyKey: "patches:rollback-second" })
      })
    ]);
    expect(resources.rolledBack).toEqual([]);

    const executor = new JobExecutor({
      registry,
      resources: { dataPatches: service },
      clock: fixedClock(now)
    });
    await expect(executor.execute(queue.queued()[0]!.message)).resolves.toEqual({
      status: "succeeded",
      result: {
        rolledBack: [{ id: "crm.second", checksum: "v1", rolledBackAt: now, result: { rolledBack: 1 } }],
        skipped: []
      }
    });
    expect(resources.rolledBack).toEqual(["second"]);
  });

  it("enqueues validated data patch rollback retry plans and executes them through the built-in job", async () => {
    const resources = { rollbackAttempts: 0, rolledBack: [] as string[] };
    const log = new InMemoryDataPatchLog();
    const service = new DataPatchService({
      log,
      resources,
      patches: [
        defineDataPatch<typeof resources>({
          id: "core.rollback_retry",
          checksum: "v1",
          run: () => undefined,
          rollback: {
            run: ({ resources }) => {
              resources.rollbackAttempts += 1;
              if (resources.rollbackAttempts === 1) {
                throw new Error("rollback boom");
              }
              resources.rolledBack.push("core");
              return { attempts: resources.rollbackAttempts };
            }
          }
        })
      ],
      clock: fixedClock(now),
      ids: deterministicIds(["claim-apply", "rollback-failed", "rollback-retry"])
    });
    const registry = createJobRegistry<{ readonly dataPatches: DataPatchService<typeof resources> }>({
      jobs: [createDataPatchRollbackRetryJob()]
    });
    const queue = new InMemoryJobQueue();
    const dispatcher = new JobDispatcher({
      registry,
      queue,
      clock: fixedClock(now),
      ids: deterministicIds(["patch-rollback-retry-001"])
    });
    const queueService = new DataPatchQueueService({
      dataPatches: service,
      dispatcher
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    await service.apply(admin);
    await expect(service.rollback(admin, { patchIds: ["core.rollback_retry"] })).rejects.toThrow("rollback boom");

    await expect(
      queueService.enqueueRollbackRetry(admin, "core.rollback_retry", {
        delaySeconds: 60,
        idempotencyKey: "patches:rollback-retry",
        metadata: { source: "test" }
      })
    ).resolves.toMatchObject({
      plan: { patchId: "core.rollback_retry" },
      message: {
        tenantId: "acme",
        jobName: "cf-frappe.data-patches.rollback-retry",
        runId: "job_patch-rollback-retry-001",
        idempotencyKey: "patches:rollback-retry",
        payload: {
          actor: { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
          patchId: "core.rollback_retry"
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
        delaySeconds: 60,
        message: expect.objectContaining({ idempotencyKey: "patches:rollback-retry" })
      })
    ]);
    expect(resources.rolledBack).toEqual([]);

    const executor = new JobExecutor({
      registry,
      resources: { dataPatches: service },
      clock: fixedClock(now)
    });
    await expect(executor.execute(queue.queued()[0]!.message)).resolves.toEqual({
      status: "succeeded",
      result: {
        rolledBack: [
          { id: "core.rollback_retry", checksum: "v1", rolledBackAt: now, result: { attempts: 2 } }
        ],
        skipped: []
      }
    });
    expect(resources).toEqual({ rollbackAttempts: 2, rolledBack: ["core"] });
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

  it("does not enqueue empty data patch rollback plans", async () => {
    const service = new DataPatchService({
      log: new InMemoryDataPatchLog(),
      resources: {},
      patches: []
    });
    const registry = createJobRegistry({ jobs: [createDataPatchRollbackJob()] });
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

    await expect(queueService.enqueueRollback(admin)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "No rollbackable data patches to enqueue"
    });
  });

  it("does not enqueue rollback retry plans when no failed rollback exists", async () => {
    const service = new DataPatchService({
      log: new InMemoryDataPatchLog(),
      resources: {},
      patches: [
        defineDataPatch({
          id: "core.seed",
          checksum: "v1",
          run: () => undefined,
          rollback: { run: () => undefined }
        })
      ]
    });
    const registry = createJobRegistry({ jobs: [createDataPatchRollbackRetryJob()] });
    const queue = new InMemoryJobQueue();
    const queueService = new DataPatchQueueService({
      dataPatches: service,
      dispatcher: new JobDispatcher({
        registry,
        queue,
        clock: fixedClock(now),
        ids: deterministicIds(["patch-001"])
      })
    });
    const admin = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

    await expect(queueService.enqueueRollbackRetry(admin, "core.seed")).rejects.toMatchObject({
      code: "DATA_PATCH_ROLLBACK_RETRY_UNAVAILABLE",
      status: 409
    });
    expect(queue.queued()).toEqual([]);
  });
});
