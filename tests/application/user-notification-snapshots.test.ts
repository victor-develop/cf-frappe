import { describe, expect, it } from "vitest";
import {
  D1SnapshotStore,
  InMemoryEventStore,
  InMemorySnapshotStore,
  UserNotificationService,
  deterministicIds,
  fixedClock,
  userNotificationsStream
} from "../../src";
import type { DomainEvent, ReadStreamOptions, SnapshotStore, StreamName } from "../../src";
import { createTestD1, frameworkSchema } from "../d1-engine.js";

const NOW = "2026-01-01T00:00:00.000Z";

class CountingEvents extends InMemoryEventStore {
  replayed = 0;

  override async readStream(stream: StreamName, options?: ReadStreamOptions): Promise<readonly DomainEvent[]> {
    const events = await super.readStream(stream, options);
    if (stream.includes("__UserNotifications")) {
      this.replayed += events.length;
    }
    return events;
  }
}

function service(events: InMemoryEventStore, snapshots?: SnapshotStore) {
  return new UserNotificationService({
    events,
    clock: fixedClock(NOW),
    ids: deterministicIds(Array.from({ length: 4000 }, (_unused, index) => `evt_${index}`)),
    ...(snapshots === undefined ? {} : { snapshots })
  });
}

/** One assignment of the same user to a different document each time. */
function assignmentEvent(index: number): DomainEvent {
  return {
    id: `evt_assign_${index}`,
    tenantId: "acme",
    stream: `acme:Note:N${index}`,
    sequence: 2,
    type: "NoteAssigned",
    doctype: "Note",
    documentName: `N${index}`,
    actorId: "owner@example.com",
    occurredAt: NOW,
    payload: { kind: "DocumentAssigned", assigneeId: "support@example.com" },
    metadata: {}
  };
}

async function deliver(notifications: UserNotificationService, count: number) {
  const seen: unknown[] = [];
  for (let index = 1; index <= count; index += 1) {
    seen.push(await notifications.recordFromDomainEvent(assignmentEvent(index)));
  }
  return seen;
}

