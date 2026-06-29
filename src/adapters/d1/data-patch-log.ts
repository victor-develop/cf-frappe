import { FrameworkError } from "../../core/errors.js";
import {
  assertDataPatchChecksumMatches,
  assertRetryableFailedJournal,
  assertRetryableRollbackFailedJournal,
  assertRollbackClaimableJournal,
  dataPatchRetryUnavailable,
  dataPatchRollbackRetryUnavailable
} from "../../application/data-patch-journal-policy.js";
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
  RetryFailedDataPatch,
  RetryFailedDataPatchRollback
} from "../../ports/data-patch-log.js";
import {
  appliedDataPatchFromRow,
  claimResultFromRow,
  recordedDataPatchFromRow,
  rollbackClaimResultFromRow,
  serializedPatchResult,
  type DataPatchRow
} from "./data-patch-serde.js";

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
    assertDataPatchChecksumMatches(patch.id, patch.checksum, row.checksum);
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
        serializedPatchResult(patch.id, "result_json", patch.result),
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
    assertRetryableFailedJournal(row, patch.id, patch.checksum);
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
    assertRetryableRollbackFailedJournal(row, patch.id, patch.checksum);
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
    assertRollbackClaimableJournal(row, patch.id, patch.checksum);
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
      assertRollbackClaimableJournal(changed, patch.id, patch.checksum);
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
        serializedPatchResult(patch.id, "rollback_result_json", patch.result),
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

function assertChanged(result: unknown, id: string): void {
  if (changedRows(result) === 0) {
    throw new FrameworkError("DATA_PATCH_PENDING", `Data patch '${id}' is not claimed by this runner`, {
      status: 409
    });
  }
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
  if (!isRecord(result) || !isRecord(result.meta)) {
    return 0;
  }
  return typeof result.meta.changes === "number" ? result.meta.changes : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
