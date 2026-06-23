import { FrameworkError } from "../../core/errors.js";
import type { JsonValue } from "../../core/types.js";
import type {
  AppliedDataPatch,
  ClaimDataPatch,
  ClaimRollbackDataPatch,
  CompleteRollbackDataPatch,
  CompleteDataPatch,
  DataPatchClaimResult,
  DataPatchLog,
  DataPatchRollbackClaimResult,
  FailDataPatch,
  FailRollbackDataPatch,
  RecordedDataPatch,
  RollbackFailedDataPatch,
  RollbackPendingDataPatch,
  RolledBackDataPatch,
  RetryFailedDataPatch,
  RetryFailedDataPatchRollback
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
  readonly rollback_claim_id: string | null;
  readonly rollback_claimed_at: string | null;
  readonly rolled_back_at: string | null;
  readonly rollback_failed_at: string | null;
  readonly rollback_error: string | null;
  readonly rollback_result_json: string | null;
  readonly rollback_result_present: number;
}

export class D1DataPatchLog implements DataPatchLog {
  constructor(private readonly db: D1Database) {}

  async recordedDataPatches(): Promise<readonly RecordedDataPatch[]> {
    await this.ensureDataPatchTable();
    const result = await this.db
      .prepare(
        `SELECT id, checksum, status, claim_id, claimed_at, applied_at, failed_at, error, result_json, result_present
                , rollback_claim_id, rollback_claimed_at, rolled_back_at, rollback_failed_at, rollback_error,
                  rollback_result_json, rollback_result_present
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
                , rollback_claim_id, rollback_claimed_at, rolled_back_at, rollback_failed_at, rollback_error,
                  rollback_result_json, rollback_result_present
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

  async retryFailedDataPatch(patch: RetryFailedDataPatch): Promise<void> {
    await this.ensureDataPatchTable();
    const row = await this.row(patch.id);
    assertRetryableFailedRow(row, patch.id, patch.checksum);
    const result = await this.db
      .prepare(
        `DELETE FROM cf_frappe_data_patches
         WHERE id = ?
           AND checksum = ?
           AND status = 'failed'
           AND claim_id IS ?
           AND failed_at IS ?
           AND error IS ?`
      )
      .bind(patch.id, patch.checksum, row.claim_id, row.failed_at, row.error)
      .run();
    assertRetryCleared(result, patch.id);
  }

  async retryFailedDataPatchRollback(patch: RetryFailedDataPatchRollback) {
    await this.ensureDataPatchTable();
    const row = await this.row(patch.id);
    assertRetryableFailedRollbackRow(row, patch.id, patch.checksum);
    const result = await this.db
      .prepare(
        `UPDATE cf_frappe_data_patches
         SET status = 'rollback_pending',
             rollback_claim_id = ?,
             rollback_claimed_at = ?,
             rolled_back_at = NULL,
             rollback_failed_at = NULL,
             rollback_error = NULL,
             rollback_result_json = NULL,
             rollback_result_present = 0
         WHERE id = ?
           AND checksum = ?
           AND status = 'rollback_failed'
           AND rollback_claim_id IS ?
           AND rollback_claimed_at IS ?
           AND rollback_failed_at IS ?
           AND rollback_error IS ?`
      )
      .bind(
        patch.claimId,
        patch.claimedAt,
        patch.id,
        patch.checksum,
        row.rollback_claim_id,
        row.rollback_claimed_at,
        row.rollback_failed_at,
        row.rollback_error
      )
      .run();
    assertRollbackRetryClaimed(result, patch.id);
    return { id: patch.id, checksum: patch.checksum, claimId: patch.claimId, claimedAt: patch.claimedAt };
  }

  async claimDataPatchRollback(patch: ClaimRollbackDataPatch): Promise<DataPatchRollbackClaimResult> {
    await this.ensureDataPatchTable();
    const row = await this.row(patch.id);
    assertRollbackClaimableRow(row, patch.id, patch.checksum);
    if (row.status !== "applied") {
      return rollbackClaimResultFromRow(row);
    }
    const result = await this.db
      .prepare(
        `UPDATE cf_frappe_data_patches
         SET status = 'rollback_pending',
             rollback_claim_id = ?,
             rollback_claimed_at = ?,
             rollback_failed_at = NULL,
             rollback_error = NULL
         WHERE id = ?
           AND checksum = ?
           AND status = 'applied'`
      )
      .bind(patch.claimId, patch.claimedAt, patch.id, patch.checksum)
      .run();
    if (changedRows(result) === 0) {
      const changed = await this.row(patch.id);
      assertRollbackClaimableRow(changed, patch.id, patch.checksum);
      return rollbackClaimResultFromRow(changed);
    }
    return {
      kind: "claimed",
      claim: { id: patch.id, checksum: patch.checksum, claimId: patch.claimId, claimedAt: patch.claimedAt }
    };
  }

  async completeDataPatchRollback(patch: CompleteRollbackDataPatch): Promise<void> {
    await this.ensureDataPatchTable();
    const result = await this.db
      .prepare(
        `UPDATE cf_frappe_data_patches
         SET status = 'rolled_back',
             rolled_back_at = ?,
             rollback_result_json = ?,
             rollback_result_present = ?,
             rollback_failed_at = NULL,
             rollback_error = NULL
         WHERE id = ?
           AND checksum = ?
           AND rollback_claim_id = ?
           AND status = 'rollback_pending'`
      )
      .bind(
        patch.rolledBackAt,
        patch.result === undefined ? null : JSON.stringify(patch.result),
        patch.result === undefined ? 0 : 1,
        patch.id,
        patch.checksum,
        patch.claimId
      )
      .run();
    assertRollbackChanged(result, patch.id);
  }

  async failDataPatchRollback(patch: FailRollbackDataPatch): Promise<void> {
    await this.ensureDataPatchTable();
    const result = await this.db
      .prepare(
        `UPDATE cf_frappe_data_patches
         SET status = 'rollback_failed',
             rollback_failed_at = ?,
             rollback_error = ?
         WHERE id = ?
           AND checksum = ?
           AND rollback_claim_id = ?
           AND status = 'rollback_pending'`
      )
      .bind(patch.failedAt, patch.error, patch.id, patch.checksum, patch.claimId)
      .run();
    assertRollbackChanged(result, patch.id);
  }

  private async ensureDataPatchTable(): Promise<void> {
    await this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS cf_frappe_data_patches (
           id TEXT PRIMARY KEY,
           checksum TEXT NOT NULL,
           status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'failed', 'rollback_pending', 'rolled_back', 'rollback_failed')),
           claim_id TEXT,
           claimed_at TEXT,
           applied_at TEXT,
           failed_at TEXT,
           error TEXT,
           result_json TEXT,
           result_present INTEGER NOT NULL DEFAULT 0,
           rollback_claim_id TEXT,
           rollback_claimed_at TEXT,
           rolled_back_at TEXT,
           rollback_failed_at TEXT,
           rollback_error TEXT,
           rollback_result_json TEXT,
           rollback_result_present INTEGER NOT NULL DEFAULT 0
         )`
      )
      .run();
  }

