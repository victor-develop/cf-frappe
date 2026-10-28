import { ProjectionRebuildService } from "../application/projection-rebuild-service.js";
import { RoutedProjectionStore, type ProjectionParityResult } from "../application/projection-targets.js";
import { D1DocumentStore } from "../adapters/d1/document-store.js";
import { D1EventStore } from "../adapters/d1/event-store.js";
import { D1ProjectionStore } from "../adapters/d1/projection-store.js";
import {
  D1TypedProjectionStore,
  planD1TypedProjections,
  type D1TypedProjectionPlan,
  type D1TypedProjectionSettings
} from "../adapters/d1/typed-projection-store.js";
import type { ModelRegistry } from "../core/registry.js";
import type { DocTypeName, TenantId } from "../core/types.js";
import { systemClock, type Clock } from "../ports/clock.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";
import type { ProjectionStore } from "../ports/projection-store.js";

/**
 * Typed per-DocType projection tables (issue #15), as the Worker and the
 * aggregate coordinator take them.
 *
 * Pass the **same value** to `createCloudFrappeWorker` and to
 * `createAggregateCoordinatorClass`: the coordinator owns the write path and
 * the Worker the read path, so a DocType that is `active` in the Worker but
 * `off` in the coordinator would be read from a table nothing writes. Omitted
 * in both — the default — nothing changes. See docs/typed-projection-tables.md.
 */
export interface CloudFrappeTypedProjectionOptions extends D1TypedProjectionSettings {
  /** Clock for the rebuild runs started through {@link CloudFrappeTypedProjectionServices.rebuild}. */
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}

/** The name the typed tables are mounted under in the rebuild router. */
export const TYPED_PROJECTION_TARGET = "typed";

/**
 * Operator handles for typed tables, exposed on the runtime services when
 * typed projections are configured — for a job or an admin route to drive the
 * rebuild-then-compare step that comes before switching a DocType to `active`.
 */
export interface CloudFrappeTypedProjectionServices {
  readonly plan: D1TypedProjectionPlan;
  /** Every `shadow` and `active` typed table. */
  readonly store: D1TypedProjectionStore;
  /**
   * Rebuilds a DocType's typed table from its event streams. Start it with
   * `target: "typed"` ({@link TYPED_PROJECTION_TARGET}) and drive `advance`
   * from a job; it never touches the shared table.
   */
  readonly rebuild: ProjectionRebuildService;
  /**
   * Compares a DocType's typed table with the shared table, row by row. An empty
   * `differences` is the evidence to switch the DocType to `active`.
   */
  compare(tenantId: TenantId, doctype: DocTypeName): Promise<ProjectionParityResult>;
}

const plans = new WeakMap<ModelRegistry, WeakMap<object, D1TypedProjectionPlan>>();

/**
 * Resolves the options once per options object, so a misconfiguration throws at
 * construction rather than on the first request, and every instance shares the
 * same layouts.
 */
export function typedProjectionPlanFor(
  registry: ModelRegistry,
  options: CloudFrappeTypedProjectionOptions | undefined
): D1TypedProjectionPlan | undefined {
  if (options === undefined) {
    return undefined;
  }
  // Keyed by registry as well: the layouts come from the registry's DocTypes,
  // so one options object shared by two registries must not share a plan.
  let byOptions = plans.get(registry);
  if (byOptions === undefined) {
    byOptions = new WeakMap();
    plans.set(registry, byOptions);
  }
  const cached = byOptions.get(options);
  if (cached !== undefined) {
    return cached;
  }
  const plan = planD1TypedProjections(registry.list(), options);
  byOptions.set(options, plan);
  return plan;
}

/** A `D1DocumentStore` that maintains the typed tables the plan names, if any. */
export function d1DocumentStoreFor(db: D1Database, plan: D1TypedProjectionPlan | undefined): D1DocumentStore {
  return plan === undefined ? new D1DocumentStore(db) : new D1DocumentStore(db, { typedProjections: plan });
}

/**
 * The store the application reads documents through: `active` DocTypes from
 * their typed table, everything else from the shared one. With no `active`
 * DocType it is the shared store itself, untouched.
 */
export function readProjectionStoreFor(
  db: D1Database,
  shared: D1ProjectionStore,
  plan: D1TypedProjectionPlan | undefined
): ProjectionStore {
  if (plan === undefined || plan.active.length === 0) {
    return shared;
  }
  return new D1TypedProjectionStore(db, { layouts: plan.active, fallback: shared });
}

export function typedProjectionServicesFor(
  db: D1Database,
  shared: D1ProjectionStore,
  plan: D1TypedProjectionPlan | undefined,
  options: CloudFrappeTypedProjectionOptions | undefined
): CloudFrappeTypedProjectionServices | undefined {
  if (plan === undefined || options === undefined) {
    return undefined;
  }
  const store = new D1TypedProjectionStore(db, { layouts: [...plan.active, ...plan.shadow] });
  // Reads in the application never go through this router: it exists so the
  // rebuild has a non-active target to write and a reference to compare with.
  // Its in-memory state (`promote`) is per isolate; switching a DocType to
  // `active` is a configuration change, not a call.
  const router = new RoutedProjectionStore({
    targets: [
      { name: "shared", state: "active", store: shared },
      { name: TYPED_PROJECTION_TARGET, state: "building", store }
    ]
  });
  const events = new D1EventStore(db);
  const rebuild = new ProjectionRebuildService({
    events,
    streams: events,
    router,
    targetStore: (name) => router.targetStore(name),
    clock: options.clock ?? systemClock,
    ids: options.ids ?? cryptoIdGenerator
  });
  return {
    plan,
    store,
    rebuild,
    compare: (tenantId, doctype) => router.compare(TYPED_PROJECTION_TARGET, tenantId, doctype)
  };
}
