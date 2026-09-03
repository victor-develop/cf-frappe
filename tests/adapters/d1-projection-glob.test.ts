import { DatabaseSync } from "node:sqlite";
import {
  D1ProjectionStore,
  InMemoryProjectionStore,
  containsLikePattern,
  defineDocType,
  likePatternMatches
} from "../../src";
import type { DocumentSnapshot, ListDocumentsQuery, PredicateExpression } from "../../src";
import {
  D1_PROJECTION_TEXT_PATTERN_MAX_BYTES,
  d1ProjectionListQuery
} from "../../src/adapters/d1/projection-query.js";
import { likeGlobPattern } from "../../src/core/like-glob.js";
import { afterField, predicateGroup } from "../predicate-fixtures";
import { createProjectionEngine, type ProjectionEngine } from "../sqlite-engine";

// `contains`, `like` and `not_like` are compiled into SQLite `GLOB` with
// case-fold character classes (issue #41). Before this they were the last
// operators evaluated in the Worker: the store pulled a bounded candidate set
// and refused past 1000 rows, so text search did not work on a large doctype.
//
// Everything here runs against a real SQLite engine. The hand-written fake in
// d1-projection-store.test.ts matches SQL by substring and passes every row for
// a shape it does not recognise, so it cannot judge a `GLOB` condition at all —
// it can only be trusted for the SQL text and the bound parameters.

const Note = defineDocType({
  name: "Note",
  fields: [
    { name: "title", type: "text" },
    { name: "priority", type: "text" }
  ],
  indexes: [["title"], ["priority"]]
});

/**
 * One value per interesting fold or metacharacter. Names are ASCII and ordered,
 * so `ORDER BY name` is the same question for SQLite's BINARY collation and for
 * the in-memory store.
 */
const CORPUS: readonly (readonly [string, string | null | undefined])[] = [
  ["N01", "Ärger"],
  ["N02", "ärger"],
  ["N03", "ÄRGER"],
  ["N04", "σigma"],
  ["N05", "ςigma"],
  ["N06", "Σigma"],
  ["N07", "ϑeta"],
  ["N08", "µ meter"],
  ["N09", "İstanbul"],
  ["N10", "Kelvin"],
  ["N11", "Straße"],
  ["N12", "Ǆ"],
  ["N13", "ǅ"],
  ["N14", "ǆ"],
  ["N15", "50% _off [x] ^y *z ?q a-b \\end"],
  ["N16", "plain"],
  ["N17", null],
  ["N18", undefined],
  ["N19", "a^b"],
  ["N20", "axb"],
  ["N21", "STRASSE"],
  ["N22", "ıstanbul"],
  ["N23", "kelvin"]
];

const SNAPSHOTS: readonly DocumentSnapshot[] = CORPUS.map(([name, title]) =>
  snapshot(name, title === undefined ? { priority: "Low" } : { title, priority: "Low" })
);

