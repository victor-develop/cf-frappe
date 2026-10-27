import { badRequest, conflict, FrameworkError } from "../../core/errors.js";
import type { DocTypeName, DocumentSnapshot, StreamName, TenantId } from "../../core/types.js";
import { ProjectionBackfillService, projectionRowFromEvents } from "../../application/projection-backfill.js";
import { systemClock, type Clock } from "../../ports/clock.js";
import { cryptoIdGenerator, type IdGenerator } from "../../ports/id-generator.js";
import type { MonotonicProjectionWriter } from "../../ports/projection-store.js";
import type { ShardId, TenantShardAssignment } from "../../ports/tenant-shards.js";
import { HOME_SHARD_TENANTS } from "../sharding/tenant-shard-router.js";
import { D1EventStore } from "./event-store.js";
import { D1_EVENTS_TABLE } from "./tables.js";
import {
  fenceD1Tenant,
  liftD1TenantFence,
  readD1TenantFence,
  type D1TenantShardDirectory,
  type TenantMoveRecord
} from "./tenant-shard-directory.js";
import type { D1ShardMigrations } from "./tenant-provisioning.js";

/** Events per copy page. D1 binds at most 100 parameters per statement, and the missing-id probe binds one per event. */
export const MAX_TENANT_MOVE_PAGE_SIZE = 100;
export const DEFAULT_TENANT_MOVE_PAGE_SIZE = 100;
export const DEFAULT_TENANT_MOVE_PAGES_PER_ADVANCE = 5;
/**
 * How far before a pass started the next pass looks again. Covers the time
 * between a writer stamping `occurredAt` and its batch committing, plus clock
 * skew between isolates. Generous on purpose: too small can only cost a
 * cutover retry (the count check catches it), never a lost event; too large
 * only costs re-reading rows the target already has.
 */
export const DEFAULT_TENANT_MOVE_CATCH_UP_MARGIN_MS = 5 * 60_000;
/** A catch-up pass that found at most this many missing events is followed by the cutover. */
export const DEFAULT_TENANT_MOVE_CUTOVER_THRESHOLD = 100;
/** Most pages the fenced final pass may take before the cutover gives up and unfences. */
export const DEFAULT_TENANT_MOVE_MAX_CUTOVER_PAGES = 20;
/**
 * A fence left on the target by an earlier move *away* from it is lifted when
 * the tenant moves back, but only once no isolate can still be routing writes
 * there from cache. Twice the default router cache lifetime.
 */
export const DEFAULT_TENANT_MOVE_STALE_FENCE_AGE_MS = 10_000;

/** A position in the copy order: `(occurred_at, stream, sequence)`, which `idx_cf_frappe_events_tenant_time` serves. */
export interface TenantMoveEventKey {
  readonly occurredAt: string;
  readonly stream: StreamName;
  readonly sequence: number;
}

export interface TenantMoveCutoverReport {
  readonly at: string;
  readonly outcome: "completed" | "counts-differ" | "too-many-pages";
  readonly sourceEvents?: number;
  readonly targetEvents?: number;
  readonly pages: number;
}

/** The mover's own progress, journaled as the move's state. */
export interface TenantMoveState {
  /** Events copied so far, all passes. */
  readonly copied: number;
  /** When the current pass started, by the mover's clock. */
  readonly passStartedAt?: string;
  /** Lower `occurred_at` bound of the current pass. Absent: from the tenant's first event. */
  readonly windowFrom?: string;
  /** Where the current pass got to. */
  readonly cursor?: TenantMoveEventKey;
  /** Events the current catch-up pass found missing on the target. */
  readonly passMissing: number;
  readonly passes: number;
  /** Where the next pass starts looking: the start of the last full pass, less the margin. */
  readonly nextWindowFrom?: string;
  /** Projection rebuild progress on the target: which projected doctype, and the stream cursor in it. */
  readonly build?: { readonly doctypeIndex: number; readonly after?: StreamName; readonly applied: number };
  readonly cutovers: readonly TenantMoveCutoverReport[];
  readonly abortReason?: string;
}

