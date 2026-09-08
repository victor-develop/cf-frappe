import type { DocumentEventPayload, DomainEvent, StreamName } from "../core/types.js";
import type { EventStore } from "../ports/event-store.js";
import type { FoldSnapshot, SnapshotStore } from "../ports/snapshot-store.js";

/**
 * One fold, with everything a snapshot of it needs to be safe.
 *
 * `payloadKinds` is bound to the fold rather than passed at each call site.
 * Several streams are folded more than one way over different subsets of their
 * events, and a snapshot taken over one subset then resumed over another folds
 * events its state has already seen or misses ones it has not.
 *
 * Binding removes that from every call site, but be precise about what it does
 * not do: the snapshot key is `(stream, name, version)` and the filter is not in
 * it, so two folds sharing a name and version while differing in `payloadKinds`
 * would still share a snapshot. Nothing structural prevents that — only the fact
 * that a name is owned by one fold. A real registry keyed by name, which issue
 * #17 asks for, is what would make it impossible.
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
  /**
   * Converts the state to and from something a `SnapshotStore` can persist.
   *
   * Required, not optional, because the obvious default is wrong in a way that
   * is fatal rather than merely useless. `UserNotificationState` holds a `Map`;
   * `JSON.stringify` renders one as `{}`, and the fold then does
   * `new Map(prior.notifications)` on a plain object and throws. A durable store
   * turns that into a permanent failure for that key — every read and every
   * write, until the row is deleted. So the shape a store sees is stated by the
   * fold that owns it rather than assumed.
   *
   * `decode` may throw or return null for anything it does not recognise; the
   * caller treats that as a cache miss.
   */
  readonly codec: FoldStateCodec<State>;
}

export interface FoldStateCodec<State> {
  encode(state: State): unknown;
  decode(stored: unknown): State | null;
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
    if (base !== null) {
      try {
        return fold.foldFrom(
          base.state,
          await this.events.readStream(stream, { ...options, minSequence: base.uptoSequence + 1 })
        );
      } catch {
        // Folding onto a snapshot must not be able to fail the caller. A stored
        // state the fold cannot consume — a shape from an older version, or one
        // a store mangled on the way through — has to degrade to a cold fold,
        // or the snapshot stops being ignorable and becomes fatal. That is the
        // one thing the whole design forbids.
      }
    }
    return fold.foldFrom(null, await this.events.readStream(stream, options));
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
      await this.snapshots.write<unknown>({
        stream,
        foldName: fold.name,
        foldVersion: fold.version,
        uptoSequence,
        state: fold.codec.encode(state)
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
      const stored = await this.snapshots.read<unknown>({
        stream,
        foldName: fold.name,
        foldVersion: fold.version
      });
      if (stored === null) {
        return null;
      }
      const state = fold.codec.decode(stored.state);
      return state === null ? null : { ...stored, state };
    } catch {
      return null;
    }
  }
}
