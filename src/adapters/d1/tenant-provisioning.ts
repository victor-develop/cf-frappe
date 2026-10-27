import { FrameworkError } from "../../core/errors.js";
import type { TenantId } from "../../core/types.js";
import type { Clock } from "../../ports/clock.js";
import type { ShardId, TenantShardAssignment, TenantShardDirectory } from "../../ports/tenant-shards.js";
import { D1MigrationRunner } from "./migrator.js";
import type { D1Migration } from "./schema-planner.js";

/** One shard's migration state. */
export interface D1ShardMigrationStatus {
  readonly shardId: ShardId;
  /** Ids applied on this shard, in id order. */
  readonly applied: readonly string[];
  /** Planned ids this shard has not applied yet, in plan order. */
  readonly pending: readonly string[];
  /** Why the shard could not be read or does not match the plan — a checksum mismatch, an unreachable database. */
  readonly error?: string;
}

export interface D1ShardRollOutStep {
  readonly shardId: ShardId;
  /**
   * `applied`: this call applied migrations here. `current`: nothing was
   * pending. `failed`: applying stopped the roll-out here. `not-attempted`: an
   * earlier shard failed, or `maxShards` was reached.
   */
  readonly outcome: "applied" | "current" | "failed" | "not-attempted";
  readonly applied: readonly string[];
  readonly error?: string;
}

export interface D1ShardRollOutResult {
  readonly steps: readonly D1ShardRollOutStep[];
  /** True when every requested shard is now current. */
  readonly complete: boolean;
}

export interface D1ShardMigrationsOptions {
  readonly shards: ReadonlyMap<ShardId, D1Database>;
  /** The full plan every shard should end up with — normally `planD1Migrations(registry.list())`. */
  readonly migrations: () => readonly D1Migration[];
  /**
   * Wrangler's own journal table (`migrations_table` in `wrangler.jsonc`,
   * `d1_migrations` by default). Read, never written, so that a shard migrated
   * with `wrangler d1 migrations apply` counts as migrated. Pass `false` to
   * trust only `cf_frappe_migrations`.
   */
  readonly wranglerMigrationsTable?: string | false;
  readonly clock?: Clock;
}

export const DEFAULT_WRANGLER_MIGRATIONS_TABLE = "d1_migrations";

/**
 * Per-shard migration tracking and rolling upgrades.
 *
 * Every shard keeps its own `cf_frappe_migrations` journal — that is what
 * `D1MigrationRunner` already reads and writes — so "which version is shard X
 * on" is a question each shard answers for itself, and a shard that missed a
 * roll-out says so rather than being assumed current.
 *
 * `rollOut` upgrades shards **one at a time, in order, and stops at the first
 * failure.** That is the rolling part: a bad migration takes down one shard's
 * upgrade, not all of them, and a re-run resumes where it stopped because the
 * runner skips what a shard has already applied. While a roll-out is under way
 * different shards run different schema versions under the same code, so
 * migrations rolled out this way have to be expand/contract: add what the new
 * code needs, deploy, roll out, and only drop what the old code needed in a
 * later release. `docs/tenant-sharding.md` spells out the order.
 */
export class D1ShardMigrations {
  private readonly current = new Set<ShardId>();

  constructor(private readonly options: D1ShardMigrationsOptions) {}

  get shardIds(): readonly ShardId[] {
    return [...this.options.shards.keys()];
  }

  async status(shardIds: readonly ShardId[] = this.shardIds): Promise<readonly D1ShardMigrationStatus[]> {
    const plan = this.options.migrations();
    const statuses: D1ShardMigrationStatus[] = [];
    for (const shardId of shardIds) {
      try {
        const applied = await this.applied(shardId);
        const pending = await this.pending(shardId, plan);
        statuses.push({ shardId, applied, pending: pending.map((migration) => migration.id) });
      } catch (error) {
        statuses.push({ shardId, applied: [], pending: [], error: errorMessage(error) });
      }
    }
    return statuses;
  }

