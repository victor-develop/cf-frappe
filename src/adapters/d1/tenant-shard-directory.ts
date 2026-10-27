import { conflict, FrameworkError } from "../../core/errors.js";
import type { TenantId } from "../../core/types.js";
import { systemClock, type Clock } from "../../ports/clock.js";
import type {
  ShardId,
  TenantShardAssignment,
  TenantShardDirectory,
  TenantShardListQuery
} from "../../ports/tenant-shards.js";
import { D1_TENANT_FENCES_TABLE, D1_TENANT_MOVES_TABLE, D1_TENANT_SHARDS_TABLE } from "./tables.js";

/** Most rows one directory listing returns. A scatter-gather pages through tenants with `after`. */
export const MAX_TENANT_SHARD_LIST_LIMIT = 500;

export type TenantMovePhase = "copying" | "building" | "catching-up" | "cutover" | "completed" | "aborted";

/**
 * One move of one tenant between shards, as journaled on the directory database.
 *
 * `state` is the mover's own progress — cursors and counters, opaque to the
 * journal. `revision` is the journal's compare-and-swap: every write names the
 * revision it read, so two drivers advancing the same move (an overlapping cron
 * tick, a retried queue message) cannot both apply a step. The loser gets a
 * conflict and stops; the winner's step stands.
 */
export interface TenantMoveRecord<State = unknown> {
  readonly moveId: string;
  readonly tenantId: TenantId;
  readonly sourceShardId: ShardId;
  readonly targetShardId: ShardId;
  readonly phase: TenantMovePhase;
  readonly revision: number;
  readonly state: State;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly finishedAt?: string;
}

interface TenantShardRow {
  readonly tenant_id: string;
  readonly shard_id: string;
  readonly epoch: number;
  readonly move_id: string | null;
  readonly assigned_at: string;
  readonly updated_at: string;
}

interface TenantMoveRow {
  readonly move_id: string;
  readonly tenant_id: string;
  readonly source_shard_id: string;
  readonly target_shard_id: string;
  readonly phase: TenantMovePhase;
  readonly revision: number;
  readonly state_json: string;
  readonly started_at: string;
  readonly updated_at: string;
  readonly finished_at: string | null;
}

/**
 * The tenant → shard directory and the move journal, in one D1 database.
 *
 * Every statement here is keyed: by tenant, by move, or by one shard's slice of
 * the shard index. Nothing scans the directory unbounded — listings page with
 * a keyset cursor and a capped limit.
 */
export class D1TenantShardDirectory implements TenantShardDirectory {
  private readonly clock: Clock;

  constructor(private readonly db: D1Database, options: { readonly clock?: Clock } = {}) {
    this.clock = options.clock ?? systemClock;
  }

  async get(tenantId: TenantId): Promise<TenantShardAssignment | null> {
    const row = await this.db
      .prepare(
        `SELECT tenant_id, shard_id, epoch, move_id, assigned_at, updated_at
         FROM ${D1_TENANT_SHARDS_TABLE} WHERE tenant_id = ?`
      )
      .bind(tenantId)
      .first<TenantShardRow>();
    return row === null ? null : assignmentFromRow(row);
  }

  async assign(tenantId: TenantId, shardId: ShardId): Promise<TenantShardAssignment> {
    const now = this.clock.now();
    await this.db
      .prepare(
        `INSERT INTO ${D1_TENANT_SHARDS_TABLE} (tenant_id, shard_id, epoch, move_id, assigned_at, updated_at)
         VALUES (?, ?, 1, NULL, ?, ?)
         ON CONFLICT(tenant_id) DO NOTHING`
      )
      .bind(tenantId, shardId, now, now)
      .run();
    const assignment = await this.get(tenantId);
    if (assignment === null) {
      // Only reachable if something deleted the row between the two statements;
      // nothing in the framework does.
      throw new FrameworkError("TENANT_SHARD_NOT_FOUND", `Tenant '${tenantId}' has no shard assignment after assigning it`, {
        status: 500
      });
    }
    return assignment;
  }

