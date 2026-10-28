import { FrameworkError } from "../../core/errors.js";
import type {
  DocTypeName,
  DocumentSnapshot,
  ListDocumentsQuery,
  PredicateExpression,
  TenantId
} from "../../core/types.js";
import type { ProjectionStore } from "../../ports/projection-store.js";
import type { ShardId, TenantShardAssignment, TenantShardDirectory } from "../../ports/tenant-shards.js";
import type { TenantShardRouter } from "./tenant-shard-router.js";

/** Most tenants one scatter call may touch unless the deployment raises it. */
export const DEFAULT_TENANT_SCATTER_MAX_TENANTS = 50;
/** The ceiling `maxTenants` cannot be raised past. */
export const MAX_TENANT_SCATTER_TENANTS = 500;
/**
 * Calls in flight at once. A Worker invocation can hold six simultaneous
 * connections to D1 (https://developers.cloudflare.com/d1/platform/limits/);
 * more would only queue inside the runtime.
 */
export const DEFAULT_TENANT_SCATTER_CONCURRENCY = 6;
export const DEFAULT_TENANT_SCATTER_TIMEOUT_MS = 5_000;
export const DEFAULT_TENANT_SCATTER_MAX_RESULTS = 100;
export const MAX_TENANT_SCATTER_RESULTS = 1_000;

export interface TenantScatterGatherLimits {
  /** Most tenants one call may name. Callers page through more with `tenants({ after })`. */
  readonly maxTenants?: number;
  readonly concurrency?: number;
  /** One tenant's call is abandoned, and reported as a failure, after this long. */
  readonly perTenantTimeoutMs?: number;
  /** Most rows a merged search may return. */
  readonly maxResults?: number;
}

export interface TenantScatterResult<T> {
  readonly results: readonly { readonly tenantId: TenantId; readonly shardId: ShardId; readonly value: T }[];
  /**
   * Tenants whose call failed or timed out. A scatter never fails as a whole
   * because one shard is slow or down: an operator console that shows nothing
   * when one of fifty databases is unreachable is worse than one that says
   * which one.
   */
  readonly failures: readonly { readonly tenantId: TenantId; readonly shardId?: ShardId; readonly error: string }[];
}

export interface TenantScatterGatherOptions<S> {
  readonly directory: TenantShardDirectory;
  readonly router: TenantShardRouter<S>;
  /** The projection store reads come from on one shard. */
  readonly projections: (shard: S) => ProjectionStore;
  readonly limits?: TenantScatterGatherLimits;
}

/**
 * Cross-tenant queries over a sharded deployment: the operator console, billing
 * roll-ups, global search.
 *
 * Every per-tenant port call already names one tenant, so nothing that runs
 * inside a tenant needs this. Questions *across* tenants do, and they are the
 * permanent cost the issue warns about — one query becomes one per tenant, on
 * however many databases those tenants live in. The upper bounds are the
 * point of this class:
 *
 * - **A call names its tenants, at most `maxTenants` of them** (50 by default,
 *   500 at most). There is no "all tenants" call; walking every tenant is
 *   paging through {@link tenants} and calling once per page, so each call's
 *   cost is bounded by its page, however many tenants exist.
 * - **At most `concurrency` calls in flight** (6, D1's per-invocation
 *   connection limit), so a page does not open more connections than a Worker
 *   may hold.
 * - **Each tenant's call has a deadline**, and a tenant that misses it — or
 *   whose shard errors — is reported in `failures` rather than failing the rest.
 * - **A merged search returns at most `maxResults` rows**, taking at most that
 *   many from each tenant.
 *
 * These read projections directly, **without row-level permissions** — they are
 * system tools, not an end-user API. Nothing in the HTTP layer exposes them; an
 * application that builds an operator endpoint on top must put its own
 * authorization in front.
 */
export class TenantScatterGather<S> {
  private readonly maxTenants: number;
  private readonly concurrency: number;
  private readonly timeoutMs: number;
  private readonly maxResults: number;

  constructor(private readonly options: TenantScatterGatherOptions<S>) {
    const limits = options.limits ?? {};
    this.maxTenants = bounded("maxTenants", limits.maxTenants ?? DEFAULT_TENANT_SCATTER_MAX_TENANTS, MAX_TENANT_SCATTER_TENANTS);
    this.concurrency = bounded("concurrency", limits.concurrency ?? DEFAULT_TENANT_SCATTER_CONCURRENCY, 6);
    this.timeoutMs = bounded("perTenantTimeoutMs", limits.perTenantTimeoutMs ?? DEFAULT_TENANT_SCATTER_TIMEOUT_MS, 30_000);
    this.maxResults = bounded("maxResults", limits.maxResults ?? DEFAULT_TENANT_SCATTER_MAX_RESULTS, MAX_TENANT_SCATTER_RESULTS);
  }

