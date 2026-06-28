import { isJsonValue } from "../../src";

describe("json value guard", () => {
  it("accepts JSON primitives, arrays, and plain objects", () => {
    expect(isJsonValue(null)).toBe(true);
    expect(isJsonValue(["a", 1, false, { nested: ["ok"] }])).toBe(true);
    expect(isJsonValue(Object.assign(Object.create(null), { safe: "value" }))).toBe(true);
  });

  it("rejects values that cannot be represented by the JsonValue type", () => {
    expect(isJsonValue(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isJsonValue(() => "generated")).toBe(false);
    expect(isJsonValue({ missing: undefined })).toBe(false);
    expect(isJsonValue(Object.assign([], { length: 2, 0: "present" }))).toBe(false);
  });

  it("rejects cyclic and non-plain objects", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    expect(isJsonValue(cyclic)).toBe(false);
    expect(isJsonValue(new Date("2026-01-01T00:00:00.000Z"))).toBe(false);
  });

  it("supports bounded depth for realtime collaboration payloads", () => {
    expect(isJsonValue({ a: { b: { c: true } } }, { maxDepth: 2 })).toBe(true);
    expect(isJsonValue({ a: { b: { c: [] } } }, { maxDepth: 2 })).toBe(false);
  });
});
