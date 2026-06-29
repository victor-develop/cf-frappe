import type { DataPatchDefinition } from "../core/data-patch.js";
import { FrameworkError } from "../core/errors.js";
import type {
  AppliedDataPatch,
  ClaimedDataPatch,
  ClaimedRollbackDataPatch,
  DataPatchClaimResult,
  DataPatchRollbackClaimResult,
  RecordedDataPatch,
  RolledBackDataPatch
} from "../ports/data-patch-log.js";
import {
  assertAppliedDataPatchChecksumMatches,
  assertDataPatchChecksumMatches
} from "./data-patch-journal-policy.js";

export type DataPatchApplyClaimDecision =
  | { readonly action: "claimed"; readonly claim: ClaimedDataPatch }
  | { readonly action: "skip"; readonly patch: AppliedDataPatch };

export type DataPatchRollbackClaimDecision =
  | { readonly action: "claimed"; readonly claim: ClaimedRollbackDataPatch }
  | { readonly action: "skip"; readonly patch: RolledBackDataPatch };

export function dataPatchApplyClaimDecision<TResources>(
  patch: DataPatchDefinition<TResources>,
  result: DataPatchClaimResult
): DataPatchApplyClaimDecision {
  if (result.kind === "claimed") {
    return { action: "claimed", claim: result.claim };
  }
  if (result.kind === "applied") {
    assertAppliedDataPatchChecksumMatches(patch.id, patch.checksum, result.patch.checksum);
    return { action: "skip", patch: result.patch };
  }
  assertDataPatchChecksumMatches(patch.id, patch.checksum, result.patch.checksum);
  if (result.kind === "pending") {
    throw new FrameworkError(
      "DATA_PATCH_PENDING",
      `Data patch '${patch.id}' is already claimed and has not completed`,
      { status: 409 }
    );
  }
  throw new FrameworkError(
    "DATA_PATCH_FAILED",
    `Data patch '${patch.id}' previously failed at '${result.patch.failedAt}': ${result.patch.error}`,
    { status: 409 }
  );
}

export function dataPatchRollbackClaimDecision(
  patchId: string,
  result: DataPatchRollbackClaimResult
): DataPatchRollbackClaimDecision {
  if (result.kind === "claimed") {
    return { action: "claimed", claim: result.claim };
  }
  if (result.kind === "rolled_back") {
    return { action: "skip", patch: result.patch };
  }
  if (result.kind === "pending") {
    throw new FrameworkError(
      "DATA_PATCH_PENDING",
      `Data patch '${patchId}' is already claimed and has not completed`,
      { status: 409 }
    );
  }
  if (result.kind === "failed") {
    throw new FrameworkError(
      "DATA_PATCH_FAILED",
      `Data patch '${patchId}' previously failed at '${result.patch.failedAt}': ${result.patch.error}`,
      { status: 409 }
    );
  }
  if (result.kind === "rollback_pending") {
    throw new FrameworkError(
      "DATA_PATCH_ROLLBACK_PENDING",
      `Data patch '${patchId}' rollback is already claimed and has not completed`,
      { status: 409 }
    );
  }
  throw new FrameworkError(
    "DATA_PATCH_ROLLBACK_FAILED",
    `Data patch '${patchId}' rollback previously failed at '${result.patch.rollbackFailedAt}': ${result.patch.rollbackError}`,
    { status: 409 }
  );
}

export function assertRecordedDataPatchAllowsApplySkip<TResources>(
  patch: DataPatchDefinition<TResources>,
  recorded: RecordedDataPatch
): AppliedDataPatch {
  if (recorded.status === "applied") {
    const applied = appliedPatchFromRecord(recorded);
    assertAppliedDataPatchChecksumMatches(patch.id, patch.checksum, applied.checksum);
    return applied;
  }
  assertDataPatchChecksumMatches(patch.id, patch.checksum, recorded.checksum);
  if (recorded.status === "pending") {
    throw new FrameworkError(
      "DATA_PATCH_PENDING",
      `Data patch '${patch.id}' is already claimed and has not completed`,
      { status: 409 }
    );
  }
  if (recorded.status === "rollback_pending") {
    throw new FrameworkError(
      "DATA_PATCH_ROLLBACK_PENDING",
      `Data patch '${patch.id}' rollback is already claimed and has not completed`,
      { status: 409 }
    );
  }
  if (recorded.status === "rollback_failed") {
    throw new FrameworkError(
      "DATA_PATCH_ROLLBACK_FAILED",
      `Data patch '${patch.id}' rollback previously failed at '${recorded.rollbackFailedAt}': ${recorded.rollbackError}`,
      { status: 409 }
    );
  }
  if (recorded.status === "rolled_back") {
    throw new FrameworkError(
      "DATA_PATCH_ROLLBACK_UNAVAILABLE",
      `Data patch '${patch.id}' has already been rolled back`,
      { status: 409 }
    );
  }
  throw new FrameworkError(
    "DATA_PATCH_FAILED",
    `Data patch '${patch.id}' previously failed at '${recorded.failedAt}': ${recorded.error}`,
    { status: 409 }
  );
}

function appliedPatchFromRecord(record: RecordedDataPatch & { readonly status: "applied" }): AppliedDataPatch {
  const { status: _status, ...patch } = record;
  return patch;
}
