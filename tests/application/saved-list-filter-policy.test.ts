import {
  findSavedListFilter,
  planSavedListFilterLookup,
  planSavedListFilterReadAccess,
  planSavedListFilterDelete,
  planSavedListFilterSave,
  projectSavedListFilterSave
} from "../../src/application/saved-list-filter-policy.js";
import type { SavedListFilter } from "../../src/application/saved-list-filter-events.js";
import { defineDocType } from "../../src";
import { guest, owner } from "../helpers";

describe("saved list filter policy", () => {
  it("plans saved-filter DocType read access before service stream reads", () => {
    const doctype = defineDocType({
      name: "Private Note",
      fields: [{ name: "title", type: "text", required: true }],
      permissions: [{ roles: ["User"], actions: ["read"] }]
    });

    expect(planSavedListFilterReadAccess({ actor: owner, doctype })).toEqual({ status: "allow" });
    expect(planSavedListFilterReadAccess({ actor: guest, doctype })).toEqual({
      status: "deny",
      message: "Actor 'guest' cannot read Private Note"
    });
  });

  it("finds filters and plans save targets without service I/O", () => {
    const existing = filter("filter-1");

    expect(findSavedListFilter([existing], "filter-1")).toBe(existing);
    expect(findSavedListFilter([existing], "missing")).toBeUndefined();
    expect(planSavedListFilterSave(undefined, undefined)).toEqual({ status: "write" });
    expect(planSavedListFilterSave(existing, "filter-1")).toEqual({ status: "write" });
    expect(planSavedListFilterSave(undefined, "missing")).toEqual({
      status: "missing",
      message: "Saved filter 'missing' was not found"
    });
  });

  it("plans saved-filter get lookups before service error mapping", () => {
    const existing = filter("filter-1");

    expect(planSavedListFilterLookup(existing, "filter-1")).toEqual({
      status: "found",
      filter: existing
    });
    expect(planSavedListFilterLookup(undefined, "missing")).toEqual({
      status: "missing",
      message: "Saved filter 'missing' was not found"
    });
  });

  it("plans delete targets without letting missing filters reach append", () => {
    expect(planSavedListFilterDelete(filter("filter-1"), "filter-1")).toEqual({ status: "write" });
    expect(planSavedListFilterDelete(undefined, "missing")).toEqual({
      status: "missing",
      message: "Saved filter 'missing' was not found"
    });
  });

  it("projects saved filter writes while preserving created timestamps on updates", () => {
    const existing = filter("filter-1");
    const now = "2026-01-02T00:00:00.000Z";

    expect(projectSavedListFilterSave({
      tenantId: "acme",
      doctype: "Note",
      id: "filter-1",
      label: "Updated",
      ownerId: owner.id,
      filters: [{ field: "workflow_state", value: "Closed" }],
      filterExpression: { field: "priority", value: "High" },
      existing,
      now
    })).toMatchObject({
      id: "filter-1",
      label: "Updated",
      filterExpression: { field: "priority", value: "High" },
      createdAt: existing.createdAt,
      updatedAt: now
    });

    expect(projectSavedListFilterSave({
      tenantId: "acme",
      doctype: "Note",
      id: "filter-2",
      label: "Fresh",
      ownerId: owner.id,
      filters: [{ field: "priority", value: "Low" }],
      now
    })).toEqual({
      tenantId: "acme",
      doctype: "Note",
      id: "filter-2",
      label: "Fresh",
      ownerId: owner.id,
      filters: [{ field: "priority", value: "Low" }],
      createdAt: now,
      updatedAt: now
    });
  });
});

function filter(id: string): SavedListFilter {
  return {
    tenantId: "acme",
    doctype: "Note",
    id,
    label: "Open notes",
    ownerId: owner.id,
    filters: [{ field: "workflow_state", value: "Open" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}
