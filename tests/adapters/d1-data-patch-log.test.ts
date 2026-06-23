import { D1DataPatchLog } from "../../src";
import { now } from "../helpers";

describe("D1DataPatchLog", () => {
  it("records and lists applied data patches in id order", async () => {
    const db = new FakeD1Database();
    const log = new D1DataPatchLog(db as unknown as D1Database);

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
    expect(db.executedSql.some((sql) => sql.includes("CREATE TABLE IF NOT EXISTS cf_frappe_data_patches"))).toBe(true);
  });

  it("returns pending and failed claim states without taking ownership", async () => {
    const db = new FakeD1Database();
    const log = new D1DataPatchLog(db as unknown as D1Database);

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
    const db = new FakeD1Database();
    const log = new D1DataPatchLog(db as unknown as D1Database);

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
    expect(db.executedSql.some((sql) => sql.includes("DELETE FROM cf_frappe_data_patches"))).toBe(true);
  });

  it("rejects retry clearing for non-failed D1 journal records", async () => {
    const db = new FakeD1Database();
    const log = new D1DataPatchLog(db as unknown as D1Database);

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

  it("does not clear a newer failed D1 retry attempt after reading an older one", async () => {
    const db = new FakeD1Database();
    const log = new D1DataPatchLog(db as unknown as D1Database);
    await log.claimDataPatch({ id: "accounts.failed", checksum: "v1", claimId: "claim-old", claimedAt: now });
    await log.failDataPatch({
      id: "accounts.failed",
      checksum: "v1",
      claimId: "claim-old",
      failedAt: now,
      error: "old failure"
    });
    db.beforeDelete = () => {
      db.beforeDelete = undefined;
      db.patches.set("accounts.failed", {
        checksum: "v1",
        status: "failed",
        claim_id: "claim-new",
        claimed_at: "2026-01-01T00:01:00.000Z",
        applied_at: null,
        failed_at: "2026-01-01T00:02:00.000Z",
        error: "new failure",
        result_json: null,
        result_present: 0
      });
    };

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

  it("rejects invalid journal statuses", async () => {
    const db = new FakeD1Database();
    const log = new D1DataPatchLog(db as unknown as D1Database);
    db.patches.set("bad.status", {
      checksum: "v1",
      status: "corrupt" as "pending",
      claim_id: "claim-1",
      claimed_at: now,
      applied_at: null,
      failed_at: null,
      error: null,
      result_json: null,
      result_present: 0
    });

    await expect(log.recordedDataPatches()).rejects.toMatchObject({ code: "DATA_PATCH_INVALID" });
    await expect(
      log.claimDataPatch({ id: "bad.status", checksum: "v1", claimId: "claim-2", claimedAt: now })
    ).rejects.toMatchObject({ code: "DATA_PATCH_INVALID" });
  });
});

class FakeD1Database {
  readonly patches = new Map<string, {
    checksum: string;
    status: "pending" | "applied" | "failed";
    claim_id: string | null;
    claimed_at: string | null;
    applied_at: string | null;
    failed_at: string | null;
    error: string | null;
    result_json: string | null;
    result_present: number;
  }>();
  readonly executedSql: string[] = [];
  beforeDelete: (() => void) | undefined;

  prepare(sql: string) {
    this.executedSql.push(sql);
    return new FakeD1PreparedStatement(this, sql);
  }
}

class FakeD1PreparedStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: FakeD1Database,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async all() {
    if (this.sql.includes("FROM cf_frappe_data_patches")) {
      return {
        results: [...this.db.patches.entries()]
          .filter(([, patch]) => !this.sql.includes("WHERE status = 'applied'") || patch.status === "applied")
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([id, patch]) => ({
            id,
            checksum: patch.checksum,
            status: patch.status,
            claim_id: patch.claim_id,
            claimed_at: patch.claimed_at,
            applied_at: patch.applied_at,
            failed_at: patch.failed_at,
            error: patch.error,
            result_json: patch.result_json,
            result_present: patch.result_present
          }))
      };
    }
    return { results: [] };
  }

  async first() {
    if (this.sql.includes("FROM cf_frappe_data_patches")) {
      const id = String(this.params[0]);
      const patch = this.db.patches.get(id);
      return patch === undefined
        ? null
        : {
            id,
            checksum: patch.checksum,
            status: patch.status,
            claim_id: patch.claim_id,
            claimed_at: patch.claimed_at,
            applied_at: patch.applied_at,
            failed_at: patch.failed_at,
            error: patch.error,
            result_json: patch.result_json,
            result_present: patch.result_present
          };
    }
    return null;
  }

  async run() {
    if (this.sql.includes("INSERT OR IGNORE INTO cf_frappe_data_patches")) {
      const [id, checksum, claim_id, claimed_at] = this.params;
      if (!this.db.patches.has(String(id))) {
        this.db.patches.set(String(id), {
          checksum: String(checksum),
          status: "pending",
          claim_id: String(claim_id),
          claimed_at: String(claimed_at),
          applied_at: null,
          failed_at: null,
          error: null,
          result_json: null,
          result_present: 0
        });
      }
    }
    if (this.sql.includes("SET status = 'applied'")) {
      const [applied_at, result_json, result_present, id, checksum, claim_id] = this.params;
      const patch = this.db.patches.get(String(id));
      if (patch?.status === "pending" && patch.checksum === checksum && patch.claim_id === claim_id) {
        this.db.patches.set(String(id), {
          ...patch,
          status: "applied",
          applied_at: String(applied_at),
          result_json: result_json === null ? null : String(result_json),
          result_present: Number(result_present),
          failed_at: null,
          error: null
        });
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    if (this.sql.includes("SET status = 'failed'")) {
      const [failed_at, error, id, checksum, claim_id] = this.params;
      const patch = this.db.patches.get(String(id));
      if (patch?.status === "pending" && patch.checksum === checksum && patch.claim_id === claim_id) {
        this.db.patches.set(String(id), {
          ...patch,
          status: "failed",
          failed_at: String(failed_at),
          error: String(error)
        });
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    if (this.sql.includes("DELETE FROM cf_frappe_data_patches")) {
      this.db.beforeDelete?.();
      const [id, checksum, claim_id, failed_at, error] = this.params;
      const patch = this.db.patches.get(String(id));
      if (
        patch?.status === "failed" &&
        patch.checksum === checksum &&
        patch.claim_id === claim_id &&
        patch.failed_at === failed_at &&
        patch.error === error
      ) {
        this.db.patches.delete(String(id));
        return { success: true, meta: { changes: 1 } };
      }
      return { success: true, meta: { changes: 0 } };
    }
    return { success: true, meta: { changes: 1 } };
  }
}