export type TenantMove = TenantMoveRecord<TenantMoveState>;

/** One shard as the mover sees it: the database holding its events, and the table its reads come from. */
export interface D1TenantMoverShard {
  readonly database: D1Database;
  /** Where the shard's projection reads come from — the shard itself, or its projection database under #13. */
  readonly projections: MonotonicProjectionWriter;
}

export interface D1TenantMoverOptions {
  readonly directory: D1TenantShardDirectory;
  readonly shards: ReadonlyMap<ShardId, D1TenantMoverShard>;
  readonly home: ShardId;
  /** Doctypes whose streams fold to projection rows: every registered doctype plus `PROJECTED_FRAMEWORK_DOCTYPES`. */
  readonly projectedDoctypes: () => readonly DocTypeName[];
  /** Checks a target is not behind its source on migrations. Optional only for tests that do not migrate. */
  readonly migrations?: D1ShardMigrations;
  /** Told when a tenant's directory entry flips, so this isolate's routing cache can forget it at once. */
  readonly onMoved?: (assignment: TenantShardAssignment) => void;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  readonly pageSize?: number;
  readonly pagesPerAdvance?: number;
  readonly catchUpMarginMs?: number;
  readonly cutoverThreshold?: number;
  readonly maxCutoverPages?: number;
  readonly staleFenceAgeMs?: number;
}

interface EventRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly stream: string;
  readonly sequence: number;
  readonly type: string;
  readonly doctype: string;
  readonly document_name: string;
  readonly actor_id: string;
  readonly occurred_at: string;
  readonly payload_json: string;
  readonly metadata_json: string;
}

interface PassPage {
  readonly scanned: number;
  readonly inserted: number;
  readonly last?: TenantMoveEventKey;
  readonly done: boolean;
}

/**
 * Moves one tenant from one shard to another while it keeps reading and
 * writing (issue #14).
 *
 * Events are the asset and projections are a cache (#5), so a move copies
 * events and **rebuilds** projections rather than copying them: the target's
 * projection is a new, not-yet-active version built from the copied stream with
 * the #11 backfill, and the source's stays the active one until the switch —
 * #10's two versions side by side, on two databases. Nothing is deleted from
 * the source; it keeps a frozen copy (see "What a move leaves behind" in
 * `docs/tenant-sharding.md`).
 *
 * The phases, each advanced a bounded step per {@link advance} call so a cron
 * or queue driver paces it:
 *
 * 1. **copying** — every event of the tenant, in `(occurred_at, stream,
 *    sequence)` order, `INSERT OR IGNORE`d into the target. Reads and writes
 *    carry on against the source.
 * 2. **building** — the target's projection table is rebuilt from its events,
 *    one projected doctype at a time.
 * 3. **catching-up** — passes that re-read the source from the start of the
 *    previous pass (less a margin), copy what the target is missing, and refold
 *    the streams those events belong to. Repeats until a pass finds at most
 *    `cutoverThreshold` missing events.
 * 4. **cutover** — in one call: fence the tenant on the source (from here every
 *    write to it there is refused by the trigger and retried by the routing
 *    stores), run a final pass, and compare the tenant's event counts on both
 *    sides. Every target event is a copy of a source event, by id, so equal
 *    counts mean equal sets; then the directory flips and writes resume on the
 *    target. Unequal counts — an event committed later than the margin assumed —
 *    or a final pass longer than `maxCutoverPages` lift the fence and go back to
 *    catching up (from the tenant's first event, after a count mismatch). The
 *    write stall is one invocation, not a pass over the tenant.
 *
 * Why the passes cannot lose an event: an event committed before a pass started
 * is found by that pass's scan, and an event committed after it started was
 * stamped no earlier than that start less the commit latency, which the next
 * pass's window covers. The count comparison under the fence checks that
 * reasoning instead of trusting it.
 */