describe("D1 projection text pushdown against a real SQLite engine", () => {
  let engine: ProjectionEngine;
  let d1: D1ProjectionStore;
  let memory: InMemoryProjectionStore;

  beforeEach(async () => {
    engine = createProjectionEngine([Note]);
    d1 = new D1ProjectionStore(engine.asD1Database());
    memory = new InMemoryProjectionStore();
    for (const document of SNAPSHOTS) {
      await d1.save(document);
      await memory.save(document);
    }
  });

  afterEach(() => {
    engine.close();
  });

  const patterns: readonly string[] = [
    "ä",
    "Ä",
    "ARGER",
    "σ",
    "ς",
    "Σ",
    "ϑ",
    "Θ",
    "µ",
    "Μ",
    "i",
    "İ",
    "ı",
    "ss",
    "ß",
    "k",
    "K",
    "ǆ",
    "50%",
    "_off",
    "[x]",
    "^y",
    "*z",
    "?q",
    "a-b",
    "\\end",
    "a^b",
    "PLAIN",
    "",
    "nothing here"
  ];

  for (const needle of patterns) {
    it(`matches the in-memory store for contains ${JSON.stringify(needle)}`, async () => {
      await expectParity(afterField("title", needle, "contains"));
      await expectParity({ kind: "not", predicate: afterField("title", needle, "contains") });
    });
  }

  const likePatterns: readonly string[] = [
    "%ä%",
    "%Ä%",
    "_rger",
    "ärger",
    "%ς%",
    "%ϑ%",
    "%µ%",
    "%i%",
    "%ss%",
    "%K%",
    "%ǅ%",
    "50\\%%",
    "%\\_off%",
    "%[x]%",
    "%^y%",
    "%*z%",
    "%?q%",
    "%a-b%",
    "%\\\\end%",
    "%a^b%",
    "a_b",
    "%",
    "",
    "plain\\"
  ];

  for (const pattern of likePatterns) {
    it(`matches the in-memory store for like ${JSON.stringify(pattern)}`, async () => {
      await expectParity(afterField("title", pattern, "like"));
      await expectParity({ kind: "not", predicate: afterField("title", pattern, "like") });
      await expectParity(afterField("title", pattern, "not_like"));
      await expectParity({ kind: "not", predicate: afterField("title", pattern, "not_like") });
    });
  }

  it("matches the in-memory store inside groups that mix pushed-down operators", async () => {
    await expectParity(predicateGroup(
      "any",
      afterField("priority", "Low"),
      afterField("title", "ä", "contains")
    ));
    await expectParity(predicateGroup(
      "all",
      afterField("priority", "Low"),
      afterField("title", "%ä%", "not_like")
    ));
    await expectParity({
      kind: "not",
      predicate: predicateGroup(
        "any",
        afterField("title", "ä", "contains"),
        afterField("title", "%ς%", "like")
      )
    });
  });

  it("agrees with memory when a text filter is combined with an ordered comparison", async () => {
    // Ordered comparisons on text are where the two adapters used to part
    // company: SQLite compares bytes, so `"apple" > "B"`, while the in-memory
    // rule used `localeCompare`, which says the opposite. That stayed invisible
    // only because a group containing `contains` fell out of the pushdown and
    // got re-filtered in memory. With the text operators pushed down, this group
    // is answered entirely by SQLite — so `compareValues` now compares UTF-8
    // bytes too, and this is the case that was wrong.
    for (const rowSet of [
      { name: "P0", title: "apple pie" },
      { name: "P1", title: "Banana" },
      { name: "P2", title: "apricot" },
      { name: "P3", title: "Cherry" }
    ]) {
      const document = snapshot(rowSet.name, { title: rowSet.title, priority: "Low" });
      await d1.save(document);
      await memory.save(document);
    }

    await expectParity(predicateGroup(
      "all",
      afterField("title", "p", "contains"),
      afterField("title", "B", "gt")
    ));
    // And the ordered comparison on its own, which is the part that changed.
    await expectParity(afterField("title", "B", "gt"));
    await expectParity(afterField("title", "b", "lt"));
  });

  it("orders text by UTF-8 bytes, not by UTF-16 code units", async () => {
    // These two orders differ, and only here: UTF-16 puts an astral character
    // *before* U+E000-U+FFFF, UTF-8 puts it after. So `title gt "\ue000"`
    // matches the astral row under SQLite's BINARY collation and does not match
    // it under JavaScript's `<`. Without this case, replacing the byte
    // comparison with `left < right` passes the whole suite.
    for (const [name, title] of [["U1", "\ue000"], ["U2", "\ufffd"], ["U3", "\u{1F600}"]] as const) {
      const document = snapshot(name, { title, priority: "Low" });
      await d1.save(document);
      await memory.save(document);
    }

    await expectParity(afterField("title", "\ue000", "gt"));
    await expectParity(afterField("title", "\u{1F600}", "lt"));
    // The astral row really is the one that separates them, so the assertion is
    // not passing on an empty result.
    const matched = await listedNames(afterField("title", "\ue000", "gt"));
    expect(matched).toContain("U3");
  });

  it("keeps a literal ^ literal instead of negating the class", async () => {
    // `^` first inside a GLOB class negates it, so emitting a literal `^` as the
    // single-member class `[^]` would match every character except `^` —
    // measured, `'a^b' GLOB '*[^]*'` is 0. This is the half that catches it: the
    // row that does not contain `^` must not come back.
    const names = await listedNames(afterField("title", "a^b", "contains"));
    expect(names).toEqual(["N19"]);
  });

  it("returns a correct page and an exact total past the old 1000-row cap", async () => {
    // The criterion the issue was opened for. `D1_PROJECTION_MAX_POST_FILTER_ROWS`
    // used to reject any text filter whose other conditions left more than 1000
    // candidate rows, which is every text filter on a real doctype.
    for (let index = 0; index < 2_500; index += 1) {
      await d1.save(snapshot(`B${String(index).padStart(5, "0")}`, {
        title: index % 5 === 0 ? "Ärger bulk" : "bulk",
        priority: "Low"
      }));
    }

    const page = await d1.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: afterField("title", "ärger", "contains"),
      orderBy: "name",
      order: "asc",
      limit: 10,
      offset: 0
    });

    // 500 bulk rows fold-match plus the three corpus spellings of Ärger.
    expect(page.total).toBe(503);
    expect(page.data).toHaveLength(10);
    expect(page.data.map((document) => document.name)).toEqual([
      "B00000",
      "B00005",
      "B00010",
      "B00015",
      "B00020",
      "B00025",
      "B00030",
      "B00035",
      "B00040",
      "B00045"
    ]);
  });

  it("binds the pattern instead of interpolating it into the SQL", async () => {
    const seen: string[] = [];
    const recording = new D1ProjectionStore(recordSql(engine.asD1Database(), seen));
    const needle = "50%_o'ff[x]";
    await recording.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: afterField("title", needle, "contains")
    });

    expect(seen.length).toBeGreaterThan(0);
    for (const sql of seen) {
      expect(sql).toContain("GLOB ?");
      expect(sql).not.toContain(needle);
      expect(sql).not.toContain("50%");
      expect(sql).not.toContain("o'ff");
    }
    expect(d1ProjectionListQuery({
      tenantId: "acme",
      doctype: "Note",
      predicate: afterField("title", needle, "contains")
    }).params).toEqual(["acme", "Note", "*50%_[Oo]'[Ff][Ff][[][Xx]]*"]);
  });

  it("compiles every text predicate the validator accepts without a refinement", async () => {
    // The refinement plumbing is gone, so this asserts the shape rather than the
    // absence of a field the type no longer has: a compiled query carries only
    // conditions and bound parameters.
    const compiled = [
      afterField("title", "ä", "contains"),
      { kind: "not", predicate: afterField("title", "ä", "contains") } as PredicateExpression,
      predicateGroup("any", afterField("priority", "Low"), afterField("title", "ä", "contains")),
      predicateGroup(
        "all",
        predicateGroup("any", afterField("title", "%ä%", "like"), afterField("priority", "Low")),
        { kind: "not", predicate: afterField("title", "%ä%", "not_like") } as PredicateExpression
      )
    ].map((predicate) => d1ProjectionListQuery({ tenantId: "acme", doctype: "Note", predicate }));

    for (const query of compiled) {
      expect(Object.keys(query).sort()).toEqual(["limit", "offset", "orderBy", "params", "where"]);
      expect(query.where).toContain("GLOB ?");
    }
  });

  it("refuses to compile an empty predicate group instead of emitting `()`", () => {
    // The last route to a non-exact condition: validation rejects an empty
    // group, but this compiler is exported and takes a raw query, and with the
    // superset path gone an empty group would emit `()` — a SQL syntax error
    // arriving as a 500 from the driver rather than from here.
    expect(() => d1ProjectionListQuery({
      tenantId: "acme",
      doctype: "Note",
      predicate: { kind: "group", match: "all", predicates: [] }
    })).toThrowError(/at least one predicate/);
  });

  it("keeps an operand the in-memory rule cannot match matching nothing", async () => {
    // Each of these was a surviving mutation: replacing the never-matching
    // condition with `1 = 1` kept every row and no test noticed. `not_like` is
    // the one that must NOT become "keep everything" — the in-memory rule needs
    // the field present *and* the operand a string, so a bad operand makes it
    // false, not true.
    //
    // The two operators differ on purpose, and this pins which: `contains`
    // coerces its needle with `String(expected)` exactly as the in-memory rule
    // does, so `contains 5` is a real search for "5"; `like` and `not_like`
    // require a string and match nothing without one.
    for (const operator of ["contains", "like", "not_like"] as const) {
      const compiled = d1ProjectionListQuery({
        tenantId: "acme",
        doctype: "Note",
        predicate: afterField("title", null as never, operator)
      });
      expect(compiled.where, `${operator} with null`).toContain("0 = 1");
      await expectParity(afterField("title", null as never, operator));
    }

    for (const operator of ["like", "not_like"] as const) {
      for (const operand of [5, true] as const) {
        const compiled = d1ProjectionListQuery({
          tenantId: "acme",
          doctype: "Note",
          predicate: afterField("title", operand as never, operator)
        });
        expect(compiled.where, `${operator} with ${JSON.stringify(operand)}`).toContain("0 = 1");
        await expectParity(afterField("title", operand as never, operator));
      }
    }

    // Coerced, not rejected — and the two stores agree on that too.
    const coerced = d1ProjectionListQuery({
      tenantId: "acme",
      doctype: "Note",
      predicate: afterField("title", 5 as never, "contains")
    });
    expect(coerced.where).toContain("GLOB ?");
    expect(coerced.params).toContain("*5*");
    await expectParity(afterField("title", 5 as never, "contains"));
  });

  it("applies the pattern byte budget to not_like as well", () => {
    // Wrapping the budget check in `operator !== "not_like"` was a surviving
    // mutation: the limit was only ever reached through `contains` in the tests,
    // so it could silently stop applying to one operator.
    const tooLong = `%${"Т".repeat(400)}%`;
    expect(() =>
      d1ProjectionListQuery({
        tenantId: "acme",
        doctype: "Note",
        predicate: afterField("title", tooLong, "not_like")
      })
    ).toThrow("byte limit");
    expect(() =>
      d1ProjectionListQuery({
        tenantId: "acme",
        doctype: "Note",
        predicate: afterField("title", tooLong, "like")
      })
    ).toThrow("byte limit");
  });

  it("rejects U+0000 rather than truncating the pattern to match every row", () => {
    // SQLite's `patternCompare` walks NUL-terminated C strings, so `*\u0000*`
    // is read as `*`. Before this rejection, `contains "\u0000"` returned every
    // row while the in-memory rule returned only the row that contains U+0000 —
    // a client-supplied character silently removing the filter.
    for (const needle of ["\u0000", "a\u0000b", "trailing\u0000"]) {
      expect(() =>
        d1ProjectionListQuery({
          tenantId: "acme",
          doctype: "Note",
          predicate: afterField("title", needle, "contains")
        })
      ).toThrow("contains U+0000");
    }
    expect(() =>
      d1ProjectionListQuery({
        tenantId: "acme",
        doctype: "Note",
        predicate: afterField("title", "%\u0000%", "like")
      })
    ).toThrow("contains U+0000");
    // `not_like` too: it takes the same compile path, and a truncated pattern
    // under a negation drops rows instead of keeping them.
    expect(() =>
      d1ProjectionListQuery({
        tenantId: "acme",
        doctype: "Note",
        predicate: afterField("title", "%\u0000%", "not_like")
      })
    ).toThrow("contains U+0000");
  });

  it("rejects a needle whose compiled pattern crosses the byte budget", () => {
    // A `Т` costs 2 UTF-8 bytes and compiles to 12 — the worst case — so the
    // boundary is reachable with a needle far shorter than the engine's own
    // 50000-byte limit. The counts are literal rather than derived from the
    // constant: derived ones move with it, and a cap that quietly shrinks would
    // still look correct.
    const limit = 4096;
    expect(D1_PROJECTION_TEXT_PATTERN_MAX_BYTES).toBe(limit);
    const fits = "Т".repeat(341);
    const oversized = "Т".repeat(342);
    const encoder = new TextEncoder();
    const compiledBytes = (needle: string) => {
      const translated = likeGlobPattern(containsLikePattern(needle));
      return translated.kind === "glob" ? encoder.encode(translated.pattern).length : 0;
    };
    expect(compiledBytes(fits)).toBe(4094);
    expect(compiledBytes(oversized)).toBe(4106);

    const compile = (needle: string) => d1ProjectionListQuery({
      tenantId: "acme",
      doctype: "Note",
      predicate: afterField("title", needle, "contains")
    });

    expect(compile(fits).params).toHaveLength(3);
    expect(() => compile(oversized)).toThrowError(/Text filter on 'title'/);
    try {
      compile(oversized);
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({
        code: "D1_PROJECTION_TEXT_PATTERN_TOO_LONG",
        status: 400,
        message: expect.stringContaining(`${limit}-byte limit`)
      });
      expect((error as Error).message).toContain("4106-byte GLOB pattern");
    }
  });

  it("accepts a pattern at the budget through the store, and SQLite accepts it too", async () => {
    // The cap is only worth having if the engine really does take everything
    // under it; a pattern that SQLite rejects anyway would make the cap a
    // decoration.
    await expect(d1.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: afterField("title", "Т".repeat(341), "contains")
    })).resolves.toMatchObject({ data: [], total: 0 });
  });

  it("keeps a never-matching pattern's two polarities apart", async () => {
    // A pattern ending in a lone `\` matches nothing. `like` must return no rows
    // at all, while `not_like` must return exactly the rows whose field is
    // present — not every row in the table, which is what a naive negation of
    // `0 = 1` produces.
    const never = "ärger\\";
    const like = await d1.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: afterField("title", never, "like"),
      orderBy: "name",
      order: "asc"
    });
    expect(like.data).toEqual([]);
    expect(like.total).toBe(0);

    const notLike = await listedNames(afterField("title", never, "not_like"));
    expect(notLike).toEqual(CORPUS.filter(([, title]) => typeof title === "string").map(([name]) => name));
    expect(notLike).not.toContain("N17");
    expect(notLike).not.toContain("N18");

    await expectParity(afterField("title", never, "like"));
    await expectParity(afterField("title", never, "not_like"));
    await expectParity({ kind: "not", predicate: afterField("title", never, "like") });
    await expectParity({ kind: "not", predicate: afterField("title", never, "not_like") });
  });

  it("diverges from memory on `_` over astral data, and only there", async () => {
    // Accepted, not fixed: `_` is one UTF-16 code unit in memory and `?` is one
    // code point in GLOB. Measured on SQLite 3.51.3, `'😀' GLOB '?'` is 1 and
    // `'😀' GLOB '??'` is 0, so neither `?` nor `??` is even a consistent
    // superset. The exact fix is to redefine `_` as one code point, which would
    // have to change src/adapters/desk/client-src/forms.ts too — its parity test
    // covers only `contains`, so the drift would ship silently.
    await d1.save(snapshot("Z01", { title: "\u{1F600}", priority: "Astral" }));
    await memory.save(snapshot("Z01", { title: "\u{1F600}", priority: "Astral" }));

    // Scoped to the astral row: the single-character corpus rows match `_` on
    // both sides, and that agreement would hide the disagreement being pinned.
    const astral = (pattern: string) => ({
      tenantId: "acme",
      doctype: "Note",
      predicate: predicateGroup(
        "all",
        afterField("priority", "Astral"),
        afterField("title", pattern, "like")
      )
    } as const);

    expect((await d1.list(astral("_"))).data.map((document) => document.name)).toEqual(["Z01"]);
    expect((await memory.list(astral("_"))).data).toEqual([]);

    expect((await d1.list(astral("__"))).data).toEqual([]);
    expect((await memory.list(astral("__"))).data.map((document) => document.name)).toEqual(["Z01"]);

    // `contains` escapes `_`, so Desk's quick filter is exact even here.
    await expectParity(afterField("title", "_", "contains"));
    await expectParity(afterField("title", "\u{1F600}", "contains"));
  });

  it("diverges from memory on unpaired surrogates, which SQLite's UTF-8 reader collapses", async () => {
    // Also accepted. The two rows are stored distinctly (CESU-8, `EDA0BD` vs
    // `EDB880`) but GLOB reports them equal, while in memory `\uD83D` and
    // `\uDE00` are different code units. Reachable only with lone surrogates in
    // stored data, which is already lossy territory — pinned so the randomized
    // differential below can exclude them with a reason instead of flaking.
    await d1.save(snapshot("Z02", { title: "\ud83d", priority: "Low" }));
    await memory.save(snapshot("Z02", { title: "\ud83d", priority: "Low" }));

    const query = { tenantId: "acme", doctype: "Note", predicate: afterField("title", "\ude00", "contains") } as const;
    expect((await d1.list(query)).data.map((document) => document.name)).toEqual(["Z02"]);
    expect((await memory.list(query)).data).toEqual([]);
  });

  it("diverges from memory on a non-string value left behind in a text field", async () => {
    // Unreachable through validation — `src/core/schema.ts` validates text
    // fields as strings on write and the operator is only allowed on text-like
    // fields — but reachable when a field's type changes from `number` to `text`
    // and old rows keep numeric JSON. In memory `contains` does `String(actual)`
    // so `true` contains `ru`; SQLite turns JSON `true` into the integer 1 and
    // `1 GLOB '*[rR][uU]*'` is 0. Pinned as a known boundary rather than
    // discovered in a field report.
    await d1.save(snapshot("Z03", { title: true as unknown as string, priority: "Low" }));
    await memory.save(snapshot("Z03", { title: true as unknown as string, priority: "Low" }));

    const query = { tenantId: "acme", doctype: "Note", predicate: afterField("title", "ru", "contains") } as const;
    expect((await d1.list(query)).data).toEqual([]);
    expect((await memory.list(query)).data.map((document) => document.name)).toEqual(["Z03"]);
  });

  async function expectParity(predicate: PredicateExpression): Promise<void> {
    const query: ListDocumentsQuery = {
      tenantId: "acme",
      doctype: "Note",
      predicate,
      orderBy: "name",
      order: "asc",
      limit: 100
    };
    const [fromD1, fromMemory] = await Promise.all([d1.list(query), memory.list(query)]);
    expect({
      data: fromD1.data.map((document) => document.name),
      total: fromD1.total,
      limit: fromD1.limit,
      offset: fromD1.offset
    }).toEqual({
      data: fromMemory.data.map((document) => document.name),
      total: fromMemory.total,
      limit: fromMemory.limit,
      offset: fromMemory.offset
    });
    expect(fromD1).toEqual(fromMemory);
  }

  async function listedNames(predicate: PredicateExpression): Promise<readonly string[]> {
    const result = await d1.list({
      tenantId: "acme",
      doctype: "Note",
      predicate,
      orderBy: "name",
      order: "asc",
      limit: 100
    });
    return result.data.map((document) => document.name);
  }
});

