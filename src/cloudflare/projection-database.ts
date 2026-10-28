import { D1EventStore, D1ProjectionStore, D1SnapshotStore } from "../adapters/d1/index.js";
import type { ReadYourWritesHttpOptions } from "../adapters/http/read-your-writes.js";
import { ProjectionBackfillService } from "../application/projection-backfill.js";
import {
  ProjectionDeliveryConsumer,
  ProjectionOutboxHandoff,
  type ProjectionLagReport,
  type ProjectionLagThresholds
} from "../application/projection-delivery.js";
import {
  ConsistentProjectionStore,
  ProjectionCatchUp,
  type ProjectionReadFallback
} from "../application/projection-read-consistency.js";
import type { DocumentSnapshot } from "../core/types.js";
import type { Clock } from "../ports/clock.js";
import type { AutomationRunClaimStore } from "../ports/automation-run-claim-store.js";
import type { DocumentStoreProjectionOptions } from "../ports/document-store.js";
import type { EventStore, StreamCatalog } from "../ports/event-store.js";
import type {
  MonotonicProjectionWriter,
  ProjectionStore,
  ProjectionVersionReader
} from "../ports/projection-store.js";
import type { SnapshotStore } from "../ports/snapshot-store.js";

/**
 * The split layout from issue #13: events stay in `DB`, projections move to a
 * D1 database of their own and are fed through the delivery outbox.
 *
 * Off unless this is passed — to **both** `createCloudFrappeWorker` and
 * `createAggregateCoordinatorClass`, as the same object. The coordinator decides
 * where writes put their projection rows and the Worker decides where reads look
 * for them; one without the other leaves reads looking at a table nobody writes.
 *
 * The projection database takes the same `migrations/` directory as `DB`. Only
 * `cf_frappe_documents` and `cf_frappe_automation_runs` are used there; the
 * other tables stay empty, which is cheaper than a second schema to keep in step.
 *
 * See `docs/projection-database.md` for switching it on and back off.
 */
export interface CloudFrappeProjectionDatabaseOptions<TEnv> {
  readonly database: (env: TEnv) => D1Database;
  /**
   * Apply each commit's rows to the projection database right after the commit,
   * so a document is normally listable before the write returns. On by default.
   * Off, rows arrive only when the drain job runs — correct, but a list can lag
   * by the cron interval. Either way the outbox record is what guarantees they
   * arrive.
   */
  readonly eagerApply?: boolean;
  /**
   * Signed read-your-writes tokens on the resource API. Omitted, by-name reads
   * are still strongly consistent but lists are plainly eventual.
   */
  readonly readYourWrites?: {
    readonly secret: (env: TEnv) => string;
    readonly timeoutMs?: number;
    readonly pollMs?: number;
    readonly maxPollMs?: number;
    /** Most D1 queries one read spends waiting. See `ProjectionCatchUp`. */
    readonly maxChecks?: number;
    readonly ttlSeconds?: number;
  };
  readonly lag?: ProjectionLagThresholds;
  /**
   * Where a lag breach goes. Defaults to one structured `console.warn` line,
   * which Workers Logs records and a log-based alert can match on
   * `"event":"cf-frappe.projection.lagging"`.
   */
  readonly onLagAlert?: (alert: ProjectionLagReport, env: TEnv) => void | Promise<void>;
  readonly onEagerApplyError?: (error: unknown, snapshots: readonly DocumentSnapshot[], env: TEnv) => void;
  /**
   * Told each time a by-name read found the projection row behind the stream
   * head and folded the primary instead — the read load this layout exists to
   * move off the primary, so worth a metric. Not logged by default: on a busy
   * tenant it is one line per lagging read.
   */
  readonly onReadFallback?: (fallback: ProjectionReadFallback, env: TEnv) => void;
  readonly clock?: Clock;
}

/** What a `D1DocumentStore` on the primary is constructed with in either layout. */
export function projectionDocumentStoreOptions<TEnv>(
  env: TEnv,
  options: CloudFrappeProjectionDatabaseOptions<TEnv> | undefined
): DocumentStoreProjectionOptions {
  if (options === undefined) {
    return {};
  }
  return projectionHandoffStoreOptions(env, options, options.database(env));
}

/**
 * The handoff options for a `D1DocumentStore` whose projection rows belong in
 * `projectionDatabase`. The unsharded layout has one, `options.database(env)`;
 * a sharded one (issue #14) has one per shard.
 */