export class D1TenantMover {
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly pageSize: number;
  private readonly pagesPerAdvance: number;
  private readonly marginMs: number;
  private readonly cutoverThreshold: number;
  private readonly maxCutoverPages: number;
  private readonly staleFenceAgeMs: number;

  constructor(private readonly options: D1TenantMoverOptions) {
    this.clock = options.clock ?? systemClock;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.pageSize = positive("pageSize", options.pageSize ?? DEFAULT_TENANT_MOVE_PAGE_SIZE, MAX_TENANT_MOVE_PAGE_SIZE);
    this.pagesPerAdvance = positive("pagesPerAdvance", options.pagesPerAdvance ?? DEFAULT_TENANT_MOVE_PAGES_PER_ADVANCE, 100);
    this.marginMs = nonNegative("catchUpMarginMs", options.catchUpMarginMs ?? DEFAULT_TENANT_MOVE_CATCH_UP_MARGIN_MS);
    this.cutoverThreshold = nonNegative("cutoverThreshold", options.cutoverThreshold ?? DEFAULT_TENANT_MOVE_CUTOVER_THRESHOLD);
    this.maxCutoverPages = positive("maxCutoverPages", options.maxCutoverPages ?? DEFAULT_TENANT_MOVE_MAX_CUTOVER_PAGES, 1_000);
    this.staleFenceAgeMs = nonNegative("staleFenceAgeMs", options.staleFenceAgeMs ?? DEFAULT_TENANT_MOVE_STALE_FENCE_AGE_MS);
  }

  /** Starts moving `tenantId` to `targetShardId`. Reads and writes stay on the source until the cutover. */
  async start(tenantId: TenantId, targetShardId: ShardId): Promise<TenantMove> {
    if (HOME_SHARD_TENANTS.includes(tenantId)) {
      throw badRequest(`Tenant '${tenantId}' is framework state and always lives on the home shard`);
    }
    const target = this.shard(targetShardId);
    // A tenant with no assignment lives on the home shard; record that, so the
    // move has a source to claim.
    const assignment =
      (await this.options.directory.get(tenantId)) ?? (await this.options.directory.assign(tenantId, this.options.home));
    if (assignment.moveId !== undefined) {
      throw conflict(`Tenant '${tenantId}' already has move '${assignment.moveId}' in progress`);
    }
    if (assignment.shardId === targetShardId) {
      throw new FrameworkError("TENANT_MOVE_INVALID", `Tenant '${tenantId}' already lives on shard '${targetShardId}'`, {
        status: 409
      });
    }
    const source = this.shard(assignment.shardId);
    const sourceFence = await readD1TenantFence(source.database, tenantId);
    if (sourceFence !== null) {
      throw new FrameworkError(
        "TENANT_MOVE_INVALID",
        `Tenant '${tenantId}' is fenced on its own shard '${assignment.shardId}' by move '${sourceFence.moveId}'`,
        { status: 409 }
      );
    }
    await this.assertTargetNotBehind(assignment.shardId, targetShardId);
    // The target may hold a frozen copy from an earlier move away from it. That
    // copy is a prefix of the tenant's history — events are never changed, and
    // ids are unique — so copying on top of it is sound; only its fence has to
    // go, and only once no isolate can still be routing writes there.
    const targetFence = await readD1TenantFence(target.database, tenantId);
    if (targetFence !== null) {
      const age = Date.parse(this.clock.now()) - Date.parse(targetFence.fencedAt);
      if (!(age >= this.staleFenceAgeMs)) {
        throw new FrameworkError(
          "TENANT_MOVE_INVALID",
          `Tenant '${tenantId}' left shard '${targetShardId}' too recently to move back; retry in ${this.staleFenceAgeMs} ms`,
          { status: 409 }
        );
      }
      await liftD1TenantFence(target.database, tenantId, targetFence.moveId);
    }
    return this.options.directory.beginMove<TenantMoveState>({
      moveId: this.ids.next("move_"),
      tenantId,
      sourceShardId: assignment.shardId,
      targetShardId,
      state: { copied: 0, passMissing: 0, passes: 0, cutovers: [] }
    });
  }

