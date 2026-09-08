import { describe, expect, it } from "vitest";
import {
  InMemoryEventStore,
  InMemorySnapshotStore,
  UserNotificationService,
  deterministicIds,
  fixedClock,
  userNotificationsStream
} from "../../src";
import type { DomainEvent, ReadStreamOptions, SnapshotStore, StreamName } from "../../src";

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
