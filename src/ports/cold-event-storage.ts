/**
 * Object storage for archived event segments — R2 in production (issue #18).
 *
 * Deliberately two methods and **no delete**. Archiving is the one operation in
 * the framework that removes event rows from the hot database, and the red line
 * it works under is that an event is moved, never destroyed: the snapshots that
 * make archiving possible are computed with today's fold logic, and the day a
 * `foldVersion` is bumped every one of them is void and the stream has to be
 * folded from sequence 1 again. A port that cannot delete is the cheapest way to
 * make "no path deletes an archived event" a property of the code rather than of
 * the people changing it. Restoring a stream to the hot database leaves its
 * objects where they are; R2 has no capacity limit and an orphaned segment costs
 * cents.
 */
export interface ColdEventStorage {
  /**
   * Stores `body` under `key`, overwriting anything there.
   *
   * Overwriting is safe because keys are derived from `(stream, seqStart,
   * seqEnd)` and events are immutable, so a second write to a key carries the
   * same bytes — that is what makes a retried archive after a crash idempotent.
   *
   * `sha256` is the hex digest of `body`. An implementation that can have the
   * store verify it on receipt (R2 can) should, so a corrupted upload fails
   * here rather than at the read-back.
   */
  put(key: string, body: string, options: ColdEventPutOptions): Promise<void>;
  /** The stored body, or null when nothing is stored under `key`. */
  get(key: string): Promise<string | null>;
}

export interface ColdEventPutOptions {
  readonly sha256: string;
  readonly metadata: Readonly<Record<string, string>>;
}

/**
 * What one read that had to reach cold storage cost.
 *
 * Issue #18 asks that latency on archived data be *measurable*, not that it be
 * fast: a timeline, a `cancel` or an `amend` on an archived document is allowed
 * to take seconds, and the operator needs to see when it does. One record is
 * emitted per read that consulted the archive index and found segments, after
 * the read completes.
 */
export interface ColdEventReadMetrics {
  readonly operation: "readStream" | "readDocumentEvents" | "searchEvents";
  /** The stream read, or undefined for a tenant-wide audit search. */
  readonly stream?: string;
  /** Segments the read needed. */
  readonly segments: number;
  /** Of those, how many were served from the in-isolate cache. */
  readonly cachedSegments: number;
  /** Archived events that ended up in the result. */
  readonly archivedEvents: number;
  readonly durationMs: number;
}

export type ColdEventReadObserver = (metrics: ColdEventReadMetrics) => void;
