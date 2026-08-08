import {
  cloneMergeValue,
  documentMergePlan,
  mergeJsonEqual
} from "../../src/adapters/desk/client-src/merge";

describe("client-src merge planning", () => {
  it("returns a clean plan when nothing changed", () => {
    const base = { version: 3, data: { title: "A", qty: 1 } };
    const plan = documentMergePlan(base, base, { title: "A", qty: 1 });
    expect(plan.status).toBe("clean");
    expect(plan.baseVersion).toBe(3);
    expect(plan.remoteVersion).toBe(3);
    expect(plan.localChangedFields).toEqual([]);
    expect(plan.remoteChangedFields).toEqual([]);
    expect(plan.mergedFields).toEqual([]);
    expect(plan.patch).toEqual({});
    expect(plan.unset).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it("collects local changes into the patch", () => {
    const base = { version: 1, data: { title: "A", qty: 1 } };
    const plan = documentMergePlan(base, base, { title: "B", qty: 1 });
    expect(plan.status).toBe("clean");
    expect(plan.localChangedFields).toEqual(["title"]);
    expect(plan.mergedFields).toEqual(["title"]);
    expect(plan.patch).toEqual({ title: "B" });
  });

  it("treats a locally removed field (undefined) as an unset", () => {
    const base = { version: 1, data: { title: "A", qty: 1 } };
    const plan = documentMergePlan(base, base, { title: "A", qty: undefined });
    expect(plan.unset).toEqual(["qty"]);
    expect(plan.mergedFields).toEqual(["qty"]);
    expect(plan.patch).toEqual({});
  });

  it("treats a field missing from the draft as changed when the base has it", () => {
    const base = { version: 1, data: { title: "A", qty: 1 } };
    const plan = documentMergePlan(base, base, { title: "A" }, { fields: ["title", "qty"] });
    expect(plan.localChangedFields).toEqual(["qty"]);
    expect(plan.unset).toEqual(["qty"]);
  });

  it("flags remote-vs-local conflicts with values", () => {
    const plan = documentMergePlan(
      { version: 1, data: { title: "A" } },
      { version: 2, data: { title: "R" } },
      { title: "L" }
    );
    expect(plan.status).toBe("conflict");
    expect(plan.remoteVersion).toBe(2);
    expect(plan.localChangedFields).toEqual(["title"]);
    expect(plan.remoteChangedFields).toEqual(["title"]);
    expect(plan.conflicts).toEqual([
      {
        field: "title",
        reason: "remote_changed",
        basePresent: true,
        localPresent: true,
        remotePresent: true,
        baseValue: "A",
        localValue: "L",
        remoteValue: "R"
      }
    ]);
    expect(plan.patch).toEqual({});
  });

  it("omits undefined conflict values", () => {
    const plan = documentMergePlan(
      { version: 1, data: {} },
      { version: 2, data: { title: "R" } },
      { title: "L" },
      { fields: ["title"] }
    );
    const conflict = plan.conflicts[0]!;
    expect(conflict.basePresent).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(conflict, "baseValue")).toBe(false);
    expect(conflict.localValue).toBe("L");
    expect(conflict.remoteValue).toBe("R");
  });

  it("merges cleanly when local and remote made the same change", () => {
    const plan = documentMergePlan(
      { version: 1, data: { title: "A" } },
      { version: 2, data: { title: "B" } },
      { title: "B" }
    );
    expect(plan.status).toBe("clean");
    expect(plan.mergedFields).toEqual(["title"]);
    expect(plan.patch).toEqual({});
    expect(plan.unset).toEqual([]);
  });

  it("flags a docstatus conflict when the remote status moved", () => {
    const plan = documentMergePlan(
      { version: 1, docstatus: "draft", data: { title: "A" } },
      { version: 2, docstatus: "submitted", data: { title: "A" } },
      { title: "A" }
    );
    expect(plan.status).toBe("conflict");
    expect(plan.conflicts).toEqual([
      {
        field: "docstatus",
        reason: "remote_status_changed",
        basePresent: true,
        localPresent: true,
        remotePresent: true,
        baseValue: "draft",
        localValue: "draft",
        remoteValue: "submitted"
      }
    ]);
  });

  it("skips the docstatus check when either side lacks it", () => {
    const plan = documentMergePlan(
      { version: 1, data: { title: "A" } },
      { version: 2, docstatus: "submitted", data: { title: "A" } },
      { title: "A" }
    );
    expect(plan.conflicts).toEqual([]);
  });

  it("accepts snapshots without a data envelope and non-object inputs", () => {
    const plan = documentMergePlan({ title: "A" }, undefined, { title: "B" });
    expect(plan.baseVersion).toBe(0);
    expect(plan.remoteVersion).toBe(0);
    expect(plan.localChangedFields).toEqual(["title"]);
    // remote fell back to `{}`: base had `title`, remote does not.
    expect(plan.remoteChangedFields).toEqual(["title"]);
    expect(plan.status).toBe("conflict");
  });

  it("ignores non-finite versions and falls back", () => {
    const plan = documentMergePlan(
      { version: Number.NaN, data: { title: "A" } },
      { version: "7", data: { title: "A" } },
      { title: "A" }
    );
    expect(plan.baseVersion).toBe(0);
    expect(plan.remoteVersion).toBe(0);
  });

  it("uses the base version as the remote fallback", () => {
    const plan = documentMergePlan({ version: 5, data: {} }, { data: {} }, {});
    expect(plan.remoteVersion).toBe(5);
  });

  it("deduplicates, trims and drops empty explicit fields", () => {
    const plan = documentMergePlan(
      { version: 1, data: { title: "A" } },
      { version: 1, data: { title: "A" } },
      { title: "B" },
      { fields: ["  title  ", "title", "", null] }
    );
    expect(plan.localChangedFields).toEqual(["title"]);
    expect(plan.patch).toEqual({ title: "B" });
  });

  it("unions base/remote/draft keys when no field list is given", () => {
    const plan = documentMergePlan(
      { version: 1, data: { a: 1 } },
      { version: 1, data: { a: 1, b: 2 } },
      { a: 1, c: 3 }
    );
    expect(plan.remoteChangedFields).toEqual(["b"]);
    expect(plan.localChangedFields).toEqual(["c"]);
    expect(plan.patch).toEqual({ c: 3 });
  });

  it("compares deep values and clones the patch", () => {
    const draftRows = [{ qty: 1 }, { qty: 2 }];
    const plan = documentMergePlan(
      { version: 1, data: { rows: [{ qty: 1 }] } },
      { version: 1, data: { rows: [{ qty: 1 }] } },
      { rows: draftRows }
    );
    expect(plan.patch).toEqual({ rows: [{ qty: 1 }, { qty: 2 }] });
    expect(plan.patch.rows).not.toBe(draftRows);
    draftRows[1]!.qty = 99;
    expect(plan.patch).toEqual({ rows: [{ qty: 1 }, { qty: 2 }] });
  });

  describe("mergeJsonEqual", () => {
    it("compares primitives, arrays and objects structurally", () => {
      expect(mergeJsonEqual(1, 1)).toBe(true);
      expect(mergeJsonEqual(1, 2)).toBe(false);
      expect(mergeJsonEqual(undefined, 1)).toBe(false);
      expect(mergeJsonEqual(null, {})).toBe(false);
      expect(mergeJsonEqual([1, 2], [1, 2])).toBe(true);
      expect(mergeJsonEqual([1, 2], [1, 3])).toBe(false);
      expect(mergeJsonEqual([1], [1, 2])).toBe(false);
      expect(mergeJsonEqual([1], { 0: 1 })).toBe(false);
      expect(mergeJsonEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
      expect(mergeJsonEqual({ a: 1 }, { a: 2 })).toBe(false);
      expect(mergeJsonEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
      expect(mergeJsonEqual({ a: 1 }, { b: 1 })).toBe(false);
    });
  });

  describe("cloneMergeValue", () => {
    it("deep clones arrays and objects and passes primitives through", () => {
      expect(cloneMergeValue(5)).toBe(5);
      expect(cloneMergeValue(null)).toBeNull();
      const source = { rows: [{ qty: 1 }], meta: { tag: "x" } };
      const clone = cloneMergeValue(source) as typeof source;
      expect(clone).toEqual(source);
      expect(clone).not.toBe(source);
      expect(clone.rows).not.toBe(source.rows);
      expect(clone.rows[0]).not.toBe(source.rows[0]);
      expect(clone.meta).not.toBe(source.meta);
    });
  });
});
