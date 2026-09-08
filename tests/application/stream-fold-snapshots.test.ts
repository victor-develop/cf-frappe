import { describe, expect, it } from "vitest";
import { InMemoryEventStore, InMemorySnapshotStore } from "../../src";
import type { DomainEvent, NewDomainEvent, SnapshotStore, StreamName } from "../../src";
import { StreamFoldSnapshots, type StreamFold } from "../../src/application/stream-fold-snapshots.js";

const STREAM = "acme:__Mixed:one" as StreamName;
const NOW = "2026-01-01T00:00:00.000Z";

/** Counts only the kinds it is asked about, so a missing filter is visible. */
const COUNTING_FOLD: StreamFold<readonly string[]> = {
  name: "counting",
  version: 1,
  payloadKinds: ["DocumentCreated"],
  foldFrom: (prior, events) => [...(prior ?? []), ...events.map((event) => event.payload.kind)]
};

function event(index: number, kind: "DocumentCreated" | "DocumentUpdated"): NewDomainEvent {
  return {
    id: `evt_${index}`,
    tenantId: "acme",
    stream: STREAM,
    type: kind,
    doctype: "Mixed",
    documentName: "one",
    actorId: "owner@example.com",
    occurredAt: NOW,
    payload: kind === "DocumentCreated"
      ? { kind: "DocumentCreated", data: {}, docstatus: "draft" }
      : { kind: "DocumentUpdated", data: {}, changed: [] },
    metadata: {}
  } as NewDomainEvent;
}

/** Appends alternating kinds onto whatever is already there. */
async function seed(events: InMemoryEventStore, count: number): Promise<readonly DomainEvent[]> {
  const saved: DomainEvent[] = [];
  let version = (await events.readStream(STREAM)).length;
  for (let index = 1; index <= count; index += 1) {
    const appended = await events.append(STREAM, version, [
      event(version + 1, version % 2 === 0 ? "DocumentCreated" : "DocumentUpdated")
    ]);
    saved.push(...appended);
    version += appended.length;
  }
  return saved;
}

describe("stream fold snapshots", () => {
  it("keeps the fold's event filter across a resume", async () => {
    // The reason `payloadKinds` is bound to the fold rather than passed per
    // call. A snapshot taken over one subset of a stream and resumed over
    // another folds events its state has already seen, or misses ones it has
    // not — and the notification stream cannot show this, because it holds only
    // one kind. This one is deliberately mixed.
    const events = new InMemoryEventStore();
    const snapshots = new InMemorySnapshotStore();
    const folds = new StreamFoldSnapshots(events, snapshots);
    const saved = await seed(events, 4);

    const cold = await folds.resume(STREAM, COUNTING_FOLD);
    expect(cold).toEqual(["DocumentCreated", "DocumentCreated"]);

    await folds.record(STREAM, COUNTING_FOLD, cold, saved.at(-1)!.sequence);
    await seed(events, 2);
    const resumed = await folds.resume(STREAM, COUNTING_FOLD);

    // Two from the snapshot plus one filtered event from the tail — never an
    // Updated, and never a Created counted twice.
    expect(resumed).toEqual(["DocumentCreated", "DocumentCreated", "DocumentCreated"]);
  });

  it("gives the same answer with no snapshot store at all", async () => {
    const events = new InMemoryEventStore();
    await seed(events, 6);

    const withStore = await new StreamFoldSnapshots(events, new InMemorySnapshotStore()).resume(STREAM, COUNTING_FOLD);
    const without = await new StreamFoldSnapshots(events, undefined).resume(STREAM, COUNTING_FOLD);

    expect(withStore).toEqual(without);
  });

  it("does not record a snapshot at sequence zero", async () => {
    // Nothing was appended, so there is no state to resume from and a snapshot
    // at 0 would claim to cover an event that does not exist.
    const snapshots = new InMemorySnapshotStore();
    const folds = new StreamFoldSnapshots(new InMemoryEventStore(), snapshots);

    await folds.record(STREAM, COUNTING_FOLD, [], 0);

    await expect(snapshots.read({ stream: STREAM, foldName: "counting", foldVersion: 1 })).resolves.toBeNull();
  });

  it("degrades to a full fold when the store throws on either side", async () => {
    const broken: SnapshotStore = {
      read: async () => {
        throw new Error("read exploded");
      },
      write: async () => {
        throw new Error("write exploded");
      }
    };
    const events = new InMemoryEventStore();
    const folds = new StreamFoldSnapshots(events, broken);
    const saved = await seed(events, 4);

    await folds.record(STREAM, COUNTING_FOLD, ["stale"], saved.at(-1)!.sequence);

    await expect(folds.resume(STREAM, COUNTING_FOLD)).resolves.toEqual([
      "DocumentCreated",
      "DocumentCreated"
    ]);
  });
});
