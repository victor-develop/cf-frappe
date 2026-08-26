import { readFileSync } from "node:fs";
import {
  D1_AUTOMATION_RUNS_TABLE,
  D1_DATA_PATCHES_TABLE,
  D1_DOCUMENTS_TABLE,
  D1_EVENTS_TABLE,
  D1_JOB_EXECUTIONS_TABLE,
  D1_MIGRATIONS_TABLE,
  D1_QUERIED_TABLES,
  D1_STATISTICS_TARGETS,
  D1_TABLES,
  planD1Migrations
} from "../../src";
import { isMetadataName, isPlainIdentifier } from "../../src/core/identifiers.js";

const MIGRATION_SQL = [
  "0001_cf_frappe_core",
  "0002_cf_frappe_job_executions",
  "0003_cf_frappe_job_execution_messages",
  "0004_cf_frappe_data_patches",
  "0005_cf_frappe_data_patch_rollbacks",
  "0006_cf_frappe_automation_runs"
]
  .map((id) => readFileSync(new URL(`../../migrations/${id}.sql`, import.meta.url), "utf8"))
  .join("\n");

describe("D1 table constants", () => {
  it("names every table the checked-in migrations create", () => {
    const created = [...MIGRATION_SQL.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([A-Za-z_][A-Za-z0-9_]*)/g)]
      .map((match) => match[1]!)
      // Intermediate tables that a later migration renames away.
      .filter((table) => !table.endsWith("_before_rollbacks"));

    expect([...new Set(created)].sort()).toEqual([...D1_TABLES].sort());
  });

  it("plans core migrations that only touch the named tables", () => {
    const sql = planD1Migrations([])
      .flatMap((migration) => migration.statements.map((statement) => statement.sql))
      .join("\n");
    const referenced = [...sql.matchAll(/\b(cf_frappe_[a-z_]+)\b/g)].map((match) => match[1]!);

    for (const table of new Set(referenced)) {
      const known =
        D1_TABLES.includes(table) ||
        // Index names and the rollback rename target embed a table name.
        table.startsWith("cf_frappe_data_patches_") ||
        D1_TABLES.some((owner) => table.startsWith(`${owner}_`));
      expect(known, `unexpected table reference '${table}'`).toBe(true);
    }
  });

  it("derives the statistics targets from the queried tables", () => {
    expect(D1_STATISTICS_TARGETS).toEqual(D1_QUERIED_TABLES);
    // Only the migration journal is excluded: it is read once per migrate.
    expect(D1_TABLES.filter((table) => !D1_QUERIED_TABLES.includes(table))).toEqual([
      D1_MIGRATIONS_TABLE
    ]);
  });

  it("keeps every table name a plain SQL identifier", () => {
    for (const table of D1_TABLES) {
      expect(isPlainIdentifier(table), table).toBe(true);
    }
    expect(D1_TABLES).toContain(D1_DOCUMENTS_TABLE);
    expect(D1_TABLES).toContain(D1_EVENTS_TABLE);
    expect(D1_TABLES).toContain(D1_JOB_EXECUTIONS_TABLE);
    expect(D1_TABLES).toContain(D1_DATA_PATCHES_TABLE);
    expect(D1_TABLES).toContain(D1_AUTOMATION_RUNS_TABLE);
  });
});

describe("identifier predicates", () => {
  it("accepts author-facing metadata names, including spaces", () => {
    for (const value of ["Task", "Sales Order", "customer id", "A1_b 2"]) {
      expect(isMetadataName(value), value).toBe(true);
    }
  });

  it("rejects metadata names that do not start with a letter or contain punctuation", () => {
    for (const value of ["", "_leading", "1Task", "Task;", "Task-1", "Task\n", "Task."]) {
      expect(isMetadataName(value), JSON.stringify(value)).toBe(false);
    }
  });

  it("accepts machine-facing identifiers without spaces", () => {
    for (const value of ["cf_frappe_documents", "_env", "A1_b2"]) {
      expect(isPlainIdentifier(value), value).toBe(true);
    }
  });

  it("rejects plain identifiers with spaces or SQL punctuation", () => {
    // The metadata shape allows spaces; the SQL shape must not, because these
    // values are interpolated into statements that take no bound parameters.
    for (const value of ["customer id", "Sales Order", "t; DROP TABLE x", "t--", "1t", "", "t\n"]) {
      expect(isPlainIdentifier(value), JSON.stringify(value)).toBe(false);
    }
  });
});
