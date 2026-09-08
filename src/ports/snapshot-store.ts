import type { StreamName } from "../core/types.js";

/**
 * Identifies one fold's snapshot of one stream.
 *
 * The key is `(stream, foldName, foldVersion)`, not `stream`, because a single
 * stream is folded several different ways. `documentStream` alone is read by
 * `foldDocument`, `foldDocumentAssignments`, `foldDocumentTags` and
 * `foldDocumentFollowers`, several of them over a filtered subset of the events.
 * Keying by stream would let one fold read another's state.
 *
 * `foldVersion` is declared by hand and bumped when a fold's semantics change.
 * Hashing the function source was considered and rejected: reformatting would
 * invalidate every snapshot, while a real semantic change made through a helper
 * would not. Nothing enforces the bump, so a test pins the folded state for a
 * fixed fixture instead — changing what a fold computes without declaring it
 * then fails.
 */
export interface FoldSnapshotKey {
  readonly stream: StreamName;
  readonly foldName: string;
  readonly foldVersion: number;
}

export interface FoldSnapshot<State = unknown> extends FoldSnapshotKey {
  /** Highest event sequence folded into `state`, inclusive. */
  readonly uptoSequence: number;
  readonly state: State;
}

/**
 * Stores folded state so a write does not replay a document's whole history.
 *
 * **The one safety rule: a snapshot may always be ignored, and ignoring it must
 * give exactly the same answer as using it.** Every decision here serves that,
 * and it is what makes the store optional, its writes best-effort, and a stale
 * snapshot harmless.
 *
 * Consequences worth stating, because each is load-bearing:
 *
 * - **Writes happen after the commit, not inside it.** A failed snapshot write
 *   must never fail a business write. Since the reader resumes from whatever
 *   sequence the snapshot claims, one that is missing or behind only costs a
 *   longer tail replay.
 * - **A snapshot is never the source of truth for a version check.** Optimistic
 *   concurrency still compares against the stream. This also keeps the door open
 *   for issue #13, which moves projections to a separate database: the
 *   projection row becomes a possibly-lagging copy then, which is why this is a
 *   separate store rather than a read of `cf_frappe_documents`.
 * - **A read carrying `maxSequence` must not use a snapshot** unless the
 *   snapshot is at or below that bound, or the fold would see state from the
 *   future. Those paths are rare, so the wiring skips snapshots for them
 *   entirely rather than comparing.
 */
export interface SnapshotStore {
  read<State>(key: FoldSnapshotKey): Promise<FoldSnapshot<State> | null>;
  /**
   * Records folded state. Implementations keep only the newest snapshot per
   * key, and callers must treat failure as acceptable.
   */
  write<State>(snapshot: FoldSnapshot<State>): Promise<void>;
}
