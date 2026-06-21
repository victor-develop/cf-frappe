import { applyDefaults, defineDocType, FrameworkError, validateDocumentData } from "../../src";
import { owner } from "../helpers";

describe("schema", () => {
  const doctype = defineDocType({
    name: "Invoice",
    fields: [
      { name: "customer", type: "text", required: true },
      { name: "amount", type: "number", min: 0 },
      { name: "paid", type: "boolean", defaultValue: false },
      { name: "status", type: "select", options: ["Draft", "Paid"], defaultValue: "Draft" }
    ]
  });

  it("applies scalar defaults without mutating input", () => {
    const input = { customer: "Ada" };
    const result = applyDefaults(doctype, input, { actor: owner, now: "2026-01-01T00:00:00.000Z" });

    expect(result).toEqual({ customer: "Ada", paid: false, status: "Draft" });
    expect(input).toEqual({ customer: "Ada" });
  });

  it("reports missing required fields", () => {
    expect(validateDocumentData(doctype, {})).toMatchObject([
      { field: "customer", code: "required" }
    ]);
  });

  it("reports type violations", () => {
    const issues = validateDocumentData(doctype, { customer: "Ada", amount: "lots", paid: "yes" });

    expect(issues.map((issue) => issue.field)).toEqual(["amount", "paid"]);
  });

  it("reports select values outside declared options", () => {
    expect(validateDocumentData(doctype, { customer: "Ada", status: "Void" })).toMatchObject([
      { field: "status", code: "option" }
    ]);
  });

  it("rejects unknown fields by default", () => {
    expect(validateDocumentData(doctype, { customer: "Ada", mystery: true })).toMatchObject([
      { field: "mystery", code: "unknown_field" }
    ]);
  });

  it("allows unknown fields when the doctype opts in", () => {
    const loose = defineDocType({
      name: "Loose",
      allowUnknownFields: true,
      fields: [{ name: "title", type: "text" }]
    });

    expect(validateDocumentData(loose, { title: "ok", extra: true })).toEqual([]);
  });

  it("rejects duplicate fields early", () => {
    expect(() =>
      defineDocType({
        name: "Bad",
        fields: [
          { name: "title", type: "text" },
          { name: "title", type: "text" }
        ]
      })
    ).toThrow("Duplicate field");
  });

  it("requires naming series metadata to include a placeholder", () => {
    expect(() =>
      defineDocType({
        name: "Ticket",
        naming: { kind: "series", pattern: "TICKET" },
        fields: [{ name: "title", type: "text" }]
      })
    ).toThrow(FrameworkError);
  });

  it("requires link fields to declare their target DocType", () => {
    expect(() =>
      defineDocType({
        name: "Task",
        fields: [{ name: "project", type: "link" }]
      })
    ).toThrow(FrameworkError);
  });

  it("rejects link targets on non-link fields", () => {
    expect(() =>
      defineDocType({
        name: "Task",
        fields: [{ name: "project", type: "text", linkTo: "Project" }]
      })
    ).toThrow(FrameworkError);
  });

  it("requires table fields to declare their child DocType", () => {
    expect(() =>
      defineDocType({
        name: "Invoice",
        fields: [{ name: "items", type: "table" }]
      })
    ).toThrow(FrameworkError);
  });

  it("rejects table targets on non-table fields", () => {
    expect(() =>
      defineDocType({
        name: "Invoice",
        fields: [{ name: "items", type: "json", tableOf: "Invoice Item" }]
      })
    ).toThrow(FrameworkError);
  });

  it("validates table rows against child DocType metadata", () => {
    const InvoiceItem = defineDocType({
      name: "Invoice Item",
      fields: [
        { name: "item_code", type: "text", required: true },
        { name: "quantity", type: "integer", required: true, min: 1 }
      ]
    });
    const Invoice = defineDocType({
      name: "Sales Invoice",
      fields: [{ name: "items", type: "table", tableOf: "Invoice Item", required: true }]
    });

    const issues = validateDocumentData(
      Invoice,
      {
        items: [
          { item_code: "SKU-1", quantity: 2 },
          { item_code: "", quantity: 0 },
          "not a row"
        ]
      },
      {
        relatedDocType: (name) => (name === "Invoice Item" ? InvoiceItem : undefined)
      }
    );

    expect(issues).toMatchObject([
      { field: "items[1].item_code", code: "required" },
      { field: "items[1].quantity", code: "min" },
      { field: "items[2]", code: "type" }
    ]);
  });

  it("treats an empty required table as missing", () => {
    const Invoice = defineDocType({
      name: "Sales Invoice",
      fields: [{ name: "items", type: "table", tableOf: "Invoice Item", required: true }]
    });

    expect(validateDocumentData(Invoice, { items: [] })).toMatchObject([
      { field: "items", code: "required" }
    ]);
  });

  it("rejects explicitly empty required fields during partial validation", () => {
    const Invoice = defineDocType({
      name: "Sales Invoice",
      fields: [{ name: "items", type: "table", tableOf: "Invoice Item", required: true }]
    });

    expect(validateDocumentData(Invoice, { items: [] }, { partial: true })).toMatchObject([
      { field: "items", code: "required" }
    ]);
  });
});
