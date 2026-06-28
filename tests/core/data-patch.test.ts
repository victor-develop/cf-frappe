import { defineDataPatch, FrameworkError } from "../../src";

describe("data patch metadata", () => {
  it("snapshots rollback metadata by value", async () => {
    const rollback = {
      label: "Undo seed notes",
      run: () => "original rollback"
    };
    const patch = defineDataPatch({
      id: "notes.seed",
      checksum: "v1",
      run: () => "apply",
      rollback
    });

    rollback.label = "Mutated rollback";
    rollback.run = () => "mutated rollback";

    expect(patch.rollback?.label).toBe("Undo seed notes");
    expect(await patch.rollback?.run({ resources: {} })).toBe("original rollback");
    expect(Object.isFrozen(patch)).toBe(true);
    expect(Object.isFrozen(patch.rollback)).toBe(true);
  });

  it("rejects invalid data patch ids and checksums", () => {
    expect(() => defineDataPatch({ id: "Bad Patch", checksum: "v1", run: () => undefined })).toThrow(FrameworkError);
    expect(() => defineDataPatch({ id: "notes.empty", checksum: "", run: () => undefined })).toThrow(FrameworkError);
  });
});
