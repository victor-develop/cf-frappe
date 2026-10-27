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
  projectionDeliverySnapshots,
  createProjectionDeliveryDrainJob,
  projectionDrainRounds,
  type Actor,
  type DocumentDeliveryOutboxRecord,
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

function enqueued(outboxId: string, target: "notification" | "projection" = "notification"): NewDomainEvent {
  return {
    id: `evt-${outboxId}`,
    tenantId: "acme",
    stream: documentDeliveryOutboxStream("acme", PROJECTION_OUTBOX_CHANNEL),
    type: "DocumentDeliveryOutboxEnqueued",
    doctype: "__DocumentDeliveryOutbox",
    documentName: outboxId,
    actorId: "system",
    occurredAt: NOW,
    payload: {
      kind: "DocumentDeliveryOutboxEnqueued",
      outboxId,
      target,
      sourceEventId: `source-${outboxId}`,
      sourceEventType: "NoteCreated",
      payloadKind: "DocumentCreated",
      doctype: "Note",
      documentName: "One",
      actorId: "system"
    },
    metadata: {}
  };
}

describe("delivery outbox channels", () => {
  it("keeps a channel's records in their own stream, apart from the default outbox", async () => {
    const events = new InMemoryDocumentStore();
    const deliveries = new DocumentDeliveryOutboxService({ events, clock: fixedClock(NOW), ids });
    const projections = new DocumentDeliveryOutboxService({
      events,
      channel: PROJECTION_OUTBOX_CHANNEL,
      clock: fixedClock(NOW),
      ids
    });
    await events.append(projections.stream("acme"), 0, [enqueued("a:projection", "projection")]);

    expect(projections.stream("acme")).toBe(documentDeliveryOutboxStream("acme", PROJECTION_OUTBOX_CHANNEL));
    expect(deliveries.stream("acme")).toBe(documentDeliveryOutboxStream("acme"));
    await expect(projections.list("acme")).resolves.toHaveLength(1);
    await expect(deliveries.list("acme")).resolves.toEqual([]);
  });

  it("names checkpoints by channel, so two channels of one tenant never collide", async () => {
    const events = new InMemoryDocumentStore();
    const channelled = new DocumentDeliveryOutboxService({
      events,
      channel: PROJECTION_OUTBOX_CHANNEL,
      clock: fixedClock(NOW),
      ids
    });
    await events.append(channelled.stream("acme"), 0, [enqueued("a:projection", "projection")]);
    const [claimed] = await channelled.claimPending({ tenantId: "acme", claimId: "c1" });
    await channelled.markDelivered({ tenantId: "acme", outboxId: claimed!.id, claimId: "c1" });

    const checkpoints = (await events.readStream(channelled.stream("acme")))
      .filter((event) => event.payload.kind === "DocumentDeliveryOutboxCheckpointed");
    expect(checkpoints.map((event) => event.id)).toEqual(["evt_outbox_checkpoint_acme_projections_2"]);
  });
});