  /** One page of the directory, in tenant order. Pass the last tenant back as `after`. */
  async tenants(query: { readonly shardId?: ShardId; readonly after?: TenantId; readonly limit?: number } = {}): Promise<
    readonly TenantShardAssignment[]
  > {
    return this.options.directory.list({
      ...(query.shardId === undefined ? {} : { shardId: query.shardId }),
      ...(query.after === undefined ? {} : { after: query.after }),
      limit: Math.min(query.limit ?? this.maxTenants, this.maxTenants)
    });
  }

  /** Runs `run` once per named tenant, on that tenant's shard. */
  async gather<T>(input: {
    readonly tenants: readonly TenantId[];
    readonly run: (context: { readonly tenantId: TenantId; readonly shard: S }) => Promise<T>;
  }): Promise<TenantScatterResult<T>> {
    const tenants = [...new Set(input.tenants)];
    if (tenants.length > this.maxTenants) {
      throw new FrameworkError(
        "TENANT_SCATTER_LIMIT_EXCEEDED",
        `A cross-tenant call may name at most ${this.maxTenants} tenants (got ${tenants.length}); page through them`,
        { status: 400 }
      );
    }
    const results: { tenantId: TenantId; shardId: ShardId; value: T }[] = [];
    const failures: { tenantId: TenantId; shardId?: ShardId; error: string }[] = [];
    let next = 0;
    const worker = async () => {
      for (;;) {
        const index = next;
        next += 1;
        if (index >= tenants.length) {
          return;
        }
        const tenantId = tenants[index]!;
        let shardId: ShardId | undefined;
        try {
          shardId = await this.options.router.readShardId(tenantId);
          const shard = this.options.router.shard(shardId);
          const value = await withTimeout(input.run({ tenantId, shard }), this.timeoutMs, tenantId);
          results.push({ tenantId, shardId, value });
        } catch (error) {
          failures.push({
            tenantId,
            ...(shardId === undefined ? {} : { shardId }),
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(this.concurrency, tenants.length) }, worker));
    // Completion order is a race; the answer should not be.
    const order = new Map(tenants.map((tenantId, index) => [tenantId, index]));
    results.sort((left, right) => order.get(left.tenantId)! - order.get(right.tenantId)!);
    failures.sort((left, right) => order.get(left.tenantId)! - order.get(right.tenantId)!);
    return { results, failures };
  }

  /**
   * How many projected documents of a doctype each tenant has — the billing
   * roll-up shape. One counted list query per tenant.
   */
  async countDocuments(input: {
    readonly tenants: readonly TenantId[];
    readonly doctype: DocTypeName;
    readonly predicate?: PredicateExpression;
  }): Promise<TenantScatterResult<number> & { readonly total: number }> {
    const gathered = await this.gather({
      tenants: input.tenants,
      run: async ({ tenantId, shard }) =>
        (await this.options.projections(shard).list(listQuery(tenantId, input.doctype, input.predicate, 1))).total
    });
    return { ...gathered, total: gathered.results.reduce((sum, result) => sum + result.value, 0) };
  }

  /**
   * The most recently updated documents of a doctype across the named tenants,
   * merged — global search. Each tenant contributes at most `limit` rows, and
   * the merge keeps the newest `limit` overall.
   */
  async search(input: {
    readonly tenants: readonly TenantId[];
    readonly doctype: DocTypeName;
    readonly predicate?: PredicateExpression;
    readonly limit?: number;
  }): Promise<{
    readonly data: readonly DocumentSnapshot[];
    readonly failures: TenantScatterResult<unknown>["failures"];
  }> {
    const limit = bounded("limit", input.limit ?? this.maxResults, this.maxResults);
    const gathered = await this.gather({
      tenants: input.tenants,
      run: async ({ tenantId, shard }) =>
        (await this.options.projections(shard).list({
          ...listQuery(tenantId, input.doctype, input.predicate, limit),
          orderBy: "updatedAt",
          order: "desc",
          skipTotal: true
        })).data
    });
    const data = gathered.results
      .flatMap((result) => result.value)
      .sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.tenantId.localeCompare(right.tenantId) ||
        left.name.localeCompare(right.name)
      )
      .slice(0, limit);
    return { data, failures: gathered.failures };
  }
}

function listQuery(
  tenantId: TenantId,
  doctype: DocTypeName,
  predicate: PredicateExpression | undefined,
  limit: number
): ListDocumentsQuery {
  return { tenantId, doctype, ...(predicate === undefined ? {} : { predicate }), limit, offset: 0 };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, tenantId: TenantId): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Tenant '${tenantId}' did not answer within ${ms} ms`)), ms);
      })
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function bounded(name: string, value: number, max: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) {
    throw new FrameworkError("TENANT_SCATTER_LIMIT_EXCEEDED", `Scatter-gather ${name} must be between 1 and ${max}`, {
      status: 400
    });
  }
  return value;
}
