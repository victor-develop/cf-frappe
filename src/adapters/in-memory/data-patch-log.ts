import { FrameworkError } from "../../core/errors.js";
import {
  assertDataPatchChecksumMatches,
  assertRetryableFailedJournal,
  assertRetryableRollbackFailedJournal,
  assertRollbackClaimableJournal,
  dataPatchApplyUnavailable,
  dataPatchRollbackUnavailable
} from "../../application/data-patch-journal-policy.js";
import { cloneJsonValue, isJsonValue } from "../../core/json.js";
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
  FailedDataPatch,
  PendingDataPatch,
  RecordedDataPatch,
  RollbackFailedDataPatch,
  RollbackPendingDataPatch,
  RolledBackDataPatch,
  RetryFailedDataPatch,
  RetryFailedDataPatchRollback
} from "../../ports/data-patch-log.js";

type InMemoryDataPatchEntry =
  | (PendingDataPatch & { readonly status: "pending"; readonly claimId: string })
  | (AppliedDataPatch & { readonly status: "applied" })
  | (FailedDataPatch & { readonly status: "failed"; readonly claimId: string })
  | (RollbackPendingDataPatch & { readonly status: "rollback_pending"; readonly claimId: string })
  | (RolledBackDataPatch & { readonly status: "rolled_back" })
  | (RollbackFailedDataPatch & { readonly status: "rollback_failed"; readonly claimId: string });

export class InMemoryDataPatchLog implements DataPatchLog {
  private readonly patches = new Map<string, InMemoryDataPatchEntry>();

  async recordedDataPatches(): Promise<readonly RecordedDataPatch[]> {
    return [...this.patches.values()].map(recordFromEntry).sort((left, right) => left.id.localeCompare(right.id));
  }

  async appliedDataPatches(): Promise<readonly AppliedDataPatch[]> {
    return (await this.recordedDataPatches())
      .filter((patch): patch is RecordedDataPatch & { readonly status: "applied" } => patch.status === "applied")
      .map(appliedPatchFromRecord);
  }

  async claimDataPatch(patch: ClaimDataPatch): Promise<DataPatchClaimResult> {
    const existing = this.patches.get(patch.id);
    if (existing !== undefined) {
      assertDataPatchChecksumMatches(patch.id, patch.checksum, existing.checksum);
      return claimResult(existing);
    }
    const claimed = Object.freeze({
      id: patch.id,
      checksum: patch.checksum,
      claimId: patch.claimId,
      claimedAt: patch.claimedAt,
      status: "pending" as const
    });
    this.patches.set(patch.id, claimed);
    return { kind: "claimed", claim: claimed };
  }

  async completeDataPatch(patch: CompleteDataPatch): Promise<void> {
    const existing = this.patches.get(patch.id);
    assertPendingClaim(existing, patch.id, patch.checksum, patch.claimId);
    this.patches.set(patch.id, Object.freeze({
      id: patch.id,
      checksum: patch.checksum,
      appliedAt: patch.appliedAt,
      ...(patch.result === undefined ? {} : { result: clonePatchResult(patch.id, "result", patch.result) }),
      status: "applied" as const
    }));
  }

  async failDataPatch(patch: FailDataPatch): Promise<void> {
    const existing = this.patches.get(patch.id);
    assertPendingClaim(existing, patch.id, patch.checksum, patch.claimId);
    this.patches.set(patch.id, Object.freeze({
      id: patch.id,
      checksum: patch.checksum,
      claimId: patch.claimId,
      failedAt: patch.failedAt,
      error: patch.error,
      status: "failed" as const
    }));
  }

  async retryFailedDataPatch(patch: RetryFailedDataPatch): Promise<void> {
    const existing = this.patches.get(patch.id);
    assertRetryableFailedJournal(existing, patch.id, patch.checksum);
    this.patches.delete(patch.id);
  }

  async retryFailedDataPatchRollback(patch: RetryFailedDataPatchRollback) {
    const existing = this.patches.get(patch.id);
    assertRetryableRollbackFailedJournal(existing, patch.id, patch.checksum);
    const claimed = Object.freeze({
      id: patch.id,
      checksum: patch.checksum,
      appliedAt: existing.appliedAt,
      ...(existing.result === undefined ? {} : { result: clonePatchResult(patch.id, "result", existing.result) }),
      claimId: patch.claimId,
      rollbackClaimedAt: patch.claimedAt,
      status: "rollback_pending" as const
    });
    this.patches.set(patch.id, claimed);
    return { id: patch.id, checksum: patch.checksum, claimId: patch.claimId, claimedAt: patch.claimedAt };
  }