describe("compiled GLOB against the shipped like rule, randomized", () => {
  // The central property: for every pattern and every value, SQLite's verdict on
  // the compiled GLOB equals `likePatternMatches`. A fixed corpus cannot cover
  // the interactions between escapes, wildcards, class-forming characters and
  // fold groups, so this walks a seeded product of both.
  //
  // The alphabet holds every GLOB metacharacter, the `like` metacharacters, the
  // escape character, and the fold groups the issue named. Lone surrogates and
  // astral characters are deliberately absent: both have accepted divergences
  // pinned above, and including them here would turn a known boundary into a
  // flaky failure.
  //
  // U+0000 is absent for a different reason, and not because it is safe: it used
  // to make `contains` match every row, and adding this one character to this
  // alphabet was what found that. It cannot reach either side any more — a
  // pattern containing it is a 400 and a value containing it fails validation —
  // so generating it here would only exercise those two rejections, which
  // `rejects U+0000 rather than truncating the pattern` and the schema tests
  // pin directly.
  const ALPHABET = [
    ..."%_\\[]^*?-",
    ..."aA",
    "ß",
    "å",
    "Å",
    "σ",
    "ς",
    "Σ",
    "θ",
    "Θ",
    "ϑ",
    "µ",
    "μ",
    "Μ",
    "İ",
    "ı",
    ..."iI",
    "Ǆ",
    "ǅ",
    "ǆ",
    "K",
    "Å",
    "字",
    " "
  ];

  it("agrees on 120000 value x pattern pairs", () => {
    const db = new DatabaseSync(":memory:");
    try {
      // `json_extract` is how the compiled condition actually reads a field, so
      // the differential goes through it rather than binding the value straight
      // into the comparison.
      const glob = db.prepare("SELECT (json_extract(?, '$.v') GLOB ?) AS matched");
      const random = seededRandom(0x41_2f_9a_1d);
      const values = Array.from({ length: 120 }, () => randomString(random, ALPHABET, 8));
      let comparisons = 0;
      let matched = 0;
      for (let index = 0; index < 1_000; index += 1) {
        const pattern = randomString(random, ALPHABET, 6);
        const translated = likeGlobPattern(pattern);
        for (const value of values) {
          comparisons += 1;
          const expected = likePatternMatches(value, pattern);
          matched += expected ? 1 : 0;
          const actual = translated.kind === "never"
            ? false
            : glob.get(JSON.stringify({ v: value }), translated.pattern)!.matched === 1;
          if (actual !== expected) {
            throw new Error(
              `GLOB diverged from likePatternMatches\n` +
                `  pattern: ${JSON.stringify(pattern)}\n` +
                `  value:   ${JSON.stringify(value)}\n` +
                `  glob:    ${JSON.stringify(translated.kind === "never" ? null : translated.pattern)}\n` +
                `  memory:  ${String(expected)}\n` +
                `  sqlite:  ${String(actual)}`
            );
          }
        }
      }
      expect(comparisons).toBe(120_000);
      // Without this the differential could agree by matching nothing at all.
      expect(matched).toBeGreaterThan(1_000);
    } finally {
      db.close();
    }
  });

  it("agrees on 120000 needle x value pairs for contains", () => {
    // `contains` is `like` over an escaped needle, so it needs its own product:
    // the escaping is where a needle containing `% _ \` would otherwise leak
    // wildcard meaning into the pattern.
    const db = new DatabaseSync(":memory:");
    try {
      const glob = db.prepare("SELECT (json_extract(?, '$.v') GLOB ?) AS matched");
      const random = seededRandom(0x7e_11_c3_05);
      const values = Array.from({ length: 120 }, () => randomString(random, ALPHABET, 8));
      let comparisons = 0;
      let matched = 0;
      for (let index = 0; index < 1_000; index += 1) {
        const needle = randomString(random, ALPHABET, 4);
        const translated = likeGlobPattern(containsLikePattern(needle));
        expect(translated.kind).toBe("glob");
        for (const value of values) {
          comparisons += 1;
          const expected = likePatternMatches(value, containsLikePattern(needle));
          matched += expected ? 1 : 0;
          const actual = translated.kind === "never"
            ? false
            : glob.get(JSON.stringify({ v: value }), translated.pattern)!.matched === 1;
          if (actual !== expected) {
            throw new Error(
              `contains GLOB diverged from likePatternMatches\n` +
                `  needle: ${JSON.stringify(needle)}\n` +
                `  value:  ${JSON.stringify(value)}\n` +
                `  glob:   ${JSON.stringify(translated.kind === "never" ? null : translated.pattern)}\n` +
                `  memory: ${String(expected)}\n` +
                `  sqlite: ${String(actual)}`
            );
          }
        }
      }
      expect(comparisons).toBe(120_000);
      // Without this the differential could agree by matching nothing at all.
      expect(matched).toBeGreaterThan(1_000);
    } finally {
      db.close();
    }
  });
});

/** mulberry32: seeded so a divergence is reproducible from the printed inputs. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d_2b_79_f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomString(random: () => number, alphabet: readonly string[], maxLength: number): string {
  const length = Math.floor(random() * (maxLength + 1));
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += alphabet[Math.floor(random() * alphabet.length)];
  }
  return value;
}

function snapshot(name: string, data: Record<string, unknown>): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Note",
    name,
    version: 1,
    docstatus: "draft",
    data: data as DocumentSnapshot["data"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function recordSql(db: D1Database, sink: string[]): D1Database {
  return {
    ...db,
    prepare: (sql: string) => {
      sink.push(sql);
      return db.prepare(sql);
    }
  } as unknown as D1Database;
}
