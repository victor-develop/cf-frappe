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
});