describe("user notification fold snapshots", () => {
  it("survives a round trip through the durable store it is wired to", async () => {
    // The test that was missing, and the reason a catastrophic defect shipped
    // green: nothing drove this service through the store it is actually wired
    // to in production. `UserNotificationState` holds a `Map`, `JSON.stringify`
    // renders one as `{}`, and the fold then calls `new Map()` on a plain object
    // and throws — so the first notification poisoned the key and every
    // subsequent delivery and inbox read for that user failed permanently.
    //
    // In-memory `structuredClone` preserves a `Map`, which is exactly why the
    // existing tests could not see it.
    const d1 = createTestD1({ schema: frameworkSchema() });
    const events = new InMemoryEventStore();
    const notifications = service(events, new D1SnapshotStore(d1.database, { clock: fixedClock(NOW) }));

    await notifications.recordFromDomainEvent(assignmentEvent(1));
    await notifications.recordFromDomainEvent(assignmentEvent(2));
    await notifications.recordFromDomainEvent(assignmentEvent(3));

    const inbox = await notifications.inbox(
      { id: "support@example.com", roles: ["User"], tenantId: "acme" },
      { includeDismissed: true }
    );
    expect(inbox.notifications.map((entry) => entry.documentName)).toEqual(["N3", "N2", "N1"]);
    // And the stored row really is being read back, not skipped as a miss.
    expect(d1.query("SELECT upto_sequence FROM cf_frappe_fold_snapshots")).toEqual([{ upto_sequence: 3 }]);
    d1.close();
  });

  it("degrades to a cold fold when the stored state cannot be consumed", async () => {
    // A snapshot the fold cannot use has to be ignorable, not fatal. Folding
    // onto stored state used to run outside the guard, so a shape the fold
    // rejected threw out of `resume` instead of falling back.
    const d1 = createTestD1({ schema: frameworkSchema() });
    const events = new InMemoryEventStore();
    const snapshots = new D1SnapshotStore(d1.database, { clock: fixedClock(NOW) });
    const notifications = service(events, snapshots);
    await notifications.recordFromDomainEvent(assignmentEvent(1));
    // A `Map` rendered the way `JSON.stringify` would have, which is the exact
    // corruption that shipped.
    d1.query("UPDATE cf_frappe_fold_snapshots SET state_json = ?", JSON.stringify({
      tenantId: "acme",
      userId: "support@example.com",
      version: 1,
      notifications: {}
    }));

    await expect(notifications.recordFromDomainEvent(assignmentEvent(2))).resolves.toMatchObject([
      { documentName: "N2" }
    ]);
    const inbox = await notifications.inbox(
      { id: "support@example.com", roles: ["User"], tenantId: "acme" },
      { includeDismissed: true }
    );
    expect(inbox.notifications).toHaveLength(2);
    d1.close();
  });

  it("gives identical results whether or not a snapshot store is present", async () => {
    // The safety rule, on the second stream to get snapshots: ignoring one must
    // give exactly the same answer as using it.
    const plainEvents = new InMemoryEventStore();
    const cachedEvents = new InMemoryEventStore();

    const plain = await deliver(service(plainEvents), 10);
    const cached = await deliver(service(cachedEvents, new InMemorySnapshotStore()), 10);

    expect(cached).toEqual(plain);
    const streamOf = async (events: InMemoryEventStore) =>
      (await events.readStream(userNotificationsStream("acme", "support@example.com"))).map((event) => ({
        sequence: event.sequence,
        type: event.type,
        payload: event.payload
      }));
    expect(await streamOf(cachedEvents)).toEqual(await streamOf(plainEvents));
  });

  it("replays a constant number of events per notification instead of the whole inbox", async () => {
    // This stream never ends — it grows for as long as the user receives
    // notifications — so before this the cost of delivering one grew with every
    // notification the user had ever had.
    const perDelivery = async (snapshots?: SnapshotStore) => {
      const events = new CountingEvents();
      const notifications = service(events, snapshots);
      const marks: number[] = [];
      for (let index = 1; index <= 30; index += 1) {
        const before = events.replayed;
        await notifications.recordFromDomainEvent(assignmentEvent(index));
        if (index % 10 === 0) {
          marks.push(events.replayed - before);
        }
      }
      return marks;
    };

    expect(await perDelivery()).toEqual([9, 19, 29]);
    expect(await perDelivery(new InMemorySnapshotStore())).toEqual([0, 0, 0]);
  });

  it("delivers faster with a snapshot than without, not merely with fewer events read", async () => {
    // Events replayed is not the whole story, and for this stream it was
    // briefly the wrong story: the fold's state is O(history), and the in-memory
    // store used to deep-copy it on both read and write, which made a delivery
    // on a 600-notification inbox 1.9x *slower* than having no snapshot at all.
    // Wall clock, not event counts, is what says whether the feature helps.
    //
    // Asserted as a ratio with generous headroom, since absolute timings vary by
    // machine; the regression it guards against was 15x on the wrong side of 1.
    const measure = async (snapshots?: SnapshotStore) => {
      const events = new InMemoryEventStore();
      const notifications = service(events, snapshots);
      for (let index = 1; index <= 200; index += 1) {
        await notifications.recordFromDomainEvent(assignmentEvent(index));
      }
      const started = process.hrtime.bigint();
      for (let index = 201; index <= 220; index += 1) {
        await notifications.recordFromDomainEvent(assignmentEvent(index));
      }
      return Number(process.hrtime.bigint() - started);
    };

    const without = await measure();
    const with_ = await measure(new InMemorySnapshotStore());

    // Measured around 0.10x; anything at or above parity means the snapshot is
    // costing more than the replay it removes.
    expect(with_).toBeLessThan(without * 0.5);
  });

  it("still answers correctly from a snapshot that has fallen behind", async () => {
    const events = new InMemoryEventStore();
    const snapshots = new InMemorySnapshotStore();
    const notifications = service(events, snapshots);
    await notifications.recordFromDomainEvent(assignmentEvent(1));
    // Delivered with the snapshot store detached, so it keeps the old state.
    const detached = service(events);
    for (let index = 2; index <= 5; index += 1) {
      await detached.recordFromDomainEvent(assignmentEvent(index));
    }

    const recorded = await notifications.recordFromDomainEvent(assignmentEvent(6));

    expect(recorded).toMatchObject([{ documentName: "N6" }]);
    const inbox = await notifications.inbox(
      { id: "support@example.com", roles: ["User"], tenantId: "acme" },
      { includeDismissed: true }
    );
    expect(inbox.notifications).toHaveLength(6);
  });

  it("degrades to a full fold when the snapshot store throws", async () => {
    const broken: SnapshotStore = {
      read: async () => {
        throw new Error("read exploded");
      },
      write: async () => {
        throw new Error("write exploded");
      }
    };

    const cached = await deliver(service(new InMemoryEventStore(), broken), 4);
    const plain = await deliver(service(new InMemoryEventStore()), 4);

    expect(cached).toEqual(plain);
  });

  it("does not resume one fold from another fold's snapshot of the same stream", async () => {
    // The reason the key carries `foldName`: several streams are folded more
    // than one way, and a fold must not be handed state it did not produce.
    const snapshots = new InMemorySnapshotStore();
    const events = new InMemoryEventStore();
    await deliver(service(events, snapshots), 3);
    const stream = userNotificationsStream("acme", "support@example.com");

    await expect(snapshots.read({ stream, foldName: "userNotifications", foldVersion: 1 })).resolves.not.toBeNull();
    await expect(snapshots.read({ stream, foldName: "document", foldVersion: 1 })).resolves.toBeNull();
    await expect(snapshots.read({ stream, foldName: "userNotifications", foldVersion: 2 })).resolves.toBeNull();
  });
});