  async list(query: TenantShardListQuery): Promise<readonly TenantShardAssignment[]> {
    const limit = tenantListLimit(query.limit);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query.shardId !== undefined) {
      conditions.push("shard_id = ?");
      params.push(query.shardId);
    }
    if (query.after !== undefined) {
      conditions.push("tenant_id > ?");
      params.push(query.after);
    }
    const result = await this.db
      .prepare(
        `SELECT tenant_id, shard_id, epoch, move_id, assigned_at, updated_at
         FROM ${D1_TENANT_SHARDS_TABLE}` +
        (conditions.length === 0 ? "" : ` WHERE ${conditions.join(" AND ")}`) +
        " ORDER BY tenant_id ASC LIMIT ?"
      )
      .bind(...params, limit)
      .all<TenantShardRow>();
    return (result.results ?? []).map(assignmentFromRow);
  }

  async countByShard(): Promise<ReadonlyMap<ShardId, number>> {
    const result = await this.db
      .prepare(`SELECT shard_id, COUNT(*) AS tenants FROM ${D1_TENANT_SHARDS_TABLE} GROUP BY shard_id`)
      .all<{ shard_id: string; tenants: number }>();
    return new Map((result.results ?? []).map((row) => [row.shard_id, Number(row.tenants)]));
  }

  /**
   * Journals a new move and claims the tenant for it. The claim succeeds only if
   * the tenant is still on `sourceShardId` with no other move in progress, so
   * two operators starting a move at once get one move, not two.
   */
  async beginMove<State>(input: {
    readonly moveId: string;
    readonly tenantId: TenantId;
    readonly sourceShardId: ShardId;
    readonly targetShardId: ShardId;
    readonly state: State;
  }): Promise<TenantMoveRecord<State>> {
    const now = this.clock.now();
    await this.db
      .prepare(
        `INSERT INTO ${D1_TENANT_MOVES_TABLE}
         (move_id, tenant_id, source_shard_id, target_shard_id, phase, revision, state_json, started_at, updated_at, finished_at)
         VALUES (?, ?, ?, ?, 'copying', 1, ?, ?, ?, NULL)`
      )
      .bind(input.moveId, input.tenantId, input.sourceShardId, input.targetShardId, JSON.stringify(input.state), now, now)
      .run();
    const claimed = await this.db
      .prepare(
        `UPDATE ${D1_TENANT_SHARDS_TABLE} SET move_id = ?, updated_at = ?
         WHERE tenant_id = ? AND shard_id = ? AND move_id IS NULL`
      )
      .bind(input.moveId, now, input.tenantId, input.sourceShardId)
      .run();
    if (Number(claimed.meta?.changes ?? 0) !== 1) {
      await this.db
        .prepare(
          `UPDATE ${D1_TENANT_MOVES_TABLE} SET phase = 'aborted', revision = revision + 1, updated_at = ?, finished_at = ?
           WHERE move_id = ?`
        )
        .bind(now, now, input.moveId)
        .run();
      throw conflict(
        `Tenant '${input.tenantId}' is not on shard '${input.sourceShardId}' with no move in progress`
      );
    }
    return (await this.requireMove<State>(input.moveId));
  }

  async getMove<State>(moveId: string): Promise<TenantMoveRecord<State> | null> {
    const row = await this.db
      .prepare(
        `SELECT move_id, tenant_id, source_shard_id, target_shard_id, phase, revision, state_json, started_at, updated_at, finished_at
         FROM ${D1_TENANT_MOVES_TABLE} WHERE move_id = ?`
      )
      .bind(moveId)
      .first<TenantMoveRow>();
    return row === null ? null : moveFromRow<State>(row);
  }

  async requireMove<State>(moveId: string): Promise<TenantMoveRecord<State>> {
    const move = await this.getMove<State>(moveId);
    if (move === null) {
      throw new FrameworkError("TENANT_MOVE_NOT_FOUND", `Tenant move '${moveId}' was not found`, { status: 404 });
    }
    return move;
  }

  /** A tenant's moves, newest first. */
  async listMoves<State>(tenantId: TenantId, limit = 20): Promise<readonly TenantMoveRecord<State>[]> {
    const result = await this.db
      .prepare(
        `SELECT move_id, tenant_id, source_shard_id, target_shard_id, phase, revision, state_json, started_at, updated_at, finished_at
         FROM ${D1_TENANT_MOVES_TABLE} WHERE tenant_id = ? ORDER BY started_at DESC, move_id DESC LIMIT ?`
      )
      .bind(tenantId, tenantListLimit(limit))
      .all<TenantMoveRow>();
    return (result.results ?? []).map((row) => moveFromRow<State>(row));
  }

  /** Records one step of a move, if nobody else has since `move.revision`. */
  async saveMove<State>(
    move: TenantMoveRecord<State>,
    next: { readonly phase: TenantMovePhase; readonly state: State }
  ): Promise<TenantMoveRecord<State>> {
    const now = this.clock.now();
    const result = await this.db
      .prepare(
        `UPDATE ${D1_TENANT_MOVES_TABLE}
         SET phase = ?, state_json = ?, revision = revision + 1, updated_at = ?
         WHERE move_id = ? AND revision = ? AND phase NOT IN ('completed', 'aborted')`
      )
      .bind(next.phase, JSON.stringify(next.state), now, move.moveId, move.revision)
      .run();
    if (Number(result.meta?.changes ?? 0) !== 1) {
      throw conflict(`Tenant move '${move.moveId}' changed while advancing it`);
    }
    return this.requireMove<State>(move.moveId);
  }

  /**
   * Finishes a move: the journal says completed and the directory points the
   * tenant at the target, in one batch.
   *
   * The directory update is guarded on the journal row having *just* become
   * completed at the next revision, so a stale driver whose journal update
   * matched nothing cannot flip the directory either — the batch is all or
   * nothing in effect, not only in transaction.
   */
  async completeMove<State>(move: TenantMoveRecord<State>, state: State): Promise<TenantShardAssignment> {
    const now = this.clock.now();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE ${D1_TENANT_MOVES_TABLE}
           SET phase = 'completed', state_json = ?, revision = revision + 1, updated_at = ?, finished_at = ?
           WHERE move_id = ? AND revision = ? AND phase = 'cutover'`
        )
        .bind(JSON.stringify(state), now, now, move.moveId, move.revision),
      this.db
        .prepare(
          `UPDATE ${D1_TENANT_SHARDS_TABLE}
           SET shard_id = ?, epoch = epoch + 1, move_id = NULL, updated_at = ?
           WHERE tenant_id = ? AND move_id = ? AND EXISTS (
             SELECT 1 FROM ${D1_TENANT_MOVES_TABLE}
             WHERE move_id = ? AND phase = 'completed' AND revision = ?
           )`
        )
        .bind(move.targetShardId, now, move.tenantId, move.moveId, move.moveId, move.revision + 1)
    ]);
    const assignment = await this.get(move.tenantId);
    if (assignment === null || assignment.shardId !== move.targetShardId || assignment.moveId !== undefined) {
      throw conflict(`Tenant move '${move.moveId}' changed while completing it`);
    }
    return assignment;
  }

  /** Abandons a move. The directory keeps the tenant where it was. */
  async abortMove<State>(move: TenantMoveRecord<State>, state: State): Promise<TenantMoveRecord<State>> {
    const now = this.clock.now();
    await this.db.batch([
      this.db
        .prepare(
          `UPDATE ${D1_TENANT_MOVES_TABLE}
           SET phase = 'aborted', state_json = ?, revision = revision + 1, updated_at = ?, finished_at = ?
           WHERE move_id = ? AND revision = ? AND phase NOT IN ('completed', 'aborted')`
        )
        .bind(JSON.stringify(state), now, now, move.moveId, move.revision),
      this.db
        .prepare(
          `UPDATE ${D1_TENANT_SHARDS_TABLE} SET move_id = NULL, updated_at = ?
           WHERE tenant_id = ? AND move_id = ? AND EXISTS (
             SELECT 1 FROM ${D1_TENANT_MOVES_TABLE} WHERE move_id = ? AND phase = 'aborted'
           )`
        )
        .bind(now, move.tenantId, move.moveId, move.moveId)
    ]);
    const aborted = await this.requireMove<State>(move.moveId);
    if (aborted.phase !== "aborted") {
      throw conflict(`Tenant move '${move.moveId}' changed while aborting it`);
    }
    return aborted;
  }
}

/** A tenant's write fence on one shard, as `cf_frappe_tenant_fences` holds it. */
export interface D1TenantFence {
  readonly tenantId: TenantId;
  readonly moveId: string;
  readonly fencedAt: string;
}

/**
 * Fences `tenantId` on this database: from the moment the insert commits, the
 * trigger refuses every event insert for the tenant here, from any writer.
 * Idempotent for the same move; a fence left by a different move stays and is
 * returned, so the caller can see it is not its own.
 */
export async function fenceD1Tenant(
  db: D1Database,
  fence: D1TenantFence
): Promise<D1TenantFence> {
  await db
    .prepare(
      `INSERT INTO ${D1_TENANT_FENCES_TABLE} (tenant_id, move_id, fenced_at) VALUES (?, ?, ?)
       ON CONFLICT(tenant_id) DO NOTHING`
    )
    .bind(fence.tenantId, fence.moveId, fence.fencedAt)
    .run();
  const stored = await readD1TenantFence(db, fence.tenantId);
  // The insert above either created the row or found one; it cannot be absent.
  return stored!;
}

export async function readD1TenantFence(db: D1Database, tenantId: TenantId): Promise<D1TenantFence | null> {
  const row = await db
    .prepare(`SELECT tenant_id, move_id, fenced_at FROM ${D1_TENANT_FENCES_TABLE} WHERE tenant_id = ?`)
    .bind(tenantId)
    .first<{ tenant_id: string; move_id: string; fenced_at: string }>();
  return row === null ? null : { tenantId: row.tenant_id, moveId: row.move_id, fencedAt: row.fenced_at };
}

/**
 * Lifts one move's fence. Keyed by tenant *and* move, so lifting can never
 * remove a fence some other move put there.
 */
export async function liftD1TenantFence(db: D1Database, tenantId: TenantId, moveId: string): Promise<void> {
  await db
    .prepare(`DELETE FROM ${D1_TENANT_FENCES_TABLE} WHERE tenant_id = ? AND move_id = ?`)
    .bind(tenantId, moveId)
    .run();
}

function tenantListLimit(limit: number): number {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > MAX_TENANT_SHARD_LIST_LIMIT) {
    throw new FrameworkError(
      "TENANT_SCATTER_LIMIT_EXCEEDED",
      `Tenant listings take a limit between 1 and ${MAX_TENANT_SHARD_LIST_LIMIT}`,
      { status: 400 }
    );
  }
  return limit;
}

function assignmentFromRow(row: TenantShardRow): TenantShardAssignment {
  return {
    tenantId: row.tenant_id,
    shardId: row.shard_id,
    epoch: Number(row.epoch),
    ...(row.move_id === null ? {} : { moveId: row.move_id }),
    assignedAt: row.assigned_at,
    updatedAt: row.updated_at
  };
}

function moveFromRow<State>(row: TenantMoveRow): TenantMoveRecord<State> {
  return {
    moveId: row.move_id,
    tenantId: row.tenant_id,
    sourceShardId: row.source_shard_id,
    targetShardId: row.target_shard_id,
    phase: row.phase,
    revision: Number(row.revision),
    state: JSON.parse(row.state_json) as State,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    ...(row.finished_at === null ? {} : { finishedAt: row.finished_at })
  };
}