describe("DocumentDeliveryOutboxService.markDeliveredBatch", () => {
  async function claimedOutbox(count: number) {
    const events = new InMemoryDocumentStore();
    const outbox = new DocumentDeliveryOutboxService({
      events,
      channel: PROJECTION_OUTBOX_CHANNEL,
      clock: fixedClock(NOW),
      ids
    });
    await events.append(
      outbox.stream("acme"),
      0,
      Array.from({ length: count }, (_, index) => enqueued(`r${index}:projection`, "projection"))
    );
    const claimed = await outbox.claimPending({ tenantId: "acme", claimId: "c1" });
    return { events, outbox, claimed };
  }

  it("delivers a whole claim in one append", async () => {
    const { events, outbox, claimed } = await claimedOutbox(3);
    const before = (await events.readStream(outbox.stream("acme"))).length;

    const delivered = await outbox.markDeliveredBatch({
      tenantId: "acme",
      claimId: "c1",
      outboxIds: claimed.map((record) => record.id)
    });

    expect(delivered).toEqual(["r0:projection", "r1:projection", "r2:projection"]);
    await expect(outbox.list("acme")).resolves.toEqual([]);
    const appended = (await events.readStream(outbox.stream("acme"))).slice(before);
    expect(appended.map((event) => event.payload.kind)).toEqual([
      "DocumentDeliveryOutboxCheckpointed",
      "DocumentDeliveryOutboxDelivered",
      "DocumentDeliveryOutboxDelivered",
      "DocumentDeliveryOutboxDelivered"
    ]);
    await expect(outbox.record("acme", "r1:projection")).resolves.toMatchObject({ status: "delivered" });
  });

  it("treats an already delivered record as success and appends nothing for it", async () => {
    const { events, outbox, claimed } = await claimedOutbox(2);
    await outbox.markDeliveredBatch({ tenantId: "acme", claimId: "c1", outboxIds: [claimed[0]!.id] });
    const before = (await events.readStream(outbox.stream("acme"))).length;

    const delivered = await outbox.markDeliveredBatch({
      tenantId: "acme",
      claimId: "c1",
      outboxIds: claimed.map((record) => record.id)
    });

    expect(delivered).toEqual(["r1:projection"]);
    const appended = (await events.readStream(outbox.stream("acme"))).slice(before);
    expect(appended.filter((event) => event.payload.kind === "DocumentDeliveryOutboxDelivered")).toHaveLength(1);
  });

  it("refuses the whole batch when one record is claimed by someone else", async () => {
    const { outbox, claimed } = await claimedOutbox(2);

    await expect(outbox.markDeliveredBatch({
      tenantId: "acme",
      claimId: "someone-else",
      outboxIds: claimed.map((record) => record.id)
    })).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
    await expect(outbox.list("acme")).resolves.toHaveLength(2);
  });

  it("refuses a record that was never enqueued", async () => {
    const { outbox, claimed } = await claimedOutbox(1);

    await expect(outbox.markDeliveredBatch({
      tenantId: "acme",
      claimId: "c1",
      outboxIds: [claimed[0]!.id, "missing:projection"]
    })).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(outbox.list("acme")).resolves.toHaveLength(1);
  });

  it("is a no-op for an empty batch", async () => {
    const { outbox } = await claimedOutbox(1);
    await expect(outbox.markDeliveredBatch({ tenantId: "acme", claimId: "c1", outboxIds: [] })).resolves.toEqual([]);
  });
});

