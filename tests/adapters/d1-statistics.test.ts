import {
  D1_QUERIED_TABLES,
  D1_STATISTICS_TARGETS,
  analyzeD1Statistics,
  clearD1Statistics,
  readD1Statistics
} from "../../src";

describe("D1 statistics", () => {
  it("analyzes the framework tables by default, one statement per target", async () => {
    const db = new FakeD1Database();

    await expect(analyzeD1Statistics(db as unknown as D1Database)).resolves.toEqual({
      analyzed: [...D1_QUERIED_TABLES]
    });

    expect(db.executedSql).toEqual(D1_QUERIED_TABLES.map((table) => `ANALYZE ${table};`));
  });

  it("analyzes named indexes so a large table can be split under the query timeout", async () => {
    const db = new FakeD1Database();
    const targets = ["idx_cf_frappe_documents_task_status_c530bb88", "cf_frappe_documents"];

    await expect(analyzeD1Statistics(db as unknown as D1Database, { targets })).resolves.toEqual({
      analyzed: targets
    });

    expect(db.executedSql).toEqual([
      "ANALYZE idx_cf_frappe_documents_task_status_c530bb88;",
      "ANALYZE cf_frappe_documents;"
    ]);
  });

  it("rejects targets that are not plain SQL identifiers", async () => {
    const db = new FakeD1Database();
    const rejected = [
      "cf_frappe_documents; DROP TABLE cf_frappe_events",
      "cf_frappe_documents;",
      "cf_frappe_documents\n",
      "cf_frappe_documents\r\nANALYZE x",
      "cf_frappe_documents\u0000",
      "cf_frappe_documents ",
      "cf_frappe_documents --",
      "cf_frappe_documents/*x*/",
      '"cf_frappe_documents"',
      "`cf_frappe_documents`",
      "[cf_frappe_documents]",
      "main.cf_frappe_documents",
      "1_bad",
      "with space",
      " cf_frappe_documents",
      "café_table",
      "a".repeat(129),
      ""
    ];

    for (const target of rejected) {
      await expect(
        analyzeD1Statistics(db as unknown as D1Database, { targets: [target] })
      ).rejects.toMatchObject({ code: "D1_ANALYZE_TARGET_INVALID" });
    }

    expect(db.executedSql).toEqual([]);
  });

  it("rejects an empty target list", async () => {
    const db = new FakeD1Database();

    await expect(
      analyzeD1Statistics(db as unknown as D1Database, { targets: [] })
    ).rejects.toMatchObject({ code: "D1_ANALYZE_TARGETS_EMPTY" });
  });

  it("validates every target before running any statement", async () => {
    const db = new FakeD1Database();

    await expect(
      analyzeD1Statistics(db as unknown as D1Database, { targets: ["cf_frappe_documents", "bad;target"] })
    ).rejects.toMatchObject({ code: "D1_ANALYZE_TARGET_INVALID" });

    expect(db.executedSql).toEqual([]);
  });

  it("reports which targets completed when a later target fails", async () => {
    const db = new FakeD1Database({ failSqlIncludes: "ANALYZE cf_frappe_events" });

    await expect(
      analyzeD1Statistics(db as unknown as D1Database, {
        targets: ["cf_frappe_documents", "cf_frappe_events", "cf_frappe_job_executions"]
      })
    ).rejects.toMatchObject({
      code: "D1_ANALYZE_FAILED",
      message: expect.stringContaining("after completing [cf_frappe_documents]")
    });

    // The target after the failure is skipped, not attempted.
    expect(db.executedSql).toEqual(["ANALYZE cf_frappe_documents;"]);
  });

  it("distinguishes never analyzed from analyzed with no rows for the targets", async () => {
    const never = new FakeD1Database({ statTableExists: false });
    await expect(readD1Statistics(never as unknown as D1Database)).resolves.toEqual({
      analyzed: false,
      statistics: []
    });
    // A fresh D1 has no sqlite_stat1 at all, so it must never be selected from.
    expect(never.executedSql.some((sql) => sql.includes("FROM sqlite_stat1"))).toBe(false);

    const analyzedElsewhere = new FakeD1Database({
      statTableExists: true,
      stats: [{ tbl: "some_other_table", idx: "some_other_index", stat: "1" }]
    });
    await expect(readD1Statistics(analyzedElsewhere as unknown as D1Database)).resolves.toEqual({
      analyzed: true,
      statistics: []
    });
  });

  it("reads statistics for the requested targets and filters out everything else", async () => {
    const db = new FakeD1Database({
      statTableExists: true,
      stats: [
        { tbl: "_cf_METADATA", idx: null, stat: "1" },
        { tbl: "cf_frappe_documents", idx: "idx_cf_frappe_documents_list", stat: "120000 120000 60000 5000" },
        { tbl: "cf_frappe_events", idx: null, stat: "42" }
      ]
    });

    await expect(readD1Statistics(db as unknown as D1Database)).resolves.toEqual({
      analyzed: true,
      statistics: [
        { table: "cf_frappe_documents", index: "idx_cf_frappe_documents_list", stat: "120000 120000 60000 5000" },
        { table: "cf_frappe_events", index: null, stat: "42" }
      ]
    });
  });

  it("matches statistics by index name so a scoped analyze can be read back", async () => {
    const index = "idx_cf_frappe_documents_task_status_c530bb88";
    const db = new FakeD1Database({
      statTableExists: true,
      stats: [{ tbl: "cf_frappe_documents", idx: index, stat: "100000 100000 100000 200 67" }]
    });

    await expect(
      readD1Statistics(db as unknown as D1Database, { targets: [index] })
    ).resolves.toEqual({
      analyzed: true,
      statistics: [{ table: "cf_frappe_documents", index, stat: "100000 100000 100000 200 67" }]
    });
  });

  it("clears recorded statistics, and does nothing when there are none", async () => {
    const analyzed = new FakeD1Database({ statTableExists: true, stats: [] });
    await clearD1Statistics(analyzed as unknown as D1Database);
    expect(analyzed.executedSql).toContain("DELETE FROM sqlite_stat1");

    const never = new FakeD1Database({ statTableExists: false });
    await clearD1Statistics(never as unknown as D1Database);
    expect(never.executedSql.some((sql) => sql.includes("DELETE FROM sqlite_stat1"))).toBe(false);
  });

  it("exposes the queried framework tables as the default target set", () => {
    expect(D1_STATISTICS_TARGETS).toEqual(D1_QUERIED_TABLES);
    expect(D1_STATISTICS_TARGETS).toContain("cf_frappe_documents");
    expect(D1_STATISTICS_TARGETS).toContain("cf_frappe_events");
    expect(D1_STATISTICS_TARGETS).not.toContain("cf_frappe_migrations");
  });
});

