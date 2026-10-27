import type { DocTypeName, StreamName, TenantId } from "../core/types.js";

/** One contiguous run of a stream's events that lives in cold storage. */
export interface ArchivedEventSegment {
  readonly stream: StreamName;
  /** First sequence in the segment, inclusive. */
  readonly seqStart: number;
  /** Last sequence in the segment, inclusive. */
  readonly seqEnd: number;
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly eventCount: number;
  readonly objectKey: string;
  readonly sha256: string;
  readonly archivedAt: string;
}

export interface EventArchiveMoveOptions {
  /**
   * Highest sequence to move, inclusive. The caller decides it — normally the
   * `uptoSequence` of a snapshot that covers the stream — and the archive moves
   * nothing above it.
   */
  readonly through: number;
  /** Events per cold object. */
  readonly maxSegmentEvents?: number;
  /**
   * Do nothing unless at least this many hot events are below `through`. Many
   * tiny objects cost more in R2 operations and index rows than they save.
   */
  readonly minEvents?: number;
}

export interface EventArchiveMoveResult {
  readonly stream: StreamName;
  /** Segments written by this call, oldest first; empty when nothing moved. */
  readonly segments: readonly ArchivedEventSegment[];
  /** Highest archived sequence for the stream after the call, or 0. */
  readonly archivedThrough: number;
}

export interface EventArchiveRestoreResult {
  readonly stream: StreamName;
  readonly segments: number;
  readonly events: number;
}

export interface EventArchiveCandidate {
  readonly stream: StreamName;
  /** Events of the stream still in the hot database. */
  readonly hotEvents: number;
}

/**
 * Moves a stream's old events between the hot database and cold storage.
 *
 * This is the write side of issue #18. The read side does not appear here on
 * purpose: `EventStore`, `DocumentStore` and `AuditEventStore` keep their
 * interfaces, and an adapter that has an archive behind it answers them with
 * hot and cold events merged, so callers cannot tell the difference.
 *
 * Two invariants every implementation must hold:
 *
 * - **Moved, never deleted.** An event leaves the hot database only in the same
 *   atomic step that records where it went, and only after the cold copy has
 *   been read back and verified. `restore` reverses it.
 * - **Protected streams never move.** `isArchivableStream` in
 *   `core/streams.ts` is checked here, at the lowest level that can remove a
 *   row, so no caller and no cut policy can archive a naming-series counter or
 *   a unique-value claim.
 */
export interface EventArchive {
  archive(stream: StreamName, options: EventArchiveMoveOptions): Promise<EventArchiveMoveResult>;
  /** Moves every archived event of `stream` back into the hot database. */
  restore(stream: StreamName): Promise<EventArchiveRestoreResult>;
  segments(stream: StreamName): Promise<readonly ArchivedEventSegment[]>;
  /**
   * Streams with at least `minHotEvents` hot events, in stream-name order after
   * `after`. Protected streams are included so a caller paging by the last
   * stream it saw does not stop early; `archive` refuses them.
   */
  candidates(query: {
    readonly after?: StreamName;
    readonly limit: number;
    readonly minHotEvents: number;
  }): Promise<readonly EventArchiveCandidate[]>;
  /** Streams with at least one archived segment, in stream-name order after `after`. */
  archivedStreams(query: { readonly after?: StreamName; readonly limit: number }): Promise<readonly StreamName[]>;
}
