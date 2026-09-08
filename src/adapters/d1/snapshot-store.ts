import { D1_FOLD_SNAPSHOTS_TABLE } from "./tables.js";
import type { Clock } from "../../ports/clock.js";
import { systemClock } from "../../ports/clock.js";
import type { FoldSnapshot, FoldSnapshotKey, SnapshotStore } from "../../ports/snapshot-store.js";

interface FoldSnapshotRow {
  readonly upto_sequence: number;
  readonly state_json: string;
}

/**
 * Folded state in D1, so a snapshot outlives the isolate that took it.
 *
 * The in-memory store is enough where one instance owns one stream — the
 * aggregate Durable Object for a document — but not for the streams issue #17
 * lists as unbounded. A user's notification fold is written from whichever
 * document's coordinator happened to handle the event and read from whichever
 * Worker isolate serves the inbox, so an in-memory snapshot is cold almost
 * every time. This one is not.
 *
 * The safety rule still holds and is what keeps this simple: **a snapshot may
 * always be ignored.** So there is no transaction against the event append, no
 * consistency check, and a read that fails is a cache miss rather than an error
 * — the caller folds the whole stream instead.
 */
export class D1SnapshotStore implements SnapshotStore {
  private readonly clock: Clock;

  constructor(
    private readonly db: D1Database,
    options: { readonly clock?: Clock } = {}
  ) {
    this.clock = options.clock ?? systemClock;
  }

  async read<State>(key: FoldSnapshotKey): Promise<FoldSnapshot<State> | null> {
    const row = await this.db
      .prepare(
        `SELECT upto_sequence, state_json
         FROM ${D1_FOLD_SNAPSHOTS_TABLE}
         WHERE stream = ? AND fold_name = ? AND fold_version = ?`
      )
      .bind(key.stream, key.foldName, key.foldVersion)
      .first<FoldSnapshotRow>();
    if (row === null) {
      return null;
    }
    return {
      ...key,
      uptoSequence: Number(row.upto_sequence),
      state: JSON.parse(row.state_json) as State
    };
  }

  async write<State>(snapshot: FoldSnapshot<State>): Promise<void> {
    // Newest wins, decided in SQL rather than by reading first. Two isolates can
    // write different sequences for one key concurrently, and an older snapshot
    // arriving late must not undo a newer one — the `WHERE excluded... >` makes
    // that a property of the statement instead of a race between a read and a
    // write.
    await this.db
      .prepare(
        `INSERT INTO ${D1_FOLD_SNAPSHOTS_TABLE}
           (stream, fold_name, fold_version, upto_sequence, state_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (stream, fold_name, fold_version) DO UPDATE SET
           upto_sequence = excluded.upto_sequence,
           state_json = excluded.state_json,
           updated_at = excluded.updated_at
         WHERE excluded.upto_sequence > ${D1_FOLD_SNAPSHOTS_TABLE}.upto_sequence`
      )
      .bind(
        snapshot.stream,
        snapshot.foldName,
        snapshot.foldVersion,
        snapshot.uptoSequence,
        JSON.stringify(snapshot.state),
        this.clock.now()
      )
      .run();
  }
}
