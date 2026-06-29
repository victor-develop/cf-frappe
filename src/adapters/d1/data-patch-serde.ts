import { FrameworkError } from "../../core/errors.js";
import { dataPatchApplyUnavailable, invalidDataPatchJournalStatus } from "../../application/data-patch-journal-policy.js";
import { cloneJsonValue, isJsonValue } from "../../core/json.js";
import type { JsonValue } from "../../core/types.js";
import type {
  AppliedDataPatch,
  DataPatchClaimResult,
  DataPatchRollbackClaimResult,
  RecordedDataPatch,
  RollbackFailedDataPatch,
  RollbackPendingDataPatch,
  RolledBackDataPatch
} from "../../ports/data-patch-log.js";

export interface DataPatchRow {
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

export function recordedDataPatchFromRow(row: DataPatchRow): RecordedDataPatch {
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
  throw invalidDataPatchJournalStatus(row);
}

export function appliedDataPatchFromRow(row: DataPatchRow): AppliedDataPatch {
  const result = parseResult(row);
  return {
    id: row.id,
    checksum: row.checksum,
    appliedAt: row.applied_at ?? "",
    ...(result === undefined ? {} : { result })
  };
}

export function claimResultFromRow(row: DataPatchRow, claimId: string): DataPatchClaimResult {
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
  throw invalidDataPatchJournalStatus(row);
}

export function rollbackClaimResultFromRow(row: DataPatchRow): DataPatchRollbackClaimResult {
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
  throw invalidDataPatchJournalStatus(row);
}

export function serializedPatchResult(
  id: string,
  field: "result_json" | "rollback_result_json",
  value: JsonValue | undefined
): string | null {
  if (value === undefined) {
    return null;
  }
  if (!isJsonValue(value)) {
    throw new FrameworkError("DATA_PATCH_INVALID", `Data patch '${id}' has invalid ${field}`, { status: 409 });
  }
  return JSON.stringify(cloneJsonValue(value));
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

function parseResult(row: DataPatchRow): JsonValue | undefined {
  if (Number(row.result_present) !== 1) {
    return undefined;
  }
  return parseJsonValue(row.id, "result_json", row.result_json ?? "null");
}

function parseRollbackResult(row: DataPatchRow): JsonValue | undefined {
  if (Number(row.rollback_result_present) !== 1) {
    return undefined;
  }
  return parseJsonValue(row.id, "rollback_result_json", row.rollback_result_json ?? "null");
}

function parseJsonValue(id: string, field: "result_json" | "rollback_result_json", value: string): JsonValue {
  try {
    const parsed: unknown = JSON.parse(value);
    if (isJsonValue(parsed)) {
      return parsed;
    }
  } catch {
    // Fall through to the journal corruption error below.
  }
  throw new FrameworkError("DATA_PATCH_INVALID", `Data patch '${id}' has invalid ${field}`, { status: 409 });
}
