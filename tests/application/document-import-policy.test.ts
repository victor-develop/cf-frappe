import {
  assertImportRowLimit,
  canImportDocuments,
  defineDocType,
  documentImportFailure,
  documentImportRowInput,
  documentImportRowName,
  documentImportTemplate,
  FrameworkError,
  importableFields,
  normalizeImportMaxRows,
  requiredImportUpdateName,
  validateImportHeaders
} from "../../src";
import { owner } from "../helpers";

describe("document import policy", () => {
  const Importable = defineDocType({
    name: "Importable Thing",
    fields: [
      { name: "title", type: "text", required: true },
      { name: "count", type: "integer", defaultValue: 0 },
      { name: "price", type: "number" },
      { name: "active", type: "boolean" },
      { name: "payload", type: "json" },
      { name: "rows", type: "table", tableOf: "Importable Thing Row" },
      { name: "secret", type: "text", hidden: true },
      { name: "created_by", type: "text", readOnly: true },
      { name: "name", type: "text" },
      { name: "expectedVersion", type: "integer" }
    ],
    permissions: [
      { roles: ["User"], actions: ["read", "create"] },
      { roles: ["Manager"], actions: ["update"] }
    ]
  });

  it("selects writable non-reserved fields for imports", () => {
    expect(importableFields(Importable).map((field) => field.name)).toEqual([
      "title",
      "count",
      "price",
      "active",
      "payload",
      "rows"
    ]);
  });

  it("builds CSV templates from importable metadata defaults", () => {
    expect(documentImportTemplate(Importable)).toMatchObject({
      doctype: "Importable Thing",
      filename: "Importable-Thing-import-template.csv",
      contentType: "text/csv; charset=utf-8",
      body: "name,expectedVersion,title,count,price,active,payload,rows\n,,,0,,,,",
      fields: ["title", "count", "price", "active", "payload", "rows"]
    });
  });

  it("plans row inputs with typed CSV values and trimmed reserved columns", () => {
    const input = documentImportRowInput(
      ["name", "expectedVersion", "title", "count", "price", "active", "payload", "rows"],
      row(7, ["  Import Target  ", "2", "Updated", "3", "12.5", "yes", "{\"ok\":true}", "[{\"item\":\"A\"}]"]),
      Importable
    );

    expect(input).toEqual({
      name: "Import Target",
      expectedVersion: 2,
      data: {
        title: "Updated",
        count: 3,
        price: 12.5,
        active: true,
        payload: { ok: true },
        rows: [{ item: "A" }]
      }
    });
  });

  it("omits blank import values without deleting existing data", () => {
    const input = documentImportRowInput(
      ["name", "expectedVersion", "title", "count", "active"],
      row(3, ["", "", "Draft", "", "off"]),
      Importable
    );

    expect(input).toEqual({ data: { title: "Draft", active: false } });
    expect(documentImportRowName(["name", "title"], row(3, ["  Named Row  ", "Draft"]))).toBe("Named Row");
    expect(documentImportRowName(["title"], row(3, ["Draft"]))).toBeUndefined();
  });

  it("rejects invalid import row values with row-specific messages", () => {
    expect(() => documentImportRowInput(["count"], row(4, ["1.2"]), Importable)).toThrow(
      "CSV row 4 field 'count' must be an integer"
    );
    expect(() => documentImportRowInput(["price"], row(4, ["nope"]), Importable)).toThrow(
      "CSV row 4 field 'price' must be a number"
    );
    expect(() => documentImportRowInput(["active"], row(4, ["maybe"]), Importable)).toThrow(
      "CSV row 4 field 'active' must be a boolean"
    );
    expect(() => documentImportRowInput(["payload"], row(4, ["{bad"]), Importable)).toThrow(
      "CSV row 4 field 'payload' must be JSON"
    );
    expect(() => documentImportRowInput(["expectedVersion"], row(4, ["1.5"]), Importable)).toThrow(
      "CSV row 4 expectedVersion must be an integer"
    );
  });

  it("validates headers against metadata and importability", () => {
    expect(() => validateImportHeaders(Importable, ["title", "name", "expectedVersion"])).not.toThrow();
    expect(() => validateImportHeaders(Importable, ["missing"])).toThrow(
      "CSV import header 'missing' is not a field on Importable Thing"
    );
    expect(() => validateImportHeaders(Importable, ["created_by"])).toThrow(
      "CSV import header 'created_by' is not importable on Importable Thing"
    );
  });

  it("normalizes import row windows and update names", () => {
    expect(normalizeImportMaxRows(undefined)).toBe(500);
    expect(normalizeImportMaxRows(5_000)).toBe(5_000);
    expect(() => normalizeImportMaxRows(5_001)).toThrow("CSV import maxRows must be an integer from 1 to 5000");
    expect(() => assertImportRowLimit(3, 2)).toThrow("CSV import cannot exceed 2 rows");
    expect(requiredImportUpdateName("DOC-1", 9)).toBe("DOC-1");
    expect(() => requiredImportUpdateName(undefined, 9)).toThrow(
      "CSV row 9 requires a name column value for update imports"
    );
  });

  it("projects row failures from framework and unknown errors", () => {
    expect(documentImportFailure(2, "create", "Bad Row", new FrameworkError("VALIDATION_FAILED", "Nope", {
      status: 422
    }))).toEqual({
      row: 2,
      action: "create",
      name: "Bad Row",
      code: "VALIDATION_FAILED",
      message: "Nope",
      status: 422
    });
    expect(documentImportFailure(3, "update", undefined, new Error("Boom"))).toEqual({
      row: 3,
      action: "update",
      code: "UNKNOWN",
      message: "Boom",
      status: 500
    });
  });

  it("checks import capability from create or update permissions", () => {
    expect(canImportDocuments(owner, Importable)).toBe(true);
    expect(canImportDocuments({
      id: "manager@example.com",
      roles: ["Manager"],
      tenantId: "acme"
    }, Importable)).toBe(true);
    expect(canImportDocuments({ id: "guest@example.com", roles: ["Guest"], tenantId: "acme" }, Importable)).toBe(false);
  });
});

function row(line: number, cells: readonly string[]): { readonly line: number; readonly cells: readonly string[] } {
  return { line, cells };
}