  async claimDataPatchRollback(patch: ClaimRollbackDataPatch): Promise<DataPatchRollbackClaimResult> {
    const existing = this.patches.get(patch.id);
    assertRollbackClaimableJournal(existing, patch.id, patch.checksum);
    if (existing.status !== "applied") {
      return rollbackClaimResult(existing);
    }
    const claimed = Object.freeze({
      ...existing,
      claimId: patch.claimId,
      rollbackClaimedAt: patch.claimedAt,
      status: "rollback_pending" as const
    });
    this.patches.set(patch.id, claimed);
    return {
      kind: "claimed",
      claim: { id: patch.id, checksum: patch.checksum, claimId: patch.claimId, claimedAt: patch.claimedAt }
    };
  }

  async completeDataPatchRollback(patch: CompleteRollbackDataPatch): Promise<void> {
    const existing = this.patches.get(patch.id);
    assertRollbackPendingClaim(existing, patch.id, patch.checksum, patch.claimId);
    this.patches.set(patch.id, Object.freeze({
      id: patch.id,
      checksum: patch.checksum,
      appliedAt: existing.appliedAt,
      ...(existing.result === undefined ? {} : { result: clonePatchResult(patch.id, "result", existing.result) }),
      rolledBackAt: patch.rolledBackAt,
      ...(patch.result === undefined
        ? {}
        : { rollbackResult: clonePatchResult(patch.id, "rollbackResult", patch.result) }),
      status: "rolled_back" as const
    }));
  }

  async failDataPatchRollback(patch: FailRollbackDataPatch): Promise<void> {
    const existing = this.patches.get(patch.id);
    assertRollbackPendingClaim(existing, patch.id, patch.checksum, patch.claimId);
    this.patches.set(patch.id, Object.freeze({
      id: patch.id,
      checksum: patch.checksum,
      appliedAt: existing.appliedAt,
      ...(existing.result === undefined ? {} : { result: clonePatchResult(patch.id, "result", existing.result) }),
      claimId: patch.claimId,
      rollbackFailedAt: patch.failedAt,
      rollbackError: patch.error,
      status: "rollback_failed" as const
    }));
  }
}

function recordFromEntry(entry: InMemoryDataPatchEntry): RecordedDataPatch {
  if (entry.status === "applied") {
    return { ...appliedPatchFromRecord(entry), status: "applied" };
  }
  if (entry.status === "rollback_pending") {
    const { claimId: _claimId, ...patch } = entry;
    return cloneRecordedPatch(patch);
  }
  if (entry.status === "rollback_failed") {
    const { claimId: _claimId, ...patch } = entry;
    return cloneRecordedPatch(patch);
  }
  if (entry.status === "rolled_back") {
    return cloneRecordedPatch(entry);
  }
  if (entry.status === "failed") {
    const { claimId: _claimId, ...patch } = entry;
    return patch;
  }
  const { claimId: _claimId, ...patch } = entry;
  return patch;
}

function claimResult(entry: InMemoryDataPatchEntry): DataPatchClaimResult {
  if (entry.status === "applied") {
    const { status: _status, ...patch } = entry;
    return { kind: "applied", patch: cloneAppliedPatch(patch) };
  }
  if (entry.status === "failed") {
    const { status: _status, claimId: _claimId, ...patch } = entry;
    return { kind: "failed", patch };
  }
  if (entry.status === "rollback_pending" || entry.status === "rollback_failed" || entry.status === "rolled_back") {
    throw dataPatchApplyUnavailable(entry.id, `journal status is '${entry.status}'`);
  }
  const { status: _status, claimId: _claimId, ...patch } = entry;
  return { kind: "pending", patch };
}

