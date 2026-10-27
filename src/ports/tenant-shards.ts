import type { TenantId } from "../core/types.js";

/**
 * Tenant sharding (issue #14, phase T2 of the projection roadmap #5).
 *
 * Every port the framework writes through already names its tenant: a
 * `ProjectionStore` call carries `tenantId`, a stream name starts with it, an
 * audit query has it. That is what lets sharding live entirely in the adapter
 * layer — a store that looks up which database a tenant lives in and forwards
 * the call there satisfies the same port, so `core` and `application` cannot
 * tell. The types here are what those routing adapters share.
 */
export type ShardId = string;

/** Where one tenant lives, as the directory records it. */
export interface TenantShardAssignment {
  readonly tenantId: TenantId;
  readonly shardId: ShardId;
  /**
   * Bumped by every completed move. Not used for routing — the shard id is the
   * routing — but it makes "this tenant has moved since I looked" visible in
   * operator output and tests.
   */
  readonly epoch: number;
  /** The move in progress for this tenant, if any. Reads and writes still go to `shardId` while it runs. */
  readonly moveId?: string;
  readonly assignedAt: string;
  readonly updatedAt: string;
}

export interface TenantShardListQuery {
  /** Only tenants on this shard. */
  readonly shardId?: ShardId;
  /** Keyset cursor: only tenants that sort after this one. */
  readonly after?: TenantId;
  readonly limit: number;
}

/**
 * The routing table: tenant → shard.
 *
 * Kept in one database (the directory, `DB` in the Cloudflare wiring) rather
 * than in each shard, because the question "where does this tenant live" has to
 * have one answer before anything knows which shard to ask.
 */
export interface TenantShardDirectory {
  get(tenantId: TenantId): Promise<TenantShardAssignment | null>;
  /**
   * Records `tenantId` on `shardId` unless it already has an assignment, and
   * returns whichever assignment stands afterwards. Two isolates provisioning the
   * same new tenant at once therefore agree on one shard: the loser gets the
   * winner's row back, not its own.
   */
  assign(tenantId: TenantId, shardId: ShardId): Promise<TenantShardAssignment>;
  list(query: TenantShardListQuery): Promise<readonly TenantShardAssignment[]>;
  /** Assigned tenants per shard. Shards with none are absent. */
  countByShard(): Promise<ReadonlyMap<ShardId, number>>;
}

/**
 * Picks the shard a tenant's call goes to. Implemented by `TenantShardRouter`;
 * the routing stores depend on this rather than on the router so tests can
 * route by hand.
 *
 * `S` is whatever one shard's stores are — the routing stores only ever pick a
 * member of it.
 */
export interface TenantShardResolver<S> {
  /**
   * The shard to read a tenant from. A tenant with no assignment reads from the
   * home shard and is **not** assigned: reading must never place a tenant.
   */
  forRead(tenantId: TenantId): Promise<S>;
  /** The shard to write a tenant to, assigning (provisioning) the tenant first if it has none. */
  forWrite(tenantId: TenantId): Promise<S>;
  /**
   * A write to the shard this resolver last returned was refused by that shard's
   * tenant fence: the tenant is moving or has moved. Forget whatever is cached so
   * the next `forWrite` asks the directory.
   */
  fenced(tenantId: TenantId): void;
}
