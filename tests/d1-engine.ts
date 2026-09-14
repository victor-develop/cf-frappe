import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

/**
 * A `D1Database` backed by a real SQLite engine, for tests whose assertions
 * depend on what the SQL *means* rather than on which statements were issued.
 *
 * The hand-written fakes this replaces are SQL-subset interpreters: they match
 * substrings of the query text and decide which rows to hand back. That cannot
 * tell a wrong query from an unfamiliar one. PR #40 hit the consequence — a
 * `not` predicate compiled to `(...) IS NOT 1`, the fake did not recognise the
 * condition, ignored it, and returned every row, so a wrong operator-inversion
 * table would have passed CI. See issue #42.
 *
 * The point of this facade is fidelity to D1's *contract*, not just to SQLite:
 * `batch` is atomic, a binding-count mismatch is the error D1 raises, and
 * parameters are coerced the way the D1 adapter's own binder does.
 */
export interface TestD1Options {
  /**
   * Statements whose SQL contains this fragment throw instead of running.
   *
   * For exercising partial-failure and rollback paths, which cannot be reached
   * by writing valid SQL.
   */
  readonly failSqlIncludes?: string;
  /**
   * Runs just before each attempted statement executes, after the binding
   * check, and records nothing.
   *
   * The one arrangement real SQL cannot express from outside the call under
   * test: a concurrent writer landing between an adapter's read and its
   * guarded write. The hook mutates the table through {@link TestD1.query},
   * so it is the statement's own WHERE guard — not a fake's in-memory check —
   * that must notice the row moved. See the data-patch journal retry races.
   */
  readonly beforeSql?: (sql: string) => void;
  /** SQL run once at open — a schema, fixtures, whatever the test needs. */
  readonly schema?: readonly string[];
}

export interface TestD1 {
  readonly database: D1Database;
  /**
   * Every SQL string *attempted*, in order, batches included.
   *
   * Attempted, not committed: a statement that ran and was then rolled back
   * still appears. Assert rollback against the database — the tables, the rows —
   * rather than against this list.
   */
  readonly executed: readonly string[];
  /**
   * Every attempted statement with the parameters it actually ran with.
   *
   * Recorded at execution, not at `bind()`: what matters is what reached the
   * engine, so a prepared-but-never-run statement and a re-`bind()` of an
   * already-run one do not appear. `executed` is this list, flattened to SQL.
   */
  readonly statements: readonly { readonly sql: string; readonly params: readonly unknown[] }[];
  /** Escape hatch for arranging or inspecting state directly. */
  query(sql: string, ...params: readonly unknown[]): readonly Record<string, unknown>[];
  close(): void;
}

const MIGRATIONS_DIRECTORY = new URL("../migrations/", import.meta.url);

/**
 * Every shipped migration, in order — the schema a deployment actually ends up
 * with, rather than a re-derivation of it.
 */
export function frameworkSchema(): readonly string[] {
  return readdirSync(MIGRATIONS_DIRECTORY)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => readFileSync(new URL(name, MIGRATIONS_DIRECTORY), "utf8"));
}

/** D1's own message when the placeholder count and the binding count disagree. */
export const D1_BINDING_MISMATCH = "Wrong number of parameter bindings for SQL query.";

export function createTestD1(options: TestD1Options = {}): TestD1 {
  const db = new DatabaseSync(":memory:");
  for (const statement of options.schema ?? []) {
    db.exec(statement);
  }
  const statements: { sql: string; params: readonly unknown[] }[] = [];

  const run = (sql: string, params: readonly unknown[]): number => {
    if (options.failSqlIncludes !== undefined && sql.includes(options.failSqlIncludes)) {
      throw new Error(`planned statement failed: ${sql}`);
    }
    assertBindingCount(sql, params);
    options.beforeSql?.(sql);
    statements.push({ sql, params });
    return Number(db.prepare(sql).run(...(params as never[])).changes);
  };

  const rows = (sql: string, params: readonly unknown[]): Record<string, unknown>[] => {
    if (options.failSqlIncludes !== undefined && sql.includes(options.failSqlIncludes)) {
      throw new Error(`planned statement failed: ${sql}`);
    }
    assertBindingCount(sql, params);
    options.beforeSql?.(sql);
    statements.push({ sql, params });
    return db.prepare(sql).all(...(params as never[])) as Record<string, unknown>[];
  };

  const statement = (sql: string, params: readonly unknown[]) => ({
    sql,
    params,
    bind: (...next: readonly unknown[]) => statement(sql, coerceParams(next)),
    all: async () => ({ results: rows(sql, params) }),
    first: async () => rows(sql, params)[0] ?? null,
    run: async () => {
      const changes = run(sql, params);
      // `meta.changes` is not decoration: `data-patch-log.ts` reads it to report
      // how many rows a patch touched, so a facade without it would report 0.
      return { success: true, meta: { changes } };
    }
  });

  const database = {
    prepare: (sql: string) => statement(sql, []),
    // D1 runs a batch as one transaction: either every statement lands or none
    // does. The previous facade mapped it to `Promise.all(...all())`, which has
    // neither the ordering nor the atomicity, so no rollback path could be
    // tested against it.
    batch: async (statements: readonly { readonly sql: string; readonly params: readonly unknown[] }[]) => {
      db.exec("BEGIN");
      try {
        const results = statements.map((entry) => ({ results: rows(entry.sql, entry.params), success: true }));
        db.exec("COMMIT");
        return results;
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
    }
  } as unknown as D1Database;

  return {
    database,
    // Live views, not snapshots: statements land as the test runs, so these
    // must be read through getters, never destructured before acting.
    get executed() {
      return statements.map((entry) => entry.sql);
    },
    statements,
    query: (sql, ...params) => db.prepare(sql).all(...(params as never[])) as Record<string, unknown>[],
    close: () => {
      db.close();
    }
  };
}

/**
 * D1 rejects a statement whose bindings do not match its placeholders.
 *
 * node:sqlite rejects only *over*-binding (`column index out of range`); it
 * NULL-fills an under-bound statement silently, which is the direction that
 * matters — it is how `d1-statistics.test.ts` once passed with its
 * `WHERE tbl IN (...)` clause removed entirely.
 *
 * Known to be stricter than real D1 in four shapes, none of which appear in
 * `src/` today: a reused `?NNN`, a named `:name`, a `?` inside a block comment,
 * and a `?` inside a `[bracketed]` or backtick-quoted identifier. If a future
 * query uses one, fix the counter rather than removing the check.
 */
function assertBindingCount(sql: string, params: readonly unknown[]): void {
  const placeholders = countPlaceholders(sql);
  if (placeholders !== params.length) {
    throw new Error(D1_BINDING_MISMATCH);
  }
}

/** `?` placeholders outside string literals and comments. */
function countPlaceholders(sql: string): number {
  let count = 0;
  let quote: string | undefined;
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index]!;
    if (quote !== undefined) {
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "-" && sql[index + 1] === "-") {
      const newline = sql.indexOf("\n", index);
      index = newline === -1 ? sql.length : newline;
      continue;
    }
    if (char === "?") {
      count += 1;
    }
  }
  return count;
}

