import { FrameworkError } from "../../core/errors.js";
import type { JsonValue } from "../../core/types.js";
import type {
  AppliedDataPatch,
  ClaimDataPatch,
  CompleteDataPatch,
  DataPatchClaimResult,
  DataPatchLog,
  FailDataPatch,
  RecordedDataPatch
} from "../../ports/data-patch-log.js";

interface DataPatchRow {
  readonly id: string;
  readonly checksum: string;
  readonly status: string;
  readonly claim_id: string | null;
  readonly claimed_at: string | null;
  readonly applied_at: string | null;
  readonly failed_at: string | null;
  readonly error: string | null;
  readonly result_json: string | null;
  readonly result_present: number;
}

export class D1DataPatchLog implements DataPatchLog {
  constructor(private readonly db: D1Database) {}

  async recordedDataPatches(): Promise<readonly RecordedDataPatch[]> {
    await this.ensureDataPatchTable();
    const result = await this.db
      .prepare(
        `SELECT id, checksum, status, claim_id, claimed_at, applied_at, failed_at, error, result_json, result_present
         FROM cf_frappe_data_patches
         ORDER BY id ASC`
      )
      .all<DataPatchRow>();
    return (result.results ?? []).map(recordedDataPatchFromRow);
  }

  async appliedDataPatches(): Promise<readonly AppliedDataPatch[]> {
    await this.ensureDataPatchTable();
    const result = await this.db
      .prepare(
        `SELECT id, checksum, status, claim_id, claimed_at, applied_at, failed_at, error, result_json, result_present
         FROM cf_frappe_data_patches
         WHERE status = 'applied'
         ORDER BY id ASC`
      )
      .all<DataPatchRow>();
    return (result.results ?? []).map(appliedDataPatchFromRow);
  }

  async claimDataPatch(patch: ClaimDataPatch): Promise<DataPatchClaimResult> {
    await this.ensureDataPatchTable();
    await this.db
      .prepare(
        `INSERT OR IGNORE INTO cf_frappe_data_patches
         (id, checksum, status, claim_id, claimed_at, result_present)
         VALUES (?, ?, 'pending', ?, ?, 0)`
      )
      .bind(patch.id, patch.checksum, patch.claimId, patch.claimedAt)
      .run();
    const row = await this.row(patch.id);
    if (row === undefined) {
      throw new FrameworkError("DATA_PATCH_PENDING", `Data patch '${patch.id}' claim was not recorded`, {
        status: 409
      });
    }
    if (row.checksum !== patch.checksum) {
      throw new FrameworkError(
        "DATA_PATCH_CHECKSUM_MISMATCH",
        `Recorded data patch '${patch.id}' has checksum '${row.checksum}' but planned '${patch.checksum}'`,
        { status: 409 }
      );
    }
    return claimResultFromRow(row, patch.claimId);
  }

  async completeDataPatch(patch: CompleteDataPatch): Promise<void> {
    await this.ensureDataPatchTable();
    const result = await this.db
      .prepare(
        `UPDATE cf_frappe_data_patches
         SET status = 'applied',
             applied_at = ?,
             result_json = ?,
             result_present = ?,
             failed_at = NULL,
             error = NULL
         WHERE id = ?
           AND checksum = ?
           AND claim_id = ?
           AND status = 'pending'`
      )
      .bind(
        patch.appliedAt,
        patch.result === undefined ? null : JSON.stringify(patch.result),
        patch.result === undefined ? 0 : 1,
        patch.id,
        patch.checksum,
        patch.claimId
      )
      .run();
    assertChanged(result, patch.id);
  }

  async failDataPatch(patch: FailDataPatch): Promise<void> {
    await this.ensureDataPatchTable();
    const result = await this.db
      .prepare(
        `UPDATE cf_frappe_data_patches
         SET status = 'failed',
             failed_at = ?,
             error = ?
         WHERE id = ?
           AND checksum = ?
           AND claim_id = ?
           AND status = 'pending'`
      )
      .bind(patch.failedAt, patch.error, patch.id, patch.checksum, patch.claimId)
      .run();
    assertChanged(result, patch.id);
  }

