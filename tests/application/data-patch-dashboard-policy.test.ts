import { defineDataPatch } from "../../src/core/data-patch.js";
import type { JsonValue } from "../../src/core/types.js";
import type { RecordedDataPatch } from "../../src/ports/data-patch-log.js";
import {
  dataPatchDashboardEntry,
  dataPatchDashboardTotals,
  type DataPatchDashboardEntry
} from "../../src/application/data-patch-dashboard-policy.js";
import { now } from "../helpers";

describe("data patch dashboard policy", () => {
  it("projects unapplied and applied entries with rollback affordances", () => {
    expect(dataPatchDashboardEntry(patch({ label: "Seed Core" }), undefined)).toEqual({
      id: "core.seed",
      label: "Seed Core",
      checksum: "v1",
      status: "not_applied"
    });
    expect(dataPatchDashboardEntry(patch({ rollbackLabel: "Undo Seed" }), recorded("applied", { touched: 1 }))).toEqual({
      id: "core.seed",
      checksum: "v1",
      status: "applied",
      rollbackable: true,
      rollbackLabel: "Undo Seed",
      appliedAt: now,
      result: { touched: 1 }
    });
  });

  it("projects pending and failed entries with operator timestamps and errors", () => {
    expect(dataPatchDashboardEntry(patch(), recorded("pending"))).toEqual({
      id: "core.seed",
      checksum: "v1",
      status: "pending",
      claimedAt: now
    });
    expect(dataPatchDashboardEntry(patch(), recorded("failed"))).toEqual({
      id: "core.seed",
      checksum: "v1",
      status: "failed",
      failedAt: now,
      error: "boom"
    });
  });

  it("projects rollback journal states without losing apply results", () => {
    expect(dataPatchDashboardEntry(patch(), recorded("rollback_pending", { applied: true }))).toEqual({
      id: "core.seed",
      checksum: "v1",
      status: "rollback_pending",
      appliedAt: now,
      result: { applied: true },
      rollbackClaimedAt: now
    });
    expect(dataPatchDashboardEntry(patch(), recorded("rolled_back", { applied: true }, { undone: true }))).toEqual({
      id: "core.seed",
      checksum: "v1",
      status: "rolled_back",
      appliedAt: now,
      result: { applied: true },
      rolledBackAt: now,
      rollbackResult: { undone: true }
    });
    expect(dataPatchDashboardEntry(patch(), recorded("rollback_failed", { applied: true }))).toEqual({
      id: "core.seed",
      checksum: "v1",
      status: "rollback_failed",
      appliedAt: now,
      result: { applied: true },
      rollbackFailedAt: now,
      rollbackError: "rollback boom"
    });
  });

  it("totals dashboard entries and rejects checksum drift", () => {
    const entries: readonly DataPatchDashboardEntry[] = [
      { id: "a", checksum: "v1", status: "not_applied" },
      { id: "b", checksum: "v1", status: "pending" },
      { id: "c", checksum: "v1", status: "applied" },
      { id: "d", checksum: "v1", status: "failed" },
      { id: "e", checksum: "v1", status: "rollback_pending" },
      { id: "f", checksum: "v1", status: "rolled_back" },
      { id: "g", checksum: "v1", status: "rollback_failed" }
    ];

    expect(dataPatchDashboardTotals(entries)).toEqual({
      total: 7,
      notApplied: 1,
      pending: 1,
      applied: 1,
      failed: 1,
      rollbackPending: 1,
      rolledBack: 1,
      rollbackFailed: 1
    });
    expect(() => dataPatchDashboardEntry(patch({ checksum: "v2" }), recorded("applied"))).toThrow(
      "Recorded data patch 'core.seed' has checksum 'v1' but planned 'v2'"
    );
  });
});

function patch(options: { readonly checksum?: string; readonly label?: string; readonly rollbackLabel?: string } = {}) {
  return defineDataPatch({
    id: "core.seed",
    ...(options.label === undefined ? {} : { label: options.label }),
    checksum: options.checksum ?? "v1",
    run: () => undefined,
    ...(options.rollbackLabel === undefined ? {} : { rollback: { label: options.rollbackLabel, run: () => undefined } })
  });
}

function recorded(
  status: RecordedDataPatch["status"],
  result?: JsonValue,
  rollbackResult?: JsonValue
): RecordedDataPatch {
  switch (status) {
    case "pending":
      return { id: "core.seed", checksum: "v1", status, claimedAt: now };
    case "applied":
      return { id: "core.seed", checksum: "v1", status, appliedAt: now, ...(result === undefined ? {} : { result }) };
    case "failed":
      return { id: "core.seed", checksum: "v1", status, failedAt: now, error: "boom" };
    case "rollback_pending":
      return {
        id: "core.seed",
        checksum: "v1",
        status,
        appliedAt: now,
        ...(result === undefined ? {} : { result }),
        rollbackClaimedAt: now
      };
    case "rolled_back":
      return {
        id: "core.seed",
        checksum: "v1",
        status,
        appliedAt: now,
        ...(result === undefined ? {} : { result }),
        rolledBackAt: now,
        ...(rollbackResult === undefined ? {} : { rollbackResult })
      };
    case "rollback_failed":
      return {
        id: "core.seed",
        checksum: "v1",
        status,
        appliedAt: now,
        ...(result === undefined ? {} : { result }),
        rollbackFailedAt: now,
        rollbackError: "rollback boom"
      };
  }
}
