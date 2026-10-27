import type { DocumentEventPayload, DocumentSnapshot, DomainEvent, NewDomainEvent, StreamName } from "../core/types.js";

export interface ReadStreamOptions {
  /**
   * Lowest sequence to return, inclusive. Used to read only the tail of a
   * stream after a snapshot, so folds do not replay history they already
   * folded.
   */
  readonly minSequence?: number;
  readonly maxSequence?: number;
  /**
   * Maximum number of events to return. With minSequence, returns the first
   * events at or after the lower bound for forward replay. Without
   * minSequence, preserves the existing recent-page behavior.
   */
  readonly limit?: number;
  readonly payloadKinds?: readonly DocumentEventPayload["kind"][];
}

export interface DocumentCommit {
  readonly events: readonly DomainEvent[];
  readonly snapshot: DocumentSnapshot;
}

export interface DocumentCommitBatchEntry {
  readonly stream: StreamName;
  readonly expectedVersion: number;
  readonly events: readonly NewDomainEvent[];
}

export interface DocumentCommitBatchProjection {
  readonly snapshot: DocumentSnapshot;
  readonly auxiliarySnapshots?: readonly DocumentSnapshot[];
}

export interface DocumentStore {
  readStream(stream: StreamName, options?: ReadStreamOptions): Promise<readonly DomainEvent[]>;
  commit(
    stream: StreamName,
    expectedVersion: number,
    events: readonly NewDomainEvent[],
    project: (events: readonly DomainEvent[]) => DocumentSnapshot
  ): Promise<DocumentCommit>;
  commitBatch(
    entries: readonly DocumentCommitBatchEntry[],
    project: (events: readonly DomainEvent[]) => DocumentCommitBatchProjection
  ): Promise<DocumentCommit>;
}

/**
 * Where a commit's projection rows go when they are *not* written inside it.
 *
 * By default a `DocumentStore` writes the projection rows a commit produces in
 * the same atomic batch as its events, so a document is listable the moment the
 * write returns. Issue #13 moves projections to a separate database, and a
 * second database cannot join that batch. What can join it is an event: the
 * handoff turns the rows into events that the store appends in the same atomic
 * batch, so "the write happened" and "the projection will be told" cannot come
 * apart — not on a crashed Worker, not on an evicted Durable Object.
 *
 * The returned events are appended **at the head of their own streams**, with
 * the sequence taken inside the batch rather than from an expected version.
 * That is the point: every document write in a tenant hands off into the same
 * stream, and a compare-and-swap on it would serialize every writer in the
 * tenant behind one version number. A head append cannot conflict with another
 * head append; a writer that does CAS on that stream (a delivery claim) just
 * sees its own expectation move and retries, as it already does.
 *
 * A handoff stream must not also be one of the commit's own entries — the store
 * refuses that, because the entry's expected version would then depend on the
 * order the two were applied in.
 */
export interface ProjectionHandoff {
  handoff(commit: {
    readonly events: readonly DomainEvent[];
    readonly snapshots: readonly DocumentSnapshot[];
  }): readonly NewDomainEvent[];
  /**
   * Runs after the commit has landed, with the rows that were handed off — the
   * hook for applying them early. The store awaits it and ignores a rejection:
   * the commit has succeeded by then and the handed-off events guarantee the
   * rows arrive, so this can make them arrive sooner and nothing else.
   */
  afterHandoff?(snapshots: readonly DocumentSnapshot[]): Promise<void>;
}

export interface DocumentStoreProjectionOptions {
  /**
   * Hand projection rows off as events instead of writing them. Omitted, the
   * store writes them inline exactly as it always has.
   */
  readonly projectionHandoff?: ProjectionHandoff;
}

/**
 * The handoff's events, refused when one targets a stream the commit itself
 * writes: that entry's expected version was checked against a head the handoff
 * is about to move, so which of the two "wins" would depend on statement order.
 */
export async function afterProjectionHandoff(
  handoff: ProjectionHandoff,
  snapshots: readonly DocumentSnapshot[]
): Promise<void> {
  try {
    await handoff.afterHandoff?.(snapshots);
  } catch {
    // See `ProjectionHandoff.afterHandoff`: never the reason a commit fails.
  }
}

export function projectionHandoffEvents(
  handoff: ProjectionHandoff,
  entries: readonly DocumentCommitBatchEntry[],
  saved: readonly DomainEvent[],
  snapshots: readonly DocumentSnapshot[]
): readonly NewDomainEvent[] {
  const events = handoff.handoff({ events: saved, snapshots });
  const committed = new Set(entries.map((entry) => entry.stream));
  for (const event of events) {
    if (committed.has(event.stream)) {
      throw new Error(`Projection handoff stream '${event.stream}' is also written by the commit it hands off`);
    }
  }
  return events;
}