export function projectionHandoffStoreOptions<TEnv>(
  env: TEnv,
  options: CloudFrappeProjectionDatabaseOptions<TEnv>,
  projectionDatabase: D1Database
): DocumentStoreProjectionOptions {
  const eager = options.eagerApply === false ? undefined : new D1ProjectionStore(projectionDatabase);
  return {
    projectionHandoff: new ProjectionOutboxHandoff({
      ...(eager === undefined ? {} : { eager }),
      onEagerApplyError: (error, snapshots) => {
        if (options.onEagerApplyError) {
          options.onEagerApplyError(error, snapshots, env);
          return;
        }
        console.warn(JSON.stringify({
          event: "cf-frappe.projection.eager-apply-failed",
          error: error instanceof Error ? error.message : String(error),
          documents: snapshots.map((snapshot) => `${snapshot.doctype}/${snapshot.name}@${snapshot.version}`)
        }));
      }
    })
  };
}

export interface CloudFrappeProjectionRuntime {
  /** What every query service reads: the projection database, strong by name. */
  readonly projections: ConsistentProjectionStore;
  readonly delivery: ProjectionDeliveryConsumer;
  readonly backfill: ProjectionBackfillService;
  readonly readYourWrites?: ReadYourWritesHttpOptions;
}

export function createProjectionRuntime<TEnv extends { readonly DB: D1Database }>(
  env: TEnv,
  options: CloudFrappeProjectionDatabaseOptions<TEnv>
): CloudFrappeProjectionRuntime {
  const events = new D1EventStore(env.DB);
  return createProjectionRuntimeFromStores(env, options, {
    table: new D1ProjectionStore(options.database(env)),
    events,
    streams: events,
    snapshots: new D1SnapshotStore(env.DB)
  });
}

/**
 * The stores the split layout's read side is assembled from: the table rows
 * physically live in, and the primary's events and fold snapshots. Plain D1
 * stores unsharded; tenant-routed ones when sharding (issue #14) puts each
 * tenant's primary and projection database on its shard. Every call these make
 * names its tenant, so one runtime over routed stores behaves as one runtime
 * per shard would.
 */
export interface CloudFrappeProjectionRuntimeStores {
  readonly table: ProjectionStore & MonotonicProjectionWriter & ProjectionVersionReader & AutomationRunClaimStore;
  readonly events: Pick<EventStore, "readStream" | "append" | "currentVersion">;
  readonly streams: StreamCatalog;
  readonly snapshots: SnapshotStore;
}

export function createProjectionRuntimeFromStores<TEnv>(
  env: TEnv,
  options: CloudFrappeProjectionDatabaseOptions<TEnv>,
  stores: CloudFrappeProjectionRuntimeStores
): CloudFrappeProjectionRuntime {
  const projectionDatabase = stores.table;
  const events = stores.events;
  const projections = new ConsistentProjectionStore({
    projections: projectionDatabase,
    events,
    snapshots: stores.snapshots,
    ...(options.onReadFallback === undefined
      ? {}
      : { onFallback: (fallback: ProjectionReadFallback) => options.onReadFallback!(fallback, env) })
  });
  const delivery = new ProjectionDeliveryConsumer({
    events,
    projections: projectionDatabase,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.lag === undefined ? {} : { lag: options.lag }),
    onSkipped: (skipped) => {
      console.error(JSON.stringify({ event: "cf-frappe.projection.delivery-skipped", ...skipped }));
    },
    onLagAlert: async (alert) => {
      if (options.onLagAlert) {
        await options.onLagAlert(alert, env);
        return;
      }
      console.warn(JSON.stringify({ event: "cf-frappe.projection.lagging", ...alert }));
    }
  });
  const readYourWrites = options.readYourWrites;
  return {
    projections,
    delivery,
    backfill: new ProjectionBackfillService({ events, streams: stores.streams, target: projectionDatabase }),
    ...(readYourWrites === undefined
      ? {}
      : {
          readYourWrites: {
            secret: readYourWrites.secret(env),
            catchUp: new ProjectionCatchUp({
              projections: projectionDatabase,
              ...(readYourWrites.timeoutMs === undefined ? {} : { timeoutMs: readYourWrites.timeoutMs }),
              ...(readYourWrites.pollMs === undefined ? {} : { pollMs: readYourWrites.pollMs }),
              ...(readYourWrites.maxPollMs === undefined ? {} : { maxPollMs: readYourWrites.maxPollMs }),
              ...(readYourWrites.maxChecks === undefined ? {} : { maxChecks: readYourWrites.maxChecks })
            }),
            ...(readYourWrites.ttlSeconds === undefined ? {} : { ttlSeconds: readYourWrites.ttlSeconds })
          }
        })
  };
}
