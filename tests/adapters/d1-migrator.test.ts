import { D1MigrationRunner, defineD1Migration, fixedClock, planD1Migrations } from "../../src";
import { now } from "../helpers";

describe("D1MigrationRunner", () => {
  it("applies pending migrations and records them in order", async () => {
    const db = new FakeD1Database();
    const runner = new D1MigrationRunner(db as unknown as D1Database, { clock: fixedClock(now) });
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
    expect(db.executedSql).toContain("CREATE TABLE one (id TEXT PRIMARY KEY);");
    expect(db.executedSql).toContain("CREATE TABLE two (id TEXT PRIMARY KEY);");
    await expect(runner.appliedMigrations()).resolves.toHaveLength(2);
  });

  it("skips already-applied migrations with matching checksums", async () => {
    const db = new FakeD1Database();
    const runner = new D1MigrationRunner(db as unknown as D1Database, { clock: fixedClock(now) });
    const migrations = planD1Migrations([], { includeCore: true });

    await runner.apply(migrations);
    const result = await runner.apply(migrations);

    expect(result.applied).toEqual([]);
    expect(result.skipped.map((migration) => migration.id)).toEqual([
      "0001_cf_frappe_core",
      "0002_cf_frappe_job_executions",
      "0003_cf_frappe_job_execution_messages",
      "0004_cf_frappe_data_patches"
    ]);
  });

  it("rejects duplicate migration ids when listing pending migrations", async () => {
    const db = new FakeD1Database();
    const runner = new D1MigrationRunner(db as unknown as D1Database, { clock: fixedClock(now) });
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
    const db = new FakeD1Database();
    const runner = new D1MigrationRunner(db as unknown as D1Database, { clock: fixedClock(now) });
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
    const db = new FakeD1Database({ failSqlIncludes: "CREATE INDEX fail_idx" });
    const runner = new D1MigrationRunner(db as unknown as D1Database, { clock: fixedClock(now) });
    const migration = defineD1Migration({
      id: "0001_first",
      statements: [
        { name: "create_one", sql: "CREATE TABLE one (id TEXT PRIMARY KEY);" },
        { name: "fail_index", sql: "CREATE INDEX fail_idx ON one(id);" }
      ]
    });

    await expect(runner.apply([migration])).rejects.toThrow("planned statement failed");

    expect(db.migrations.size).toBe(0);
    expect(db.executedSql).not.toContain("CREATE TABLE one (id TEXT PRIMARY KEY);");
  });
});

class FakeD1Database {
  readonly migrations = new Map<string, { checksum: string; statement_count: number; applied_at: string }>();
  readonly executedSql: string[] = [];
  private readonly failSqlIncludes: string | undefined;

  constructor(options: { readonly failSqlIncludes?: string } = {}) {
    this.failSqlIncludes = options.failSqlIncludes;
  }

  prepare(sql: string) {
    return new FakeD1PreparedStatement(this, sql);
  }

  async batch(statements: FakeD1PreparedStatement[]) {
    const migrations = new Map(this.migrations);
    const executedSql = [...this.executedSql];
    try {
      const results = [];
      for (const statement of statements) {
        results.push(await statement.run());
      }
      return results;
    } catch (error) {
      this.migrations.clear();
      for (const [id, migration] of migrations) {
        this.migrations.set(id, migration);
      }
      this.executedSql.length = 0;
      this.executedSql.push(...executedSql);
      throw error;
    }
  }

  shouldFail(sql: string): boolean {
    return this.failSqlIncludes !== undefined && sql.includes(this.failSqlIncludes);
  }
}

class FakeD1PreparedStatement {
  private params: unknown[] = [];

  constructor(
    private readonly db: FakeD1Database,
    private readonly sql: string
  ) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }

  async all() {
    if (this.sql.includes("FROM cf_frappe_migrations")) {
      return {
        results: [...this.db.migrations.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([id, migration]) => ({
            id,
            checksum: migration.checksum,
            statement_count: migration.statement_count,
            applied_at: migration.applied_at
          }))
      };
    }
    return { results: [] };
  }

  async run() {
    if (this.db.shouldFail(this.sql)) {
      throw new Error("planned statement failed");
    }
    if (this.sql.includes("INSERT INTO cf_frappe_migrations")) {
      const [id, checksum, statement_count, applied_at] = this.params;
      this.db.migrations.set(String(id), {
        checksum: String(checksum),
        statement_count: Number(statement_count),
        applied_at: String(applied_at)
      });
      return { success: true };
    }
    this.db.executedSql.push(this.sql);
    return { success: true };
  }
}