  async status(moveId: string): Promise<TenantMove> {
    return this.options.directory.requireMove<TenantMoveState>(moveId);
  }

  /** The tenant's move in progress, if any. */
  async activeMove(tenantId: TenantId): Promise<TenantMove | null> {
    const assignment = await this.options.directory.get(tenantId);
    return assignment?.moveId === undefined
      ? null
      : this.options.directory.requireMove<TenantMoveState>(assignment.moveId);
  }

  /** Does one bounded step of the move. Returns the journaled move afterwards. */
  async advance(moveId: string): Promise<TenantMove> {
    const move = await this.options.directory.requireMove<TenantMoveState>(moveId);
    switch (move.phase) {
      case "copying":
        return this.copy(move);
      case "building":
        return this.build(move);
      case "catching-up":
        return this.catchUp(move);
      case "cutover":
        return this.cutover(move);
      case "completed":
      case "aborted":
        return move;
    }
  }

  /** Advances until the move completes or `maxSteps` run out. For tools and tests; production paces with the job. */
  async run(moveId: string, maxSteps = 10_000): Promise<TenantMove> {
    let move = await this.status(moveId);
    for (let step = 0; step < maxSteps && move.phase !== "completed" && move.phase !== "aborted"; step += 1) {
      move = await this.advance(moveId);
    }
    return move;
  }

  /** Abandons a move before its cutover lands. The tenant stays where it was, unfenced. */
  async abort(moveId: string, reason: string): Promise<TenantMove> {
    const move = await this.options.directory.requireMove<TenantMoveState>(moveId);
    if (move.phase === "completed" || move.phase === "aborted") {
      return move;
    }
    await liftD1TenantFence(this.shard(move.sourceShardId).database, move.tenantId, move.moveId);
    return this.options.directory.abortMove(move, { ...move.state, abortReason: reason });
  }

  private async copy(move: TenantMove): Promise<TenantMove> {
    const state = move.state;
    const passStartedAt = state.passStartedAt ?? this.clock.now();
    let cursor = state.cursor;
    let copied = state.copied;
    for (let page = 0; page < this.pagesPerAdvance; page += 1) {
      const result = await this.copyPage(move, undefined, cursor, false);
      copied += result.inserted;
      cursor = result.last ?? cursor;
      if (result.done) {
        return this.options.directory.saveMove(move, {
          phase: "building",
          state: withoutCursor({
            ...state,
            copied,
            passes: state.passes + 1,
            nextWindowFrom: this.windowFrom(passStartedAt),
            build: { doctypeIndex: 0, applied: 0 }
          })
        });
      }
    }
    return this.options.directory.saveMove(move, {
      phase: "copying",
      state: { ...state, copied, passStartedAt, ...(cursor === undefined ? {} : { cursor }) }
    });
  }

  private async build(move: TenantMove): Promise<TenantMove> {
    const target = this.shard(move.targetShardId);
    const backfill = new ProjectionBackfillService({
      events: new D1EventStore(target.database),
      streams: new D1EventStore(target.database),
      target: target.projections
    });
    const doctypes = this.options.projectedDoctypes();
    let build = move.state.build ?? { doctypeIndex: 0, applied: 0 };
    for (let page = 0; page < this.pagesPerAdvance && build.doctypeIndex < doctypes.length; page += 1) {
      const result = await backfill.advance({
        tenantId: move.tenantId,
        doctype: doctypes[build.doctypeIndex]!,
        ...(build.after === undefined ? {} : { after: build.after }),
        batchSize: this.pageSize
      });
      build = result.more
        ? { doctypeIndex: build.doctypeIndex, after: result.cursor!, applied: build.applied + result.applied }
        : { doctypeIndex: build.doctypeIndex + 1, applied: build.applied + result.applied };
    }
    if (build.doctypeIndex < doctypes.length) {
      return this.options.directory.saveMove(move, { phase: "building", state: { ...move.state, build } });
    }
    return this.options.directory.saveMove(move, {
      phase: "catching-up",
      state: this.newPass({ ...move.state, build }, move.state.nextWindowFrom)
    });
  }

