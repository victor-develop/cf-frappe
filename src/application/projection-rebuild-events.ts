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
  return foldProjectionRebuildFrom(null, events);
}

/**
 * Resumable form: folds `events` on top of an already-folded state. Every fold in
 * the framework has one so a snapshot can stand in for the head of a stream (see
 * issue #17), and `tests/core/fold-associativity.test.ts` holds every one of them
 * to `foldFrom(foldAll(head), tail) === foldAll(head ++ tail)`.
 */
export function foldProjectionRebuildFrom(
  initial: ProjectionRebuildState | null,
  events: readonly DomainEvent[]
): ProjectionRebuildState | null {
  let state: ProjectionRebuildState | null = initial;
  for (const event of events) {
    const payload = event.payload;
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
    if (payload.kind === "ProjectionRebuildCompleted") {
      state = { ...state, status: "completed", version: event.sequence };
      continue;
    }
    if (payload.kind === "ProjectionRebuildAborted" || payload.kind === "ProjectionRebuildFailed") {
      state = {
        ...state,
        status: payload.kind === "ProjectionRebuildAborted" ? "aborted" : "failed",
        reason: payload.reason,
        version: event.sequence
      };
    }
    // Anything else on this stream is not part of the run and is ignored.
  }
  return state;
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly ProjectionRebuildStarted: Extract<
      ProjectionRebuildEventPayload,
      { readonly kind: "ProjectionRebuildStarted" }
    >;
    readonly ProjectionRebuildAdvanced: Extract<
      ProjectionRebuildEventPayload,
      { readonly kind: "ProjectionRebuildAdvanced" }
    >;
    readonly ProjectionRebuildCompleted: Extract<
      ProjectionRebuildEventPayload,
      { readonly kind: "ProjectionRebuildCompleted" }
    >;
    readonly ProjectionRebuildAborted: Extract<
      ProjectionRebuildEventPayload,
      { readonly kind: "ProjectionRebuildAborted" }
    >;
    readonly ProjectionRebuildFailed: Extract<
      ProjectionRebuildEventPayload,
      { readonly kind: "ProjectionRebuildFailed" }
    >;
  }
}
