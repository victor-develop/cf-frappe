import { defineDataPatch } from "../../src/core/data-patch.js";
import type { RecordedDataPatch } from "../../src/ports/data-patch-log.js";
import {
  assertDataPatchRollbackRetryable,
  assertSelectedDataPatchRollbackable,
  dataPatchRollbackPlanDecision
} from "../../src/application/data-patch-rollback-policy.js";
import { now } from "../helpers";

describe("data patch rollback policy", () => {
  it("plans automatic rollback disposition from recorded state", () => {
    const rollbackable = patch({ rollback: true });
    const irreversible = patch();

    expect(dataPatchRollbackPlanDecision(rollbackable, recorded("applied"))).toEqual({ action: "include" });
    expect(dataPatchRollbackPlanDecision(rollbackable, undefined)).toEqual({ action: "skip" });
    expect(dataPatchRollbackPlanDecision(rollbackable, recorded("rolled_back"))).toEqual({ action: "skip" });
    expect(dataPatchRollbackPlanDecision(irreversible, recorded("applied"))).toEqual({ action: "stop" });
    expect(() => dataPatchRollbackPlanDecision(rollbackable, recorded("failed"))).toThrow(
      "failed and must be retried first"
    );
  });

  it("guards selected rollback requests with exact operator-facing reasons", () => {
    expect(() => assertSelectedDataPatchRollbackable(patch({ rollback: true }), undefined)).toThrow(
      "cannot be rolled back because it has not been applied"
    );
    expect(() => assertSelectedDataPatchRollbackable(patch({ rollback: true }), recorded("rolled_back"))).toThrow(
      "has already been rolled back"
    );
    expect(() => assertSelectedDataPatchRollbackable(patch(), recorded("applied"))).toThrow(
      "does not declare a rollback"
    );
  });

  it("guards rollback retry requests by failed rollback journal state", () => {
    expect(() => assertDataPatchRollbackRetryable(patch({ rollback: true }), recorded("rollback_failed"))).not.toThrow();
    expect(() => assertDataPatchRollbackRetryable(patch({ rollback: true }), undefined)).toThrow(
      "rollback cannot be retried because no failed rollback journal entry exists"
    );
    expect(() => assertDataPatchRollbackRetryable(patch({ rollback: true }), recorded("applied"))).toThrow(
      "rollback cannot be retried because journal status is 'applied'"
    );
    expect(() => assertDataPatchRollbackRetryable(patch(), recorded("rollback_failed"))).toThrow(
      "does not declare a rollback"
    );
  });
});

function patch(options: { readonly rollback?: boolean } = {}) {
  return defineDataPatch({
    id: "accounts.seed",
    checksum: "v1",
    run: () => undefined,
    ...(options.rollback === true ? { rollback: { run: () => undefined } } : {})
  });
}

function recorded(status: RecordedDataPatch["status"], checksum = "v1"): RecordedDataPatch {
  switch (status) {
    case "pending":
      return { id: "accounts.seed", checksum, status, claimedAt: now };
    case "applied":
      return { id: "accounts.seed", checksum, status, appliedAt: now };
    case "failed":
      return { id: "accounts.seed", checksum, status, failedAt: now, error: "boom" };
    case "rollback_pending":
      return { id: "accounts.seed", checksum, status, appliedAt: now, rollbackClaimedAt: now };
    case "rolled_back":
      return { id: "accounts.seed", checksum, status, appliedAt: now, rolledBackAt: now };
    case "rollback_failed":
      return { id: "accounts.seed", checksum, status, appliedAt: now, rollbackFailedAt: now, rollbackError: "boom" };
  }
}
