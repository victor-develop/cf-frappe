import type { DocTypeName, DomainEvent, StreamName, TenantId } from "../core/types.js";

export type ProjectionRebuildStatus = "running" | "aborted" | "completed" | "failed";

export interface ProjectionRebuildError {
  readonly stream: StreamName;
  readonly reason: string;
}

export type ProjectionRebuildEventPayload =
  | {
      readonly kind: "ProjectionRebuildStarted";
      readonly runId: string;
      readonly doctype: DocTypeName;
      readonly target: string;
      readonly batchSize: number;
      readonly totalStreams: number;
    }
  | {
      readonly kind: "ProjectionRebuildAdvanced";
      readonly runId: string;
      /** Last stream written in this batch; the resume point. */
      readonly cursor: StreamName;
      readonly rebuilt: number;
      readonly errors: readonly ProjectionRebuildError[];
    }
  | {
      readonly kind: "ProjectionRebuildCompleted";
      readonly runId: string;
    }
  | {
      readonly kind: "ProjectionRebuildAborted";
      readonly runId: string;
      readonly reason: string;
    }
  | {
      readonly kind: "ProjectionRebuildFailed";
      readonly runId: string;
      readonly reason: string;
    };

/**
 * How many recent per-stream errors the folded state keeps.
 *
 * The state is folded from the whole run stream on every advance, so it must not
 * grow with the number of events in it — see #28 for what happens when a folded
 * state accumulates without bound. Counts are unbounded (they are numbers);
 * error detail is a bounded sample, and the full history stays in the events.
 */
export const PROJECTION_REBUILD_ERROR_SAMPLE = 20;

export interface ProjectionRebuildState {
  readonly runId: string;
  readonly doctype: DocTypeName;
  readonly target: string;
  readonly batchSize: number;
  readonly totalStreams: number;
  readonly status: ProjectionRebuildStatus;
  /** Last stream written, or undefined when nothing has been written yet. */
  readonly cursor?: StreamName;
  readonly rebuilt: number;
  readonly failed: number;
  readonly recentErrors: readonly ProjectionRebuildError[];
  readonly version: number;
  readonly reason?: string;
}

/** One stream per run, so this fold stays bounded by the run's own length. */
export function projectionRebuildStream(tenantId: TenantId, runId: string): StreamName {
  return `${tenantId}/__ProjectionRebuild/${runId}`;
}

export const PROJECTION_REBUILD_DOCTYPE = "__ProjectionRebuild";

export function foldProjectionRebuild(events: readonly DomainEvent[]): ProjectionRebuildState | null {
  let state: ProjectionRebuildState | null = null;
  for (const event of events) {
    const payload = event.payload as unknown as ProjectionRebuildEventPayload;
    if (payload.kind === "ProjectionRebuildStarted") {
      state = {
        runId: payload.runId,
        doctype: payload.doctype,
        target: payload.target,
        batchSize: payload.batchSize,
        totalStreams: payload.totalStreams,
        status: "running",
        rebuilt: 0,
        failed: 0,
        recentErrors: [],
        version: event.sequence
      };
      continue;
    }
    if (state === null) {
      continue;
    }
    if (payload.kind === "ProjectionRebuildAdvanced") {
      const recentErrors = [...state.recentErrors, ...payload.errors].slice(
        -PROJECTION_REBUILD_ERROR_SAMPLE
      );
      state = {
        ...state,
        cursor: payload.cursor,
        rebuilt: state.rebuilt + payload.rebuilt,
        failed: state.failed + payload.errors.length,
        recentErrors,
        version: event.sequence
      };
      continue;
    }
    state = {
      ...state,
      status:
        payload.kind === "ProjectionRebuildCompleted"
          ? "completed"
          : payload.kind === "ProjectionRebuildAborted"
            ? "aborted"
            : "failed",
      ...(payload.kind === "ProjectionRebuildCompleted" ? {} : { reason: payload.reason }),
      version: event.sequence
    };
  }
  return state;
}
