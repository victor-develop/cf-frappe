import { planDocumentFieldMerge, type DocumentMergeSnapshot } from "../../src";

describe("document field merge planning", () => {
  it("plans a clean patch when local and remote edits touch different fields", () => {
    const plan = planDocumentFieldMerge({
      base: snapshot(1, { title: "Queued", body: "Draft", priority: "Low" }),
      remote: snapshot(2, { title: "Queued", body: "Remote body", priority: "Low" }),
      draft: { title: "Local title", body: "Draft", priority: "Low" }
    });

    expect(plan).toEqual({
      status: "clean",
      baseVersion: 1,
      remoteVersion: 2,
      localChangedFields: ["title"],
      remoteChangedFields: ["body"],
      mergedFields: ["title"],
      patch: { title: "Local title" },
      unset: [],
      conflicts: []
    });
  });

  it("treats same-value concurrent edits as already merged", () => {
    const plan = planDocumentFieldMerge({
      base: snapshot(1, { title: "Queued", body: "Draft" }),
      remote: snapshot(2, { title: "Shared title", body: "Draft" }),
      draft: { title: "Shared title", body: "Draft" }
    });

    expect(plan).toMatchObject({
      status: "clean",
      localChangedFields: ["title"],
      remoteChangedFields: ["title"],
      mergedFields: ["title"],
      patch: {},
      unset: [],
      conflicts: []
    });
  });

  it("plans local field removals when the full draft omits a base field", () => {
    const plan = planDocumentFieldMerge({
      base: snapshot(1, { title: "Queued", body: "Draft", obsolete: "yes" }),
      remote: snapshot(2, { title: "Queued", body: "Remote body", obsolete: "yes" }),
      draft: { title: "Queued", body: "Draft" }
    });

    expect(plan).toMatchObject({
      status: "clean",
      localChangedFields: ["obsolete"],
      remoteChangedFields: ["body"],
      mergedFields: ["obsolete"],
      patch: {},
      unset: ["obsolete"],
      conflicts: []
    });
  });

  it("reports same-field conflicts while preserving independent unsets", () => {
    const plan = planDocumentFieldMerge({
      base: snapshot(1, { title: "Queued", body: "Draft", obsolete: "yes" }),
      remote: snapshot(3, { title: "Remote title", body: "Draft", obsolete: "yes" }),
      draft: { title: "Local title", body: "Local body", obsolete: undefined },
      fields: [" title ", "body", "obsolete", "body"]
    });

    expect(plan).toEqual({
      status: "conflict",
      baseVersion: 1,
      remoteVersion: 3,
      localChangedFields: ["title", "body", "obsolete"],
      remoteChangedFields: ["title"],
      mergedFields: ["body", "obsolete"],
      patch: { body: "Local body" },
      unset: ["obsolete"],
      conflicts: [
        {
          field: "title",
          reason: "remote_changed",
          basePresent: true,
          localPresent: true,
          remotePresent: true,
          baseValue: "Queued",
          localValue: "Local title",
          remoteValue: "Remote title"
        }
      ]
    });
  });

  it("treats remote document status changes as merge conflicts", () => {
    const plan = planDocumentFieldMerge({
      base: snapshot(1, { title: "Queued" }),
      remote: snapshot(2, { title: "Queued" }, "submitted"),
      draft: { title: "Local title" }
    });

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
});

function snapshot(
  version: number,
  data: DocumentMergeSnapshot["data"],
  docstatus: DocumentMergeSnapshot["docstatus"] = "draft"
): DocumentMergeSnapshot {
  return {
    version,
    docstatus,
    data
  };
}