  private async catchUp(move: TenantMove): Promise<TenantMove> {
    let state = move.state;
    for (let page = 0; page < this.pagesPerAdvance; page += 1) {
      const result = await this.copyPage(move, state.windowFrom, state.cursor, true);
      state = {
        ...state,
        copied: state.copied + result.inserted,
        passMissing: state.passMissing + result.inserted,
        ...(result.last === undefined ? {} : { cursor: result.last })
      };
      if (result.done) {
        const nextWindowFrom = this.windowFrom(state.passStartedAt ?? this.clock.now());
        const finished = { ...state, passes: state.passes + 1, nextWindowFrom };
        if (state.passMissing <= this.cutoverThreshold) {
          return this.options.directory.saveMove(move, { phase: "cutover", state: withoutCursor(finished) });
        }
        return this.options.directory.saveMove(move, { phase: "catching-up", state: this.newPass(finished, nextWindowFrom) });
      }
    }
    return this.options.directory.saveMove(move, { phase: "catching-up", state });
  }

  private async cutover(move: TenantMove): Promise<TenantMove> {
    const source = this.shard(move.sourceShardId);
    const target = this.shard(move.targetShardId);
    const fence = await fenceD1Tenant(source.database, {
      tenantId: move.tenantId,
      moveId: move.moveId,
      fencedAt: this.clock.now()
    });
    if (fence.moveId !== move.moveId) {
      throw new FrameworkError(
        "TENANT_MOVE_INVALID",
        `Tenant '${move.tenantId}' is fenced on '${move.sourceShardId}' by another move, '${fence.moveId}'`,
        { status: 409 }
      );
    }
    // From here the source is frozen for this tenant: the trigger refuses every
    // event insert for it, whichever isolate or cached route issued it.
    let cursor: TenantMoveEventKey | undefined;
    let copied = 0;
    let pages = 0;
    let done = false;
    while (!done && pages < this.maxCutoverPages) {
      const result = await this.copyPage(move, move.state.nextWindowFrom, cursor, true);
      copied += result.inserted;
      cursor = result.last ?? cursor;
      pages += 1;
      done = result.done;
    }
    const at = this.clock.now();
    if (!done) {
      await liftD1TenantFence(source.database, move.tenantId, move.moveId);
      return this.options.directory.saveMove(move, {
        phase: "catching-up",
        state: this.newPass(
          { ...move.state, copied: move.state.copied + copied, cutovers: [...move.state.cutovers, { at, outcome: "too-many-pages", pages }] },
          move.state.nextWindowFrom
        )
      });
    }
    const [sourceEvents, targetEvents] = await Promise.all([
      tenantEventCount(source.database, move.tenantId),
      tenantEventCount(target.database, move.tenantId)
    ]);
    if (sourceEvents !== targetEvents) {
      await liftD1TenantFence(source.database, move.tenantId, move.moveId);
      // Something escaped the window. Rescan from the tenant's first event;
      // the rows the target already has cost a read, not a write.
      return this.options.directory.saveMove(move, {
        phase: "catching-up",
        state: this.newPass(
          {
            ...move.state,
            copied: move.state.copied + copied,
            cutovers: [...move.state.cutovers, { at, outcome: "counts-differ", sourceEvents, targetEvents, pages }]
          },
          undefined
        )
      });
    }
    const finalState: TenantMoveState = {
      ...move.state,
      copied: move.state.copied + copied,
      cutovers: [...move.state.cutovers, { at, outcome: "completed", sourceEvents, targetEvents, pages }]
    };
    let assignment: TenantShardAssignment;
    try {
      assignment = await this.options.directory.completeMove(move, finalState);
    } catch (error) {
      // The directory did not flip, so the tenant still lives on the source:
      // it must not stay frozen there.
      const now = await this.options.directory.get(move.tenantId);
      if (now?.shardId !== move.targetShardId) {
        await liftD1TenantFence(source.database, move.tenantId, move.moveId);
      }
      throw error;
    }
    this.options.onMoved?.(assignment);
    return this.options.directory.requireMove<TenantMoveState>(move.moveId);
  }

