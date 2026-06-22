import { FrameworkError } from "../../core/errors.js";
import type { Clock } from "../../ports/clock.js";
import { systemClock } from "../../ports/clock.js";
import type { D1Migration } from "./schema-planner.js";

export interface AppliedD1Migration {
  readonly id: string;
  readonly checksum: string;
  readonly statementCount: number;
  readonly appliedAt: string;
}

export interface D1MigrationResult {
  readonly applied: readonly AppliedD1Migration[];
  readonly skipped: readonly AppliedD1Migration[];
}

interface AppliedD1MigrationRow {
  readonly id: string;
  readonly checksum: string;
  readonly statement_count: number;
  readonly applied_at: string;
}

export class D1MigrationRunner {
  private readonly db: D1Database;
  private readonly clock: Clock;

  constructor(db: D1Database, options: { readonly clock?: Clock } = {}) {
    this.db = db;
    this.clock = options.clock ?? systemClock;
  }

  async appliedMigrations(): Promise<readonly AppliedD1Migration[]> {
    await this.ensureMigrationTable();
    const result = await this.db
      .prepare(
        `SELECT id, checksum, statement_count, applied_at
         FROM cf_frappe_migrations
         ORDER BY id ASC`
      )
      .all<AppliedD1MigrationRow>();
    return (result.results ?? []).map(appliedMigrationFromRow);
  }

  async pendingMigrations(migrations: readonly D1Migration[]): Promise<readonly D1Migration[]> {
    assertUniqueMigrationIds(migrations);
    const appliedById = new Map((await this.appliedMigrations()).map((migration) => [migration.id, migration]));
    return migrations.filter((migration) => {
      const applied = appliedById.get(migration.id);
      if (!applied) {
        return true;
      }
      assertChecksumMatches(migration, applied);
      return false;
    });
  }

  async apply(migrations: readonly D1Migration[]): Promise<D1MigrationResult> {
    assertUniqueMigrationIds(migrations);
    await this.ensureMigrationTable();
    const appliedById = new Map((await this.appliedMigrations()).map((migration) => [migration.id, migration]));
    const applied: AppliedD1Migration[] = [];
    const skipped: AppliedD1Migration[] = [];

    for (const migration of migrations) {
      const existing = appliedById.get(migration.id);
      if (existing) {
        assertChecksumMatches(migration, existing);
        skipped.push(existing);
        continue;
      }

      const appliedAt = this.clock.now();
      await this.db.batch([
        ...migration.statements.map((statement) => this.db.prepare(statement.sql)),
        this.db
          .prepare(
            `INSERT INTO cf_frappe_migrations
             (id, checksum, statement_count, applied_at)
             VALUES (?, ?, ?, ?)`
          )
          .bind(migration.id, migration.checksum, migration.statements.length, appliedAt)
      ]);
      const record = {
        id: migration.id,
        checksum: migration.checksum,
        statementCount: migration.statements.length,
        appliedAt
      };
      applied.push(record);
      appliedById.set(record.id, record);
    }

    return { applied, skipped };
  }

  private async ensureMigrationTable(): Promise<void> {
    await this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS cf_frappe_migrations (
           id TEXT PRIMARY KEY,
           checksum TEXT NOT NULL,
           statement_count INTEGER NOT NULL,
           applied_at TEXT NOT NULL
         )`
      )
      .run();
  }
}

function appliedMigrationFromRow(row: AppliedD1MigrationRow): AppliedD1Migration {
  return {
    id: row.id,
    checksum: row.checksum,
    statementCount: Number(row.statement_count),
    appliedAt: row.applied_at
  };
}

function assertChecksumMatches(migration: D1Migration, applied: AppliedD1Migration): void {
  if (migration.checksum !== applied.checksum) {
    throw new FrameworkError(
      "MIGRATION_CHECKSUM_MISMATCH",
      `Applied migration '${migration.id}' has checksum '${applied.checksum}' but planned '${migration.checksum}'`,
      { status: 409 }
    );
  }
}

function assertUniqueMigrationIds(migrations: readonly D1Migration[]): void {
  const seen = new Set<string>();
  for (const migration of migrations) {
    if (seen.has(migration.id)) {
      throw new FrameworkError("MIGRATION_DUPLICATE", `Migration '${migration.id}' is defined more than once`, {
        status: 409
      });
    }
    seen.add(migration.id);
  }
}