interface FakeStatRow {
  readonly tbl: string;
  readonly idx: string | null;
  readonly stat: string;
}

interface FakeD1Options {
  readonly statTableExists?: boolean;
  readonly stats?: readonly FakeStatRow[];
  readonly failSqlIncludes?: string;
}

class FakeD1Database {
  readonly executedSql: string[] = [];

  constructor(private readonly options: FakeD1Options = {}) {}

  prepare(sql: string) {
    return new FakeD1PreparedStatement(this, sql);
  }

  get statTableExists(): boolean {
    return this.options.statTableExists ?? false;
  }

  get stats(): readonly FakeStatRow[] {
    return this.options.stats ?? [];
  }

  shouldFail(sql: string): boolean {
    return this.options.failSqlIncludes !== undefined && sql.includes(this.options.failSqlIncludes);
  }
}

class FakeD1PreparedStatement {
  private params: unknown[] = [];
  private bound = false;

  constructor(
    private readonly db: FakeD1Database,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    this.bound = true;
    return this;
  }

  async all() {
    // D1 rejects a statement whose placeholder count does not match its bindings,
    // so the fake must too — otherwise dropping the WHERE clause still passes.
    const placeholders = (this.sql.match(/\?/g) ?? []).length;
    if (placeholders !== this.params.length) {
      throw new Error("Wrong number of parameter bindings for SQL query.");
    }
    this.db.executedSql.push(this.sql);
    if (this.sql.includes("FROM sqlite_master")) {
      return { results: this.db.statTableExists ? [{ name: "sqlite_stat1" }] : [] };
    }
    if (this.sql.includes("FROM sqlite_stat1")) {
      if (!this.bound) {
        throw new Error("sqlite_stat1 must be queried with bound targets");
      }
      const wanted = new Set(this.params.map((param) => String(param)));
      const matched = this.db.stats.filter(
        (row) => wanted.has(row.tbl) || (row.idx !== null && wanted.has(row.idx))
      );
      return {
        results: [...matched].sort(
          (left, right) => left.tbl.localeCompare(right.tbl) || (left.idx ?? "").localeCompare(right.idx ?? "")
        )
      };
    }
    return { results: [] };
  }

  async run() {
    if (this.db.shouldFail(this.sql)) {
      throw new Error("D1_ERROR: analyze failed: SQLITE_ERROR");
    }
    this.db.executedSql.push(this.sql);
    return { success: true };
  }
}
