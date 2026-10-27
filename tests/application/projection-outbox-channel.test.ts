import {
  createRegistry,
  defineDocType,
  DocumentDeliveryOutboxService,
  DocumentService,
  documentDeliveryOutboxStream,
  fixedClock,
  InMemoryDocumentStore,
  InMemoryProjectionStore,
  PROJECTION_OUTBOX_CHANNEL,
  ProjectionDeliveryConsumer,
  ProjectionOutboxHandoff,
  projectionDeliveryCursorStream,
  projectionDeliverySnapshots,
  createProjectionDeliveryDrainJob,
  projectionDrainRounds,
  type Actor,
  type DocumentData,
  type DocumentSnapshot,
  type IdGenerator,
  type NewDomainEvent
} from "../../src";

const NOW = "2026-03-01T00:00:00.000Z";
const LATER = "2026-03-01T00:02:00.000Z";

const Note = defineDocType({
  name: "Note",
  fields: [{ name: "title", type: "text" }],
  permissions: [{ roles: ["User"], actions: ["read", "create", "update"] }]
});
const actor: Actor = { id: "owner@example.com", roles: ["User"], tenantId: "acme" };

let nextId = 0;
const ids: IdGenerator = { next: (prefix = "") => `${prefix}${String((nextId += 1))}` };

const CHANNEL = documentDeliveryOutboxStream("acme", PROJECTION_OUTBOX_CHANNEL);

function note(version: number, name = "One", tenantId = "acme"): DocumentSnapshot {
  return {
    tenantId,
    doctype: "Note",
    name,
    version,
    docstatus: "draft",
    data: { title: `${name} v${version}` },
    createdAt: NOW,
    updatedAt: NOW
  };
}

/** A projection record as the handoff writes it, carrying `payload`. */
function projectionRecord(id: string, payload: Record<string, unknown>): NewDomainEvent {
  return {
    id: `evt-${id}`,
    tenantId: "acme",
    stream: CHANNEL,
    type: "DocumentDeliveryOutboxEnqueued",
    doctype: "__DocumentDeliveryOutbox",
    documentName: `${id}:projection`,
    actorId: "system",
    occurredAt: NOW,
    payload: {
      kind: "DocumentDeliveryOutboxEnqueued",
      outboxId: `${id}:projection`,
      target: "projection",
      sourceEventId: id,
      sourceEventType: "NoteCreated",
      payloadKind: "DocumentCreated",
      doctype: "Note",
      documentName: "One",
      actorId: "system",
      payload: payload as DocumentData
    },
    metadata: {}
  };
}

async function headAppend(store: InMemoryDocumentStore, ...records: NewDomainEvent[]): Promise<void> {
  await store.append(CHANNEL, await store.currentVersion(CHANNEL), records);
}

describe("projection channel", () => {
  it("keeps projection records in their own stream, apart from the notification outbox", async () => {
    expect(CHANNEL).toBe("acme:__DocumentDeliveryOutbox:projections");
    expect(documentDeliveryOutboxStream("acme")).toBe("acme:__DocumentDeliveryOutbox:deliveries");
    expect(projectionDeliveryCursorStream("acme")).toBe("acme:__ProjectionDelivery:cursor");
  });
});

