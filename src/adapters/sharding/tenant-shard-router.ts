import { FrameworkError } from "../../core/errors.js";
import type { StreamName, TenantId } from "../../core/types.js";
import type {
  ShardId,
  TenantShardAssignment,
  TenantShardDirectory,
  TenantShardResolver
} from "../../ports/tenant-shards.js";

/**
 * Tenants that never have a directory entry and always live on the home shard.
 * `__global__` owns the job schedule definitions stream
 * (`jobScheduleDefinitionsStream`) — framework state, not a customer's, and
 * read before any tenant is known.
 */
export const HOME_SHARD_TENANTS: readonly TenantId[] = Object.freeze(["__global__"]);

/** How long a routing answer is reused before the directory is asked again. */
export const DEFAULT_TENANT_SHARD_CACHE_TTL_MS = 5_000;
/** How long a fenced write keeps retrying before it gives up with `TENANT_MOVING`. */
export const DEFAULT_TENANT_FENCE_WAIT_MS = 5_000;

export interface TenantShardRouterOptions<S> {
  readonly directory: TenantShardDirectory;
  /** Every shard this isolate can reach, by id. */
  readonly shards: ReadonlyMap<ShardId, S>;
  /** The shard unassigned tenants read from, and the one `HOME_SHARD_TENANTS` live on. */
  readonly home: ShardId;
  /**
   * Assigns a tenant that has none, on its first write. Returns the assignment
   * that stands — see `TenantShardDirectory.assign`.
   */
  readonly provision: (tenantId: TenantId) => Promise<TenantShardAssignment>;
  readonly cacheTtlMs?: number;
  /**
   * Cache "no assignment, read from home" too. Only safe when an unassigned
   * tenant's first write also lands on home (`newTenants: "home"`): then the
   * cached answer and the eventual assignment agree, and a deployment that
   * switched sharding on without registering its existing tenants does not pay
   * a directory query on every read. Under placement it must stay off — the
   * first write may put the tenant anywhere, and a cached "home" would hide it.
   */
  readonly cacheUnassigned?: boolean;
  readonly fenceWaitMs?: number;
  /** Milliseconds now. Injected for tests. */
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

/**
 * Tenant → shard routing, with a per-isolate cache in front of the directory.
 *
 * **What the cache can and cannot get wrong.** An entry is reused for
 * `cacheTtlMs` (5 s by default) without asking the directory. When a tenant
 * moves, an isolate holding the old answer keeps sending that tenant's calls to
 * the shard it left until the entry expires:
 *
 * - *Writes cannot go wrong.* The source shard is fenced before the move's final
 *   copy (see `D1_TENANT_SHARD_SCHEMA_STATEMENTS`), so a write routed there is
 *   refused inside its own transaction. The routing stores catch that, call
 *   {@link fenced}, and retry against the directory's current answer.
 * - *Reads can be stale, by at most `cacheTtlMs`.* The source still holds the
 *   tenant's data exactly as it was when the move fenced it, so a read routed
 *   there sees a consistent, slightly old state — never a partial one.
 *
 * Unassigned tenants are not cached unless `cacheUnassigned` says their first
 * write lands on home anyway: otherwise the next write may assign them anywhere.
 */
export class TenantShardRouter<S> implements TenantShardResolver<S> {
  private readonly cache = new Map<
    TenantId,
    { readonly shardId: ShardId; readonly assigned: boolean; readonly expiresAt: number }
  >();
  private readonly cacheTtlMs: number;
  private readonly now: () => number;

  constructor(private readonly options: TenantShardRouterOptions<S>) {
    if (!options.shards.has(options.home)) {
      throw new FrameworkError("TENANT_SHARD_INVALID", `Home shard '${options.home}' is not one of the shards`, {
        status: 500
      });
    }
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_TENANT_SHARD_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
  }

  get home(): ShardId {
    return this.options.home;
  }

  get fenceWaitMs(): number {
    return this.options.fenceWaitMs ?? DEFAULT_TENANT_FENCE_WAIT_MS;
  }

  async sleep(ms: number): Promise<void> {
    await (this.options.sleep ?? defaultSleep)(ms);
  }

  elapsedSince(startedAt: number): number {
    return this.now() - startedAt;
  }

