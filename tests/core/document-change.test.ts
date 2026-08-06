import { describe, expect, it } from "vitest";
import { documentChangeContext } from "../../src/core/document-change.js";
import type { DocumentSnapshot } from "../../src/core/types.js";

describe("document change context", () => {
  it("distinguishes touched fields from semantic changes", () => {
    const before = snapshot({ status: "Open", title: "Ship" }, 1);
    const after = snapshot({ status: "Open", title: "Ship now" }, 2);

    expect(documentChangeContext(before, after, ["status", "title"])).toEqual({
      before,
      after,
      touchedFields: ["status", "title"],
      changedFields: ["title"],
      changes: {
        title: { before: "Ship", after: "Ship now" }
      }
    });
  });

  it("records unset, create, and delete changes", () => {
    const before = snapshot({ status: "Open", note: "remove" }, 1);
    const after = snapshot({ status: "Open" }, 2);
    expect(documentChangeContext(before, after, ["note"])).toMatchObject({
      touchedFields: ["note"],
      changedFields: ["note"],
      changes: { note: { before: "remove", after: undefined } }
    });

    expect(documentChangeContext(null, after)).toMatchObject({
      touchedFields: ["status"],
      changedFields: ["status"],
      changes: { status: { before: undefined, after: "Open" } }
    });

    expect(documentChangeContext(before, null)).toMatchObject({
      touchedFields: ["note", "status"],
      changedFields: ["note", "status"]
    });
  });

  it("compares nested JSON values structurally", () => {
    const before = snapshot({ payload: { a: 1, nested: [true, "x"] } }, 1);
    const after = snapshot({ payload: { nested: [true, "x"], a: 1 } }, 2);
    expect(documentChangeContext(before, after, ["payload"]).changedFields).toEqual([]);
  });
});

function snapshot(data: Record<string, any>, version: number): DocumentSnapshot {
  return {
    tenantId: "default",
    doctype: "Task",
    name: "TASK-1",
    version,
    docstatus: "draft",
    data,
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z"
  };
}
