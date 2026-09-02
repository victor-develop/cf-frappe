import { likeGlobCaseFoldGroups, likeGlobPattern } from "../../src/core/like-glob.js";

// The embedded case-fold table is only correct relative to the *running*
// engine: the in-memory rule is whatever this runtime's regexp `i` flag does, so
// a V8 Unicode data update would move it and leave the SQL side behind. These
// tests rebuild the table here and compare, rather than checking a fixed corpus
// that would keep passing through such a drift.
//
// `Canonicalize` is reimplemented here on purpose. Importing it from the source
// would mean the generator and the check share whatever mistake the generator
// made; the table is data, and this is the independent derivation of it.

const BMP_END = 0xffff;
const SURROGATE_START = 0xd800;
const SURROGATE_END = 0xdfff;

function canonicalize(char: string): string {
  const upper = char.toUpperCase();
  if (upper.length !== 1) {
    // `ß` uppercases to `SS`: the `i` flag refuses any mapping that changes
    // length, so `ß` folds with nothing.
    return char;
  }
  if (char.codePointAt(0)! >= 128 && upper.codePointAt(0)! < 128) {
    // `ı` uppercases to `I`: the `i` flag refuses mappings that reach ASCII
    // from outside it.
    return char;
  }
  return upper;
}

function bmpCharacters(): readonly string[] {
  const characters: string[] = [];
  for (let codePoint = 0; codePoint <= BMP_END; codePoint += 1) {
    if (codePoint >= SURROGATE_START && codePoint <= SURROGATE_END) {
      // A lone surrogate is not a character; it only exists as half a pair, and
      // the translator passes pairs through unfolded.
      continue;
    }
    characters.push(String.fromCharCode(codePoint));
  }
  return characters;
}

function regeneratedGroups(): ReadonlyMap<string, string> {
  const byKey = new Map<string, string>();
  for (const char of bmpCharacters()) {
    const key = canonicalize(char);
    byKey.set(key, (byKey.get(key) ?? "") + char);
  }
  const members = new Map<string, string>();
  for (const group of byKey.values()) {
    if (group.length < 2) {
      continue;
    }
    for (const member of group) {
      members.set(member, group);
    }
  }
  return members;
}

function matchesIgnoringCase(pattern: string, value: string): boolean {
  return new RegExp(`^${pattern.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&")}$`, "i").test(value);
}

describe("like-glob case-fold table", () => {
  it("matches a table regenerated from the running engine", () => {
    const embedded = likeGlobCaseFoldGroups();
    const regenerated = regeneratedGroups();

    expect(embedded.size).toBe(regenerated.size);
    expect(new Set(embedded.values()).size).toBe(1144);
    expect(Math.max(...[...embedded.values()].map((group) => group.length))).toBe(4);
    for (const [member, group] of regenerated) {
      expect(embedded.get(member)).toBe(group);
    }
    for (const [member, group] of embedded) {
      expect(regenerated.get(member)).toBe(group);
    }
  });

  it("agrees with regexp `i` inside every group", () => {
    const groups = new Set(likeGlobCaseFoldGroups().values());
    let pairs = 0;
    for (const group of groups) {
      for (const left of group) {
        for (const right of group) {
          if (left === right) {
            continue;
          }
          pairs += 1;
          expect(matchesIgnoringCase(left, right)).toBe(true);
        }
      }
    }
    expect(pairs).toBe(2392);
  });

  it("agrees with regexp `i` outside every group, over every case-related BMP pair", () => {
    // The cheap half of the check is in-group. This is the other direction: any
    // pair regexp `i` unites must share a group. A full BMP cross-product is
    // 2.0 billion comparisons (18 s in this runtime, measured) so it is not run
    // here; case-related candidates are the only plausible unions, and this is
    // the direction where grouping by `toLowerCase` diverges (72 pairs).
    const groups = likeGlobCaseFoldGroups();
    const byLower = new Map<string, string[]>();
    const byUpper = new Map<string, string[]>();
    for (const char of bmpCharacters()) {
      (byLower.get(char.toLowerCase()) ?? byLower.set(char.toLowerCase(), []).get(char.toLowerCase())!).push(char);
      (byUpper.get(char.toUpperCase()) ?? byUpper.set(char.toUpperCase(), []).get(char.toUpperCase())!).push(char);
    }
    const divergences: string[] = [];
    for (const char of bmpCharacters()) {
      const candidates = new Set([
        ...(byLower.get(char.toLowerCase()) ?? []),
        ...(byUpper.get(char.toUpperCase()) ?? []),
        ...(groups.get(char) ?? "")
      ]);
      const group = groups.get(char) ?? char;
      for (const candidate of candidates) {
        if (matchesIgnoringCase(char, candidate) !== group.includes(candidate)) {
          divergences.push(`${hex(char)} vs ${hex(candidate)}`);
        }
      }
    }
    expect(divergences).toEqual([]);
  });

  it("keeps every GLOB-sensitive character out of multi-member groups", () => {
    // The emitted class body is unescaped and unordered, so this is what makes
    // that safe: `]` would close the class, `^` first would negate it, `-`
    // would form a range, and `[`/`*`/`?` would nest or wildcard. If a future
    // Unicode update put one of these in a fold group, the translator would
    // silently emit a class that means something else.
    const sensitive = [...'*?[]^-'];
    const offenders = [...new Set(likeGlobCaseFoldGroups().values())].filter((group) =>
      sensitive.some((char) => group.includes(char))
    );
    expect(offenders).toEqual([]);
  });

  it("expands a pattern by at most 6x in UTF-8 bytes", () => {
    // This factor is what the caller's byte budget is sized against, so it is
    // asserted rather than assumed.
    const encoder = new TextEncoder();
    let worst = { factor: 0, char: "" };
    for (const [member, group] of likeGlobCaseFoldGroups()) {
      const factor = encoder.encode(`[${group}]`).length / encoder.encode(member).length;
      if (factor > worst.factor) {
        worst = { factor, char: member };
      }
    }
    expect(worst.factor).toBe(6);
    expect(worst.char).toBe("Т");
    expect(likeGlobPattern("Т")).toEqual({ kind: "glob", pattern: "[Ттᲄᲅ]" });
  });
});

