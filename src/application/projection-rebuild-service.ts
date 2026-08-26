import { FrameworkError, notFound } from "../core/errors.js";
import { foldDocument } from "../core/events.js";
import type { DocTypeName, NewDomainEvent, StreamName, TenantId } from "../core/types.js";
import type { Clock } from "../ports/clock.js";
import type { EventStore, StreamCatalog } from "../ports/event-store.js";
import type { IdGenerator } from "../ports/id-generator.js";
import type { ProjectionStore } from "../ports/projection-store.js";
import type { RoutedProjectionStore } from "./projection-targets.js";
import {
  PROJECTION_REBUILD_DOCTYPE,
  foldProjectionRebuild,
  projectionRebuildStream,
  type ProjectionRebuildError,
  type ProjectionRebuildEventPayload,
  type ProjectionRebuildState
} from "./projection-rebuild-events.js";

export const DEFAULT_PROJECTION_REBUILD_BATCH_SIZE = 50;
export const MAX_PROJECTION_REBUILD_BATCH_SIZE = 500;

export interface ProjectionRebuildStartOptions {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  /** Name of the projection target to rebuild into. Must not be the active one. */
  readonly target: string;
  /**
   * Streams processed per {@link ProjectionRebuildService.advance} call. This is
   * the rate limit: a rebuild advances only when its driver — a Cron Trigger or a
   * queue consumer — calls it, so batch size times call frequency bounds the load
   * a rebuild can put on the same single-writer database serving live traffic.
   */
  readonly batchSize?: number;
}

export interface ProjectionRebuildAdvanceResult {
  readonly state: ProjectionRebuildState;
  /** False once the run has reached the end of the stream list or stopped. */
  readonly more: boolean;
}

export interface ProjectionRebuildServiceOptions {
  readonly events: EventStore;
  readonly streams: StreamCatalog;
  readonly router: RoutedProjectionStore;
  /** Resolves a target name to its store. Usually the router's own targets. */
  readonly targetStore: (name: string) => ProjectionStore | undefined;
  readonly clock: Clock;
  readonly ids: IdGenerator;
}

/**
 * Rebuilds a doctype's projection from the event stream.
 *
 * A projection is a cache folded from events, so changing the fold — adding a
 * derived field, fixing a projection bug, reshaping the physical layout —
 * invalidates every existing row. This is the operation that recomputes them.
 *
 * Three properties make it safe to run against a live system:
 *
 * - **It never writes the active projection.** The target must be a non-active
 *   projection mounted on the router (see `projection-targets.ts`), so live reads
 *   keep answering from the projection that was already correct.
 * - **It is resumable and idempotent.** Progress is a cursor over the
 *   lexicographically ordered stream list, and `ProjectionStore.save` upserts, so
 *   re-running a batch rewrites the same rows rather than duplicating them.
 * - **It is externally paced.** `advance` does one batch and returns; the caller
 *   decides when the next one runs.
 */
export class ProjectionRebuildService {
  constructor(private readonly options: ProjectionRebuildServiceOptions) {}

  async start(input: ProjectionRebuildStartOptions): Promise<ProjectionRebuildState> {
    const batchSize = assertBatchSize(input.batchSize ?? DEFAULT_PROJECTION_REBUILD_BATCH_SIZE);
    this.assertRebuildableTarget(input.target);
    const streams = await this.options.streams.listStreams({
      tenantId: input.tenantId,
      doctype: input.doctype
    });
    const runId = this.options.ids.next("rebuild");
    await this.append(input.tenantId, runId, 0, {
      kind: "ProjectionRebuildStarted",
      runId,
      doctype: input.doctype,
      target: input.target,
      batchSize,
      totalStreams: streams.length
    });
    return this.requireState(input.tenantId, runId);
  }

  async status(tenantId: TenantId, runId: string): Promise<ProjectionRebuildState> {
    return this.requireState(tenantId, runId);
  }

  async abort(tenantId: TenantId, runId: string, reason: string): Promise<ProjectionRebuildState> {
    const state = await this.requireState(tenantId, runId);
    if (state.status !== "running") {
      return state;
    }
    await this.append(tenantId, runId, state.version, {
      kind: "ProjectionRebuildAborted",
      runId,
      reason
    });
    return this.requireState(tenantId, runId);
  }