describe("projection handoff on the in-memory store", () => {
  function layout(options: { readonly eager?: boolean } = {}) {
    const projections = new InMemoryProjectionStore();
    const store = new InMemoryDocumentStore({
      projectionHandoff: new ProjectionOutboxHandoff(options.eager ? { eager: projections } : {})
    });
    const documents = new DocumentService({
      registry: createRegistry({ doctypes: [Note] }),
      store,
      clock: fixedClock(NOW),
      ids
    });
    const consumer = new ProjectionDeliveryConsumer({ events: store, projections, clock: fixedClock(NOW), ids });
    return { store, documents, projections, consumer };
  }

  it("writes no projection row of its own and hands one record to the channel", async () => {
    const { store, documents } = layout();
    const created = await documents.create({ actor, doctype: "Note", name: "One", data: { title: "One" } });

    await expect(store.get("acme", "Note", "One")).resolves.toBeNull();
    const records = await store.readStream(CHANNEL);
    expect(records).toHaveLength(1);
    expect(records[0]!.payload).toMatchObject({ target: "projection", doctype: "Note", documentName: "One" });
    expect(projectionDeliverySnapshots("acme", records[0]!)).toEqual([created]);
    // The notification outbox reads its own stream and never sees it.
    await expect(new DocumentDeliveryOutboxService({ events: store }).list("acme")).resolves.toEqual([]);
  });

  it("drains to the projection store, and applies eagerly when asked", async () => {
    const lazy = layout();
    await lazy.documents.create({ actor, doctype: "Note", name: "One", data: { title: "One" } });
    await expect(lazy.projections.get("acme", "Note", "One")).resolves.toBeNull();
    await lazy.consumer.drain({ tenantId: "acme" });
    await expect(lazy.projections.get("acme", "Note", "One")).resolves.toMatchObject({ version: 1 });

    const eager = layout({ eager: true });
    await eager.documents.create({ actor, doctype: "Note", name: "One", data: { title: "One" } });
    await expect(eager.projections.get("acme", "Note", "One")).resolves.toMatchObject({ version: 1 });
  });

  it("refuses a handoff into a stream the commit itself writes, and writes nothing", async () => {
    const store = new InMemoryDocumentStore({
      projectionHandoff: {
        handoff: ({ events }) => [{ ...events[0]!, id: "evt-clash" }]
      }
    });
    const documents = new DocumentService({ registry: createRegistry({ doctypes: [Note] }), store, clock: fixedClock(NOW), ids });

    await expect(documents.create({ actor, doctype: "Note", name: "One", data: { title: "One" } }))
      .rejects.toThrow(/also written by the commit/);
    await expect(store.currentVersion("acme:Note:One")).resolves.toBe(0);
  });

  it("does not let a throwing afterHandoff fail the commit", async () => {
    const store = new InMemoryDocumentStore({
      projectionHandoff: {
        handoff: () => [],
        afterHandoff: async () => {
          throw new Error("eager apply exploded");
        }
      }
    });
    const documents = new DocumentService({ registry: createRegistry({ doctypes: [Note] }), store, clock: fixedClock(NOW), ids });

    await expect(documents.create({ actor, doctype: "Note", name: "One", data: { title: "One" } }))
      .resolves.toMatchObject({ name: "One" });
  });

  it("keeps the newest version in the in-memory projection store, as D1 does", async () => {
    const projections = new InMemoryProjectionStore();
    const row = (version: number, title: string, createdAt = NOW) => ({
      tenantId: "acme",
      doctype: "Note",
      name: "One",
      version,
      docstatus: "draft" as const,
      data: { title },
      createdAt,
      updatedAt: NOW
    });
    await projections.saveNewest([row(2, "two")]);
    await projections.saveNewest([row(1, "one")]);
    await expect(projections.get("acme", "Note", "One")).resolves.toMatchObject({ version: 2, data: { title: "two" } });
    await projections.saveNewest([row(2, "two again", LATER)]);
    await expect(projections.get("acme", "Note", "One")).resolves.toMatchObject({
      data: { title: "two again" },
      createdAt: NOW
    });
  });
});

