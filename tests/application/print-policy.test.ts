import {
  canAccessPrintFormat,
  isPrintEmptyValue,
  printDocumentSections,
  printHiddenFields,
  printSectionView
} from "../../src/application/print-policy.js";
import { defineDocType, definePrintFormat, definePrintLetterhead } from "../../src";
import type { Actor, DocumentSnapshot } from "../../src/core/types.js";

const actor: Actor = { id: "owner@example.com", roles: ["User"], tenantId: "acme" };
const guest: Actor = { id: "guest@example.com", roles: ["Guest"], tenantId: "acme" };
const doctype = defineDocType({
  name: "Printable",
  fields: [
    { name: "title", type: "text", required: true },
    { name: "internal_note", type: "longText", printHide: true },
    { name: "optional_note", type: "text", printHideIfNoValue: true },
    { name: "count", type: "integer", printHideIfNoValue: true }
  ],
  permissions: [{ roles: ["User"], actions: ["read"] }]
});

describe("print policy", () => {
  it("plans hidden print fields from DocType metadata and document values", () => {
    expect([...printHiddenFields(doctype, snapshot({ title: "Memo", internal_note: "secret", optional_note: "", count: 0 }))])
      .toEqual(["internal_note", "optional_note"]);
    expect([...printHiddenFields(doctype, snapshot({ title: "Memo", optional_note: "visible", count: 0 }))])
      .toEqual(["internal_note"]);
  });

  it("classifies print-empty values without hiding falsy business values", () => {
    expect(isPrintEmptyValue(null)).toBe(true);
    expect(isPrintEmptyValue("")).toBe(true);
    expect(isPrintEmptyValue([])).toBe(true);
    expect(isPrintEmptyValue(0)).toBe(false);
    expect(isPrintEmptyValue(false)).toBe(false);
  });

  it("projects print section fields while omitting hidden fields and defaulting missing data to null", () => {
    expect(
      printSectionView(
        {
          heading: "Summary",
          fields: [
            { field: "title", label: "Title" },
            { field: "missing", label: "Missing" },
            { field: "internal_note", label: "Internal Note" }
          ]
        },
        snapshot({ title: "Memo", internal_note: "secret" }),
        new Set(["internal_note"])
      )
    ).toEqual({
      heading: "Summary",
      fields: [
        { field: "title", label: "Title", value: "Memo" },
        { field: "missing", label: "Missing", value: null }
      ]
    });
  });

  it("drops empty print sections after hidden-field projection", () => {
    expect(
      printDocumentSections(
        [
          { heading: "Hidden", fields: [{ field: "internal_note", label: "Internal Note" }] },
          { heading: "Visible", fields: [{ field: "title", label: "Title" }] }
        ],
        snapshot({ title: "Memo", internal_note: "secret" }),
        new Set(["internal_note"])
      )
    ).toEqual([{ heading: "Visible", fields: [{ field: "title", label: "Title", value: "Memo" }] }]);
  });

  it("combines print-format roles, DocType permissions, and referenced letterhead access", () => {
    const format = definePrintFormat({
      name: "Printable Standard",
      doctype: "Printable",
      letterhead: "Company",
      sections: [{ fields: [{ field: "title" }] }],
      roles: ["User"]
    });
    const letterhead = definePrintLetterhead({ name: "Company", headerHtml: "<strong>ACME</strong>", roles: ["User"] });
    const restrictedLetterhead = definePrintLetterhead({
      name: "Company",
      headerHtml: "<strong>ACME</strong>",
      roles: ["System Manager"]
    });

    expect(canAccessPrintFormat({ actor, format, doctype, letterhead })).toBe(true);
    expect(canAccessPrintFormat({ actor: guest, format, doctype, letterhead })).toBe(false);
    expect(canAccessPrintFormat({ actor, format, doctype, letterhead: restrictedLetterhead })).toBe(false);
    expect(canAccessPrintFormat({ actor, format, doctype })).toBe(false);
  });
});

function snapshot(data: Record<string, unknown>): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Printable",
    name: "Memo",
    version: 1,
    data,
    docstatus: "draft",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ownerId: actor.id
  } as DocumentSnapshot;
}