describe("likeGlobPattern", () => {
  it.each([
    ["ärger", "[Ää][Rr][Gg][Ee][Rr]"],
    ["%ärger%", "*[Ää][Rr][Gg][Ee][Rr]*"],
    ["_", "?"],
    ["a_b", "[Aa]?[Bb]"],
    // GLOB's own metacharacters become single-member classes; `^`, `]` and `-`
    // must stay raw, because `[^]` negates and the others are literal anyway.
    ["*", "[*]"],
    ["?", "[?]"],
    ["[", "[[]"],
    ["]", "]"],
    ["^", "^"],
    ["-", "-"],
    ["a^b", "[Aa]^[Bb]"],
    // Escaped wildcards lose their meaning and are emitted literally; `%` and
    // `_` are not GLOB metacharacters, so they need no class.
    ["\\%", "%"],
    ["\\_", "_"],
    ["\\\\", "\\"],
    ["\\*", "[*]"],
    ["50\\%", "50%"],
    // Nothing outside the BMP folds, on either side, so a surrogate pair passes
    // through as the pair it is rather than as two lone halves.
    ["\u{1F600}", "\u{1F600}"],
    ["a\u{1F600}b", "[Aa]\u{1F600}[Bb]"],
    ["\\\u{1F600}", "\u{1F600}"],
    ["\u{10400}", "\u{10400}"],
    ["", ""],
    // The multi-member groups the issue named, so the table is exercised and not
    // just regenerated.
    ["ς", "[Σςσ]"],
    ["ϑ", "[Θθϑ]"],
    ["µ", "[µΜμ]"],
    // The characters that fold with nothing, each for its own reason: the
    // Kelvin sign U+212A and the Angstrom sign U+212B uppercase to themselves, and
    // the `i` flag never applies a mapping that reaches ASCII from outside it, so
    // neither folds with `k`/`a` — measured, `/^\u212A$/i.test("k")` is false. `ß`
    // uppercases to `SS` and `ı` uppercases to ASCII `I`: length- and ASCII-barred.
    ["K", "K"],
    ["Å", "Å"],
    ["ß", "ß"],
    ["ı", "ı"],
    ["İ", "İ"],
    ["ǅ", "[Ǆǅǆ]"]
  ])("translates %j to %j", (pattern, expected) => {
    expect(likeGlobPattern(pattern)).toEqual({ kind: "glob", pattern: expected });
  });

  it("reports a pattern that can never match instead of dropping the escape", () => {
    // `likePatternRegex` compiles a trailing lone `\` to `(?!)`. GLOB cannot say
    // that, and treating the `\` as escaping nothing would match instead.
    expect(likeGlobPattern("launch\\")).toEqual({ kind: "never" });
    expect(likeGlobPattern("\\")).toEqual({ kind: "never" });
    expect(likeGlobPattern("\\\\\\")).toEqual({ kind: "never" });
    expect(likeGlobPattern("\\\\")).toEqual({ kind: "glob", pattern: "\\" });
  });

  it("advances by one code unit after an escape", () => {
    // A first prototype emitted `[Aa][\][Bb][Bb]` for `a\\b`: the escape
    // consumed one unit and the loop consumed it again.
    expect(likeGlobPattern("a\\\\b")).toEqual({ kind: "glob", pattern: "[Aa]\\[Bb]" });
  });
});

function hex(char: string): string {
  return `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
}