describe("ProjectionDeliveryConsumer", () => {
  function consumerOver(store: InMemoryDocumentStore, projections = new InMemoryProjectionStore()) {
    return new ProjectionDeliveryConsumer({ events: store, projections, clock: fixedClock(NOW), ids });
  }

  it("applies records past the cursor and records how far it got on its own stream", async () => {
    const store = new InMemoryDocumentStore();
    const projections = new InMemoryProjectionStore();
    await headAppend(store, projectionRecord("a", { snapshots: [note(1)] }), projectionRecord("b", { snapshots: [note(1, "Two")] }));

    await expect(consumerOver(store, projections).drain({ tenantId: "acme" })).resolves.toEqual({
      tenantId: "acme",
      rounds: 1,
      delivered: 2,
      skipped: 0,
      cursor: 2,
      contended: false
    });

    // Nothing is appended to the channel by the consumer: writers own it.
    await expect(store.currentVersion(CHANNEL)).resolves.toBe(2);
    const cursor = await store.readStream(projectionDeliveryCursorStream("acme"));
    expect(cursor.map((event) => event.payload)).toEqual([
      { kind: "ProjectionDeliveryCursorAdvanced", fromSequence: 0, toSequence: 2, applied: 2, skipped: [] }
    ]);
    await expect(projections.get("acme", "Note", "Two")).resolves.toMatchObject({ version: 1 });
    // A second drain finds nothing past the cursor and appends nothing.
    await expect(consumerOver(store, projections).drain({ tenantId: "acme" })).resolves.toMatchObject({ delivered: 0, cursor: 2 });
    await expect(store.currentVersion(projectionDeliveryCursorStream("acme"))).resolves.toBe(1);
  });

  it("applies only the newest row per document in a round", async () => {
    const store = new InMemoryDocumentStore();
    const written: DocumentSnapshot[][] = [];
    await headAppend(
      store,
      projectionRecord("a", { snapshots: [note(1)] }),
      projectionRecord("b", { snapshots: [note(3)] }),
      projectionRecord("c", { snapshots: [note(2)] })
    );
    const consumer = new ProjectionDeliveryConsumer({
      events: store,
      projections: { saveNewest: async (snapshots) => void written.push([...snapshots]) },
      ids
    });

    await expect(consumer.drain({ tenantId: "acme" })).resolves.toMatchObject({ delivered: 3 });
    expect(written.map((batch) => batch.map((snapshot) => snapshot.version))).toEqual([[3]]);
  });

  it("reads past a record with no usable snapshots, and names it, rather than blocking every later write", async () => {
    const store = new InMemoryDocumentStore();
    const projections = new InMemoryProjectionStore();
    const skips: unknown[] = [];
    await headAppend(
      store,
      projectionRecord("a", {}),
      projectionRecord("b", { snapshots: [note(1, "Other", "other-tenant")] }),
      projectionRecord("c", { snapshots: [note(1)] })
    );
    const consumer = new ProjectionDeliveryConsumer({
      events: store,
      projections,
      ids,
      onSkipped: (skip) => skips.push(skip)
    });

    await expect(consumer.drain({ tenantId: "acme" })).resolves.toMatchObject({ delivered: 1, skipped: 2, cursor: 3 });
    expect(skips).toEqual([
      { tenantId: "acme", sequence: 1, eventId: "evt-a", reason: "Projection delivery 'evt-a' carries no snapshots" },
      { tenantId: "acme", sequence: 2, eventId: "evt-b", reason: "Projection delivery 'evt-b' carries an invalid snapshot" }
    ]);
    const [advanced] = await store.readStream(projectionDeliveryCursorStream("acme"));
    expect(advanced!.payload).toMatchObject({ skipped: [{ sequence: 1 }, { sequence: 2 }] });
    await expect(projections.get("acme", "Note", "Other")).resolves.toBeNull();
    await expect(projections.get("acme", "Note", "One")).resolves.toMatchObject({ version: 1 });
  });

  it("does not advance past a round whose apply throws, and applies it on the next drain", async () => {
    const store = new InMemoryDocumentStore();
    const projections = new InMemoryProjectionStore();
    let failures = 1;
    await headAppend(store, projectionRecord("a", { snapshots: [note(1)] }));
    const consumer = new ProjectionDeliveryConsumer({
      events: store,
      ids,
      projections: {
        async saveNewest(snapshots) {
          if (failures > 0) {
            failures -= 1;
            throw new Error("projection database unavailable");
          }
          await projections.saveNewest(snapshots);
        }
      }
    });

    await expect(consumer.drain({ tenantId: "acme" })).rejects.toThrow(/unavailable/);
    await expect(consumer.lag("acme", NOW)).resolves.toMatchObject({ cursor: 0, inFlight: 1 });
    await expect(consumer.drain({ tenantId: "acme" })).resolves.toMatchObject({ delivered: 1, cursor: 1 });
    await expect(projections.get("acme", "Note", "One")).resolves.toMatchObject({ version: 1 });
  });

  it("stops without error when another drain advanced the cursor first", async () => {
    const store = new InMemoryDocumentStore();
    const projections = new InMemoryProjectionStore();
    await headAppend(store, projectionRecord("a", { snapshots: [note(1)] }));
    const rival = consumerOver(store, projections);
    const consumer = new ProjectionDeliveryConsumer({
      events: store,
      ids,
      projections: {
        async saveNewest(snapshots) {
          await projections.saveNewest(snapshots);
          // The rival drains the same range while this one is applying.
          await rival.drain({ tenantId: "acme" });
        }
      }
    });

    await expect(consumer.drain({ tenantId: "acme" })).resolves.toMatchObject({ contended: true, delivered: 0, cursor: 0 });
    await expect(store.currentVersion(projectionDeliveryCursorStream("acme"))).resolves.toBe(1);
    await expect(consumer.lag("acme", NOW)).resolves.toMatchObject({ cursor: 1, inFlight: 0 });
  });

  it("stops after maxRounds even when the channel is still full", async () => {
    const store = new InMemoryDocumentStore();
    for (let index = 0; index < 5; index += 1) {
      await headAppend(store, projectionRecord(`r${index}`, { snapshots: [note(index + 1)] }));
    }

    await expect(consumerOver(store).drain({ tenantId: "acme", limit: 1, maxRounds: 3 })).resolves.toMatchObject({
      rounds: 3,
      delivered: 3,
      cursor: 3
    });
  });

  it("reports lag from the cursor, the channel head and the oldest record past the cursor", async () => {
    const store = new InMemoryDocumentStore();
    await headAppend(store, projectionRecord("a", { snapshots: [note(1)] }), projectionRecord("b", { snapshots: [note(2)] }));
    const consumer = new ProjectionDeliveryConsumer({ events: store, projections: new InMemoryProjectionStore(), ids, clock: fixedClock(LATER) });

    await expect(consumer.lag("acme")).resolves.toEqual({
      tenantId: "acme",
      measuredAt: LATER,
      inFlight: 2,
      cursor: 0,
      head: 2,
      oldestEnqueuedAt: NOW,
      ageSeconds: 120
    });
    await consumer.drain({ tenantId: "acme" });
    await expect(consumer.lag("acme")).resolves.toEqual({
      tenantId: "acme",
      measuredAt: LATER,
      inFlight: 0,
      cursor: 2,
      head: 2,
      ageSeconds: 0
    });
  });

  it("validates its options and drain bounds", () => {
    const events = new InMemoryDocumentStore();
    expect(() => new ProjectionDeliveryConsumer({ events, projections: new InMemoryProjectionStore(), lag: { maxAgeSeconds: 0 } }))
      .toThrow(/maxAgeSeconds/);
    expect(() => new ProjectionDeliveryConsumer({ events, projections: new InMemoryProjectionStore(), lag: { maxInFlight: -1 } }))
      .toThrow(/maxInFlight/);
    expect(() => projectionDrainRounds(0)).toThrow(/maxRounds/);
    expect(() => projectionDrainRounds(101)).toThrow(/maxRounds/);
    expect(projectionDrainRounds(undefined)).toBe(10);
  });
});

