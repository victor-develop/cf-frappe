import {
  ensureSavedReportServiceAvailable,
  findSavedReport,
  planSavedReportLookup,
  planSavedReportReadAccess,
  planSavedReportDelete,
  planSavedReportSave,
  projectSavedReportSave
} from "../../src/application/saved-report-policy.js";
import type { SavedReport } from "../../src/application/saved-report-events.js";
import { defineDocType } from "../../src";
import { guest, owner } from "../helpers";

describe("saved report policy", () => {
  it("guards saved-report service availability before Desk report-builder routes", () => {
    expect(() => ensureSavedReportServiceAvailable({ list: async () => [] })).not.toThrow();

    let error: unknown;
    try {
      ensureSavedReportServiceAvailable(undefined);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: "REPORT_NOT_FOUND",
      message: "Saved reports are not enabled",
      status: 404
    });
  });

  it("plans saved-report DocType read access before service stream reads", () => {
    const doctype = defineDocType({
      name: "Private Report Source",
      fields: [{ name: "title", type: "text", required: true }],
      permissions: [{ roles: ["User"], actions: ["read"] }]
    });

    expect(planSavedReportReadAccess({ actor: owner, doctype })).toEqual({ status: "allow" });
    expect(planSavedReportReadAccess({ actor: guest, doctype })).toEqual({
      status: "deny",
      message: "Actor 'guest' cannot read Private Report Source"
    });
  });

  it("finds reports and plans save targets without service I/O", () => {
    const existing = report("report-1");

    expect(findSavedReport([existing], "report-1")).toBe(existing);
    expect(findSavedReport([existing], "missing")).toBeUndefined();
    expect(planSavedReportSave(undefined, undefined)).toEqual({ status: "write" });
    expect(planSavedReportSave(existing, "report-1")).toEqual({ status: "write" });
    expect(planSavedReportSave(undefined, "missing")).toEqual({
      status: "missing",
      message: "Saved report 'missing' was not found"
    });
  });

  it("plans saved-report get lookups before service error mapping", () => {
    const existing = report("report-1");

    expect(planSavedReportLookup(existing, "report-1")).toEqual({
      status: "found",
      report: existing
    });
    expect(planSavedReportLookup(undefined, "missing")).toEqual({
      status: "missing",
      message: "Saved report 'missing' was not found"
    });
  });

  it("plans delete targets without letting missing reports reach append", () => {
    expect(planSavedReportDelete(report("report-1"), "report-1")).toEqual({ status: "write" });
    expect(planSavedReportDelete(undefined, "missing")).toEqual({
      status: "missing",
      message: "Saved report 'missing' was not found"
    });
  });

  it("projects saved report writes while preserving created timestamps on updates", () => {
    const existing = report("report-1");
    const now = "2026-01-02T00:00:00.000Z";

    expect(projectSavedReportSave({
      tenantId: "acme",
      doctype: "Note",
      id: "report-1",
      label: "Updated",
      ownerId: owner.id,
      definition: { columns: [{ name: "priority" }] },
      existing,
      now
    })).toMatchObject({
      id: "report-1",
      label: "Updated",
      createdAt: existing.createdAt,
      updatedAt: now
    });

    expect(projectSavedReportSave({
      tenantId: "acme",
      doctype: "Note",
      id: "report-2",
      label: "Fresh",
      ownerId: owner.id,
      definition: { columns: [{ name: "title" }] },
      now
    })).toMatchObject({
      id: "report-2",
      createdAt: now,
      updatedAt: now
    });
  });
});

function report(id: string): SavedReport {
  return {
    tenantId: "acme",
    doctype: "Note",
    id,
    label: "Open notes",
    ownerId: owner.id,
    definition: { columns: [{ name: "title" }] },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}