  async rollOut(options: { readonly shards?: readonly ShardId[]; readonly maxShards?: number } = {}): Promise<D1ShardRollOutResult> {
    const shardIds = options.shards ?? this.shardIds;
    const maxShards = options.maxShards ?? shardIds.length;
    const plan = this.options.migrations();
    const steps: D1ShardRollOutStep[] = [];
    let stopped = false;
    for (const [index, shardId] of shardIds.entries()) {
      if (stopped || index >= maxShards) {
        steps.push({ shardId, outcome: "not-attempted", applied: [] });
        continue;
      }
      try {
        const result = await this.runner(shardId).apply(await this.pending(shardId, plan));
        this.current.add(shardId);
        steps.push({
          shardId,
          outcome: result.applied.length === 0 ? "current" : "applied",
          applied: result.applied.map((migration) => migration.id)
        });
      } catch (error) {
        this.current.delete(shardId);
        steps.push({ shardId, outcome: "failed", applied: [], error: errorMessage(error) });
        stopped = true;
      }
    }
    return {
      steps,
      complete: steps.every((step) => step.outcome === "applied" || step.outcome === "current")
    };
  }

  /**
   * Brings one shard up to the plan, once per isolate. What provisioning runs
   * before it places a tenant: a new tenant must never land on a shard whose
   * schema is behind the code.
   */
  async ensureCurrent(shardId: ShardId): Promise<void> {
    if (this.current.has(shardId)) {
      return;
    }
    await this.runner(shardId).apply(await this.pending(shardId, this.options.migrations()));
    this.current.add(shardId);
  }

  /**
   * Ids `shardId` has applied, by either journal, sorted. Also the mover's check
   * that a target is not behind its source.
   *
   * A Wrangler journal row names a file — `0009_cf_frappe_tenant_shards.sql`
   * for a core migration, `0012_doctype_task_v1_indexes.sql` for one `cf-frappe
   * migrate generate` wrote — and the id is that name without `.sql`, and
   * without the generated four-digit prefix when the id does not carry it.
   */
  async applied(shardId: ShardId): Promise<readonly string[]> {
    const own = (await this.runner(shardId).appliedMigrations()).map((migration) => migration.id);
    const wrangler = await this.wranglerApplied(shardId);
    return [...new Set([...own, ...wrangler])].sort();
  }

  private async pending(shardId: ShardId, plan: readonly D1Migration[]): Promise<readonly D1Migration[]> {
    const wrangler = new Set(await this.wranglerApplied(shardId));
    const byWrangler = (migration: D1Migration) =>
      wrangler.has(migration.id) || [...wrangler].some((name) => /^\d{4}_/.test(name) && name.slice(5) === migration.id);
    // What Wrangler applied is taken as applied: it keeps no checksum to compare.
    // Everything else goes through the runner, which refuses a checksum mismatch.
    return this.runner(shardId).pendingMigrations(plan.filter((migration) => !byWrangler(migration)));
  }

  private async wranglerApplied(shardId: ShardId): Promise<readonly string[]> {
    const table = this.options.wranglerMigrationsTable ?? DEFAULT_WRANGLER_MIGRATIONS_TABLE;
    if (table === false) {
      return [];
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(table)) {
      throw new FrameworkError("TENANT_SHARD_INVALID", `'${table}' is not a valid migrations table name`, { status: 500 });
    }
    const db = this.database(shardId);
    const exists = await db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .bind(table)
      .first<{ name: string }>();
    if (exists === null) {
      return [];
    }
    // The table name is checked against a plain-identifier pattern above and
    // cannot be bound as a parameter.
    const result = await db.prepare(`SELECT name FROM ${table}`).all<{ name: string | null }>();
    return (result.results ?? [])
      .map((row) => row.name)
      .filter((name): name is string => typeof name === "string")
      .map((name) => name.replace(/\.sql$/, ""));
  }

  private database(shardId: ShardId): D1Database {
    const db = this.options.shards.get(shardId);
    if (db === undefined) {
      throw new FrameworkError("TENANT_SHARD_NOT_FOUND", `Shard '${shardId}' is not bound in this deployment`, {
        status: 404
      });
    }
    return db;
  }

