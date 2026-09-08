import type { FoldSnapshot, FoldSnapshotKey, SnapshotStore } from "../../ports/snapshot-store.js";

/** Snapshots held in a `Map`, for tests and single-isolate use. */
export class InMemorySnapshotStore implements SnapshotStore {
  private readonly snapshots = new Map<string, FoldSnapshot>();

  async read<State>(key: FoldSnapshotKey): Promise<FoldSnapshot<State> | null> {
    const found = this.snapshots.get(snapshotKey(key));
    // Cloned on the way out: a caller that folds onto this state must not be
    // able to mutate what a later read returns, or a snapshot would stop
    // agreeing with the events it claims to summarise.
    return found === undefined ? null : (structuredClone(found) as FoldSnapshot<State>);
  }

  async write<State>(snapshot: FoldSnapshot<State>): Promise<void> {
    const key = snapshotKey(snapshot);
    const existing = this.snapshots.get(key);
    // Newest wins. Two isolates can commit at different sequences, and an older
    // snapshot arriving late must not undo a newer one.
    if (existing !== undefined && existing.uptoSequence >= snapshot.uptoSequence) {
      return;
    }
    this.snapshots.set(key, structuredClone(snapshot) as FoldSnapshot);
  }
}

function snapshotKey(key: FoldSnapshotKey): string {
  return `${key.stream} ${key.foldName} ${String(key.foldVersion)}`;
}
