import { CHILD_TABLE_ROW_INDEX_FIELD, defineDocType } from "../../src";
import type { DocumentSnapshot } from "../../src";
import {
  allowOnSubmitIssues,
  childTableOriginIssues,
  copyDocumentData,
  documentUnsetIssues,
  preserveReadOnlyTableValues,
  readonlyIssues,
  stripInternalTableFields
} from "../../src/application/document-field-policy";

const InvoiceItem = defineDocType({
  name: "Invoice Item",
  fields: [
    { name: "sku", type: "text", required: true },
    { name: "line_id", type: "text", readOnly: true },
    { name: "internal_note", type: "text", noCopy: true },
    { name: "approval_note", type: "text", readOnlyDependsOn: { field: "sku", value: "LOCKED" } }
  ]
});

const Invoice = defineDocType({
  name: "Invoice",
  fields: [
    { name: "title", type: "text", required: true },
    { name: "status", type: "select", options: ["Draft", "Approved"] },
    { name: "approval_note", type: "text", readOnlyDependsOn: { field: "status", value: "Approved" } },
    { name: "revision_note", type: "text", allowOnSubmit: true },
    { name: "token", type: "text", noCopy: true },
    { name: "items", type: "table", tableOf: "Invoice Item" }
  ]
});

const relatedDocType = (name: string) => name === InvoiceItem.name ? InvoiceItem : undefined;

describe("document field policy", () => {
  it("reports conditional readonly issues for patched, unset, and child table fields", () => {
    expect(
      readonlyIssues(
        Invoice,
        {
          status: "Approved",
          approval_note: "locked",
          items: [{ sku: "LOCKED", approval_note: "child locked" }]
        },
        relatedDocType,
        {
          status: "Approved",
          approval_note: "locked",
          items: [{ sku: "LOCKED", approval_note: "child locked" }]
        },
        ["approval_note"]
      )
    ).toEqual([
      expect.objectContaining({ field: "approval_note", code: "readonly" }),
      expect.objectContaining({ field: "items[0].approval_note", code: "readonly" })
    ]);
  });

  it("keeps submit-time mutation policy separate from generic unset safety", () => {
    expect(allowOnSubmitIssues(Invoice, { title: "Renamed", revision_note: "ok" }, ["status"])).toEqual([
      expect.objectContaining({ field: "title", code: "allow_on_submit" }),
      expect.objectContaining({ field: "status", code: "allow_on_submit" })
    ]);

    expect(documentUnsetIssues(Invoice, ["title", "missing"], { title: "A" }, { title: "B" })).toEqual([
      expect.objectContaining({ field: "title", code: "unset_patch_conflict" }),
      expect.objectContaining({ field: "title", code: "required" }),
      expect.objectContaining({ field: "missing", code: "unknown_field" })
    ]);
  });

  it("validates child row origins without accepting ambiguous indexes", () => {
    const existing = { items: [{ sku: "A" }, { sku: "B" }] };

    expect(
      childTableOriginIssues(
        Invoice,
        { items: [{ [CHILD_TABLE_ROW_INDEX_FIELD]: "-1", sku: "A" }] },
        existing,
        relatedDocType
      )
    ).toEqual([
      expect.objectContaining({ field: `items[0].${CHILD_TABLE_ROW_INDEX_FIELD}`, code: "child_row_origin" })
    ]);

    expect(
      childTableOriginIssues(
        Invoice,
        { items: [{ [CHILD_TABLE_ROW_INDEX_FIELD]: " 1 ", sku: "B" }] },
        existing,
        relatedDocType
      )
    ).toEqual([
      expect.objectContaining({ field: `items[0].${CHILD_TABLE_ROW_INDEX_FIELD}`, code: "child_row_origin" })
    ]);
  });

  it("strips internal table origin fields before events leave the policy boundary", () => {
    expect(
      stripInternalTableFields(
        Invoice,
        { items: [{ [CHILD_TABLE_ROW_INDEX_FIELD]: "1", sku: "B" }] },
        relatedDocType
      )
    ).toEqual({ items: [{ sku: "B" }] });
  });

  it("preserves read-only child table values from their declared row origins", () => {
    const existing = snapshot({
      items: [
        { sku: "A", line_id: "line-a" },
        { sku: "B", line_id: "line-b" }
      ]
    });

    expect(
      preserveReadOnlyTableValues(
        Invoice,
        { items: [{ [CHILD_TABLE_ROW_INDEX_FIELD]: "1", sku: "B2" }] },
        existing,
        relatedDocType
      )
    ).toEqual({ items: [{ sku: "B2", line_id: "line-b" }] });
  });

  it("copies documents without read-only, no-copy, or internal table fields", () => {
    expect(
      copyDocumentData(
        Invoice,
        {
          title: "INV-1",
          token: "secret",
          items: [{ [CHILD_TABLE_ROW_INDEX_FIELD]: "0", sku: "A", line_id: "line-a", internal_note: "skip" }]
        },
        relatedDocType,
        { skipNoCopy: true }
      )
    ).toEqual({ title: "INV-1", items: [{ sku: "A" }] });
  });
});

function snapshot(data: DocumentSnapshot["data"]): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: Invoice.name,
    name: "INV-1",
    version: 1,
    docstatus: "draft",
    data,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}