function rollbackClaimResult(entry: InMemoryDataPatchEntry): DataPatchRollbackClaimResult {
  if (entry.status === "pending") {
    const { status: _status, claimId: _claimId, ...patch } = entry;
    return { kind: "pending", patch };
  }
  if (entry.status === "failed") {
    const { status: _status, claimId: _claimId, ...patch } = entry;
    return { kind: "failed", patch };
  }
  if (entry.status === "rollback_pending") {
    const { status: _status, claimId: _claimId, ...patch } = entry;
    return { kind: "rollback_pending", patch: cloneRollbackPendingPatch(patch) };
  }
  if (entry.status === "rollback_failed") {
    const { status: _status, claimId: _claimId, ...patch } = entry;
    return { kind: "rollback_failed", patch: cloneRollbackFailedPatch(patch) };
  }
  if (entry.status === "rolled_back") {
    const { status: _status, ...patch } = entry;
    return { kind: "rolled_back", patch: cloneRolledBackPatch(patch) };
  }
  throw dataPatchRollbackUnavailable(entry.id, `journal status is '${entry.status}'`);
}

function appliedPatchFromRecord(record: RecordedDataPatch & { readonly status: "applied" }): AppliedDataPatch {
  const { status: _status, ...patch } = record;
  return cloneAppliedPatch(patch);
}

function cloneRecordedPatch(record: RecordedDataPatch): RecordedDataPatch {
  if (record.status === "applied") {
    return { ...cloneAppliedPatch(record), status: "applied" };
  }
  if (record.status === "rollback_pending") {
    return { ...cloneRollbackPendingPatch(record), status: "rollback_pending" };
  }
  if (record.status === "rolled_back") {
    return { ...cloneRolledBackPatch(record), status: "rolled_back" };
  }
  if (record.status === "rollback_failed") {
    return { ...cloneRollbackFailedPatch(record), status: "rollback_failed" };
  }
  return record;
}

function cloneAppliedPatch(patch: AppliedDataPatch): AppliedDataPatch {
  return {
    id: patch.id,
    checksum: patch.checksum,
    appliedAt: patch.appliedAt,
    ...(patch.result === undefined ? {} : { result: clonePatchResult(patch.id, "result", patch.result) })
  };
}

function cloneRollbackPendingPatch(patch: RollbackPendingDataPatch): RollbackPendingDataPatch {
  return {
    ...cloneAppliedPatch(patch),
    rollbackClaimedAt: patch.rollbackClaimedAt
  };
}

function cloneRolledBackPatch(patch: RolledBackDataPatch): RolledBackDataPatch {
  return {
    ...cloneAppliedPatch(patch),
    rolledBackAt: patch.rolledBackAt,
    ...(patch.rollbackResult === undefined
      ? {}
      : { rollbackResult: clonePatchResult(patch.id, "rollbackResult", patch.rollbackResult) })
  };
}

function cloneRollbackFailedPatch(patch: RollbackFailedDataPatch): RollbackFailedDataPatch {
  return {
    ...cloneAppliedPatch(patch),
    rollbackFailedAt: patch.rollbackFailedAt,
    rollbackError: patch.rollbackError
  };
}

function clonePatchResult(id: string, field: "result" | "rollbackResult", value: JsonValue): JsonValue {
  if (!isJsonValue(value)) {
    throw new FrameworkError("DATA_PATCH_INVALID", `Data patch '${id}' has invalid ${field}`, { status: 409 });
  }
  return cloneJsonValue(value);
}

function assertPendingClaim(
  entry: InMemoryDataPatchEntry | undefined,
  id: string,
  checksum: string,
  claimId: string
): asserts entry is PendingDataPatch & { readonly status: "pending"; readonly claimId: string } {
  if (entry?.status === "pending" && entry.checksum === checksum && entry.claimId === claimId) {
    return;
  }
  throw new FrameworkError("DATA_PATCH_PENDING", `Data patch '${id}' is not claimed by this runner`, {
    status: 409
  });
}

function assertRollbackPendingClaim(
  entry: InMemoryDataPatchEntry | undefined,
  id: string,
  checksum: string,
  claimId: string
): asserts entry is RollbackPendingDataPatch & { readonly status: "rollback_pending"; readonly claimId: string } {
  if (entry?.status === "rollback_pending" && entry.checksum === checksum && entry.claimId === claimId) {
    return;
  }
  throw new FrameworkError("DATA_PATCH_ROLLBACK_PENDING", `Data patch '${id}' rollback is not claimed by this runner`, {
    status: 409
  });
}
