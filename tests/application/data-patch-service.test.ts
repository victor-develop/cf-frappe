import {
  DataPatchService,
  defineDataPatch,
  deterministicIds,
  fixedClock,
  InMemoryDataPatchLog,
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
});
