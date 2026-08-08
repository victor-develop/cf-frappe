import {
  appendParam,
  deskPath,
  encodePart,
  encodePath,
  filePath,
  isPlainObject,
  resourcePath,
  setFormParam,
  setParam,
  withQuery,
  type MutableQueryParams
} from "../../src/adapters/desk/client-src/url";

describe("client-src url helpers", () => {
  it("encodes single path parts", () => {
    expect(encodePart("Sales Order/1")).toBe("Sales%20Order%2F1");
    expect(encodePart(42)).toBe("42");
  });

  it("encodes multi-segment paths preserving slashes", () => {
    expect(encodePath("a b/c d")).toBe("a%20b/c%20d");
  });

  it("builds query strings from primitives and skips null/undefined", () => {
    expect(withQuery("/x", { a: 1, b: "two", c: true, d: undefined, e: null })).toBe("/x?a=1&b=two&c=true");
  });

  it("appends array values and skips empty entries", () => {
    expect(withQuery("/x", { a: ["1", null, undefined, "2"] })).toBe("/x?a=1&a=2");
  });

  it("returns the bare path when there is no query", () => {
    expect(withQuery("/x", {})).toBe("/x");
    expect(withQuery("/x", undefined)).toBe("/x");
  });

  it("setParam only assigns defined values", () => {
    const params: MutableQueryParams = {};
    setParam(params, "a", 1);
    setParam(params, "b", undefined);
    setParam(params, "c", null);
    expect(params).toEqual({ a: 1 });
  });

  it("appendParam grows scalars into arrays", () => {
    const params: MutableQueryParams = {};
    appendParam(params, "k", "one");
    expect(params).toEqual({ k: "one" });
    appendParam(params, "k", "two");
    expect(params).toEqual({ k: ["one", "two"] });
    appendParam(params, "k", "three");
    expect(params).toEqual({ k: ["one", "two", "three"] });
  });

  it("setFormParam skips null/undefined and stringifies values", () => {
    const body = new URLSearchParams();
    setFormParam(body, "a", 5);
    setFormParam(body, "b", undefined);
    setFormParam(body, "c", null);
    expect(body.toString()).toBe("a=5");
  });

  it("isPlainObject accepts object literals only", () => {
    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject([])).toBe(false);
    expect(isPlainObject(null)).toBe(false);
    expect(isPlainObject("x")).toBe(false);
    expect(isPlainObject(new Date())).toBe(false);
  });

  it("builds primitive resource/desk/file paths", () => {
    expect(resourcePath("Task")).toBe("/api/resource/Task");
    expect(resourcePath("Task", "T 1")).toBe("/api/resource/Task/T%201");
    expect(deskPath("Sales Order")).toBe("/desk/Sales%20Order");
    expect(filePath("f1")).toBe("/api/files/f1");
    expect(filePath("f1", "content")).toBe("/api/files/f1/content");
  });
});
