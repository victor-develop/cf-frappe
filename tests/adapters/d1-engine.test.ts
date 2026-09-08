import { describe, expect, it } from "vitest";
import { D1_BINDING_MISMATCH, createRecordingD1, createTestD1 } from "../d1-engine.js";

const SCHEMA = ["CREATE TABLE t (id TEXT PRIMARY KEY, n INTEGER)"];

describe("test D1 facade", () => {
  it("executes real SQL rather than matching on the query text", async () => {
    // The point of the whole exercise: a condition the facade has never seen
    // still filters, because SQLite evaluates it. A substring-matching fake
    // ignores what it does not recognise and hands back every row.
    const d1 = createTestD1({ schema: SCHEMA });
    await d1.database.prepare("INSERT INTO t VALUES (?, ?)").bind("a", 1).run();
    await d1.database.prepare("INSERT INTO t VALUES (?, ?)").bind("b", 2).run();

    const { results } = await d1.database
      .prepare("SELECT id FROM t WHERE (n = ?) IS NOT 1")
      .bind(1)
      .all();

    expect(results).toEqual([{ id: "b" }]);
    d1.close();
  });

  it("rejects a binding count that does not match the placeholders", async () => {
    // D1 raises this; node:sqlite does not. Without it, a mutation that deletes
    // a whole WHERE clause leaves its test green.
    const d1 = createTestD1({ schema: SCHEMA });

    await expect(d1.database.prepare("SELECT * FROM t WHERE id = ?").all()).rejects.toThrow(
      D1_BINDING_MISMATCH
    );
    await expect(
      d1.database.prepare("SELECT * FROM t WHERE id = ?").bind("a", "b").all()
    ).rejects.toThrow(D1_BINDING_MISMATCH);
    d1.close();
  });

  it("does not count a ? inside a string literal or a comment as a placeholder", async () => {
    const d1 = createTestD1({ schema: SCHEMA });
    await d1.database.prepare("INSERT INTO t VALUES ('what?', 1)").run();

    await expect(
      d1.database.prepare("SELECT id FROM t WHERE id = 'what?' -- is this ?\n").all()
    ).resolves.toMatchObject({ results: [{ id: "what?" }] });
    d1.close();
  });

  it("applies a batch atomically", async () => {
    // D1 commits a batch as one transaction. The previous facade mapped it to
    // Promise.all, which has neither the ordering nor the atomicity — so no
    // rollback path could be tested against it at all.
    const d1 = createTestD1({ schema: SCHEMA });

    await expect(
      d1.database.batch([
        d1.database.prepare("INSERT INTO t VALUES (?, ?)").bind("a", 1),
        d1.database.prepare("INSERT INTO t VALUES (?, ?)").bind("a", 2)
      ])
    ).rejects.toThrow();

    expect(d1.query("SELECT COUNT(*) AS n FROM t")).toEqual([{ n: 0 }]);
    d1.close();
  });

  it("commits a batch that succeeds, in order", async () => {
    const d1 = createTestD1({ schema: SCHEMA });

    await d1.database.batch([
      d1.database.prepare("INSERT INTO t VALUES (?, ?)").bind("a", 1),
      d1.database.prepare("UPDATE t SET n = ? WHERE id = ?").bind(9, "a")
    ]);

    expect(d1.query("SELECT n FROM t WHERE id = 'a'")).toEqual([{ n: 9 }]);
    d1.close();
  });

  it("injects a failure for statements no valid SQL could fail on", async () => {
    const d1 = createTestD1({ schema: SCHEMA, failSqlIncludes: "UPDATE t" });

    await d1.database.prepare("INSERT INTO t VALUES (?, ?)").bind("a", 1).run();
    await expect(d1.database.prepare("UPDATE t SET n = ? WHERE id = ?").bind(2, "a").run()).rejects.toThrow(
      "planned statement failed"
    );
    expect(d1.query("SELECT n FROM t WHERE id = 'a'")).toEqual([{ n: 1 }]);
    d1.close();
  });

  it("records every statement it ran, batches included", async () => {
    const d1 = createTestD1({ schema: SCHEMA });
    await d1.database.prepare("INSERT INTO t VALUES (?, ?)").bind("a", 1).run();
    await d1.database.batch([d1.database.prepare("SELECT id FROM t WHERE id = ?").bind("a")]);

    expect(d1.executed).toEqual([
      "INSERT INTO t VALUES (?, ?)",
      "SELECT id FROM t WHERE id = ?"
    ]);
    d1.close();
  });

  it("binds booleans, blobs and null the way D1 does", async () => {
    const d1 = createTestD1({ schema: ["CREATE TABLE v (a, b, c, d)"] });

    await d1.database
      .prepare("INSERT INTO v VALUES (?, ?, ?, ?)")
      .bind(true, false, null, new Uint8Array([1, 2]))
      .run();

    expect(d1.query("SELECT a, b, c FROM v")).toEqual([{ a: 1, b: 0, c: null }]);
    d1.close();
  });

  it("refuses the value types real D1 refuses", async () => {
    // Measured against workerd, not assumed: D1 throws D1_TYPE_ERROR for each
    // of these. Coercing them silently is the dangerous direction — the test
    // goes green and production 500s on every write. Three hand-written
    // `undefined` guards in job-execution-log.ts depend on this failing.
    const d1 = createTestD1({ schema: ["CREATE TABLE v (a)"] });
    const insert = () => d1.database.prepare("INSERT INTO v VALUES (?)");

    for (const value of [undefined, { k: 1 }, [1, 2], new Date(0), 5n]) {
      expect(() => insert().bind(value), String(value)).toThrow("D1_TYPE_ERROR");
    }
    d1.close();
  });

  it("reports how many rows a write changed", async () => {
    // `data-patch-log.ts` reads `meta.changes` to report the size of a patch, so
    // a facade without it would have that read silently return 0.
    const d1 = createTestD1({ schema: ["CREATE TABLE v (a)"] });
    await d1.database.prepare("INSERT INTO v VALUES (?)").bind(1).run();
    await d1.database.prepare("INSERT INTO v VALUES (?)").bind(2).run();

    const result = await d1.database.prepare("UPDATE v SET a = a + ?").bind(10).run();

    expect(result.meta.changes).toBe(2);
    d1.close();
  });

  it("returns the first row from first(), not the last", async () => {
    // Load-bearing for the adapters still to convert: projection-store,
    // document-store, event-store, job-execution-log and data-patch-log all
    // read a single row through it.
    const d1 = createTestD1({ schema: ["CREATE TABLE v (a INTEGER)"] });
    await d1.database.prepare("INSERT INTO v VALUES (1), (2), (3)").run();

    await expect(d1.database.prepare("SELECT a FROM v ORDER BY a ASC").first()).resolves.toEqual({ a: 1 });
    await expect(d1.database.prepare("SELECT a FROM v WHERE a > ?").bind(9).first()).resolves.toBeNull();
    d1.close();
  });
});

