import { compileSafeRegex, matchesSafeRegex } from "../../src/core/safe-regex.js";

describe("safe regex", () => {
  it.each([
    ["^INV-[0-9]{4}$", undefined, "INV-0042", true],
    ["^INV-[0-9]{4}$", undefined, "XINV-0042", false],
    ["inv-\\d+$", "i", "INV-42", true],
    ["^A.*B$", undefined, "A-42-B", true],
    ["^A.*B$", undefined, "A-42-C", false],
    ["colou?r", undefined, "color", true],
    ["colou?r", undefined, "colour", true],
    ["^a?b$", undefined, "b", true],
    ["^a{0,2}b$", undefined, "b", true],
    ["a?b", undefined, "xxbxx", true],
    ["^[^0-9]+$", undefined, "ABC", true],
    ["^[^0-9]+$", undefined, "A1", false],
    ["^[a\\-z]$", undefined, "-", true],
    ["^[a\\-z]$", undefined, "m", false],
    ["^[^a\\-z]$", undefined, "m", true],
    ["^[^a\\-z]$", undefined, "-", false],
    ["^\\w{2,4}$", undefined, "A_2", true],
    ["^\\S+$", undefined, "ABC", true],
    ["^\\S+$", undefined, "A B", false],
    ["literal\\$", undefined, "literal$", true]
  ])("matches %s", (pattern, flags, value, expected) => {
    expect(matchesSafeRegex(compileSafeRegex(pattern, flags as "i" | undefined), value)).toBe(expected);
  });

  it.each([
    "",
    "^",
    "(",
    "a|b",
    "a\\",
    "[]",
    "[z-a]",
    "[\\d]",
    "a{",
    "a{}",
    "a{2,1}",
    "a{257}",
    "*a",
    "a^b",
    "a$b",
    `${"a".repeat(129)}`
  ])("rejects unsupported pattern %s", (pattern) => {
    expect(() => compileSafeRegex(pattern)).toThrow();
  });

  it("rejects unsupported flags and expanded patterns", () => {
    expect(() => compileSafeRegex("a", "g" as never)).toThrow("flags");
    expect(() => compileSafeRegex("a{256}b")).toThrow("expand");
  });
});
