import { D1MigrationRunner, defineD1Migration, fixedClock, planD1Migrations } from "../../src";
import { now } from "../helpers";
import { createTestD1 } from "../d1-engine.js";

describe("D1MigrationRunner", () => {
  it("applies pending migrations and records them in order", async () => {
    const d1 = createTestD1();
    const runner = new D1MigrationRunner(d1.database, { clock: fixedClock(now) });
    const migrations = [
      defineD1Migration({
        id: "0001_first",
        statements: [{ name: "create_one", sql: "CREATE TABLE one (id TEXT PRIMARY KEY);" }]
      }),
      defineD1Migration({
        id: "0002_second",
        statements: [{ name: "create_two", sql: "CREATE TABLE two (id TEXT PRIMARY KEY);" }]
      })
    ];

    await expect(runner.apply(migrations)).resolves.toEqual({
      applied: [
        {
          id: "0001_first",
          checksum: migrations[0]!.checksum,
          statementCount: 1,
          appliedAt: now
        },
        {
          id: "0002_second",
          checksum: migrations[1]!.checksum,
          statementCount: 1,
          appliedAt: now
        }
      ],
      skipped: []
    });
    expect(d1.executed).toContain("CREATE TABLE one (id TEXT PRIMARY KEY);");
    expect(d1.executed).toContain("CREATE TABLE two (id TEXT PRIMARY KEY);");
    await expect(runner.appliedMigrations()).resolves.toHaveLength(2);
  });

  it("skips already-applied migrations with matching checksums", async () => {
    const d1 = createTestD1();
    const runner = new D1MigrationRunner(d1.database, { clock: fixedClock(now) });
    const migrations = planD1Migrations([], { includeCore: true });

    await runner.apply(migrations);
    const result = await runner.apply(migrations);

    expect(result.applied).toEqual([]);
    expect(result.skipped.map((migration) => migration.id)).toEqual([
      "0001_cf_frappe_core",
      "0002_cf_frappe_job_executions",
      "0003_cf_frappe_job_execution_messages",
      "0004_cf_frappe_data_patches",
      "0005_cf_frappe_data_patch_rollbacks",
      "0006_cf_frappe_automation_runs",
      "0007_cf_frappe_events_document_name",
      "0008_cf_frappe_fold_snapshots"
    ]);
  });

  it("rejects duplicate migration ids when listing pending migrations", async () => {
    const d1 = createTestD1();
    const runner = new D1MigrationRunner(d1.database, { clock: fixedClock(now) });
    const first = defineD1Migration({
      id: "0001_first",
      statements: [{ name: "create_one", sql: "CREATE TABLE one (id TEXT PRIMARY KEY);" }]
    });
    const second = defineD1Migration({
      id: "0001_first",
      statements: [{ name: "create_two", sql: "CREATE TABLE two (id TEXT PRIMARY KEY);" }]
    });

    await expect(runner.pendingMigrations([first, second])).rejects.toMatchObject({
      code: "MIGRATION_DUPLICATE"
    });
  });

  it("rejects already-applied migrations when the planned checksum changes", async () => {
    const d1 = createTestD1();
    const runner = new D1MigrationRunner(d1.database, { clock: fixedClock(now) });
    await runner.apply([
      defineD1Migration({
        id: "0001_first",
        statements: [{ name: "create_one", sql: "CREATE TABLE one (id TEXT PRIMARY KEY);" }]
      })
    ]);

    await expect(
      runner.apply([
        defineD1Migration({
          id: "0001_first",
          statements: [{ name: "create_one_differently", sql: "CREATE TABLE one (id TEXT);" }]
        })
      ])
    ).rejects.toMatchObject({ code: "MIGRATION_CHECKSUM_MISMATCH" });
  });

  it("does not record a migration when one statement in the batch fails", async () => {
    const d1 = createTestD1({ failSqlIncludes: "CREATE INDEX fail_idx" });
    const runner = new D1MigrationRunner(d1.database, { clock: fixedClock(now) });
    const migration = defineD1Migration({
      id: "0001_first",
      statements: [
        { name: "create_one", sql: "CREATE TABLE one (id TEXT PRIMARY KEY);" },
        { name: "fail_index", sql: "CREATE INDEX fail_idx ON one(id);" }
      ]
    });

    await expect(runner.apply([migration])).rejects.toThrow("planned statement failed");

    // Ask the engine, not a bookkeeping array. Against the old fake this
    // asserted that the CREATE was absent from a list of executed statements,
    // which is a weaker thing: the statement *does* run, and the batch then
    // rolls it back. What matters is that neither the table nor the migration
    // row survives.
    expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_migrations")).toEqual([{ n: 0 }]);
    expect(d1.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'one'")).toEqual([]);
  });
});
