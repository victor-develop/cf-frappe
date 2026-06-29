import {
  assertDataPatchApplyLimit,
  normalizeDataPatchDefinitions,
  normalizeSingleDataPatchDefinition,
  selectDataPatch,
  selectDataPatches,
  snapshotDataPatchDefinitions,
  snapshotUniqueDataPatchDefinitions
} from "../../src/application/data-patch-definition-policy.js";

describe("data patch definition policy", () => {
  it("snapshots patch definitions by value and freezes the registry list", () => {
    const patch = { id: "core.seed", checksum: "v1", run: () => undefined };
    const snapshot = snapshotDataPatchDefinitions([patch]);

    patch.id = "core.mutated";

    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({ id: "core.seed", checksum: "v1" });
  });

  it("normalizes unique definitions and rejects duplicate ids with the shared operator error", () => {
    expect(snapshotUniqueDataPatchDefinitions([patch("core.first"), patch("crm.second")]).map((entry) => entry.id)).toEqual([
      "core.first",
      "crm.second"
    ]);
    expect(() => normalizeDataPatchDefinitions([patch("core.first"), patch("core.first")])).toThrow(
      "Data patch 'core.first' is defined more than once"
    );
  });

  it("selects requested patches in registry order and reports invalid or unknown ids", () => {
    const patches = [patch("core.first"), patch("crm.second"), patch("crm.third")];

    expect(selectDataPatches(patches, undefined)).toBe(patches);
    expect(selectDataPatches(patches, ["crm.third", "crm.second"]).map((entry) => entry.id)).toEqual([
      "crm.second",
      "crm.third"
    ]);
    expect(selectDataPatch(patches, "crm.second").id).toBe("crm.second");
    expect(() => selectDataPatches(patches, [])).toThrow("At least one data patch id is required");
    expect(() => selectDataPatches(patches, [""])).toThrow("Invalid data patch id ''");
    expect(() => selectDataPatch(patches, "crm.missing")).toThrow("Data patch 'crm.missing' is not registered");
  });

  it("normalizes a single patch and guards batch limits", () => {
    const mutable = { id: "core.once", checksum: "v1", run: () => undefined };
    const normalized = normalizeSingleDataPatchDefinition(mutable);

    mutable.id = "core.changed";

    expect(normalized.id).toBe("core.once");
    expect(() => assertDataPatchApplyLimit(undefined)).not.toThrow();
    expect(() => assertDataPatchApplyLimit(1)).not.toThrow();
    expect(() => assertDataPatchApplyLimit(0)).toThrow("Data patch apply limit must be a positive integer");
    expect(() => assertDataPatchApplyLimit(1.5)).toThrow("Data patch apply limit must be a positive integer");
  });
});

function patch(id: string) {
  return { id, checksum: "v1", run: () => undefined };
}