  /**
   * Copies one page of the tenant's events from source to target, starting
   * after `cursor` (or at `windowFrom`), in `(occurred_at, stream, sequence)`
   * order. With `refold`, also finds which of them the target was missing,
   * inserts only those, and rewrites the target projection rows of the streams
   * they belong to.
   */
  private async copyPage(
    move: TenantMove,
    windowFrom: string | undefined,
    cursor: TenantMoveEventKey | undefined,
    refold: boolean
  ): Promise<PassPage> {
    const source = this.shard(move.sourceShardId);
    const target = this.shard(move.targetShardId);
    const rows = await readEventPage(source.database, move.tenantId, windowFrom, cursor, this.pageSize);
    if (rows.length === 0) {
      return { scanned: 0, inserted: 0, done: true };
    }
    const missing = refold ? await missingOn(target.database, rows) : rows;
    if (missing.length > 0) {
      await target.database.batch(missing.map((row) => insertCopiedEventStatement(target.database, row)));
    }
    if (refold && missing.length > 0) {
      await this.refold(move.tenantId, target, missing);
    }
    const last = rows.at(-1)!;
    return {
      scanned: rows.length,
      inserted: missing.length,
      last: { occurredAt: last.occurred_at, stream: last.stream, sequence: Number(last.sequence) },
      done: rows.length < this.pageSize
    };
  }

  /** Rewrites the target's projection rows for the streams `rows` touched, from the target's events. */
  private async refold(tenantId: TenantId, target: D1TenantMoverShard, rows: readonly EventRow[]): Promise<void> {
    const projected = new Set(this.options.projectedDoctypes());
    const streams = new Map<StreamName, DocTypeName>();
    for (const row of rows) {
      if (projected.has(row.doctype)) {
        streams.set(row.stream, row.doctype);
      }
    }
    if (streams.size === 0) {
      return;
    }
    const events = new D1EventStore(target.database);
    const snapshots: DocumentSnapshot[] = [];
    for (const [stream, doctype] of streams) {
      const snapshot = projectionRowFromEvents(tenantId, doctype, await events.readStream(stream));
      if (snapshot !== null) {
        snapshots.push(snapshot);
      }
    }
    await target.projections.saveNewest(snapshots);
  }

  private newPass(state: TenantMoveState, windowFrom: string | undefined): TenantMoveState {
    const { windowFrom: _previous, ...rest } = withoutCursor(state);
    return {
      ...rest,
      passStartedAt: this.clock.now(),
      passMissing: 0,
      ...(windowFrom === undefined ? {} : { windowFrom })
    };
  }

  private windowFrom(passStartedAt: string): string {
    return new Date(Date.parse(passStartedAt) - this.marginMs).toISOString();
  }

  private async assertTargetNotBehind(sourceShardId: ShardId, targetShardId: ShardId): Promise<void> {
    if (this.options.migrations === undefined) {
      return;
    }
    const [source, target] = await Promise.all([
      this.options.migrations.applied(sourceShardId),
      this.options.migrations.applied(targetShardId)
    ]);
    const targetApplied = new Set(target);
    const missing = source.filter((id) => !targetApplied.has(id));
    if (missing.length > 0) {
      throw new FrameworkError(
        "TENANT_MOVE_INVALID",
        `Shard '${targetShardId}' is behind '${sourceShardId}' on migrations (${missing.join(", ")}); roll them out first`,
        { status: 409 }
      );
    }
  }

