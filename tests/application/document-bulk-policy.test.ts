import { describe, expect, it } from "vitest";

import {
  FrameworkError,
  bulkDeleteDocumentFailure,
  bulkDocumentFailure,
  bulkNamedCommand,
  normalizeBulkDeleteDocumentSelections,
  normalizeBulkDocumentSelections,
  runBulkDocumentSelections,
  type DocumentSnapshot
} from "../../src";

const snapshot: DocumentSnapshot = {
  tenantId: "acme",
  doctype: "Note",
  name: "NOTE-1",
  version: 2,
  docstatus: "draft",
  data: { title: "Hello" },
  createdAt: "2026-06-28T01:00:00.000Z",
  updatedAt: "2026-06-28T01:00:00.000Z"
};

describe("document bulk policy", () => {
  it("normalizes selected document names and preserves expected versions", () => {
    expect(
      normalizeBulkDocumentSelections([
        { name: "  NOTE-1  ", expectedVersion: 2 },
        { name: "NOTE-2" }
      ])
    ).toEqual([
      { name: "NOTE-1", expectedVersion: 2 },
      { name: "NOTE-2" }
    ]);
  });

  it("rejects empty, blank, duplicate, oversized, and non-integer selections", () => {
    expect(() => normalizeBulkDocumentSelections([])).toThrow("At least one document must be selected");
    expect(() => normalizeBulkDocumentSelections([{ name: "   " }])).toThrow("Document name is required");
    expect(() => normalizeBulkDocumentSelections([{ name: "NOTE-1" }, { name: " NOTE-1 " }])).toThrow(
      "Duplicate document selection 'NOTE-1'"
    );
    expect(() =>
      normalizeBulkDocumentSelections(Array.from({ length: 101 }, (_, index) => ({ name: `NOTE-${String(index)}` })))
    ).toThrow("At most 100 documents can be selected");
    expect(() => normalizeBulkDocumentSelections([{ name: "NOTE-1", expectedVersion: 1.5 }])).toThrow(
      "expectedVersion must be an integer"
    );
  });

  it("normalizes bulk-delete selections through the same policy", () => {
    expect(normalizeBulkDeleteDocumentSelections([{ name: " NOTE-1 " }])).toEqual([{ name: "NOTE-1" }]);
  });

  it("maps framework errors to per-document bulk failures", () => {
    expect(
      bulkDocumentFailure(
        "NOTE-1",
        new FrameworkError("DOCUMENT_CONFLICT", "Expected version 2, found 3", { status: 409 })
      )
    ).toEqual({
      name: "NOTE-1",
      code: "DOCUMENT_CONFLICT",
      message: "Expected version 2, found 3",
      status: 409
    });
  });

  it("maps unknown errors to bounded bulk failures", () => {
    expect(bulkDeleteDocumentFailure("NOTE-1", new Error("boom"))).toEqual({
      name: "NOTE-1",
      code: "UNKNOWN",
      message: "boom",
      status: 500
    });
    expect(bulkDocumentFailure("NOTE-2", "boom")).toEqual({
      name: "NOTE-2",
      code: "UNKNOWN",
      message: "Bulk delete failed",
      status: 500
    });
  });

  it("runs normalized bulk selections into ordered success and failure groups", async () => {
    await expect(runBulkDocumentSelections(
      {
        actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" },
        doctype: "Note",
        documents: [{ name: " NOTE-1 " }, { name: "NOTE-2", expectedVersion: 3 }]
      },
      async (selection) => selection.name === "NOTE-1"
        ? { ok: true, snapshot }
        : {
            ok: false,
            failure: {
              name: selection.name,
              code: "DOCUMENT_CONFLICT",
              message: `Cannot update ${selection.name}`,
              status: 409
            }
          }
    )).resolves.toEqual({
      succeeded: [{ name: "NOTE-1", snapshot }],
      failed: [{
        name: "NOTE-2",
        code: "DOCUMENT_CONFLICT",
        message: "Cannot update NOTE-2",
        status: 409
      }]
    });
  });

  it("shapes normalized bulk selections into single-document commands", () => {
    expect(
      bulkNamedCommand(
        {
          actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" },
          doctype: "Note",
          tenantId: "tenant_b",
          documents: [],
          metadata: { source: "bulk-action" }
        },
        { name: "NOTE-1", expectedVersion: 3 }
      )
    ).toEqual({
      actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" },
      doctype: "Note",
      name: "NOTE-1",
      tenantId: "tenant_b",
      expectedVersion: 3,
      metadata: { source: "bulk-action" }
    });
  });
});
