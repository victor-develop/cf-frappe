import { defineDataPatch } from "../../src/core/data-patch.js";
import type { RecordedDataPatch } from "../../src/ports/data-patch-log.js";
import {
  assertDataPatchRollbackRetryable,
  assertDataPatchRollbackRetryableWithSuccessors,
  assertDataPatchRollbackSuccessorsRolledBack,
  assertSelectedDataPatchRollbackable,
  dataPatchRollbackPlanDecision,
  planAutomaticDataPatchRollback,
  planSelectedDataPatchRollback
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

  it("plans selected rollback in reverse registry order with a limit", () => {
    const patches = [
      patch({ id: "core.first", rollback: true }),
      patch({ id: "crm.second", rollback: true }),
      patch({ id: "sales.third", rollback: true })
    ];
    const recordedById = new Map<string, RecordedDataPatch>([
      ["core.first", recorded("applied", "v1", "core.first")],
      ["crm.second", recorded("applied", "v1", "crm.second")],
      ["sales.third", recorded("applied", "v1", "sales.third")]
    ]);

    expect(planSelectedDataPatchRollback(patches, patches, 2, recordedById).map((planned) => planned.id)).toEqual([
      "sales.third",
      "crm.second"
    ]);
  });

  it("plans automatic rollback from the latest reversible applied patch until an irreversible predecessor", () => {
    const patches = [
      patch({ id: "core.first", rollback: true }),
      patch({ id: "crm.irreversible" }),
      patch({ id: "sales.third", rollback: true }),
      patch({ id: "support.fourth", rollback: true })
    ];
    const recordedById = new Map<string, RecordedDataPatch>([
      ["core.first", recorded("applied", "v1", "core.first")],
      ["crm.irreversible", recorded("applied", "v1", "crm.irreversible")],
      ["sales.third", recorded("rolled_back", "v1", "sales.third")],
      ["support.fourth", recorded("applied", "v1", "support.fourth")]
    ]);

    expect(planAutomaticDataPatchRollback(patches, undefined, recordedById).map((planned) => planned.id)).toEqual([
      "support.fourth"
    ]);
  });

  it("guards selected rollback order against later applied successors", () => {
    const patches = [patch({ id: "core.first", rollback: true }), patch({ id: "crm.second", rollback: true })];
    const recordedById = new Map<string, RecordedDataPatch>([
      ["core.first", recorded("applied", "v1", "core.first")],
      ["crm.second", recorded("applied", "v1", "crm.second")]
    ]);

    expect(() =>
      assertDataPatchRollbackSuccessorsRolledBack(patches, [patches[0]!], new Set(["core.first"]), recordedById)
    ).toThrow("Data patch 'core.first' cannot roll back before later patch 'crm.second' is rolled back");

    recordedById.set("crm.second", recorded("rolled_back", "v1", "crm.second"));
    expect(() =>
      assertDataPatchRollbackSuccessorsRolledBack(patches, [patches[0]!], new Set(["core.first"]), recordedById)
    ).not.toThrow();
  });

  it("checks successor status and checksum before selected rollback order succeeds", () => {
    const patches = [patch({ id: "core.first", rollback: true }), patch({ id: "crm.second", checksum: "v2", rollback: true })];

    expect(() =>
      assertDataPatchRollbackSuccessorsRolledBack(
        patches,
        [patches[0]!],
        new Set(["core.first"]),
        new Map([["crm.second", recorded("rolled_back", "v1", "crm.second")]])
      )
    ).toThrow("Recorded data patch 'crm.second' has checksum 'v1' but planned 'v2'");

    expect(() =>
      assertDataPatchRollbackSuccessorsRolledBack(
        patches,
        [patches[0]!],
        new Set(["core.first"]),
        new Map([["crm.second", recorded("pending", "v2", "crm.second")]])
      )
    ).toThrow("Data patch 'crm.second' is pending");
  });

  it("guards rollback retry against later successors before accepting the failed rollback", () => {
    const patches = [patch({ id: "core.first", rollback: true }), patch({ id: "crm.second", rollback: true })];
    const recordedById = new Map<string, RecordedDataPatch>([
      ["core.first", recorded("rollback_failed", "v1", "core.first")],
      ["crm.second", recorded("applied", "v1", "crm.second")]
    ]);

    expect(() => assertDataPatchRollbackRetryableWithSuccessors(patches, patches[0]!, recordedById)).toThrow(
      "Data patch 'core.first' cannot roll back before later patch 'crm.second' is rolled back"
    );

    recordedById.set("crm.second", recorded("rolled_back", "v1", "crm.second"));
    expect(() => assertDataPatchRollbackRetryableWithSuccessors(patches, patches[0]!, recordedById)).not.toThrow();
  });
});

function patch(options: { readonly checksum?: string; readonly id?: string; readonly rollback?: boolean } = {}) {
  return defineDataPatch({
    id: options.id ?? "accounts.seed",
    checksum: options.checksum ?? "v1",
    run: () => undefined,
    ...(options.rollback === true ? { rollback: { run: () => undefined } } : {})
  });
}

function recorded(status: RecordedDataPatch["status"], checksum = "v1", id = "accounts.seed"): RecordedDataPatch {
  switch (status) {
    case "pending":
      return { id, checksum, status, claimedAt: now };
    case "applied":
      return { id, checksum, status, appliedAt: now };
    case "failed":
      return { id, checksum, status, failedAt: now, error: "boom" };
    case "rollback_pending":
      return { id, checksum, status, appliedAt: now, rollbackClaimedAt: now };
    case "rolled_back":
      return { id, checksum, status, appliedAt: now, rolledBackAt: now };
    case "rollback_failed":
      return { id, checksum, status, appliedAt: now, rollbackFailedAt: now, rollbackError: "boom" };
  }
}