  private runner(shardId: ShardId): D1MigrationRunner {
    return new D1MigrationRunner(this.database(shardId), this.options.clock === undefined ? {} : { clock: this.options.clock });
  }
}

/**
 * Where tenants with no assignment go on their first write.
 *
 * - `home` (the default): onto the home shard, `DB`. Switching sharding on then
 *   changes nothing for anyone: every existing tenant already lives there, and
 *   new ones keep arriving there until an operator moves them.
 * - `place`: onto the accepting shard with the fewest tenants, after bringing
 *   its migrations up to date.
 */
export type TenantPlacementPolicy = "home" | "place";

export interface D1TenantProvisionerOptions {
  readonly directory: TenantShardDirectory;
  readonly migrations: D1ShardMigrations;
  readonly home: ShardId;
  readonly newTenants?: TenantPlacementPolicy;
  /** Shards that take new tenants under `place`. Defaults to every shard. */
  readonly accepting?: readonly ShardId[];
  /**
   * Overrides the fewest-tenants choice. Given the accepting shards and their
   * current tenant counts; must return one of them.
   */
  readonly choose?: (input: {
    readonly tenantId: TenantId;
    readonly candidates: readonly { readonly shardId: ShardId; readonly tenants: number }[];
  }) => ShardId;
}

/**
 * Provisions tenants: picks a shard, migrates it, records the assignment.
 *
 * Runs automatically on a tenant's first write (the router calls it), and can be
 * called ahead of time — at sign-up, say — to place a tenant before it writes
 * anything, or to put a known-large tenant on a shard of its own.
 *
 * What it cannot do is create a D1 database. A Worker can only query databases
 * bound to it at deploy time (up to about 5,000 per Worker — see
 * https://developers.cloudflare.com/d1/platform/limits/), so new shards are
 * created with `wrangler d1 create`, bound, and deployed; provisioning places
 * tenants across the shards that exist. `docs/tenant-sharding.md` covers adding
 * a shard.
 */
export class D1TenantProvisioner {
  constructor(private readonly options: D1TenantProvisionerOptions) {}

  async provision(tenantId: TenantId, request: { readonly shardId?: ShardId } = {}): Promise<TenantShardAssignment> {
    const existing = await this.options.directory.get(tenantId);
    if (existing !== null) {
      return existing;
    }
    const shardId = request.shardId ?? (await this.place(tenantId));
    if (!this.options.migrations.shardIds.includes(shardId)) {
      throw new FrameworkError("TENANT_SHARD_NOT_FOUND", `Shard '${shardId}' is not bound in this deployment`, {
        status: 404
      });
    }
    // The home shard is `DB`, which the deployment migrates itself; every
    // other shard is brought up to the plan before a tenant can land on it.
    if (shardId !== this.options.home || request.shardId !== undefined) {
      await this.options.migrations.ensureCurrent(shardId);
    }
    return this.options.directory.assign(tenantId, shardId);
  }

  private async place(tenantId: TenantId): Promise<ShardId> {
    if ((this.options.newTenants ?? "home") === "home") {
      return this.options.home;
    }
    const accepting = this.options.accepting ?? this.options.migrations.shardIds;
    if (accepting.length === 0) {
      throw new FrameworkError("TENANT_SHARD_INVALID", "No shard accepts new tenants", { status: 503 });
    }
    const counts = await this.options.directory.countByShard();
    const candidates = accepting.map((shardId) => ({ shardId, tenants: counts.get(shardId) ?? 0 }));
    if (this.options.choose !== undefined) {
      const chosen = this.options.choose({ tenantId, candidates });
      if (!accepting.includes(chosen)) {
        throw new FrameworkError("TENANT_SHARD_INVALID", `Placement chose '${chosen}', which does not accept new tenants`, {
          status: 500
        });
      }
      return chosen;
    }
    // Fewest tenants, ties to the earliest-listed shard: deterministic, so two
    // isolates placing different tenants at once spread rather than pile up
    // only by as much as their counts were stale.
    return candidates.reduce((best, candidate) => (candidate.tenants < best.tenants ? candidate : best)).shardId;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
