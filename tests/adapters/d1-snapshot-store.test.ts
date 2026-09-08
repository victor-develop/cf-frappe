import { describe, expect, it } from "vitest";
import { D1SnapshotStore, fixedClock } from "../../src";
import type { StreamName } from "../../src";
import { createTestD1, frameworkSchema } from "../d1-engine.js";

const NOW = "2026-01-01T00:00:00.000Z";
const KEY = { stream: "acme:__UserNotifications:u1" as StreamName, foldName: "userNotifications", foldVersion: 1 };

function store() {
  const d1 = createTestD1({ schema: frameworkSchema() });
  return { d1, snapshots: new D1SnapshotStore(d1.database, { clock: fixedClock(NOW) }) };
}

describe("D1SnapshotStore", () => {
  it("round-trips folded state", async () => {
    const { d1, snapshots } = store();

    await snapshots.write({ ...KEY, uptoSequence: 7, state: { unread: 3, ids: ["a", "b"] } });

    await expect(snapshots.read(KEY)).resolves.toEqual({
      ...KEY,
      uptoSequence: 7,
      state: { unread: 3, ids: ["a", "b"] }
    });
    d1.close();
  });

  it("reports a miss rather than failing", async () => {
    const { d1, snapshots } = store();

    await expect(snapshots.read(KEY)).resolves.toBeNull();
    d1.close();
  });

  it("keeps state separate per fold name and version", async () => {
    // One stream is folded several ways, and a fold whose semantics changed must
    // not be handed state from the old shape.
    const { d1, snapshots } = store();
    await snapshots.write({ ...KEY, uptoSequence: 5, state: "mine" });

    await expect(snapshots.read({ ...KEY, foldName: "other" })).resolves.toBeNull();
    await expect(snapshots.read({ ...KEY, foldVersion: 2 })).resolves.toBeNull();
    await expect(snapshots.read(KEY)).resolves.toMatchObject({ state: "mine" });
    d1.close();
  });

  it("lets the newest sequence win, whichever order the writes arrive in", async () => {
    // Two isolates can write different sequences for one key concurrently, so
    // this is decided inside the statement rather than by reading first and
    // then writing — a read-then-write would race.
    const { d1, snapshots } = store();

    await snapshots.write({ ...KEY, uptoSequence: 9, state: "new" });
    await snapshots.write({ ...KEY, uptoSequence: 4, state: "old" });

    await expect(snapshots.read(KEY)).resolves.toMatchObject({ uptoSequence: 9, state: "new" });
    // And forward progress still lands.
    await snapshots.write({ ...KEY, uptoSequence: 12, state: "newer" });
    await expect(snapshots.read(KEY)).resolves.toMatchObject({ uptoSequence: 12, state: "newer" });
    d1.close();
  });

  it("keeps one row per key rather than accumulating history", async () => {
    const { d1, snapshots } = store();
    for (let sequence = 1; sequence <= 5; sequence += 1) {
      await snapshots.write({ ...KEY, uptoSequence: sequence, state: sequence });
    }

    expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_fold_snapshots")).toEqual([{ n: 1 }]);
    d1.close();
  });

  it("stores null state distinguishably from a missing snapshot", async () => {
    // `foldDocument` returns null for a deleted document, and that is a real
    // answer worth resuming from — it must not read back as a cache miss.
    const { d1, snapshots } = store();

    await snapshots.write({ ...KEY, uptoSequence: 3, state: null });

    await expect(snapshots.read(KEY)).resolves.toEqual({ ...KEY, uptoSequence: 3, state: null });
    d1.close();
  });
});
