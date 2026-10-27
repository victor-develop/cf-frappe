import {
  D1DocumentStore,
  D1EventStore,
  D1ProjectionStore,
  D1ShardMigrations,
  D1SnapshotStore,
  D1TenantMover,
  D1TenantProvisioner,
  D1TenantShardDirectory,
  isD1TenantFencedError,
  planD1Migrations,
  type D1Migration,
  type TenantPlacementPolicy
} from "../adapters/d1/index.js";
import {
  TenantRoutedDocumentStore,
  TenantRoutedEventStore,
  TenantRoutedProjectionStore,
  TenantRoutedSnapshotStore,
  TenantScatterGather,
  TenantShardRouter,
  type TenantScatterGatherLimits
} from "../adapters/sharding/index.js";
import { PROJECTED_FRAMEWORK_DOCTYPES } from "../application/projection-backfill.js";
import { FrameworkError } from "../core/errors.js";
import type { ModelRegistry } from "../core/registry.js";
import type { TenantId } from "../core/types.js";
import type { Clock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { ShardId } from "../ports/tenant-shards.js";
import { projectionHandoffStoreOptions, type CloudFrappeProjectionDatabaseOptions } from "./projection-database.js";

/** The shard `DB` is. Also where the directory lives. */
export const DEFAULT_HOME_SHARD_ID = "home";

/** One shard's databases, when it has more than one. */
export interface CloudFrappeShardBinding {
  readonly database: D1Database;
  /**
   * The shard's own projection database, for a deployment that also runs the
   * split layout (`projectionDatabase`, issue #13). Required on every shard but
   * the home one then, and refused without it.
   */
  readonly projectionDatabase?: D1Database;
}

/**
 * Shards tenants across D1 databases (issue #14, phase T2). Off unless this is
 * passed — to **both** `createCloudFrappeWorker` and
 * `createAggregateCoordinatorClass`, as the same object, like
 * `projectionDatabase`: the coordinator writes and the Worker reads, and they
 * must agree on where a tenant lives.
 *
 * `DB` is always one of the shards — `home`, unless `home` says otherwise — and
 * always holds the directory. With the default `newTenants: "home"` switching
 * this on changes nothing a tenant sees: every tenant keeps living on `DB` until
 * an operator moves it. See `docs/tenant-sharding.md`.
 */
export interface CloudFrappeTenantShardingOptions<TEnv> {
  /** Every shard but the home one, by id. Ids are stored in the directory, so never rename one. */
  readonly shards: (env: TEnv) => Readonly<Record<ShardId, D1Database | CloudFrappeShardBinding>>;
  /** The id `DB` goes by. Defaults to `"home"`. */
  readonly home?: ShardId;
  readonly newTenants?: TenantPlacementPolicy;
  /** Shards that take new tenants under `newTenants: "place"`. Defaults to all of them. */
  readonly accepting?: readonly ShardId[];
  /**
   * The plan every shard is migrated to: by provisioning before it places a
   * tenant, and by `migrations.rollOut()`. Defaults to
   * `planD1Migrations(registry.list())`; pass your own if you plan with options.
   */
  readonly migrations?: readonly D1Migration[];
  /** How long one isolate trusts a routing answer. 5 s by default; see `TenantShardRouter`. */
  readonly cacheTtlMs?: number;
  /** How long a write to a fenced tenant keeps retrying before `503 TENANT_MOVING`. 5 s by default. */
  readonly fenceWaitMs?: number;
  readonly moves?: {
    readonly pageSize?: number;
    readonly pagesPerAdvance?: number;
    readonly catchUpMarginMs?: number;
    readonly cutoverThreshold?: number;
    readonly maxCutoverPages?: number;
    readonly staleFenceAgeMs?: number;
  };
  readonly scatter?: TenantScatterGatherLimits;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}

/** One shard's stores, as the routing stores pick between them. */
export interface CloudFrappeShardStores {
  readonly id: ShardId;
  readonly database: D1Database;
  readonly events: D1EventStore;
  readonly documents: D1DocumentStore;
  /** The table this shard's projection reads come from: its own, or its projection database's under #13. */
  readonly table: D1ProjectionStore;
  /** The shard's own projection table, whichever layout — what switching the split off drains into. */
  readonly primaryTable: D1ProjectionStore;
  readonly snapshots: D1SnapshotStore;
}

/** The operator-facing side of sharding, on `services.tenantShards`. */
export interface CloudFrappeTenantShardServices {
  readonly router: TenantShardRouter<CloudFrappeShardStores>;
  readonly directory: D1TenantShardDirectory;
  readonly provisioner: D1TenantProvisioner;
  readonly migrations: D1ShardMigrations;
  readonly mover: D1TenantMover;
  readonly scatter: TenantScatterGather<CloudFrappeShardStores>;
}

export interface CloudFrappeTenantShardingRuntime {
  readonly events: TenantRoutedEventStore<CloudFrappeShardStores>;
  readonly documents: TenantRoutedDocumentStore<CloudFrappeShardStores>;
  readonly table: TenantRoutedProjectionStore<CloudFrappeShardStores>;
  readonly primaryTable: TenantRoutedProjectionStore<CloudFrappeShardStores>;
  readonly snapshots: TenantRoutedSnapshotStore<CloudFrappeShardStores>;
  readonly services: CloudFrappeTenantShardServices;
}

export function createTenantShardingRuntime<TEnv extends { readonly DB: D1Database }>(
  env: TEnv,
  options: CloudFrappeTenantShardingOptions<TEnv>,
  context: {
    readonly registry: ModelRegistry;
    readonly projectionDatabase?: CloudFrappeProjectionDatabaseOptions<TEnv>;
  }
): CloudFrappeTenantShardingRuntime {
  const home = options.home ?? DEFAULT_HOME_SHARD_ID;
  const bindings = shardBindings(env, options, home, context.projectionDatabase);
  const shards = new Map<ShardId, CloudFrappeShardStores>();
  for (const [id, binding] of bindings) {
    const table = new D1ProjectionStore(binding.projectionDatabase ?? binding.database);
    shards.set(id, {
      id,
      database: binding.database,
      events: new D1EventStore(binding.database),
      documents: new D1DocumentStore(
        binding.database,
        context.projectionDatabase === undefined
          ? {}
          : projectionHandoffStoreOptions(env, context.projectionDatabase, binding.projectionDatabase!)
      ),
      table,
      primaryTable: binding.projectionDatabase === undefined ? table : new D1ProjectionStore(binding.database),
      snapshots: new D1SnapshotStore(binding.database)
    });
  }
  const directory = new D1TenantShardDirectory(env.DB, options.clock === undefined ? {} : { clock: options.clock });
  const plan = options.migrations;
  let planned: readonly D1Migration[] | undefined;
  const migrations = new D1ShardMigrations({
    shards: new Map([...shards].map(([id, shard]) => [id, shard.database])),
    migrations: () => (planned ??= plan ?? planD1Migrations(context.registry.list())),
    ...(options.clock === undefined ? {} : { clock: options.clock })
  });
  const provisioner = new D1TenantProvisioner({
    directory,
    migrations,
    home,
    homeDatabase: env.DB,
    ...(options.newTenants === undefined ? {} : { newTenants: options.newTenants }),
    ...(options.accepting === undefined ? {} : { accepting: options.accepting })
  });
  const router = new TenantShardRouter<CloudFrappeShardStores>({
    directory,
    shards,
    home,
    provision: (tenantId: TenantId) => provisioner.provision(tenantId),
    cacheUnassigned: (options.newTenants ?? "home") === "home",
    ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
    ...(options.fenceWaitMs === undefined ? {} : { fenceWaitMs: options.fenceWaitMs })
  });
  const mover = new D1TenantMover({
    directory,
    shards: new Map([...shards].map(([id, shard]) => [id, { database: shard.database, projections: shard.table }])),
    home,
    projectedDoctypes: () => [...context.registry.list().map((doctype) => doctype.name), ...PROJECTED_FRAMEWORK_DOCTYPES],
    migrations,
    onMoved: (assignment) => router.fenced(assignment.tenantId),
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.ids === undefined ? {} : { ids: options.ids }),
    ...(options.moves ?? {})
  });
  const table = new TenantRoutedProjectionStore(router, (shard) => shard.table);
  return {
    events: new TenantRoutedEventStore(router, (shard) => shard.events, isD1TenantFencedError),
    documents: new TenantRoutedDocumentStore(router, (shard) => shard.documents, isD1TenantFencedError),
    table,
    primaryTable: new TenantRoutedProjectionStore(router, (shard) => shard.primaryTable),
    snapshots: new TenantRoutedSnapshotStore(router, (shard) => shard.snapshots),
    services: {
      router,
      directory,
      provisioner,
      migrations,
      mover,
      scatter: new TenantScatterGather({
        directory,
        router,
        projections: (shard) => shard.table,
        ...(options.scatter === undefined ? {} : { limits: options.scatter })
      })
    }
  };
}