  nowMs(): number {
    return this.now();
  }

  async forRead(tenantId: TenantId): Promise<S> {
    return this.shard(await this.readShardId(tenantId));
  }

  /** The id of the shard {@link forRead} would pick. */
  async readShardId(tenantId: TenantId): Promise<ShardId> {
    return this.shardIdFor(tenantId, false);
  }

  async forWrite(tenantId: TenantId): Promise<S> {
    return this.shard(await this.shardIdFor(tenantId, true));
  }

  fenced(tenantId: TenantId): void {
    this.cache.delete(tenantId);
  }

  /** Drops every cached answer. For operator tools that just moved a tenant in this isolate. */
  forgetAll(): void {
    this.cache.clear();
  }

  shard(shardId: ShardId): S {
    const shard = this.options.shards.get(shardId);
    if (shard === undefined) {
      // A directory naming a shard this Worker has no binding for: a deploy
      // removed a binding that still has tenants, or a move targeted a shard
      // that only some deployments know. Failing loudly is the only safe
      // answer — routing the tenant anywhere else would serve another
      // database's view of it.
      throw new FrameworkError("TENANT_SHARD_NOT_FOUND", `Shard '${shardId}' is not bound in this deployment`, {
        status: 500
      });
    }
    return shard;
  }

  private async shardIdFor(tenantId: TenantId, forWrite: boolean): Promise<ShardId> {
    if (HOME_SHARD_TENANTS.includes(tenantId)) {
      return this.options.home;
    }
    const cached = this.cache.get(tenantId);
    // A cached "unassigned" answer serves reads only: a write still has to
    // record the tenant, or the directory would never learn it exists.
    if (cached !== undefined && cached.expiresAt > this.now() && (cached.assigned || !forWrite)) {
      return cached.shardId;
    }
    let assignment = await this.options.directory.get(tenantId);
    if (assignment === null) {
      if (!forWrite) {
        if (this.options.cacheUnassigned === true) {
          this.cache.set(tenantId, { shardId: this.options.home, assigned: false, expiresAt: this.now() + this.cacheTtlMs });
        } else {
          this.cache.delete(tenantId);
        }
        return this.options.home;
      }
      assignment = await this.options.provision(tenantId);
    }
    this.cache.set(tenantId, { shardId: assignment.shardId, assigned: true, expiresAt: this.now() + this.cacheTtlMs });
    return assignment.shardId;
  }
}

/**
 * The tenant a stream belongs to: its first `:`-separated part, unescaped.
 *
 * Mirrors `documentStream` in `src/core/streams.ts`, which escapes each part
 * with `encodeURIComponent` — and that encodes `:` — so the first separator is
 * always the end of the tenant. `tests/adapters/tenant-sharding.test.ts` pins the
 * round trip for tenants containing `:`, `%` and `.`.
 */
export function tenantOfStream(stream: StreamName): TenantId {
  const separator = stream.indexOf(":");
  const part = separator === -1 ? stream : stream.slice(0, separator);
  return decodeURIComponent(part);
}

/**
 * Runs a write against the tenant's shard, and when that shard's fence refuses
 * it, asks the directory again and retries until the move completes or
 * `fenceWaitMs` runs out.
 *
 * Retrying is safe because a fenced batch is rolled back whole by the trigger —
 * nothing of it landed — and the target holds the source's events up to the
 * fence, so the write's expected versions mean the same thing there.
 */
export async function writeWithFenceRetry<S, T>(
  router: TenantShardRouter<S>,
  tenantId: TenantId,
  isFenced: (error: unknown) => boolean,
  write: (shard: S) => Promise<T>
): Promise<T> {
  const startedAt = router.nowMs();
  let delay = 25;
  for (;;) {
    const shard = await router.forWrite(tenantId);
    try {
      return await write(shard);
    } catch (error) {
      if (!isFenced(error)) {
        throw error;
      }
      router.fenced(tenantId);
      if (router.elapsedSince(startedAt) >= router.fenceWaitMs) {
        throw new FrameworkError(
          "TENANT_MOVING",
          `Tenant '${tenantId}' is being moved to another shard; retry shortly`,
          { status: 503 }
        );
      }
      await router.sleep(delay);
      delay = Math.min(delay * 2, 500);
    }
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
