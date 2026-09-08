import type { FoldSnapshot, FoldSnapshotKey, SnapshotStore } from "../../ports/snapshot-store.js";

/**
 * Snapshots held in a `Map`, for tests and single-isolate use.
 *
 * Bounded, because one of its callers is not per-document. The aggregate
 * Durable Object is addressed per document for most commands but `create`,
 * `duplicate` and `amend` all route to a shared `${tenant}:${doctype}:_create`
 * instance, so that one accumulates a snapshot per document it has ever
 * created. 200 creates measured 200 entries with nothing evicting them, against
 * a 128 MB isolate.
 *
 * Eviction is safe by the same rule that makes the whole store optional: a
 * snapshot may always be ignored, so dropping one costs a cold fold. Least
 * recently *used* rather than least recently written, because a document being
 * edited repeatedly is exactly the one worth keeping.
 *
 * **Stores what it is handed, without copying.** An earlier version
 * `structuredClone`d on both sides so a caller could not mutate stored state.
 * That is free for a document snapshot and ruinous for an unbounded fold: on a
 * 600-notification inbox it made each delivery 1.9x *slower* than having no
 * snapshot at all, because the state itself is O(history) and got deep-copied
 * twice per write. Removing it made the same case 8x faster than the baseline.
 *
 * The isolation now comes from `StreamFold.codec`, which sits between the fold
 * and any store: `encode` produces a fresh plain structure and `decode` rebuilds
 * the state on every read. The contract that replaces the clone is therefore on
 * `encode` — it must not hand over anything its caller goes on to mutate.
 */
export class InMemorySnapshotStore implements SnapshotStore {
  private readonly snapshots = new Map<string, FoldSnapshot>();
  private readonly limit: number;

  constructor(options: { readonly limit?: number } = {}) {
    this.limit = options.limit ?? DEFAULT_SNAPSHOT_LIMIT;
  }

  async read<State>(key: FoldSnapshotKey): Promise<FoldSnapshot<State> | null> {
    const mapKey = snapshotKey(key);
    const found = this.snapshots.get(mapKey);
    if (found === undefined) {
      return null;
    }
    // Re-inserted so `Map` iteration order tracks recency of use, which is what
    // the eviction below walks.
    this.snapshots.delete(mapKey);
    this.snapshots.set(mapKey, found);
    return found as FoldSnapshot<State>;
  }

  async write<State>(snapshot: FoldSnapshot<State>): Promise<void> {
    const key = snapshotKey(snapshot);
    const existing = this.snapshots.get(key);
    // Newest wins. Two isolates can commit at different sequences, and an older
    // snapshot arriving late must not undo a newer one.
    if (existing !== undefined && existing.uptoSequence >= snapshot.uptoSequence) {
      return;
    }
    this.snapshots.delete(key);
    this.snapshots.set(key, snapshot as FoldSnapshot);
    while (this.snapshots.size > this.limit) {
      const oldest = this.snapshots.keys().next();
      if (oldest.done === true) {
        break;
      }
      this.snapshots.delete(oldest.value);
    }
  }
}

/**
 * Enough to hold the working set of a busy document without letting the shared
 * create instance grow without limit. Not measured against production traffic —
 * it is a ceiling, not a tuning.
 */
const DEFAULT_SNAPSHOT_LIMIT = 256;

function snapshotKey(key: FoldSnapshotKey): string {
  return `${key.stream} ${key.foldName} ${String(key.foldVersion)}`;
}
