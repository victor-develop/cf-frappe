import { defineDataPatch } from "../../src/core/data-patch.js";
import type {
  ClaimedDataPatch,
  ClaimedRollbackDataPatch
} from "../../src/ports/data-patch-log.js";
import {
  assertRecordedDataPatchAllowsApplySkip,
  dataPatchApplyClaimDecision,
  dataPatchRollbackClaimDecision
} from "../../src/application/data-patch-claim-policy.js";
import { now } from "../helpers";

describe("data patch claim policy", () => {
  it("plans apply claim outcomes and preserves concurrent operator errors", () => {
    expect(dataPatchApplyClaimDecision(patch(), { kind: "claimed", claim: claim() })).toEqual({
      action: "claimed",
      claim: claim()
    });
    expect(dataPatchApplyClaimDecision(patch(), { kind: "applied", patch: applied() })).toEqual({
      action: "skip",
      patch: applied()
    });
    expect(() => dataPatchApplyClaimDecision(patch(), { kind: "pending", patch: pending() })).toThrow(
      "is already claimed and has not completed"
    );
    expect(() => dataPatchApplyClaimDecision(patch(), { kind: "failed", patch: failed() })).toThrow(
      "previously failed at"
    );
    expect(() => dataPatchApplyClaimDecision(patch({ checksum: "v2" }), { kind: "applied", patch: applied() })).toThrow(
      "Applied data patch 'core.seed' has checksum 'v1' but planned 'v2'"
    );
  });

  it("plans rollback claim outcomes and preserves rollback-state operator errors", () => {
    expect(dataPatchRollbackClaimDecision("core.seed", { kind: "claimed", claim: rollbackClaim() })).toEqual({
      action: "claimed",
      claim: rollbackClaim()
    });
    expect(dataPatchRollbackClaimDecision("core.seed", { kind: "rolled_back", patch: rolledBack() })).toEqual({
      action: "skip",
      patch: rolledBack()
    });
    expect(() => dataPatchRollbackClaimDecision("core.seed", { kind: "pending", patch: pending() })).toThrow(
      "is already claimed and has not completed"
    );
    expect(() => dataPatchRollbackClaimDecision("core.seed", { kind: "failed", patch: failed() })).toThrow(
      "previously failed at"
    );
    expect(() =>
      dataPatchRollbackClaimDecision("core.seed", { kind: "rollback_pending", patch: rollbackPending() })
    ).toThrow("rollback is already claimed and has not completed");
    expect(() =>
      dataPatchRollbackClaimDecision("core.seed", { kind: "rollback_failed", patch: rollbackFailed() })
    ).toThrow("rollback previously failed at");
  });

  it("guards recorded apply skips by status and checksum", () => {
    expect(assertRecordedDataPatchAllowsApplySkip(patch(), { ...applied(), status: "applied" })).toEqual(applied());
    expect(() => assertRecordedDataPatchAllowsApplySkip(patch(), { ...pending(), status: "pending" })).toThrow(
      "is already claimed and has not completed"
    );
    expect(() => assertRecordedDataPatchAllowsApplySkip(patch(), { ...failed(), status: "failed" })).toThrow(
      "previously failed at"
    );
    expect(() =>
      assertRecordedDataPatchAllowsApplySkip(patch(), { ...rollbackPending(), status: "rollback_pending" })
    ).toThrow("rollback is already claimed and has not completed");
    expect(() =>
      assertRecordedDataPatchAllowsApplySkip(patch(), { ...rollbackFailed(), status: "rollback_failed" })
    ).toThrow("rollback previously failed at");
    expect(() => assertRecordedDataPatchAllowsApplySkip(patch(), { ...rolledBack(), status: "rolled_back" })).toThrow(
      "has already been rolled back"
    );
    expect(() => assertRecordedDataPatchAllowsApplySkip(patch({ checksum: "v2" }), { ...pending(), status: "pending" })).toThrow(
      "Recorded data patch 'core.seed' has checksum 'v1' but planned 'v2'"
    );
  });
});

function patch(options: { readonly checksum?: string } = {}) {
  return defineDataPatch({ id: "core.seed", checksum: options.checksum ?? "v1", run: () => undefined });
}

function claim(): ClaimedDataPatch {
  return { id: "core.seed", checksum: "v1", claimId: "claim-seed", claimedAt: now };
}

function rollbackClaim(): ClaimedRollbackDataPatch {
  return { id: "core.seed", checksum: "v1", claimId: "rollback-seed", claimedAt: now };
}

function applied() {
  return { id: "core.seed", checksum: "v1", appliedAt: now };
}

function pending() {
  return { id: "core.seed", checksum: "v1", claimedAt: now };
}

function failed() {
  return { id: "core.seed", checksum: "v1", failedAt: now, error: "boom" };
}

function rollbackPending() {
  return { id: "core.seed", checksum: "v1", appliedAt: now, rollbackClaimedAt: now };
}

function rolledBack() {
  return { id: "core.seed", checksum: "v1", appliedAt: now, rolledBackAt: now };
}

function rollbackFailed() {
  return { id: "core.seed", checksum: "v1", appliedAt: now, rollbackFailedAt: now, rollbackError: "rollback boom" };
}
