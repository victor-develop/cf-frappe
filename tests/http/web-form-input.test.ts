import type { WebFormResolvedField } from "../../src";
import {
  dataFromWebFormData,
  valueFromWebFormData,
  webFormDataFromBody
} from "../../src/adapters/http/web-form-input.js";

describe("web form input", () => {
  it("accepts direct and nested JSON bodies and rejects invalid data containers", () => {
    expect(webFormDataFromBody({ title: "Direct" })).toEqual({ title: "Direct" });
    expect(webFormDataFromBody({ data: { title: "Nested" } })).toEqual({ title: "Nested" });
    for (const data of [null, "invalid", []]) {
      expect(() => webFormDataFromBody({ data })).toThrow("must be an object");
    }
  });

  it("parses every supported HTML field representation", () => {
    expect(valueFromWebFormData("on", field("accepted", "boolean"))).toBe(true);
    expect(valueFromWebFormData(null, field("accepted", "boolean"))).toBe(false);
    expect(valueFromWebFormData(null, field("title", "text"))).toBeUndefined();
    expect(valueFromWebFormData("", field("title", "text"))).toBeUndefined();
    expect(valueFromWebFormData("42", field("count", "integer"))).toBe(42);
    expect(() => valueFromWebFormData("4.2", field("count", "integer"))).toThrow("integer");
    expect(valueFromWebFormData("4.2", field("amount", "number"))).toBe(4.2);
    expect(() => valueFromWebFormData("not-a-number", field("amount", "number"))).toThrow("number");
    expect(valueFromWebFormData('{"ok":true}', field("details", "json"))).toEqual({ ok: true });
    expect(() => valueFromWebFormData("{", field("details", "json"))).toThrow("valid JSON");
    expect(valueFromWebFormData("Text", field("title", "text"))).toBe("Text");
    expect(() => valueFromWebFormData(new Blob(["file"]) as never, field("title", "text"))).toThrow("text");
  });

  it("rejects unknown, duplicate, and client-supplied server fields", () => {
    const fields = [field("title", "text"), { ...field("source", "text"), serverSupplied: true }];
    const valid = new FormData();
    valid.set("title", "Lead");
    expect(dataFromWebFormData(valid, fields)).toEqual({ title: "Lead" });

    const unknown = new FormData();
    unknown.set("unexpected", "value");
    expect(() => dataFromWebFormData(unknown, fields)).toThrow("not configured");

    const duplicate = new FormData();
    duplicate.append("title", "One");
    duplicate.append("title", "Two");
    expect(() => dataFromWebFormData(duplicate, fields)).toThrow("supplied once");

    const injected = new FormData();
    injected.set("source", "client");
    expect(() => dataFromWebFormData(injected, fields)).toThrow("server-supplied");
  });
});

function field(name: string, type: WebFormResolvedField["type"]): WebFormResolvedField {
  return { field: name, label: name, type, required: false };
}