describe("projection delivery drain job", () => {
  const okLag = {
    tenantId: "acme",
    measuredAt: NOW,
    inFlight: 0,
    cursor: 0,
    head: 0,
    ageSeconds: 0,
    status: "ok" as const,
    breaches: [],
    thresholds: { maxAgeSeconds: 120, maxInFlight: 1000 }
  };

  it("drains and then reports the lag", async () => {
    const job = createProjectionDeliveryDrainJob();
    const drains: unknown[] = [];
    const result = await job.handler({
      tenantId: "acme",
      payload: { limit: 10, maxRounds: 2 },
      resources: {
        projectionDelivery: {
          drain: async (command: unknown) => {
            drains.push(command);
            return { tenantId: "acme", rounds: 1, delivered: 0, skipped: 0, cursor: 0, contended: false };
          },
          checkLag: async () => okLag
        }
      }
    } as never);

    expect(drains).toEqual([{ tenantId: "acme", limit: 10, maxRounds: 2 }]);
    expect(result).toMatchObject({ delivered: 0, lag: { status: "ok", inFlight: 0, ageSeconds: 0 } });
    await expect(job.handler({ tenantId: "acme", payload: {}, resources: {} } as never)).rejects.toThrow(/not available/);
    await expect(job.handler({
      tenantId: "acme",
      payload: { maxRounds: "x" },
      resources: { projectionDelivery: { drain: async () => ({}), checkLag: async () => ({}) } }
    } as never)).rejects.toThrow(/maxRounds/);
  });

  it("still checks the lag, and raises the alert, when the drain throws", async () => {
    const store = new InMemoryDocumentStore();
    await headAppend(store, projectionRecord("a", { snapshots: [note(1)] }));
    const alerts: unknown[] = [];
    const consumer = new ProjectionDeliveryConsumer({
      events: store,
      ids,
      clock: fixedClock(LATER),
      lag: { maxAgeSeconds: 60 },
      onLagAlert: (alert) => void alerts.push(alert),
      projections: {
        saveNewest: async () => {
          throw new Error("projection database unavailable");
        }
      }
    });

    await expect(createProjectionDeliveryDrainJob().handler({
      tenantId: "acme",
      payload: {},
      resources: { projectionDelivery: consumer }
    } as never)).rejects.toThrow(/unavailable/);
    expect(alerts).toEqual([expect.objectContaining({ status: "lagging", breaches: ["age"], inFlight: 1 })]);
  });

  it("keeps the drain's error when the lag check fails too", async () => {
    await expect(createProjectionDeliveryDrainJob().handler({
      tenantId: "acme",
      payload: {},
      resources: {
        projectionDelivery: {
          drain: async () => {
            throw new Error("drain failed");
          },
          checkLag: async () => {
            throw new Error("lag failed");
          }
        }
      }
    } as never)).rejects.toThrow(/drain failed/);
  });
});