/**
 * Binds the way real D1 binds — including refusing what it refuses.
 *
 * Measured against workerd rather than assumed. D1 throws
 * `D1_TYPE_ERROR: Type '<t>' not supported` for `undefined`, `bigint`, and any
 * object that is not an ArrayBuffer or typed array (a plain object, an array, a
 * Date). Quietly turning those into `null` or a JSON string is the dangerous
 * direction: the test goes green and production 500s on every write. Three
 * hand-written `undefined` guards in `job-execution-log.ts` would have become
 * invisible.
 *
 * `boolean` really is coerced to 1/0 by D1, and ArrayBuffer/typed arrays really
 * do bind as blobs.
 */
function coerceParams(params: readonly unknown[]): readonly unknown[] {
  return params.map((param) => {
    if (param === null) {
      return null;
    }
    if (typeof param === "boolean") {
      return param ? 1 : 0;
    }
    if (typeof param === "number" || typeof param === "string") {
      return param;
    }
    if (param instanceof ArrayBuffer || ArrayBuffer.isView(param)) {
      return param;
    }
    throw new Error(
      `D1_TYPE_ERROR: Type '${param === undefined ? "undefined" : typeof param}' not supported for value '${String(param)}'`
    );
  });
}

/**
 * A `D1Database` that records statements without running any SQL.
 *
 * For the narrow case the real engine cannot serve: asserting *which* statement
 * a builder produced and what it bound, where there is no database to query
 * because nothing is meant to execute. Anything that reads rows belongs on
 * {@link createTestD1} instead — a recorder cannot tell a wrong query from an
 * unfamiliar one, which is the whole failure mode issue #42 is about.
 *
 * So `all`/`first`/`run` throw rather than returning an empty result. Handing
 * back `[]` for a query nobody taught it is what let a real adapter change look
 * like a behaviour change in the code under test.
 */
export interface RecordingD1 {
  readonly database: D1Database;
  /** Statements prepared, in order, with the parameters bound to each. */
  readonly statements: readonly { readonly sql: string; readonly params: readonly unknown[] }[];
  /** The only statement prepared. Throws unless there is exactly one. */
  only(): { readonly sql: string; readonly params: readonly unknown[] };
}

export function createRecordingD1(): RecordingD1 {
  const statements: { sql: string; params: readonly unknown[] }[] = [];

  const make = (sql: string) => {
    const entry = { sql, params: [] as readonly unknown[] };
    statements.push(entry);
    const refuse = (method: string) => async (): Promise<never> => {
      throw new Error(
        `createRecordingD1 executes no SQL, so ${method}() on ${JSON.stringify(sql)} has no answer. ` +
          "Use createTestD1 when the assertion depends on which rows come back."
      );
    };
    const handle = {
      bind: (...params: readonly unknown[]) => {
        // Raw, deliberately. Coercing here would manufacture the very value the
        // assertion is checking for: with a JSON.stringify in this bind, a
        // production adapter that forgot its own JSON.stringify still recorded
        // the expected string, so the mutation passed here while failing on
        // main. Nothing in src/ relies on generic coercion — every D1 adapter
        // serializes at the call site — so recording exactly what was bound is
        // what makes those call sites testable.
        entry.params = params;
        return handle;
      },
      all: refuse("all"),
      first: refuse("first"),
      run: refuse("run")
    };
    return handle;
  };

  return {
    database: { prepare: (sql: string) => make(sql) } as unknown as D1Database,
    statements,
    only: () => {
      if (statements.length !== 1) {
        throw new Error(`expected exactly one prepared statement, saw ${statements.length}`);
      }
      return statements[0]!;
    }
  };
}
