import { defineDataPatch } from "../../src/core/data-patch.js";
import type { RecordedDataPatch } from "../../src/ports/data-patch-log.js";
import {
  assertSelectedDataPatchPredecessorsApplied,
  dataPatchApplyPlanSelection,
  dataPatchApplyRunSelection
} from "../../src/application/data-patch-apply-policy.js";
import { now } from "../helpers";

describe("data patch apply policy", () => {
  it("selects all requested patches for unbounded apply runs so the runner can record skips", () => {
    const selected = [patch("core.first"), patch("crm.second")];
    const pending = [selected[1]!];

    expect(dataPatchApplyRunSelection(selected, pending, undefined).map((planned) => planned.id)).toEqual([
      "core.first",
      "crm.second"
    ]);
  });

  it("selects bounded pending patches for apply runs and plans", () => {
    const pending = [patch("core.first"), patch("crm.second")];

    expect(
      dataPatchApplyRunSelection([patch("already.applied"), ...pending], pending, 1).map((planned) => planned.id)
    ).toEqual(["core.first"]);
    expect(dataPatchApplyPlanSelection(pending, 1).map((planned) => planned.id)).toEqual(["core.first"]);
    expect(dataPatchApplyPlanSelection(pending, undefined).map((planned) => planned.id)).toEqual([
      "core.first",
      "crm.second"
    ]);
  });

  it("allows selected patches when earlier registry entries are applied or selected together", () => {
    const first = patch("core.first");
    const second = patch("crm.second");
    const third = patch("crm.third");
    const patches = [first, second, third];
    const recordedById = new Map<string, RecordedDataPatch>([
      ["core.first", recorded("core.first", "applied")]
    ]);

    expect(() => assertSelectedDataPatchPredecessorsApplied(patches, [second], recordedById)).not.toThrow();
    expect(() => assertSelectedDataPatchPredecessorsApplied(patches, [first, second], new Map())).not.toThrow();
  });

  it("rejects selected patches behind missing or non-applied predecessors", () => {
    const first = patch("core.first");
    const second = patch("crm.second");
    const third = patch("crm.third");
    const patches = [first, second, third];

    expect(() => assertSelectedDataPatchPredecessorsApplied(patches, [second], new Map())).toThrow(
      "Data patch 'crm.second' cannot run before earlier patch 'core.first' is applied"
    );
    expect(() =>
      assertSelectedDataPatchPredecessorsApplied(
        patches,
        [third],
        new Map([
          ["core.first", recorded("core.first", "applied")],
          ["crm.second", recorded("crm.second", "failed")]
        ])
      )
    ).toThrow("Data patch 'crm.third' cannot run before earlier patch 'crm.second' is applied");
  });

  it("checks predecessor checksum drift before apply order succeeds", () => {
    const first = patch("core.first", "v2");
    const second = patch("crm.second");
    const patches = [first, second];

    expect(() =>
      assertSelectedDataPatchPredecessorsApplied(
        patches,
        [second],
        new Map([["core.first", recorded("core.first", "applied", "v1")]])
      )
    ).toThrow("Recorded data patch 'core.first' has checksum 'v1' but planned 'v2'");
  });
});

function patch(id: string, checksum = "v1") {
  return defineDataPatch({ id, checksum, run: () => undefined });
}

function recorded(id: string, status: RecordedDataPatch["status"], checksum = "v1"): RecordedDataPatch {
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
