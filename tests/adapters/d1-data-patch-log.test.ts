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
    return { success: true, meta: { changes: 1 } };
  }
}