  private async row(id: string): Promise<DataPatchRow | undefined> {
    const row = await this.db
      .prepare(
        `SELECT id, checksum, status, claim_id, claimed_at, applied_at, failed_at, error, result_json, result_present
                , rollback_claim_id, rollback_claimed_at, rolled_back_at, rollback_failed_at, rollback_error,
                  rollback_result_json, rollback_result_present
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
  if (row.status === "rollback_pending") {
    return { ...rollbackPendingDataPatchFromRow(row), status: "rollback_pending" };
  }
  if (row.status === "rolled_back") {
    return { ...rolledBackDataPatchFromRow(row), status: "rolled_back" };
  }
  if (row.status === "rollback_failed") {
    return { ...rollbackFailedDataPatchFromRow(row), status: "rollback_failed" };
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
  if (row.status === "rollback_pending" || row.status === "rolled_back" || row.status === "rollback_failed") {
    throw dataPatchApplyUnavailable(row.id, `journal status is '${row.status}'`);
  }
  throw invalidStatus(row);
}

function rollbackClaimResultFromRow(row: DataPatchRow): DataPatchRollbackClaimResult {
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
  if (row.status === "rollback_pending") {
    return { kind: "rollback_pending", patch: rollbackPendingDataPatchFromRow(row) };
  }
  if (row.status === "rolled_back") {
    return { kind: "rolled_back", patch: rolledBackDataPatchFromRow(row) };
  }
  if (row.status === "rollback_failed") {
    return { kind: "rollback_failed", patch: rollbackFailedDataPatchFromRow(row) };
  }
  throw invalidStatus(row);
}

function parseResult(row: DataPatchRow): JsonValue | undefined {
  if (Number(row.result_present) !== 1) {
    return undefined;
  }
  return JSON.parse(row.result_json ?? "null") as JsonValue;
}

function parseRollbackResult(row: DataPatchRow): JsonValue | undefined {
  if (Number(row.rollback_result_present) !== 1) {
    return undefined;
  }
  return JSON.parse(row.rollback_result_json ?? "null") as JsonValue;
}

function rollbackPendingDataPatchFromRow(row: DataPatchRow): RollbackPendingDataPatch {
  return {
    ...appliedDataPatchFromRow(row),
    rollbackClaimedAt: row.rollback_claimed_at ?? ""
  };
}

function rolledBackDataPatchFromRow(row: DataPatchRow): RolledBackDataPatch {
  const rollbackResult = parseRollbackResult(row);
  return {
    ...appliedDataPatchFromRow(row),
    rolledBackAt: row.rolled_back_at ?? "",
    ...(rollbackResult === undefined ? {} : { rollbackResult })
  };
}

function rollbackFailedDataPatchFromRow(row: DataPatchRow): RollbackFailedDataPatch {
  return {
    ...appliedDataPatchFromRow(row),
    rollbackFailedAt: row.rollback_failed_at ?? "",
    rollbackError: row.rollback_error ?? ""
  };
}

function assertChanged(result: unknown, id: string): void {
  if (changedRows(result) === 0) {
    throw new FrameworkError("DATA_PATCH_PENDING", `Data patch '${id}' is not claimed by this runner`, {
      status: 409
    });
  }
}

function assertRetryableFailedRow(
  row: DataPatchRow | undefined,
  id: string,
  checksum: string
): asserts row is DataPatchRow & { readonly status: "failed" } {
  if (row === undefined) {
    throw dataPatchRetryUnavailable(id, "no failed journal entry exists");
  }
  if (row.checksum !== checksum) {
    throw new FrameworkError(
      "DATA_PATCH_CHECKSUM_MISMATCH",
      `Recorded data patch '${id}' has checksum '${row.checksum}' but planned '${checksum}'`,
      { status: 409 }
    );
  }
  if (row.status === "failed") {
    return;
  }
  if (row.status === "pending") {
    throw new FrameworkError(
      "DATA_PATCH_PENDING",
      `Data patch '${id}' is already claimed and has not completed`,
      { status: 409 }
    );
  }
  if (row.status === "applied") {
    throw dataPatchRetryUnavailable(id, "journal status is 'applied'");
  }
  if (row.status === "rollback_pending" || row.status === "rolled_back" || row.status === "rollback_failed") {
    throw dataPatchRetryUnavailable(id, `journal status is '${row.status}'`);
  }
  throw invalidStatus(row);
}

function assertRetryableFailedRollbackRow(
  row: DataPatchRow | undefined,
  id: string,
  checksum: string
): asserts row is DataPatchRow & { readonly status: "rollback_failed" } {
  if (row === undefined) {
    throw dataPatchRollbackRetryUnavailable(id, "no failed rollback journal entry exists");
  }
  if (row.checksum !== checksum) {
    throw new FrameworkError(
      "DATA_PATCH_CHECKSUM_MISMATCH",
      `Recorded data patch '${id}' has checksum '${row.checksum}' but planned '${checksum}'`,
      { status: 409 }
    );
  }
  if (row.status === "rollback_failed") {
    return;
  }
  if (row.status === "pending") {
    throw new FrameworkError(
      "DATA_PATCH_PENDING",
      `Data patch '${id}' is already claimed and has not completed`,
      { status: 409 }
    );
  }
  if (row.status === "failed") {
    throw new FrameworkError("DATA_PATCH_FAILED", `Data patch '${id}' failed and must be retried first`, {
      status: 409
    });
  }
  if (row.status === "rollback_pending") {
    throw new FrameworkError("DATA_PATCH_ROLLBACK_PENDING", `Data patch '${id}' rollback is pending`, {
      status: 409
    });
  }
  if (row.status === "applied" || row.status === "rolled_back") {
    throw dataPatchRollbackRetryUnavailable(id, `journal status is '${row.status}'`);
  }
  throw invalidStatus(row);
}

function assertRollbackClaimableRow(
  row: DataPatchRow | undefined,
  id: string,
  checksum: string
): asserts row is DataPatchRow {
  if (row === undefined) {
    throw dataPatchRollbackUnavailable(id, "no applied journal entry exists");
  }
  if (row.checksum !== checksum) {
    throw new FrameworkError(
      "DATA_PATCH_CHECKSUM_MISMATCH",
      `Recorded data patch '${id}' has checksum '${row.checksum}' but planned '${checksum}'`,
      { status: 409 }
    );
  }
  if (
    row.status === "applied" ||
    row.status === "pending" ||
    row.status === "failed" ||
    row.status === "rollback_pending" ||
    row.status === "rolled_back" ||
    row.status === "rollback_failed"
  ) {
    return;
  }
  throw invalidStatus(row);
}

function assertRetryCleared(result: unknown, id: string): void {
  if (changedRows(result) === 0) {
    throw dataPatchRetryUnavailable(id, "the failed journal entry changed before retry");
  }
}

function assertRollbackRetryClaimed(result: unknown, id: string): void {
  if (changedRows(result) === 0) {
    throw dataPatchRollbackRetryUnavailable(id, "the failed rollback journal entry changed before retry claim");
  }
}

function assertRollbackChanged(result: unknown, id: string): void {
  if (changedRows(result) === 0) {
    throw new FrameworkError("DATA_PATCH_ROLLBACK_PENDING", `Data patch '${id}' rollback is not claimed by this runner`, {
      status: 409
    });
  }
}

function changedRows(result: unknown): number {
  return typeof result === "object" &&
    result !== null &&
    "meta" in result &&
    typeof (result as { readonly meta?: { readonly changes?: unknown } }).meta?.changes === "number"
    ? (result as { readonly meta: { readonly changes: number } }).meta.changes
    : 1;
}

function dataPatchRetryUnavailable(id: string, reason: string): FrameworkError {
  return new FrameworkError(
    "DATA_PATCH_RETRY_UNAVAILABLE",
    `Data patch '${id}' cannot be retried because ${reason}`,
    { status: 409 }
  );
}

function dataPatchRollbackRetryUnavailable(id: string, reason: string): FrameworkError {
  return new FrameworkError(
    "DATA_PATCH_ROLLBACK_RETRY_UNAVAILABLE",
    `Data patch '${id}' rollback cannot be retried because ${reason}`,
    { status: 409 }
  );
}

function dataPatchRollbackUnavailable(id: string, reason: string): FrameworkError {
  return new FrameworkError(
    "DATA_PATCH_ROLLBACK_UNAVAILABLE",
    `Data patch '${id}' cannot be rolled back because ${reason}`,
    { status: 409 }
  );
}

function dataPatchApplyUnavailable(id: string, reason: string): FrameworkError {
  return new FrameworkError(
    "DATA_PATCH_APPLY_UNAVAILABLE",
    `Data patch '${id}' cannot be applied because ${reason}`,
    { status: 409 }
  );
}