describe("claim leases", () => {
  it("never expires a claim without a lease, and expires one with it", async () => {
    const events = new InMemoryDocumentStore();
    const stream = documentDeliveryOutboxStream("acme");
    await events.append(stream, 0, [{ ...enqueued("a:notification"), stream }]);
    const leaseless = new DocumentDeliveryOutboxService({ events, clock: fixedClock(NOW), ids });
    await leaseless.claimPending({ tenantId: "acme", claimId: "first", now: NOW });

    await expect(leaseless.claimPending({ tenantId: "acme", now: "2027-01-01T00:00:00.000Z" })).resolves.toEqual([]);

    const leased = new DocumentDeliveryOutboxService({ events, clock: fixedClock(NOW), ids, claimLeaseSeconds: 60 });
    await expect(leased.claimPending({ tenantId: "acme", now: "2026-03-01T00:00:59.000Z" })).resolves.toEqual([]);
    const [reclaimed] = await leased.claimPending({ tenantId: "acme", claimId: "second", now: "2026-03-01T00:01:00.000Z" });
    expect(reclaimed).toMatchObject({ claimId: "second", attempts: 2 });
    // The consumer that held the expired claim can no longer complete it.
    await expect(leased.markDelivered({ tenantId: "acme", outboxId: "a:notification", claimId: "first" }))
      .rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
  });

  it("rejects a lease that is not a positive integer", () => {
    expect(() => new DocumentDeliveryOutboxService({ events: new InMemoryDocumentStore(), claimLeaseSeconds: 0 }))
      .toThrow(/claimLeaseSeconds/);
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
    const outbox = new DocumentDeliveryOutboxService({
      events: store,
      channel: PROJECTION_OUTBOX_CHANNEL,
      clock: fixedClock(NOW),
      ids
    });
    const consumer = new ProjectionDeliveryConsumer({ outbox, projections, clock: fixedClock(NOW) });
    return { store, documents, projections, outbox, consumer };
  }

  it("writes no projection row of its own and hands one record to the channel", async () => {
    const { store, documents, outbox } = layout();
    const created = await documents.create({ actor, doctype: "Note", name: "One", data: { title: "One" } });

    await expect(store.get("acme", "Note", "One")).resolves.toBeNull();
    const [record] = await outbox.list("acme");
    expect(record).toMatchObject({ target: "projection", doctype: "Note", documentName: "One", status: "pending" });
    expect(projectionDeliverySnapshots(record!)).toEqual([created]);
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
  function record(overrides: Partial<DocumentDeliveryOutboxRecord> = {}): DocumentDeliveryOutboxRecord {
    return {
      id: "e1:projection",
      tenantId: "acme",
      target: "projection",
      sourceEventId: "e1",
      sourceEventType: "NoteCreated",
      payloadKind: "DocumentCreated",
      doctype: "Note",
      documentName: "One",
      actorId: "owner",
      payload: {},
      status: "claimed",
      attempts: 1,
      claimId: "c1",
      enqueuedAt: NOW,
      ...overrides
    };
  }

  it("fails a record whose payload carries no usable snapshots, rather than dropping it", async () => {
    const failed: string[] = [];
    const consumer = new ProjectionDeliveryConsumer({
      outbox: {
        claimPending: async () => [
          record(),
          record({ id: "e2:projection", payload: { snapshots: [{ tenantId: "other" }] } })
        ],
        markDeliveredBatch: async () => [],
        markFailed: async (command) => {
          failed.push(`${command.outboxId}: ${command.error}`);
          return record();
        },
        list: async () => []
      },
      projections: new InMemoryProjectionStore(),
      clock: fixedClock(NOW)
    });

    await expect(consumer.drain({ tenantId: "acme", limit: 5 })).resolves.toMatchObject({ claimed: 2, failed: 2 });
    expect(failed).toEqual([
      "e1:projection: Projection delivery 'e1:projection' carries no snapshots",
      "e2:projection: Projection delivery 'e2:projection' carries an invalid snapshot"
    ]);
  });

  it("stops after maxRounds even when the channel is still full", async () => {
    let claims = 0;
    const snapshot = {
      tenantId: "acme",
      doctype: "Note",
      name: "One",
      version: 1,
      docstatus: "draft",
      data: {},
      createdAt: NOW,
      updatedAt: NOW
    };
    const consumer = new ProjectionDeliveryConsumer({
      outbox: {
        claimPending: async () => {
          claims += 1;
          return [record({ payload: { snapshots: [snapshot] } })];
        },
        markDeliveredBatch: async (command) => command.outboxIds,
        markFailed: async () => record(),
        list: async () => []
      },
      projections: new InMemoryProjectionStore(),
      clock: fixedClock(NOW)
    });

    await expect(consumer.drain({ tenantId: "acme", limit: 1, maxRounds: 3 })).resolves.toMatchObject({
      rounds: 3,
      claimed: 3,
      delivered: 3
    });
    expect(claims).toBe(3);
  });

  it("validates its options and drain bounds", () => {
    const outbox = {
      claimPending: async () => [],
      markDeliveredBatch: async () => [],
      markFailed: async () => record(),
      list: async () => []
    };
    expect(() => new ProjectionDeliveryConsumer({ outbox, projections: new InMemoryProjectionStore(), lag: { maxAgeSeconds: 0 } }))
      .toThrow(/maxAgeSeconds/);
    expect(() => new ProjectionDeliveryConsumer({
      outbox,
      projections: new InMemoryProjectionStore(),
      retry: { baseDelaySeconds: 10, maxDelaySeconds: 5 }
    })).toThrow(/maxDelaySeconds/);
    expect(() => projectionDrainRounds(0)).toThrow(/maxRounds/);
    expect(() => projectionDrainRounds(101)).toThrow(/maxRounds/);
    expect(projectionDrainRounds(undefined)).toBe(10);
  });

  it("runs as a job that drains and then reports the lag", async () => {
    const job = createProjectionDeliveryDrainJob();
    const drains: unknown[] = [];
    const result = await job.handler({
      tenantId: "acme",
      payload: { limit: 10, maxRounds: 2 },
      resources: {
        projectionDelivery: {
          drain: async (command: unknown) => {
            drains.push(command);
            return { tenantId: "acme", rounds: 1, claimed: 0, delivered: 0, failed: 0 };
          },
          checkLag: async () => ({
            tenantId: "acme",
            measuredAt: NOW,
            inFlight: 0,
            pending: 0,
            claimed: 0,
            failed: 0,
            ageSeconds: 0,
            maxAttempts: 0,
            status: "ok" as const,
            breaches: [],
            thresholds: { maxAgeSeconds: 120, maxInFlight: 1000 }
          })
        }
      }
    } as never);

    expect(drains).toEqual([{ tenantId: "acme", limit: 10, maxRounds: 2 }]);
    expect(result).toMatchObject({ claimed: 0, lag: { status: "ok", inFlight: 0, ageSeconds: 0 } });
    await expect(job.handler({ tenantId: "acme", payload: {}, resources: {} } as never)).rejects.toThrow(/not available/);
    await expect(job.handler({
      tenantId: "acme",
      payload: { maxRounds: "x" },
      resources: { projectionDelivery: { drain: async () => ({}), checkLag: async () => ({}) } }
    } as never)).rejects.toThrow(/maxRounds/);
  });
});
