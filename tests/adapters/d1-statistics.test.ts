import {
  D1_QUERIED_TABLES,
  D1_STATISTICS_TARGETS,
  analyzeD1Statistics,
  clearD1Statistics,
  readD1Statistics
} from "../../src";
import { createTestD1, frameworkSchema } from "../d1-engine.js";

describe("D1 statistics", () => {
  it("analyzes the framework tables by default, one statement per target", async () => {
    const d1 = createTestD1({ schema: frameworkSchema() });

    await expect(analyzeD1Statistics(d1.database)).resolves.toEqual({
      analyzed: [...D1_QUERIED_TABLES]
    });

    expect(d1.executed).toEqual(D1_QUERIED_TABLES.map((table) => `ANALYZE ${table};`));
  });

  it("analyzes named indexes so a large table can be split under the query timeout", async () => {
    // A doctype-generated index, which the framework schema does not carry.
    // Against a real engine ANALYZE on a missing target fails, which is itself
    // worth having: the old fake accepted any name at all.
    const d1 = createTestD1({
      schema: [
        ...frameworkSchema(),
        "CREATE INDEX idx_cf_frappe_documents_task_status_c530bb88 ON cf_frappe_documents(tenant_id, doctype);"
      ]
    });
    const targets = ["idx_cf_frappe_documents_task_status_c530bb88", "cf_frappe_documents"];

    await expect(analyzeD1Statistics(d1.database, { targets })).resolves.toEqual({
      analyzed: targets
    });

    expect(d1.executed).toEqual([
      "ANALYZE idx_cf_frappe_documents_task_status_c530bb88;",
      "ANALYZE cf_frappe_documents;"
    ]);
  });

  it("rejects targets that are not plain SQL identifiers", async () => {
    const d1 = createTestD1({ schema: frameworkSchema() });
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
        analyzeD1Statistics(d1.database, { targets: [target] })
      ).rejects.toMatchObject({ code: "D1_ANALYZE_TARGET_INVALID" });
    }

    expect(d1.executed).toEqual([]);
  });

  it("rejects an empty target list", async () => {
    const d1 = createTestD1({ schema: frameworkSchema() });

    await expect(
      analyzeD1Statistics(d1.database, { targets: [] })
    ).rejects.toMatchObject({ code: "D1_ANALYZE_TARGETS_EMPTY" });
  });

  it("validates every target before running any statement", async () => {
    const d1 = createTestD1({ schema: frameworkSchema() });

    await expect(
      analyzeD1Statistics(d1.database, { targets: ["cf_frappe_documents", "bad;target"] })
    ).rejects.toMatchObject({ code: "D1_ANALYZE_TARGET_INVALID" });

    expect(d1.executed).toEqual([]);
  });

  it("reports which targets completed when a later target fails", async () => {
    const d1 = createTestD1({ schema: frameworkSchema(), failSqlIncludes: "ANALYZE cf_frappe_events" });

    await expect(
      analyzeD1Statistics(d1.database, {
        targets: ["cf_frappe_documents", "cf_frappe_events", "cf_frappe_job_executions"]
      })
    ).rejects.toMatchObject({
      code: "D1_ANALYZE_FAILED",
      message: expect.stringContaining("after completing [cf_frappe_documents]")
    });

    // The target after the failure is skipped, not attempted.
    expect(d1.executed).toEqual(["ANALYZE cf_frappe_documents;"]);
  });

  it("distinguishes never analyzed from analyzed with no rows for the targets", async () => {
    // No ANALYZE has run, so `sqlite_stat1` does not exist at all.
    const never = createTestD1({ schema: frameworkSchema() });
    await expect(readD1Statistics(never.database)).resolves.toEqual({
      analyzed: false,
      statistics: []
    });
    // A fresh D1 has no sqlite_stat1 at all, so it must never be selected from.
    expect(never.executed.some((sql) => sql.includes("FROM sqlite_stat1"))).toBe(false);

    const analyzedElsewhere = withStatistics([{ tbl: "some_other_table", idx: "some_other_index", stat: "1" }]);
    await expect(readD1Statistics(analyzedElsewhere.database)).resolves.toEqual({
      analyzed: true,
      statistics: []
    });
  });

  it("reads statistics for the requested targets and filters out everything else", async () => {
    const d1 = withStatistics([
        { tbl: "_cf_METADATA", idx: null, stat: "1" },
        { tbl: "cf_frappe_documents", idx: "idx_cf_frappe_documents_list", stat: "120000 120000 60000 5000" },
        { tbl: "cf_frappe_events", idx: null, stat: "42" }
      ]);

    await expect(readD1Statistics(d1.database)).resolves.toEqual({
      analyzed: true,
      statistics: [
        { table: "cf_frappe_documents", index: "idx_cf_frappe_documents_list", stat: "120000 120000 60000 5000" },
        { table: "cf_frappe_events", index: null, stat: "42" }
      ]
    });
  });

  it("matches statistics by index name so a scoped analyze can be read back", async () => {
    const index = "idx_cf_frappe_documents_task_status_c530bb88";
    const d1 = withStatistics([{ tbl: "cf_frappe_documents", idx: index, stat: "100000 100000 100000 200 67" }]);

    await expect(
      readD1Statistics(d1.database, { targets: [index] })
    ).resolves.toEqual({
      analyzed: true,
      statistics: [{ table: "cf_frappe_documents", index, stat: "100000 100000 100000 200 67" }]
    });
  });

  it("clears recorded statistics, and does nothing when there are none", async () => {
    const analyzed = withStatistics([]);
    await clearD1Statistics(analyzed.database);
    expect(analyzed.executed).toContain("DELETE FROM sqlite_stat1");

    // No ANALYZE has run, so `sqlite_stat1` does not exist at all.
    const never = createTestD1({ schema: frameworkSchema() });
    await clearD1Statistics(never.database);
    expect(never.executed.some((sql) => sql.includes("DELETE FROM sqlite_stat1"))).toBe(false);
  });

  it("exposes the queried framework tables as the default target set", () => {
    expect(D1_STATISTICS_TARGETS).toEqual(D1_QUERIED_TABLES);
    expect(D1_STATISTICS_TARGETS).toContain("cf_frappe_documents");
    expect(D1_STATISTICS_TARGETS).toContain("cf_frappe_events");
    expect(D1_STATISTICS_TARGETS).not.toContain("cf_frappe_migrations");
  });
});

/**
 * Puts rows into the engine's real `sqlite_stat1`.
 *
 * `ANALYZE` creates that table; after that it is an ordinary table and can be
 * written to. Seeding it directly keeps these tests' fixtures while leaving the
 * query under test — `FROM sqlite_stat1 WHERE tbl IN (...)` — to be executed by
 * SQLite. That is the difference that matters: against the old fake, deleting
 * the whole `WHERE` clause left every test green.
 */
function withStatistics(rows: readonly { tbl: string; idx: string | null; stat: string }[]) {
  const d1 = createTestD1({ schema: frameworkSchema() });
  d1.query("ANALYZE cf_frappe_documents");
  d1.query("DELETE FROM sqlite_stat1");
  // Reversed on purpose: inserting in the order the assertions expect made
  // `ORDER BY tbl ASC, idx ASC` vacuous — rowid order already satisfied it, so
  // deleting the clause from the production query passed.
  for (const row of [...rows].reverse()) {
    d1.query("INSERT INTO sqlite_stat1 (tbl, idx, stat) VALUES (?, ?, ?)", row.tbl, row.idx, row.stat);
  }
  return d1;
}
