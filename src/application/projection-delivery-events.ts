import type { DomainEvent } from "../core/types.js";

/** A projection record the consumer read past without applying, and why. */
export interface ProjectionDeliverySkip {
  /** Its sequence on the projection channel. */
  readonly sequence: number;
  readonly eventId: string;
  readonly reason: string;
}

export type ProjectionDeliveryCursorEventPayload = {
  /**
   * Every projection record on the channel at or below `toSequence` has been
   * applied, except the ones in `skipped`. `fromSequence` is the position this
   * advance started from, so the stream reads as a gap-free chain of ranges.
   */
  readonly kind: "ProjectionDeliveryCursorAdvanced";
  readonly fromSequence: number;
  readonly toSequence: number;
  readonly applied: number;
  /**
   * Records that cannot be applied however often they are retried — a payload
   * with no valid snapshot. Kept here, in the event log, rather than retried
   * forever: one unreadable record would otherwise hold every later write out
   * of the projection database.
   */
  readonly skipped: readonly ProjectionDeliverySkip[];
};

export interface ProjectionDeliveryCursor {
  /** Highest channel sequence applied; 0 before the first delivery. */
  readonly position: number;
  /** The cursor stream's own version, for the next compare-and-swap. */
  readonly version: number;
}

/**
 * The cursor from the newest event on the cursor stream. Every advance carries
 * the absolute position, so the newest event alone is the state — a cursor read
 * is one row however long the stream gets.
 */
export function projectionDeliveryCursor(newest: DomainEvent | undefined): ProjectionDeliveryCursor {
  if (newest === undefined) {
    return { position: 0, version: 0 };
  }
  const payload = newest.payload as Partial<ProjectionDeliveryCursorEventPayload>;
  return {
    position: payload.kind === "ProjectionDeliveryCursorAdvanced" && typeof payload.toSequence === "number"
      ? payload.toSequence
      : 0,
    version: newest.sequence
  };
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly ProjectionDeliveryCursorAdvanced: ProjectionDeliveryCursorEventPayload;
  }
}