  private async ensureDataPatchTable(): Promise<void> {
    await this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS cf_frappe_data_patches (
           id TEXT PRIMARY KEY,
           checksum TEXT NOT NULL,
           status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'failed')),
           claim_id TEXT,
           claimed_at TEXT,
           applied_at TEXT,
           failed_at TEXT,
           error TEXT,
           result_json TEXT,
           result_present INTEGER NOT NULL DEFAULT 0
         )`
      )
      .run();
  }

  private async row(id: string): Promise<DataPatchRow | undefined> {
    const row = await this.db
      .prepare(
        `SELECT id, checksum, status, claim_id, claimed_at, applied_at, failed_at, error, result_json, result_present
         FROM cf_frappe_data_patches
         WHERE id = ?`
      )
      .bind(id)
      .first<DataPatchRow>();
    return row ?? undefined;
  }
}

function recordedDataPatchFromRow(row: DataPatchRow): RecordedDataPatch {
  if (row.status === "applied") {
    return { ...appliedDataPatchFromRow(row), status: "applied" };
  }
  if (row.status === "failed") {
    return {
      id: row.id,
      checksum: row.checksum,
      failedAt: row.failed_at ?? "",
      error: row.error ?? "",
      status: "failed"
    };
  }
  if (row.status === "pending") {
    return {
      id: row.id,
      checksum: row.checksum,
      claimedAt: row.claimed_at ?? "",
      status: "pending"
    };
  }
  throw invalidStatus(row);
}

function invalidStatus(row: DataPatchRow): FrameworkError {
  return new FrameworkError(
    "DATA_PATCH_INVALID",
    `Data patch '${row.id}' has invalid journal status '${row.status}'`,
    { status: 409 }
  );
}

function appliedDataPatchFromRow(row: DataPatchRow): AppliedDataPatch {
  const result = parseResult(row);
  return {
    id: row.id,
    checksum: row.checksum,
    appliedAt: row.applied_at ?? "",
    ...(result === undefined ? {} : { result })
  };
}

function claimResultFromRow(row: DataPatchRow, claimId: string): DataPatchClaimResult {
  if (row.status === "applied") {
    return { kind: "applied", patch: appliedDataPatchFromRow(row) };
  }
  if (row.status === "failed") {
    return {
      kind: "failed",
      patch: {
        id: row.id,
        checksum: row.checksum,
        failedAt: row.failed_at ?? "",
        error: row.error ?? ""
      }
    };
  }
  if (row.status === "pending" && row.claim_id === claimId) {
    return {
      kind: "claimed",
      claim: {
        id: row.id,
        checksum: row.checksum,
        claimId,
        claimedAt: row.claimed_at ?? ""
      }
    };
  }
  if (row.status === "pending") {
    return {
      kind: "pending",
      patch: {
        id: row.id,
        checksum: row.checksum,
        claimedAt: row.claimed_at ?? ""
      }
    };
  }
  throw invalidStatus(row);
}

function parseResult(row: DataPatchRow): JsonValue | undefined {
  if (Number(row.result_present) !== 1) {
    return undefined;
  }
  return JSON.parse(row.result_json ?? "null") as JsonValue;
}

function assertChanged(result: unknown, id: string): void {
  const changes = typeof result === "object" &&
    result !== null &&
    "meta" in result &&
    typeof (result as { readonly meta?: { readonly changes?: unknown } }).meta?.changes === "number"
    ? (result as { readonly meta: { readonly changes: number } }).meta.changes
    : 1;
  if (changes === 0) {
    throw new FrameworkError("DATA_PATCH_PENDING", `Data patch '${id}' is not claimed by this runner`, {
      status: 409
    });
  }
}
