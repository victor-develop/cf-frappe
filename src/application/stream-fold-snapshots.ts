import type { DocumentEventPayload, DomainEvent, StreamName } from "../core/types.js";
import type { EventStore } from "../ports/event-store.js";
import type { FoldSnapshot, SnapshotStore } from "../ports/snapshot-store.js";

/**
 * One fold, with everything a snapshot of it needs to be safe.
 *
 * `payloadKinds` is bound to the fold rather than passed at each call site, and
 * that is the point of the type existing at all. Several streams are folded more
 * than one way over different subsets of their events; a snapshot taken over one
 * subset and later resumed over another would fold events its state has already
 * seen, or miss ones it has not. Binding them together makes that
 * unrepresentable instead of something every call site has to get right.
 */
export interface StreamFold<State> {
  /** Part of the snapshot key, so two folds of one stream never collide. */
  readonly name: string;
  /**
   * Bumped when the fold's semantics change, so old state is not found rather
   * than being folded onto. Declared by hand — hashing the source would be
   * invalidated by reformatting and unmoved by a real change made through a
   * helper — so a test pins the folded state for a fixed fixture instead.
   */
  readonly version: number;
  readonly payloadKinds?: readonly DocumentEventPayload["kind"][];
  foldFrom(prior: State | null, events: readonly DomainEvent[]): State;
}

/**
 * Reads and records snapshots for any fold over any stream.
 *
 * The generic form of what `DocumentFoldSnapshots` does for one document, for
 * the unbounded streams in issue #17 — a tenant's notifications, the job
 * schedule catalogue — where the fold has no natural ceiling at all and cost
 * grows with the tenant's whole history rather than one document's.
 *
 * Holds the same safety rule: **a snapshot may always be ignored, and ignoring
 * it must give exactly the same answer.** With no `SnapshotStore` this does the
 * full read the caller did before, so the rule holds by construction. Reads and
 * writes both swallow their errors, and a stale snapshot only costs a longer
 * tail.
 */
export class StreamFoldSnapshots {
  constructor(
    private readonly events: EventStore,
    private readonly snapshots: SnapshotStore | undefined
  ) {}

  /** Folds `stream` forward from its snapshot, or from nothing if there is none. */
  async resume<State>(stream: StreamName, fold: StreamFold<State>): Promise<State> {
    const base = await this.read(stream, fold);
    const options = fold.payloadKinds === undefined ? {} : { payloadKinds: fold.payloadKinds };
    if (base === null) {
      return fold.foldFrom(null, await this.events.readStream(stream, options));
    }
    return fold.foldFrom(
      base.state,
      await this.events.readStream(stream, { ...options, minSequence: base.uptoSequence + 1 })
    );
  }

  /**
   * Records folded state at `uptoSequence`, ignoring any failure.
   *
   * The caller passes the sequence rather than it being derived here, because
   * only the caller knows which of the events it just appended belong to this
   * stream — a commit batch spans several and sequences are per-stream.
   */
  async record<State>(
    stream: StreamName,
    fold: StreamFold<State>,
    state: State,
    uptoSequence: number
  ): Promise<void> {
    if (this.snapshots === undefined || uptoSequence <= 0) {
      return;
    }
    try {
      await this.snapshots.write<State>({
        stream,
        foldName: fold.name,
        foldVersion: fold.version,
        uptoSequence,
        state
      });
    } catch {
      // Deliberately ignored — the events are the truth and this is a cache.
    }
  }

  private async read<State>(
    stream: StreamName,
    fold: StreamFold<State>
  ): Promise<FoldSnapshot<State> | null> {
    if (this.snapshots === undefined) {
      return null;
    }
    try {
      return await this.snapshots.read<State>({
        stream,
        foldName: fold.name,
        foldVersion: fold.version
      });
    } catch {
      return null;
    }
  }
}