describe("recording D1", () => {
  it("records exactly what was bound, without coercing it", async () => {
    // The regression this exists to prevent: an earlier version JSON-stringified
    // here, which manufactured the very string the assertion checks for. A
    // production adapter that dropped its own JSON.stringify then recorded the
    // expected value and passed — while the same mutation failed on main.
    const d1 = createRecordingD1();
    const payload = { kind: "DocumentCreated" };

    d1.database.prepare("INSERT INTO t VALUES (?, ?, ?)").bind(payload, true, undefined);

    expect(d1.only().params[0]).toBe(payload);
    expect(d1.only().params).toEqual([payload, true, undefined]);
  });

  it("refuses to answer a query, because it executes nothing", async () => {
    // Returning [] for a query nobody taught it is the failure mode issue #42 is
    // about: it cannot tell a wrong query from an unfamiliar one.
    const d1 = createRecordingD1();
    const statement = d1.database.prepare("SELECT * FROM t");

    await expect(statement.all()).rejects.toThrow("executes no SQL");
    await expect(statement.first()).rejects.toThrow("createTestD1");
    await expect(statement.run()).rejects.toThrow("executes no SQL");
  });

  it("refuses only() unless exactly one statement was prepared", () => {
    const none = createRecordingD1();
    expect(() => none.only()).toThrow("saw 0");

    const two = createRecordingD1();
    two.database.prepare("SELECT 1");
    two.database.prepare("SELECT 2");
    expect(() => two.only()).toThrow("saw 2");
  });
});
