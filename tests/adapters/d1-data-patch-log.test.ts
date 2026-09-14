import { D1DataPatchLog } from "../../src";
import {
  appliedDataPatchFromRow,
  claimResultFromRow,
  recordedDataPatchFromRow,
  serializedPatchResult,
  type DataPatchRow
} from "../../src/adapters/d1/data-patch-serde.js";
import type { DocumentData, JsonValue } from "../../src";
import { createTestD1, frameworkSchema, type TestD1 } from "../d1-engine.js";
import { now } from "../helpers";

describe("D1DataPatchLog", () => {
  it("records and lists applied data patches in id order", async () => {
    const d1 = engine();
    const log = new D1DataPatchLog(d1.database);

    await expect(log.claimDataPatch({
      id: "crm.backfill_customers",
      checksum: "v1",
      claimId: "claim-1",
      claimedAt: now
    })).resolves.toMatchObject({ kind: "claimed" });
    await log.completeDataPatch({
      id: "crm.backfill_customers",
      checksum: "v1",
      claimId: "claim-1",
      appliedAt: now,
      result: { touched: 2 }
    });
    await log.claimDataPatch({
      id: "accounts.seed_roles",
      checksum: "v1",
      claimId: "claim-2",
      claimedAt: now
    });
    await log.completeDataPatch({
      id: "accounts.seed_roles",
      checksum: "v1",
      claimId: "claim-2",
      appliedAt: now
    });
    await log.claimDataPatch({
      id: "notes.null_result",
      checksum: "v1",
      claimId: "claim-3",
      claimedAt: now
    });
    await log.completeDataPatch({
      id: "notes.null_result",
      checksum: "v1",
      claimId: "claim-3",
      appliedAt: now,
      result: null
    });

    await expect(log.appliedDataPatches()).resolves.toEqual([
      {
        id: "accounts.seed_roles",
        checksum: "v1",
        appliedAt: now
      },
      {
        id: "crm.backfill_customers",
        checksum: "v1",
        appliedAt: now,
        result: { touched: 2 }
      },
      {
        id: "notes.null_result",
        checksum: "v1",
        appliedAt: now,
        result: null
      }
    ]);
    await expect(log.recordedDataPatches()).resolves.toEqual([
      {
        id: "accounts.seed_roles",
        checksum: "v1",
        appliedAt: now,
        status: "applied"
      },
      {
        id: "crm.backfill_customers",
        checksum: "v1",
        appliedAt: now,
        result: { touched: 2 },
        status: "applied"
      },
      {
        id: "notes.null_result",
        checksum: "v1",
        appliedAt: now,
        result: null,
        status: "applied"
      }
    ]);
    // The journal table ships in the framework migrations, and the adapter
    // still re-asserts its bootstrap CREATE on every call.
    expect(d1.executed.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS cf_frappe_data_patches"))).toBe(true);
  });

  it("snapshots D1 data patch apply and rollback results by value", async () => {
    const d1 = engine();
    const log = new D1DataPatchLog(d1.database);
    const applyResult = { touched: { count: 1 }, ids: ["one"] };

    await log.claimDataPatch({ id: "accounts.seed", checksum: "v1", claimId: "claim-apply", claimedAt: now });
    await log.completeDataPatch({
      id: "accounts.seed",
      checksum: "v1",
      claimId: "claim-apply",
      appliedAt: now,
      result: applyResult
    });
    applyResult.touched.count = 2;
    applyResult.ids.push("mutated");

    const [applied] = await log.appliedDataPatches();
    expect(applied).toMatchObject({
      id: "accounts.seed",
      result: { touched: { count: 1 }, ids: ["one"] }
    });
    ((applied!.result as DocumentData).touched as DocumentData).count = 3;
    ((applied!.result as DocumentData).ids as JsonValue[]).push("returned");

    await expect(log.recordedDataPatches()).resolves.toMatchObject([
      {
        id: "accounts.seed",
        result: { touched: { count: 1 }, ids: ["one"] }
      }
    ]);

    await log.claimDataPatchRollback({
      id: "accounts.seed",
      checksum: "v1",
      claimId: "claim-rollback",
      claimedAt: now
    });
    const rollbackResult = { undone: { count: 1 }, ids: ["one"] };
    await log.completeDataPatchRollback({
      id: "accounts.seed",
      checksum: "v1",
      claimId: "claim-rollback",
      rolledBackAt: now,
      result: rollbackResult
    });
    rollbackResult.undone.count = 2;
    rollbackResult.ids.push("mutated");

    const [rolledBack] = await log.recordedDataPatches();
    expect(rolledBack).toMatchObject({
      id: "accounts.seed",
      result: { touched: { count: 1 }, ids: ["one"] },
      rollbackResult: { undone: { count: 1 }, ids: ["one"] }
    });
    const returnedRollback = rolledBack as { result: JsonValue; rollbackResult: JsonValue };
    ((returnedRollback.result as DocumentData).touched as DocumentData).count = 4;
    ((returnedRollback.rollbackResult as DocumentData).undone as DocumentData).count = 4;
    ((returnedRollback.rollbackResult as DocumentData).ids as JsonValue[]).push("returned");

    await expect(log.recordedDataPatches()).resolves.toMatchObject([
      {
        id: "accounts.seed",
        result: { touched: { count: 1 }, ids: ["one"] },
        rollbackResult: { undone: { count: 1 }, ids: ["one"] }
      }
    ]);
  });

  it("maps D1 data patch rows and result JSON through extracted serde", () => {
    const serialized = serializedPatchResult("accounts.seed", "result_json", { touched: [1] });
    expect(serialized).toBe('{"touched":[1]}');

    const applied = appliedDataPatchFromRow(dataPatchRow({
      status: "applied",
      applied_at: now,
      result_json: serialized,
      result_present: 1
    }));
    expect(applied).toEqual({
      id: "accounts.seed",
      checksum: "v1",
      appliedAt: now,
      result: { touched: [1] }
    });

    const rolledBack = recordedDataPatchFromRow(dataPatchRow({
      status: "rolled_back",
      applied_at: now,
      result_json: "null",
      result_present: 1,
      rolled_back_at: "2026-01-01T00:01:00.000Z",
      rollback_result_json: '{"undone":true}',
      rollback_result_present: 1
    }));
    expect(rolledBack).toEqual({
      id: "accounts.seed",
      checksum: "v1",
      appliedAt: now,
      result: null,
      rolledBackAt: "2026-01-01T00:01:00.000Z",
      rollbackResult: { undone: true },
      status: "rolled_back"
    });

    expect(() => claimResultFromRow(dataPatchRow({ status: "rollback_pending" }), "claim-apply")).toThrow(
      "cannot be applied because journal status is 'rollback_pending'"
    );
    expect(() => serializedPatchResult("bad.apply", "result_json", Number.POSITIVE_INFINITY as never)).toThrow(
      "invalid result_json"
    );
  });

  it("returns pending and failed claim states without taking ownership", async () => {
    const d1 = engine();
    const log = new D1DataPatchLog(d1.database);

    await log.claimDataPatch({ id: "accounts.pending", checksum: "v1", claimId: "one", claimedAt: now });
    await expect(
      log.claimDataPatch({ id: "accounts.pending", checksum: "v1", claimId: "two", claimedAt: now })
    ).resolves.toMatchObject({ kind: "pending" });
    await log.failDataPatch({
      id: "accounts.pending",
      checksum: "v1",
      claimId: "one",
      failedAt: now,
      error: "boom"
    });
    await expect(
      log.claimDataPatch({ id: "accounts.pending", checksum: "v1", claimId: "three", claimedAt: now })
    ).resolves.toMatchObject({ kind: "failed", patch: { error: "boom" } });
    await expect(log.recordedDataPatches()).resolves.toEqual([
      {
        id: "accounts.pending",
        checksum: "v1",
        failedAt: now,
        error: "boom",
        status: "failed"
      }
    ]);
    await expect(
      log.claimDataPatch({ id: "accounts.pending", checksum: "v2", claimId: "drift", claimedAt: now })
    ).rejects.toMatchObject({ code: "DATA_PATCH_CHECKSUM_MISMATCH" });
  });

  it("clears only failed data patch records with matching checksums for retry", async () => {
    const d1 = engine();
    const log = new D1DataPatchLog(d1.database);

    await log.claimDataPatch({ id: "accounts.failed", checksum: "v1", claimId: "claim-failed", claimedAt: now });
    await log.failDataPatch({
      id: "accounts.failed",
      checksum: "v1",
      claimId: "claim-failed",
      failedAt: now,
      error: "boom"
    });

    await expect(log.retryFailedDataPatch({ id: "accounts.failed", checksum: "v2" })).rejects.toMatchObject({
      code: "DATA_PATCH_CHECKSUM_MISMATCH",
      status: 409
    });
    await log.retryFailedDataPatch({ id: "accounts.failed", checksum: "v1" });
    await expect(log.recordedDataPatches()).resolves.toEqual([]);
    await expect(
      log.claimDataPatch({ id: "accounts.failed", checksum: "v1", claimId: "claim-retry", claimedAt: now })
    ).resolves.toMatchObject({ kind: "claimed" });
    expect(d1.executed.some((sql) => sql.includes("DELETE FROM cf_frappe_data_patches"))).toBe(true);
  });

  it("claims, completes, and lists data patch rollbacks", async () => {
    const d1 = engine();
    const log = new D1DataPatchLog(d1.database);

    await log.claimDataPatch({ id: "accounts.seed", checksum: "v1", claimId: "claim-apply", claimedAt: now });
    await log.completeDataPatch({
      id: "accounts.seed",
      checksum: "v1",
      claimId: "claim-apply",
      appliedAt: now,
      result: { touched: 1 }
    });

    await expect(log.claimDataPatchRollback({
      id: "accounts.seed",
      checksum: "v1",
      claimId: "claim-rollback",
      claimedAt: now
    })).resolves.toEqual({
      kind: "claimed",
      claim: { id: "accounts.seed", checksum: "v1", claimId: "claim-rollback", claimedAt: now }
    });
    await expect(log.recordedDataPatches()).resolves.toEqual([
      {
        id: "accounts.seed",
        checksum: "v1",
        appliedAt: now,
        result: { touched: 1 },
        rollbackClaimedAt: now,
        status: "rollback_pending"
      }
    ]);
    await log.completeDataPatchRollback({
      id: "accounts.seed",
      checksum: "v1",
      claimId: "claim-rollback",
      rolledBackAt: now,
      result: { undone: 1 }
    });

    await expect(log.appliedDataPatches()).resolves.toEqual([]);
    await expect(log.recordedDataPatches()).resolves.toEqual([
      {
        id: "accounts.seed",
        checksum: "v1",
        appliedAt: now,
        result: { touched: 1 },
        rolledBackAt: now,
        rollbackResult: { undone: 1 },
        status: "rolled_back"
      }
    ]);
    await expect(log.claimDataPatchRollback({
      id: "accounts.seed",
      checksum: "v1",
      claimId: "claim-again",
      claimedAt: now
    })).resolves.toMatchObject({
      kind: "rolled_back",
      patch: { id: "accounts.seed", rolledBackAt: now }
    });
    await expect(log.claimDataPatch({
      id: "accounts.seed",
      checksum: "v1",
      claimId: "claim-apply-again",
      claimedAt: now
    })).rejects.toMatchObject({
      code: "DATA_PATCH_APPLY_UNAVAILABLE",
      status: 409
    });
  });

  it("records failed D1 rollback attempts", async () => {
    const d1 = engine();
    const log = new D1DataPatchLog(d1.database);

    await log.claimDataPatch({ id: "accounts.seed", checksum: "v1", claimId: "claim-apply", claimedAt: now });
    await log.completeDataPatch({ id: "accounts.seed", checksum: "v1", claimId: "claim-apply", appliedAt: now });
    await log.claimDataPatchRollback({
      id: "accounts.seed",
      checksum: "v1",
      claimId: "claim-rollback",
      claimedAt: now
    });
    await log.failDataPatchRollback({
      id: "accounts.seed",
      checksum: "v1",
      claimId: "claim-rollback",
      failedAt: now,
      error: "rollback boom"
    });

    await expect(log.recordedDataPatches()).resolves.toEqual([
      {
        id: "accounts.seed",
        checksum: "v1",
        appliedAt: now,
        rollbackFailedAt: now,
        rollbackError: "rollback boom",
        status: "rollback_failed"
      }
    ]);
    await expect(log.claimDataPatchRollback({
      id: "accounts.seed",
      checksum: "v1",
      claimId: "claim-again",
      claimedAt: now
    })).resolves.toMatchObject({
      kind: "rollback_failed",
      patch: { rollbackError: "rollback boom" }
    });
  });

  it("claims only failed D1 rollback records with matching checksums for retry", async () => {
    const d1 = engine();
    const log = new D1DataPatchLog(d1.database);

    await log.claimDataPatch({ id: "accounts.seed", checksum: "v1", claimId: "claim-apply", claimedAt: now });
    await log.completeDataPatch({
      id: "accounts.seed",
      checksum: "v1",
      claimId: "claim-apply",
      appliedAt: now,
      result: { touched: 1 }
    });
    await log.claimDataPatchRollback({
      id: "accounts.seed",
      checksum: "v1",
      claimId: "claim-rollback",
      claimedAt: now
    });
    await log.failDataPatchRollback({
      id: "accounts.seed",
      checksum: "v1",
      claimId: "claim-rollback",
      failedAt: now,
      error: "rollback boom"
    });

    await expect(log.retryFailedDataPatchRollback({
      id: "accounts.seed",
      checksum: "v2",
      claimId: "claim-retry",
      claimedAt: now
    })).rejects.toMatchObject({
      code: "DATA_PATCH_CHECKSUM_MISMATCH",
      status: 409
    });
    await expect(log.retryFailedDataPatchRollback({
      id: "accounts.seed",
      checksum: "v1",
      claimId: "claim-retry",
      claimedAt: now
    })).resolves.toEqual({ id: "accounts.seed", checksum: "v1", claimId: "claim-retry", claimedAt: now });
    await expect(log.recordedDataPatches()).resolves.toEqual([
      {
        id: "accounts.seed",
        checksum: "v1",
        appliedAt: now,
        result: { touched: 1 },
        rollbackClaimedAt: now,
        status: "rollback_pending"
      }
    ]);
    await log.completeDataPatchRollback({
      id: "accounts.seed",
      checksum: "v1",
      claimId: "claim-retry",
      rolledBackAt: now
    });
    await expect(log.claimDataPatchRollback({
      id: "accounts.seed",
      checksum: "v1",
      claimId: "claim-again",
      claimedAt: now
    })).resolves.toMatchObject({ kind: "rolled_back" });
    expect(d1.executed.some((sql) => sql.includes("rollback_result_present = 0"))).toBe(true);
  });

  it("rejects retry clearing for non-failed D1 journal records", async () => {
    const d1 = engine();
    const log = new D1DataPatchLog(d1.database);

    await expect(log.retryFailedDataPatch({ id: "accounts.missing", checksum: "v1" })).rejects.toMatchObject({
      code: "DATA_PATCH_RETRY_UNAVAILABLE",
      status: 409
    });

    await log.claimDataPatch({ id: "accounts.pending", checksum: "v1", claimId: "claim-pending", claimedAt: now });
    await expect(log.retryFailedDataPatch({ id: "accounts.pending", checksum: "v1" })).rejects.toMatchObject({
      code: "DATA_PATCH_PENDING",
      status: 409
    });

    await log.claimDataPatch({ id: "accounts.applied", checksum: "v1", claimId: "claim-applied", claimedAt: now });
    await log.completeDataPatch({
      id: "accounts.applied",
      checksum: "v1",
      claimId: "claim-applied",
      appliedAt: now
    });
    await expect(log.retryFailedDataPatch({ id: "accounts.applied", checksum: "v1" })).rejects.toMatchObject({
      code: "DATA_PATCH_RETRY_UNAVAILABLE",
      status: 409
    });
  });

  it("rejects D1 update results that change no rows", async () => {
    const d1 = engine();
    const log = new D1DataPatchLog(d1.database);
    await log.claimDataPatch({ id: "accounts.unproven", checksum: "v1", claimId: "claim-1", claimedAt: now });

    // Real D1 always reports `meta.changes`, so an unproven result reaches the
    // adapter the same way a proven-zero result does: the journal's own WHERE
    // guard declining to apply. Completing under a claim that does not own the
    // row exercises that rejection without inventing a meta shape D1 never
    // produces.
    await expect(log.completeDataPatch({
      id: "accounts.unproven",
      checksum: "v1",
      claimId: "claim-not-the-owner",
      appliedAt: now
    })).rejects.toMatchObject({
      code: "DATA_PATCH_PENDING",
      status: 409
    });
    await expect(log.recordedDataPatches()).resolves.toEqual([
      {
        id: "accounts.unproven",
        checksum: "v1",
        claimedAt: now,
        status: "pending"
      }
    ]);
  });

  it("does not claim a newer failed D1 rollback attempt after reading an older one", async () => {
    let d1: TestD1 | undefined;
    const engineUnder = createTestD1({
      schema: frameworkSchema(),
      beforeSql: (sql) => {
        if (d1 !== undefined && sql.includes("rollback_result_present = 0")) {
          // A newer failed rollback attempt lands between the adapter's read
          // and its guarded re-claim. The UPDATE's WHERE — the old claim's
          // tokens — must decline to apply, not a fake's memory of the row.
          d1.query(
            `UPDATE cf_frappe_data_patches
             SET rollback_claim_id = 'claim-new', rollback_claimed_at = ?,
                 rollback_failed_at = ?, rollback_error = 'new failure'
             WHERE id = 'accounts.seed'`,
            "2026-01-01T00:01:00.000Z",
            "2026-01-01T00:02:00.000Z"
          );
        }
      }
    });
    d1 = engineUnder;
    const log = new D1DataPatchLog(engineUnder.database);
    await log.claimDataPatch({ id: "accounts.seed", checksum: "v1", claimId: "claim-apply", claimedAt: now });
    await log.completeDataPatch({ id: "accounts.seed", checksum: "v1", claimId: "claim-apply", appliedAt: now });
    await log.claimDataPatchRollback({
      id: "accounts.seed",
      checksum: "v1",
      claimId: "claim-old",
      claimedAt: now
    });
    await log.failDataPatchRollback({
      id: "accounts.seed",
      checksum: "v1",
      claimId: "claim-old",
      failedAt: now,
      error: "old failure"
    });

    await expect(log.retryFailedDataPatchRollback({
      id: "accounts.seed",
      checksum: "v1",
      claimId: "claim-retry",
      claimedAt: now
    })).rejects.toMatchObject({
      code: "DATA_PATCH_ROLLBACK_RETRY_UNAVAILABLE",
      status: 409
    });
    await expect(log.recordedDataPatches()).resolves.toEqual([
      {
        id: "accounts.seed",
        checksum: "v1",
        appliedAt: now,
        rollbackFailedAt: "2026-01-01T00:02:00.000Z",
        rollbackError: "new failure",
        status: "rollback_failed"
      }
    ]);
  });

  it("does not clear a newer failed D1 retry attempt after reading an older one", async () => {
    let d1: TestD1 | undefined;
    const engineUnder = createTestD1({
      schema: frameworkSchema(),
      beforeSql: (sql) => {
        if (d1 !== undefined && sql.includes("DELETE FROM cf_frappe_data_patches")) {
          // A newer failed attempt lands between the adapter's read and its
          // guarded delete. The delete must clear nothing.
          d1.query(
            `UPDATE cf_frappe_data_patches
             SET claim_id = 'claim-new', claimed_at = ?, failed_at = ?, error = 'new failure'
             WHERE id = 'accounts.failed'`,
            "2026-01-01T00:01:00.000Z",
            "2026-01-01T00:02:00.000Z"
          );
        }
      }
    });
    d1 = engineUnder;
    const log = new D1DataPatchLog(engineUnder.database);
    await log.claimDataPatch({ id: "accounts.failed", checksum: "v1", claimId: "claim-old", claimedAt: now });
    await log.failDataPatch({
      id: "accounts.failed",
      checksum: "v1",
      claimId: "claim-old",
      failedAt: now,
      error: "old failure"
    });

    await expect(log.retryFailedDataPatch({ id: "accounts.failed", checksum: "v1" })).rejects.toMatchObject({
      code: "DATA_PATCH_RETRY_UNAVAILABLE",
      status: 409
    });
    await expect(log.recordedDataPatches()).resolves.toEqual([
      {
        id: "accounts.failed",
        checksum: "v1",
        failedAt: "2026-01-01T00:02:00.000Z",
        error: "new failure",
        status: "failed"
      }
    ]);
  });

  it("rejects journal statuses outside the state machine at the schema level", async () => {
    // The journal table shipped by migrations 0004/0005 carries its own CHECK
    // constraint, so a corrupt status is not a state a real D1 can hold — the
    // fake happily stored one and then tested the serde's rejection of it.
    // What the schema guarantees is stronger and worth pinning: the insert
    // itself is refused.
    const d1 = engine();
    expect(() =>
      seedRow(d1, dataPatchRow({ status: "corrupt" as DataPatchRow["status"], id: "bad.status" }))
    ).toThrow(/CHECK constraint failed/);
  });

  it("rejects invalid stored D1 journal JSON results", async () => {
    const d1 = engine();
    const log = new D1DataPatchLog(d1.database);
    seedRow(d1, dataPatchRow({ id: "bad.result", status: "applied", claimed_at: now, applied_at: now, result_json: "{", result_present: 1 }));
    seedRow(d1, dataPatchRow({
      id: "bad.rollback_result",
      status: "rolled_back",
      claimed_at: now,
      applied_at: now,
      rollback_claim_id: "claim-rollback",
      rollback_claimed_at: now,
      rolled_back_at: now,
      rollback_result_json: "{",
      rollback_result_present: 1
    }));

    await expect(log.appliedDataPatches()).rejects.toMatchObject({
      code: "DATA_PATCH_INVALID",
      status: 409
    });
    d1.query("DELETE FROM cf_frappe_data_patches WHERE id = 'bad.result'");
    await expect(log.recordedDataPatches()).rejects.toMatchObject({
      code: "DATA_PATCH_INVALID",
      status: 409
    });
  });

  it("rejects stored D1 journal apply results with non-finite JSON numbers", async () => {
    const d1 = engine();
    const log = new D1DataPatchLog(d1.database);
    seedRow(d1, dataPatchRow({ id: "bad.result", status: "applied", claimed_at: now, applied_at: now, result_json: "1e999", result_present: 1 }));

    await expect(log.appliedDataPatches()).rejects.toMatchObject({
      code: "DATA_PATCH_INVALID",
      status: 409
    });
  });

  it("rejects stored D1 journal rollback results with non-finite JSON numbers", async () => {
    const d1 = engine();
    const log = new D1DataPatchLog(d1.database);
    seedRow(d1, dataPatchRow({
      id: "bad.rollback_result",
      status: "rolled_back",
      claimed_at: now,
      applied_at: now,
      rollback_claim_id: "claim-rollback",
      rollback_claimed_at: now,
      rolled_back_at: now,
      rollback_result_json: "1e999",
      rollback_result_present: 1
    }));

    await expect(log.recordedDataPatches()).rejects.toMatchObject({
      code: "DATA_PATCH_INVALID",
      status: 409
    });
  });

  it("rejects non-JSON D1 journal apply results before writing rows", async () => {
    const d1 = engine();
    const log = new D1DataPatchLog(d1.database);
    await log.claimDataPatch({ id: "bad.apply", checksum: "v1", claimId: "claim-1", claimedAt: now });

    await expect(log.completeDataPatch({
      id: "bad.apply",
      checksum: "v1",
      claimId: "claim-1",
      appliedAt: now,
      result: Number.POSITIVE_INFINITY as never
    })).rejects.toMatchObject({
      code: "DATA_PATCH_INVALID",
      status: 409
    });
    await expect(log.recordedDataPatches()).resolves.toEqual([
      {
        id: "bad.apply",
        checksum: "v1",
        claimedAt: now,
        status: "pending"
      }
    ]);
  });

  it("rejects non-JSON D1 journal rollback results before writing rows", async () => {
    const d1 = engine();
    const log = new D1DataPatchLog(d1.database);
    await log.claimDataPatch({ id: "bad.rollback", checksum: "v1", claimId: "claim-apply", claimedAt: now });
    await log.completeDataPatch({
      id: "bad.rollback",
      checksum: "v1",
      claimId: "claim-apply",
      appliedAt: now,
      result: { touched: 1 }
    });
    await log.claimDataPatchRollback({
      id: "bad.rollback",
      checksum: "v1",
      claimId: "claim-rollback",
      claimedAt: now
    });

    await expect(log.completeDataPatchRollback({
      id: "bad.rollback",
      checksum: "v1",
      claimId: "claim-rollback",
      rolledBackAt: now,
      result: Number.POSITIVE_INFINITY as never
    })).rejects.toMatchObject({
      code: "DATA_PATCH_INVALID",
      status: 409
    });
    await expect(log.recordedDataPatches()).resolves.toEqual([
      {
        id: "bad.rollback",
        checksum: "v1",
        appliedAt: now,
        result: { touched: 1 },
        rollbackClaimedAt: now,
        status: "rollback_pending"
      }
    ]);
  });
});

function engine(options: { readonly failSqlIncludes?: string } = {}): TestD1 {
  return createTestD1({ schema: frameworkSchema(), ...options });
}

function dataPatchRow(overrides: Partial<DataPatchRow> = {}): DataPatchRow {
  return {
    id: "accounts.seed",
    checksum: "v1",
    status: "pending",
    claim_id: "claim-1",
    claimed_at: now,
    applied_at: null,
    failed_at: null,
    error: null,
    result_json: null,
    result_present: 0,
    rollback_claim_id: null,
    rollback_claimed_at: null,
    rolled_back_at: null,
    rollback_failed_at: null,
    rollback_error: null,
    rollback_result_json: null,
    rollback_result_present: 0,
    ...overrides
  };
}

/**
 * Inserts a journal row with the exact column values given, bypassing the
 * adapter's own writes.
 *
 * These are rows real D1 could hold but the state machine never produces —
 * corrupt JSON where the serde reads. The table itself is the one the
 * framework migrations ship (0004/0005, CHECK constraint and all), loaded by
 * `frameworkSchema()`, so the corrupt bytes land where the adapter's reads
 * happen and SQLite decides what a SELECT returns.
 */
function seedRow(d1: TestD1, row: DataPatchRow): void {
  d1.query(
    `INSERT INTO cf_frappe_data_patches
       (id, checksum, status, claim_id, claimed_at, applied_at, failed_at, error,
        result_json, result_present, rollback_claim_id, rollback_claimed_at,
        rolled_back_at, rollback_failed_at, rollback_error, rollback_result_json, rollback_result_present)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    row.id,
    row.checksum,
    row.status,
    row.claim_id,
    row.claimed_at,
    row.applied_at,
    row.failed_at,
    row.error,
    row.result_json,
    row.result_present,
    row.rollback_claim_id,
    row.rollback_claimed_at,
    row.rolled_back_at,
    row.rollback_failed_at,
    row.rollback_error,
    row.rollback_result_json,
    row.rollback_result_present
  );
}