function shardBindings<TEnv extends { readonly DB: D1Database }>(
  env: TEnv,
  options: CloudFrappeTenantShardingOptions<TEnv>,
  home: ShardId,
  projectionDatabase: CloudFrappeProjectionDatabaseOptions<TEnv> | undefined
): ReadonlyMap<ShardId, CloudFrappeShardBinding> {
  const configured = options.shards(env);
  const bindings = new Map<ShardId, CloudFrappeShardBinding>();
  bindings.set(home, {
    database: env.DB,
    ...(projectionDatabase === undefined ? {} : { projectionDatabase: projectionDatabase.database(env) })
  });
  for (const [id, value] of Object.entries(configured)) {
    if (id === home) {
      throw invalid(`Shard '${id}' is the home shard, which is always DB; do not list it`);
    }
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
      throw invalid(`Shard id '${id}' must be 1-64 letters, digits, '-' or '_'`);
    }
    const binding: CloudFrappeShardBinding = isShardBinding(value) ? value : { database: value };
    if (projectionDatabase !== undefined && binding.projectionDatabase === undefined) {
      throw invalid(`Shard '${id}' needs a projectionDatabase: projectionDatabase is on, so every shard runs the split layout`);
    }
    if (projectionDatabase === undefined && binding.projectionDatabase !== undefined) {
      throw invalid(`Shard '${id}' names a projectionDatabase, but projectionDatabase is off`);
    }
    if (binding.database === env.DB || [...bindings.values()].some((other) => other.database === binding.database)) {
      throw invalid(`Shard '${id}' reuses a database another shard already is`);
    }
    bindings.set(id, binding);
  }
  return bindings;
}

function isShardBinding(value: D1Database | CloudFrappeShardBinding): value is CloudFrappeShardBinding {
  return typeof value === "object" && value !== null && "database" in value;
}

function invalid(message: string): FrameworkError {
  return new FrameworkError("TENANT_SHARD_INVALID", message, { status: 500 });
}
