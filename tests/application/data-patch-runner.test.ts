import { DataPatchRunner, defineDataPatch, deterministicIds, fixedClock, InMemoryDataPatchLog } from "../../src";
import { now } from "../helpers";

describe("DataPatchRunner", () => {
  it("applies patches once in manifest order and passes typed resources", async () => {
    const resources = { touched: [] as string[] };
    const log = new InMemoryDataPatchLog();
    const patches = [
      defineDataPatch<typeof resources>({
        id: "core.seed",
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
          return { touched: 2 };
        }
      })
    ];
    const runner = new DataPatchRunner({
      log,
      patches,
      resources,
      clock: fixedClock(now),
      ids: deterministicIds(["claim-core", "claim-crm"])
    });

    await expect(runner.apply()).resolves.toEqual({
      applied: [
        { id: "core.seed", checksum: "v1", appliedAt: now, result: { touched: 1 } },
        { id: "crm.backfill", checksum: "v1", appliedAt: now, result: { touched: 2 } }
      ],
      skipped: []
    });
    expect(resources.touched).toEqual(["core", "crm"]);

    const second = await runner.apply();
    expect(second.applied).toEqual([]);
    expect(second.skipped.map((patch) => patch.id)).toEqual(["core.seed", "crm.backfill"]);
    expect(resources.touched).toEqual(["core", "crm"]);
  });

  it("does not record a patch when execution fails", async () => {
    const log = new InMemoryDataPatchLog();
    const runner = new DataPatchRunner({
      log,
      resources: {},
      patches: [
        defineDataPatch({
          id: "fail.once",
          checksum: "v1",
          run: () => {
            throw new Error("boom");
          }
        })
      ]
    });

    await expect(runner.apply()).rejects.toThrow("boom");
    await expect(log.appliedDataPatches()).resolves.toEqual([]);
    await expect(runner.apply()).rejects.toMatchObject({ code: "DATA_PATCH_FAILED" });
    await expect(runner.pendingPatches()).rejects.toMatchObject({ code: "DATA_PATCH_FAILED" });
  });

  it("rejects duplicate patches, checksum drift, and concurrent claims", async () => {
    const log = new InMemoryDataPatchLog();
    const first = defineDataPatch({ id: "accounts.backfill", checksum: "v1", run: () => undefined });
    const changed = defineDataPatch({ id: "accounts.backfill", checksum: "v2", run: () => undefined });

    await expect(
      new DataPatchRunner({ log, resources: {}, patches: [first, first] }).pendingPatches()
    ).rejects.toMatchObject({ code: "DATA_PATCH_DUPLICATE" });

    const runner = new DataPatchRunner({ log, resources: {}, patches: [first], clock: fixedClock(now) });
    await runner.apply();
    await expect(
      new DataPatchRunner({ log, resources: {}, patches: [changed] }).pendingPatches()
    ).rejects.toMatchObject({ code: "DATA_PATCH_CHECKSUM_MISMATCH" });

    const pendingLog = new InMemoryDataPatchLog();
    await pendingLog.claimDataPatch({
      id: "accounts.pending",
      checksum: "v1",
      claimId: "other-runner",
      claimedAt: now
    });
    await expect(
      new DataPatchRunner({
        log: pendingLog,
        resources: {},
        patches: [defineDataPatch({ id: "accounts.pending", checksum: "v1", run: () => undefined })]
      }).pendingPatches()
    ).rejects.toMatchObject({ code: "DATA_PATCH_PENDING" });
    await expect(
      new DataPatchRunner({
        log: pendingLog,
        resources: {},
        patches: [defineDataPatch({ id: "accounts.pending", checksum: "v1", run: () => undefined })],
        ids: deterministicIds(["this-runner"])
      }).apply()
    ).rejects.toMatchObject({ code: "DATA_PATCH_PENDING" });
    await expect(
      pendingLog.claimDataPatch({ id: "accounts.pending", checksum: "v2", claimId: "drift", claimedAt: now })
    ).rejects.toMatchObject({ code: "DATA_PATCH_CHECKSUM_MISMATCH" });
  });
});