  /**
   * Rebuilds the next batch of streams. Returns the run state and whether more
   * work remains, so a driver can loop without knowing the cursor arithmetic.
   */
  async advance(tenantId: TenantId, runId: string): Promise<ProjectionRebuildAdvanceResult> {
    const state = await this.requireState(tenantId, runId);
    if (state.status !== "running") {
      return { state, more: false };
    }
    const store = this.assertRebuildableTarget(state.target);
    const streams = await this.options.streams.listStreams({
      tenantId,
      doctype: state.doctype
    });
    // The cursor is a stream name, not an index: streams added while the rebuild
    // runs sort into place instead of shifting everything after them.
    const pending = streams.filter((stream) => state.cursor === undefined || stream > state.cursor);
    if (pending.length === 0) {
      await this.append(tenantId, runId, state.version, {
        kind: "ProjectionRebuildCompleted",
        runId
      });
      return { state: await this.requireState(tenantId, runId), more: false };
    }

    const batch = pending.slice(0, state.batchSize);
    const errors: ProjectionRebuildError[] = [];
    let rebuilt = 0;
    let cursor: StreamName | undefined;
    for (const stream of batch) {
      try {
        const snapshot = foldDocument(await this.options.events.readStream(stream));
        if (snapshot !== null) {
          await store.save(snapshot);
          rebuilt += 1;
        }
        // A stream that folds to null was deleted; there is nothing to write, and
        // the cursor still advances so the run does not stall on it.
        cursor = stream;
      } catch (cause) {
        errors.push({ stream, reason: cause instanceof Error ? cause.message : String(cause) });
        // Advance past a failing stream so one bad document cannot block the run.
        // The failure is recorded and surfaced through the run state.
        cursor = stream;
      }
    }

    if (cursor === undefined) {
      return { state, more: true };
    }
    await this.append(tenantId, runId, state.version, {
      kind: "ProjectionRebuildAdvanced",
      runId,
      cursor,
      rebuilt,
      errors
    });
    const advanced = await this.requireState(tenantId, runId);
    if (pending.length > batch.length) {
      return { state: advanced, more: true };
    }
    // The batch consumed the last pending stream. Complete here rather than
    // waiting for another call: a driver that stops on `more: false` would
    // otherwise leave the run stuck in `running` forever.
    await this.append(tenantId, runId, advanced.version, {
      kind: "ProjectionRebuildCompleted",
      runId
    });
    return { state: await this.requireState(tenantId, runId), more: false };
  }

  private assertRebuildableTarget(name: string): ProjectionStore {
    if (name === this.options.router.readingFrom()) {
      throw new FrameworkError(
        "PROJECTION_REBUILD_TARGET_INVALID",
        `Projection target '${name}' is currently serving reads; rebuild into a non-active target`,
        { status: 409 }
      );
    }
    const store = this.options.targetStore(name);
    if (store === undefined) {
      throw notFound(`Unknown projection target '${name}'`, "PROJECTION_TARGET_NOT_FOUND");
    }
    return store;
  }

  private async requireState(tenantId: TenantId, runId: string): Promise<ProjectionRebuildState> {
    const state = foldProjectionRebuild(
      await this.options.events.readStream(projectionRebuildStream(tenantId, runId))
    );
    if (state === null) {
      throw notFound(`Projection rebuild '${runId}' was not found`, "PROJECTION_REBUILD_NOT_FOUND");
    }
    return state;
  }

  private async append(
    tenantId: TenantId,
    runId: string,
    expectedVersion: number,
    payload: ProjectionRebuildEventPayload
  ): Promise<void> {
    const stream = projectionRebuildStream(tenantId, runId);
    const event: NewDomainEvent = {
      id: this.options.ids.next("evt"),
      tenantId,
      stream,
      type: payload.kind,
      doctype: PROJECTION_REBUILD_DOCTYPE,
      documentName: runId,
      actorId: "__projection_rebuild__",
      occurredAt: this.options.clock.now(),
      payload: payload as unknown as NewDomainEvent["payload"],
      metadata: {}
    };
    await this.options.events.append(stream, expectedVersion, [event]);
  }
}

function assertBatchSize(batchSize: number): number {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_PROJECTION_REBUILD_BATCH_SIZE) {
    throw new FrameworkError(
      "PROJECTION_REBUILD_BATCH_INVALID",
      `Projection rebuild batch size must be an integer between 1 and ${MAX_PROJECTION_REBUILD_BATCH_SIZE}`,
      { status: 400 }
    );
  }
  return batchSize;
}
