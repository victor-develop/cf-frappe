import { FrameworkError } from "../../core/errors.js";
import type {
  AppliedDataPatch,
  ClaimDataPatch,
  CompleteDataPatch,
  DataPatchClaimResult,
  DataPatchLog,
  FailDataPatch,
  FailedDataPatch,
  PendingDataPatch,
  RecordedDataPatch
} from "../../ports/data-patch-log.js";

type InMemoryDataPatchEntry =
  | (PendingDataPatch & { readonly status: "pending"; readonly claimId: string })
  | (AppliedDataPatch & { readonly status: "applied" })
  | (FailedDataPatch & { readonly status: "failed"; readonly claimId: string });

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
      assertChecksumValueMatches(patch.id, patch.checksum, existing.checksum);
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
      ...(patch.result === undefined ? {} : { result: patch.result }),
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
}

function recordFromEntry(entry: InMemoryDataPatchEntry): RecordedDataPatch {
  if (entry.status === "applied") {
    return { ...appliedPatchFromRecord(entry), status: "applied" };
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
    return { kind: "applied", patch };
  }
  if (entry.status === "failed") {
    const { status: _status, claimId: _claimId, ...patch } = entry;
    return { kind: "failed", patch };
  }
  const { status: _status, claimId: _claimId, ...patch } = entry;
  return { kind: "pending", patch };
}

function appliedPatchFromRecord(record: RecordedDataPatch & { readonly status: "applied" }): AppliedDataPatch {
  const { status: _status, ...patch } = record;
  return patch;
}

function assertChecksumValueMatches(id: string, plannedChecksum: string, recordedChecksum: string): void {
  if (plannedChecksum === recordedChecksum) {
    return;
  }
  throw new FrameworkError(
    "DATA_PATCH_CHECKSUM_MISMATCH",
    `Recorded data patch '${id}' has checksum '${recordedChecksum}' but planned '${plannedChecksum}'`,
    { status: 409 }
  );
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
