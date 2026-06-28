import { describe, expect, it } from "vitest";

import { parseCsv } from "../../src/application/csv.js";

describe("CSV parser", () => {
  it("trims trailing empty rows without dropping meaningful rows", () => {
    expect(parseCsv("title,count\nFirst,1\n,\n\n")).toEqual({
      headers: ["title", "count"],
      rows: [
        { line: 2, cells: ["First", "1"] }
      ]
    });
  });

  it("rejects CSV input that only contains empty rows", () => {
    expect(() => parseCsv("\n,\n")).toThrow("CSV import requires a header row");
  });
});