  private shard(shardId: ShardId): D1TenantMoverShard {
    const shard = this.options.shards.get(shardId);
    if (shard === undefined) {
      throw new FrameworkError("TENANT_SHARD_NOT_FOUND", `Shard '${shardId}' is not bound in this deployment`, {
        status: 404
      });
    }
    return shard;
  }
}

const EVENT_COLUMNS =
  "id, tenant_id, stream, sequence, type, doctype, document_name, actor_id, occurred_at, payload_json, metadata_json";

/**
 * One page of a tenant's events after a position, served by
 * `idx_cf_frappe_events_tenant_time (tenant_id, occurred_at, stream, sequence)`.
 *
 * The keyset is spelled out rather than written as a row-value comparison so
 * the leading `occurred_at >= ?` is a plain range the planner seeks on;
 * `tests/adapters/tenant-move.test.ts` pins that the plan searches the index and
 * never sorts.
 */
async function readEventPage(
  db: D1Database,
  tenantId: TenantId,
  windowFrom: string | undefined,
  cursor: TenantMoveEventKey | undefined,
  limit: number
): Promise<readonly EventRow[]> {
  const statement = cursor === undefined
    ? db
        .prepare(
          `SELECT ${EVENT_COLUMNS} FROM ${D1_EVENTS_TABLE}
           WHERE tenant_id = ? AND occurred_at >= ?
           ORDER BY occurred_at, stream, sequence LIMIT ?`
        )
        .bind(tenantId, windowFrom ?? "", limit)
    : db
        .prepare(
          `SELECT ${EVENT_COLUMNS} FROM ${D1_EVENTS_TABLE}
           WHERE tenant_id = ? AND occurred_at >= ?
             AND (occurred_at > ? OR stream > ? OR (stream = ? AND sequence > ?))
           ORDER BY occurred_at, stream, sequence LIMIT ?`
        )
        .bind(tenantId, cursor.occurredAt, cursor.occurredAt, cursor.stream, cursor.stream, cursor.sequence, limit);
  const result = await statement.all<EventRow>();
  return result.results ?? [];
}

async function missingOn(db: D1Database, rows: readonly EventRow[]): Promise<readonly EventRow[]> {
  const result = await db
    .prepare(`SELECT id FROM ${D1_EVENTS_TABLE} WHERE id IN (${rows.map(() => "?").join(", ")})`)
    .bind(...rows.map((row) => row.id))
    .all<{ id: string }>();
  const present = new Set((result.results ?? []).map((row) => row.id));
  return rows.filter((row) => !present.has(row.id));
}

/**
 * The row exactly as the source stored it — payload and metadata JSON copied as
 * text, not re-serialized — so the target's event is byte-identical. `OR
 * IGNORE` makes a re-copied page a no-op; a row that collided on `(stream,
 * sequence)` with a different id would be ignored too, and would then show as
 * a count difference at the cutover instead of passing silently.
 */
function insertCopiedEventStatement(db: D1Database, row: EventRow): D1PreparedStatement {
  return db
    .prepare(`INSERT OR IGNORE INTO ${D1_EVENTS_TABLE} (${EVENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      row.id,
      row.tenant_id,
      row.stream,
      row.sequence,
      row.type,
      row.doctype,
      row.document_name,
      row.actor_id,
      row.occurred_at,
      row.payload_json,
      row.metadata_json
    );
}

export async function tenantEventCount(db: D1Database, tenantId: TenantId): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS events FROM ${D1_EVENTS_TABLE} WHERE tenant_id = ?`)
    .bind(tenantId)
    .first<{ events: number }>();
  return Number(row!.events);
}

function withoutCursor(state: TenantMoveState): TenantMoveState {
  const { cursor: _cursor, ...rest } = state;
  return rest;
}

function positive(name: string, value: number, max: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > max) {
    throw badRequest(`Tenant move ${name} must be an integer between 1 and ${max}`);
  }
  return value;
}

function nonNegative(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw badRequest(`Tenant move ${name} must be a non-negative integer`);
  }
  return value;
}
