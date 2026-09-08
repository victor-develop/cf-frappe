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
  foldFrom: (prior, events) => [...(prior ?? []), ...events.map((event) => event.payload.kind)],
  codec: {
    encode: (state) => [...state],
    decode: (stored) => (Array.isArray(stored) ? (stored as readonly string[]) : null)
  }
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
    // not. The notification stream cannot show it: it holds three kinds, but the
    // fold wants all three, so the filter is a no-op there. This one is mixed
    // with a kind the fold rejects.
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

  it("degrades to a cold fold when foldFrom rejects the stored state", async () => {
    // The second line of defence, and it needs its own test: the durable-store
    // corruption case is stopped earlier, by `decode` refusing the shape, so
    // nothing was exercising this. The case it covers is state `decode` cannot
    // tell is wrong — an older version of the fold whose shape still validates.
    //
    // What must not happen is the throw escaping `resume`. A snapshot that
    // cannot be used has to be ignorable, which is the one thing the whole
    // design forbids breaking.
    const events = new InMemoryEventStore();
    const snapshots = new InMemorySnapshotStore();
    const hostile: StreamFold<readonly string[]> = {
      ...COUNTING_FOLD,
      foldFrom: (prior, folded) => {
        if (prior !== null) {
          throw new Error("this fold cannot consume that state");
        }
        return COUNTING_FOLD.foldFrom(prior, folded);
      }
    };
    const folds = new StreamFoldSnapshots(events, snapshots);
    const saved = await seed(events, 4);
    await folds.record(STREAM, hostile, ["stale"], saved.at(-1)!.sequence);

    await expect(folds.resume(STREAM, hostile)).resolves.toEqual([
      "DocumentCreated",
      "DocumentCreated"
    ]);
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
