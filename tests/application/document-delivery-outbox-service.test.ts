import {
  DOCUMENT_DELIVERY_OUTBOX_CHECKPOINT_DOCUMENT_NAME,
  DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KINDS,
  DocumentDeliveryOutboxService,
  InMemoryDocumentStore,
  createDocumentDeliveryHooks,
  documentDeliveryOutboxStream,
  fixedClock,
  deterministicIds
} from "../../src";
import type {
  AuditDocumentEventQuery,
  DocumentDeliveryOutboxEventPayload,
  NewDomainEvent,
  DocumentEventPayload,
  DocumentSnapshot,
  DomainEvent,
  ReadStreamOptions,
  StreamName
} from "../../src";

const now = "2026-01-01T00:00:00.000Z";
const later = "2026-01-01T00:05:00.000Z";

describe("DocumentDeliveryOutboxService", () => {
  it("registers document delivery outbox payloads through the domain event extension map", () => {
    const payload = documentDeliveryOutboxPayload({
      kind: "DocumentDeliveryOutboxEnqueued",
      outboxId: "evt_source:notification",
      target: "notification",
      sourceEventId: "evt_source",
      sourceEventType: "NoteAssigned",
      payloadKind: "DocumentAssigned",
      doctype: "Note",
      documentName: "One",
      actorId: "owner@example.com"
    });

    expect(payload.target).toBe("notification");
  });

  it("enqueues document delivery intents idempotently from committed domain events", async () => {
    const events = new InMemoryDocumentStore();
    const outbox = new DocumentDeliveryOutboxService({
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["enqueue-1", "enqueue-2"])
    });

    const first = await outbox.enqueueFromDomainEvent({
      event: domainEvent(),
      snapshot: snapshot(),
      targets: ["notification", "realtime", "notification"]
    });
    const second = await outbox.enqueueFromDomainEvent({
      event: domainEvent(),
      snapshot: snapshot(),
      targets: ["notification", "realtime"]
    });

    expect(first).toMatchObject([
      { id: "evt_source:notification", status: "pending", target: "notification", attempts: 0 },
      { id: "evt_source:realtime", status: "pending", target: "realtime", attempts: 0 }
    ]);
    expect(second).toHaveLength(2);
    await expect(events.readStream(documentDeliveryOutboxStream("acme"))).resolves.toHaveLength(2);
  });

  it("derives enqueued payload kinds from source event identity", async () => {
    const events = new InMemoryDocumentStore();
    const outbox = new DocumentDeliveryOutboxService({
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["enqueue-1"])
    });

    await outbox.enqueueFromDomainEvent({
      event: domainEvent(),
      snapshot: snapshot(),
      targets: ["notification"]
    });

    await expect(events.readStream(documentDeliveryOutboxStream("acme"))).resolves.toMatchObject([
      {
        type: "DocumentDeliveryOutboxEnqueued",
        payload: {
          kind: "DocumentDeliveryOutboxEnqueued",
          sourceEventId: "evt_source",
          sourceEventType: "NoteCreated",
          payloadKind: "DocumentCreated"
        }
      }
    ]);
  });

  it("keeps source event type metadata separate from source payload kind", async () => {
    const events = new InMemoryDocumentStore();
    const outbox = new DocumentDeliveryOutboxService({
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["enqueue-1"])
    });

    await outbox.enqueueFromDomainEvent({
      event: {
        ...domainEvent(),
        type: "NoteDeleted",
        payload: { kind: "DocumentAssigned", assigneeId: "support@example.com" }
      },
      snapshot: snapshot(),
      targets: ["email"]
    });

    await expect(events.readStream(documentDeliveryOutboxStream("acme"))).resolves.toMatchObject([
      {
        payload: {
          kind: "DocumentDeliveryOutboxEnqueued",
          sourceEventType: "NoteDeleted",
          payloadKind: "DocumentAssigned"
        }
      }
    ]);
  });

  it("reads delivery outbox state through the bounded outbox payload kinds", async () => {
    const events = new RecordingReadOptionsDocumentDeliveryStore();
    const outbox = new DocumentDeliveryOutboxService({
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["enqueue-1"])
    });

    await outbox.enqueueFromDomainEvent({
      event: domainEvent(),
      snapshot: snapshot(),
      targets: ["notification"]
    });
    await outbox.list("acme");

    // The very first enqueue has no checkpoint to resume from, so it folds the
    // whole stream — that path has to keep the payload-kind bound.
    expect(events.reads[0]).toEqual({
      stream: documentDeliveryOutboxStream("acme"),
      options: { payloadKinds: DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KINDS }
    });
    // No read is bounded above: the fold's version is the concurrency
    // expectation and has to reach the true stream head.
    expect(events.reads.every((read) => read.options?.maxSequence === undefined)).toBe(true);
    // One read per operation, not two: the post-append fold resumes from the
    // state already in memory instead of re-reading the stream up to the version
    // it was folded from. See issue #28.
    expect(events.reads).toHaveLength(2);
  });

  it("reads only the tail after the compaction checkpoint once one exists", async () => {
    // The shape this pins is the lower bound. `minSequence` has to be the
    // checkpoint's own sequence (`upToSequence + 1`) so the checkpoint is inside
    // the read: it is what carries `state.version` to the true stream head, and
    // a read that starts after it folds to version 0 and conflicts forever.
    const events = new RecordingReadOptionsDocumentDeliveryStore();
    const outbox = new DocumentDeliveryOutboxService({
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["enqueue-1", "claim-event-1", "deliver-event-1"])
    });
    await outbox.enqueueFromDomainEvent({ event: domainEvent(), targets: ["email"] });
    await outbox.claimPending({ tenantId: "acme", claimId: "claim-1", now });
    await outbox.markDelivered({ tenantId: "acme", outboxId: "evt_source:email", claimId: "claim-1" });

    const stream = await events.readStream(documentDeliveryOutboxStream("acme"));
    const checkpoint = stream.find((event) => event.payload.kind === "DocumentDeliveryOutboxCheckpointed");
    expect(checkpoint).toMatchObject({ payload: { upToSequence: 2 }, sequence: 3 });

    events.reads.length = 0;
    await outbox.list("acme");

    expect(events.reads).toEqual([
      {
        stream: documentDeliveryOutboxStream("acme"),
        options: { minSequence: 3, payloadKinds: DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KINDS }
      }
    ]);
  });

  it("claims pending records, retries failed records when due, and marks delivery terminal", async () => {
    const events = new InMemoryDocumentStore();
    const outbox = new DocumentDeliveryOutboxService({
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["enqueue-1", "claim-event-1", "fail-event-1", "claim-event-2", "deliver-event-1"])
    });
    await outbox.enqueueFromDomainEvent({ event: domainEvent(), targets: ["email"] });

    const [claimed] = await outbox.claimPending({ tenantId: "acme", claimId: "claim-1", limit: 1, now });
    expect(claimed).toMatchObject({
      id: "evt_source:email",
      status: "claimed",
      claimId: "claim-1",
      attempts: 1
    });

    await outbox.markFailed({
      tenantId: "acme",
      outboxId: "evt_source:email",
      claimId: "claim-1",
      error: "queue unavailable",
      retryAt: later
    });
    await expect(outbox.claimPending({ tenantId: "acme", claimId: "claim-too-early", now })).resolves.toEqual([]);

    const [retried] = await outbox.claimPending({ tenantId: "acme", claimId: "claim-2", now: later });
    expect(retried).toMatchObject({
      id: "evt_source:email",
      status: "claimed",
      claimId: "claim-2",
      attempts: 2
    });

    const delivered = await outbox.markDelivered({
      tenantId: "acme",
      outboxId: "evt_source:email",
      claimId: "claim-2"
    });
    expect(delivered).toMatchObject({
      id: "evt_source:email",
      status: "delivered",
      attempts: 2
    });
  });

  it("rejects completion from stale claims", async () => {
    const outbox = new DocumentDeliveryOutboxService({
      events: new InMemoryDocumentStore(),
      clock: fixedClock(now),
      ids: deterministicIds(["enqueue-1", "claim-event-1"])
    });
    await outbox.enqueueFromDomainEvent({ event: domainEvent(), targets: ["realtime"] });
    await outbox.claimPending({ tenantId: "acme", claimId: "claim-1", now });

    await expect(
      outbox.markDelivered({ tenantId: "acme", outboxId: "evt_source:realtime", claimId: "claim-2" })
    ).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
  });

  it("keeps the working set bounded as deliveries accumulate", async () => {
    // The working set is folded on every outbox operation, so delivered records
    // used to make each of those operations more expensive than the last (#28).
    const events = new InMemoryDocumentStore();
    const outbox = new DocumentDeliveryOutboxService({
      events,
      clock: fixedClock(now),
      ids: deterministicIds(
        Array.from({ length: 12 }, (_unused, index) => `outbox-event-${index}`)
      )
    });
    const sourceIds = ["evt_a", "evt_b", "evt_c", "evt_d"];
    for (const sourceId of sourceIds) {
      await outbox.enqueueFromDomainEvent({
        event: { ...domainEvent(), id: sourceId },
        targets: ["email"]
      });
    }
    const claimed = await outbox.claimPending({ tenantId: "acme", claimId: "claim-1", limit: 10, now });
    expect(claimed).toHaveLength(4);
    for (const record of claimed) {
      await outbox.markDelivered({ tenantId: "acme", outboxId: record.id, claimId: "claim-1" });
    }

    await expect(outbox.list("acme")).resolves.toEqual([]);
    for (const sourceId of sourceIds) {
      await expect(outbox.record("acme", `${sourceId}:email`)).resolves.toMatchObject({
        id: `${sourceId}:email`,
        status: "delivered"
      });
    }
  });

  it("does not re-enqueue a source event whose delivery already completed", async () => {
    // Deduplication reads the events rather than the working set, precisely
    // because the record leaves that set once delivered. Folding state instead
    // would let an at-least-once caller queue the same delivery twice.
    const outbox = new DocumentDeliveryOutboxService({
      events: new InMemoryDocumentStore(),
      clock: fixedClock(now),
      ids: deterministicIds(["enqueue-1", "claim-event-1", "deliver-event-1", "enqueue-again"])
    });
    await outbox.enqueueFromDomainEvent({ event: domainEvent(), targets: ["email"] });
    await outbox.claimPending({ tenantId: "acme", claimId: "claim-1", now });
    await outbox.markDelivered({ tenantId: "acme", outboxId: "evt_source:email", claimId: "claim-1" });

    await expect(
      outbox.enqueueFromDomainEvent({ event: domainEvent(), targets: ["email"] })
    ).resolves.toEqual([]);
    await expect(outbox.list("acme")).resolves.toEqual([]);
  });

  it("treats delivering an already-delivered record as success", async () => {
    // An at-least-once consumer can be handed the same message twice. A second
    // markDelivered has to be a no-op, not a notFound it would retry forever.
    const outbox = new DocumentDeliveryOutboxService({
      events: new InMemoryDocumentStore(),
      clock: fixedClock(now),
      ids: deterministicIds(["enqueue-1", "claim-event-1", "deliver-event-1"])
    });
    await outbox.enqueueFromDomainEvent({ event: domainEvent(), targets: ["email"] });
    await outbox.claimPending({ tenantId: "acme", claimId: "claim-1", now });
    const first = await outbox.markDelivered({
      tenantId: "acme",
      outboxId: "evt_source:email",
      claimId: "claim-1"
    });

    // Note the claim id: a redelivery need not know which claim won, and the
    // stale-claim conflict must not fire once the record is already terminal.
    await expect(
      outbox.markDelivered({ tenantId: "acme", outboxId: "evt_source:email", claimId: "claim-anything" })
    ).resolves.toEqual(first);
  });

  it("still reports a genuinely unknown record as not found", async () => {
    const outbox = new DocumentDeliveryOutboxService({
      events: new InMemoryDocumentStore(),
      clock: fixedClock(now),
      ids: deterministicIds(["enqueue-1"])
    });
    await outbox.enqueueFromDomainEvent({ event: domainEvent(), targets: ["email"] });

    await expect(outbox.record("acme", "evt_missing:email")).resolves.toBeNull();
    await expect(
      outbox.markDelivered({ tenantId: "acme", outboxId: "evt_missing:email", claimId: "claim-1" })
    ).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });

  it("does not double-enqueue when the append loses a concurrency race", async () => {
    // Deduplication has to be recomputed on every attempt. Reading it once
    // before the retry loop leaves the decision stale exactly when a competitor
    // has just committed the record the check was meant to find.
    const events = new ConflictOnceDocumentDeliveryStore();
    const competitor = new DocumentDeliveryOutboxService({
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["competitor-enqueue"])
    });
    const outbox = new DocumentDeliveryOutboxService({
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["enqueue-1", "enqueue-retry"])
    });
    events.conflictNextAppendWith(() =>
      competitor.enqueueFromDomainEvent({ event: domainEvent(), targets: ["email"] })
    );

    await outbox.enqueueFromDomainEvent({ event: domainEvent(), targets: ["email"] });

    const stream = await events.readStream(documentDeliveryOutboxStream("acme"));
    expect(stream.filter((event) => event.payload.kind === "DocumentDeliveryOutboxEnqueued")).toHaveLength(1);
    await expect(outbox.list("acme")).resolves.toMatchObject([
      { id: "evt_source:email", status: "pending", attempts: 0 }
    ]);
  });

  it("stays idempotent when a redelivery loses a concurrency race", async () => {
    // The already-delivered check has to be recomputed on every attempt too: on
    // the retry the record is gone from the working set, so a stale "not
    // delivered" decision walks into a notFound the consumer would then treat
    // as a failure.
    const events = new ConflictOnceDocumentDeliveryStore();
    const outbox = new DocumentDeliveryOutboxService({
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["enqueue-1", "claim-event-1", "deliver-event-1", "deliver-event-2"])
    });
    await outbox.enqueueFromDomainEvent({ event: domainEvent(), targets: ["email"] });
    await outbox.claimPending({ tenantId: "acme", claimId: "claim-1", now });
    const winner = new DocumentDeliveryOutboxService({
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["winner-deliver"])
    });
    events.conflictNextAppendWith(() =>
      winner.markDelivered({ tenantId: "acme", outboxId: "evt_source:email", claimId: "claim-1" })
    );

    await expect(
      outbox.markDelivered({ tenantId: "acme", outboxId: "evt_source:email", claimId: "claim-1" })
    ).resolves.toMatchObject({ id: "evt_source:email", status: "delivered" });
    const stream = await events.readStream(documentDeliveryOutboxStream("acme"));
    expect(stream.filter((event) => event.payload.kind === "DocumentDeliveryOutboxDelivered")).toHaveLength(1);
  });

  it("records delivery intents from the composed after-commit hook", async () => {
    const events = new InMemoryDocumentStore();
    const outbox = new DocumentDeliveryOutboxService({
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["enqueue-1", "enqueue-2", "enqueue-3"])
    });
    const hooks = createDocumentDeliveryHooks({
      deliveryOutbox: outbox,
      deliveryOutboxTargets: ["notification", "realtime", "email"]
    });

    await hooks.afterCommit?.({
      doctype: { name: "Note", fields: [] },
      data: snapshot().data,
      event: domainEvent(),
      snapshot: snapshot()
    });

    await expect(outbox.list("acme")).resolves.toMatchObject([
      { id: "evt_source:email", target: "email", status: "pending" },
      { id: "evt_source:notification", target: "notification", status: "pending" },
      { id: "evt_source:realtime", target: "realtime", status: "pending" }
    ]);
  });

  describe("compaction checkpoints", () => {
    it("reads the same number of events per operation however long the history is", async () => {
      // The property, asserted as an equality between rounds rather than as a
      // threshold or a duration. Before compaction the same loop read
      // 87 / 177 / 267 / 357 events at rounds 10 / 20 / 30 / 40 — the figures in
      // issue #28, reproduced with this store.
      const events = new CountingDocumentDeliveryStore();
      const outbox = deliveryRounds(events);

      const perRound = await runDeliveryRounds(outbox, events, 40, [10, 20, 30, 40]);

      expect(perRound[40]).toEqual(perRound[10]);
      expect(perRound[30]).toEqual(perRound[10]);
      expect(perRound[20]).toEqual(perRound[10]);
      // Stated, not just compared: a mutation that reintroduced the full read
      // and happened to be flat for another reason would still have to match a
      // number, and this one is small enough to read as bounded.
      expect(perRound[10]).toEqual({ events: 24, queries: 11 });
    });

    it("completes consecutive delivery rounds without a concurrency conflict", async () => {
      // Two rounds, deliberately. Both fatal ways to get the lower bound wrong
      // — an exclusive `minSequence` of the checkpoint's own sequence, and
      // leaving the checkpoint kind out of the payload-kind filter — fold the
      // resumed state to version 0 and raise
      // `Expected stream '...' at version 0, found N` on the second round and on
      // every retry. One round passes in both broken variants.
      const events = new InMemoryDocumentStore();
      const outbox = deliveryRounds(events);

      for (const round of [1, 2]) {
        await outbox.enqueueFromDomainEvent({
          event: { ...domainEvent(), id: `evt_round_${String(round)}` },
          targets: ["email"]
        });
        const [claimed] = await outbox.claimPending({ tenantId: "acme", claimId: `claim-${String(round)}`, now });
        await expect(
          outbox.markDelivered({ tenantId: "acme", outboxId: claimed!.id, claimId: `claim-${String(round)}` })
        ).resolves.toMatchObject({ status: "delivered" });
      }
    });

    it("keeps a record enqueued before the compaction point claimable and unchanged", async () => {
      // The property the issue names as the one to attack hardest: a checkpoint
      // must never make state() miss an in-flight record. This record's own
      // events are all below every checkpoint written afterwards, so it survives
      // only through `carryOver`.
      const events = new InMemoryDocumentStore();
      const outbox = deliveryRounds(events);
      await outbox.enqueueFromDomainEvent({
        event: { ...domainEvent(), id: "evt_stuck" },
        targets: ["email"]
      });
      const [stuck] = await outbox.claimPending({ tenantId: "acme", claimId: "claim-stuck", limit: 1, now });
      await outbox.markFailed({
        tenantId: "acme",
        outboxId: stuck!.id,
        claimId: "claim-stuck",
        error: "target permanently down",
        retryAt: "2099-01-01T00:00:00.000Z"
      });

      await runDeliveryRounds(outbox, events, 10, []);

      await expect(outbox.list("acme")).resolves.toMatchObject([
        { id: "evt_stuck:email", status: "failed", attempts: 1, claimId: "claim-stuck", error: "target permanently down" }
      ]);
      // Still reachable as a claim candidate once its retry falls due, which is
      // the part that loses a delivery silently if the checkpoint drops it.
      await expect(
        outbox.claimPending({ tenantId: "acme", claimId: "claim-late", now: "2099-06-01T00:00:00.000Z" })
      ).resolves.toMatchObject([{ id: "evt_stuck:email", status: "claimed", attempts: 2, claimId: "claim-late" }]);
    });

    it("still compacts while a permanently failing target sits in flight", async () => {
      // The constraint the issue records, measured rather than assumed. FAILED
      // records never leave the working set, and
      // `claimableDocumentDeliveryOutboxRecords` re-claims the oldest first, so
      // a poison record stays the oldest in-flight record indefinitely. A
      // checkpoint keyed on the minimum in-flight enqueue sequence would be
      // pinned at its sequence and reads would go straight back to linear
      // (96 / 186 / 276 / 366 events per round when measured that way). Carrying
      // the id instead holds this flat.
      const events = new CountingDocumentDeliveryStore();
      const outbox = deliveryRounds(events);
      await outbox.enqueueFromDomainEvent({
        event: { ...domainEvent(), id: "evt_stuck" },
        targets: ["email"]
      });
      const [stuck] = await outbox.claimPending({ tenantId: "acme", claimId: "claim-stuck", limit: 1, now });
      await outbox.markFailed({
        tenantId: "acme",
        outboxId: stuck!.id,
        claimId: "claim-stuck",
        error: "target permanently down",
        retryAt: "2099-01-01T00:00:00.000Z"
      });

      const perRound = await runDeliveryRounds(outbox, events, 40, [10, 20, 30, 40]);

      expect(perRound[40]).toEqual(perRound[10]);
      // The number docs/delivery-outbox.md quotes for this case. One more read
      // than the unpinned 24: the stuck record is rehydrated from `carryOver` on
      // every state fold.
      expect(perRound[10]).toEqual({ events: 33, queries: 14 });
    });

    it("does not fail a delivery when the checkpoint loses its concurrency race", async () => {
      // The checkpoint rides in the delivery's own commit, so there is only one
      // CAS to lose and the retry recomputes the checkpoint from fresh state.
      const events = new ConflictOnceDocumentDeliveryStore();
      const outbox = new DocumentDeliveryOutboxService({
        events,
        clock: fixedClock(now),
        ids: deterministicIds(["enqueue-1", "claim-event-1", "deliver-event-1", "deliver-event-2"])
      });
      await outbox.enqueueFromDomainEvent({ event: domainEvent(), targets: ["email"] });
      await outbox.claimPending({ tenantId: "acme", claimId: "claim-1", now });
      const competitor = new DocumentDeliveryOutboxService({
        events,
        clock: fixedClock(now),
        ids: deterministicIds(["competitor-enqueue"])
      });
      events.conflictNextAppendWith(() =>
        competitor.enqueueFromDomainEvent({ event: { ...domainEvent(), id: "evt_other" }, targets: ["email"] })
      );

      await expect(
        outbox.markDelivered({ tenantId: "acme", outboxId: "evt_source:email", claimId: "claim-1" })
      ).resolves.toMatchObject({ id: "evt_source:email", status: "delivered" });

      const stream = await events.readStream(documentDeliveryOutboxStream("acme"));
      expect(
        stream.filter(
          (event) =>
            event.payload.kind === "DocumentDeliveryOutboxDelivered" &&
            event.documentName === "evt_source:email"
        )
      ).toHaveLength(1);
    });

    it("writes checkpoints that make strict progress and never share an id", async () => {
      const events = new InMemoryDocumentStore();
      const outbox = deliveryRounds(events);

      await runDeliveryRounds(outbox, events, 20, []);

      const checkpoints = (await events.readStream(documentDeliveryOutboxStream("acme"))).filter(
        (event) => event.payload.kind === "DocumentDeliveryOutboxCheckpointed"
      );
      expect(checkpoints).toHaveLength(20);
      const sequences = checkpoints.map((event) =>
        (event.payload as { readonly upToSequence: number }).upToSequence
      );
      expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
      expect(new Set(sequences).size).toBe(sequences.length);
      // The id is derived from tenant and `upToSequence` rather than drawn from
      // the id generator, so a repeat would hit `id TEXT PRIMARY KEY` in D1 and
      // surface as a conflict that fails a delivery after five retries.
      expect(new Set(checkpoints.map((event) => event.id)).size).toBe(checkpoints.length);
      // Every checkpoint lands one sequence above the version it summarises, so
      // a reader resuming at `upToSequence + 1` starts on it.
      for (const event of checkpoints) {
        expect(event.sequence).toBe((event.payload as { readonly upToSequence: number }).upToSequence + 1);
      }
    });

    it("keeps deduplication and redelivery idempotency working across compacted history", async () => {
      // Both behaviours #54 moved off the fold read a record's own events, so
      // compaction must not reach them. The first source event's record is long
      // since compacted away by the time this asks about it.
      const events = new InMemoryDocumentStore();
      const outbox = deliveryRounds(events);

      await runDeliveryRounds(outbox, events, 12, []);

      await expect(
        outbox.enqueueFromDomainEvent({ event: { ...domainEvent(), id: "evt_round_1" }, targets: ["email"] })
      ).resolves.toEqual([]);
      await expect(outbox.record("acme", "evt_round_1:email")).resolves.toMatchObject({
        id: "evt_round_1:email",
        status: "delivered"
      });
      await expect(
        outbox.markDelivered({ tenantId: "acme", outboxId: "evt_round_1:email", claimId: "claim-anything" })
      ).resolves.toMatchObject({ id: "evt_round_1:email", status: "delivered" });
      await expect(
        outbox.markDelivered({ tenantId: "acme", outboxId: "evt_unknown:email", claimId: "claim-1" })
      ).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    });

    it("keeps the checkpoint sentinel out of every record's own history", async () => {
      // The checkpoint shares the tenant's outbox stream and is told apart only
      // by `documentName`. Naming it after the record being delivered would put
      // it inside that record's history, where the per-record fold cannot filter
      // a payload with no `outboxId` and the `limit: 1` dedup read would find it.
      const events = new InMemoryDocumentStore();
      const outbox = deliveryRounds(events);

      await runDeliveryRounds(outbox, events, 4, []);

      const own = await events.readDocumentEvents({
        tenantId: "acme",
        doctype: "__DocumentDeliveryOutbox",
        documentName: "evt_round_1:email",
        stream: documentDeliveryOutboxStream("acme")
      });
      expect(own.map((event) => event.payload.kind)).toEqual([
        "DocumentDeliveryOutboxEnqueued",
        "DocumentDeliveryOutboxClaimed",
        "DocumentDeliveryOutboxDelivered"
      ]);
      await expect(
        events.readDocumentEvents({
          tenantId: "acme",
          doctype: "__DocumentDeliveryOutbox",
          documentName: "evt_never_enqueued:email",
          stream: documentDeliveryOutboxStream("acme"),
          limit: 1
        })
      ).resolves.toEqual([]);
      // The sentinel cannot collide with a record: outbox ids are always
      // `${eventId}:${target}` and so always contain a colon.
      expect(DOCUMENT_DELIVERY_OUTBOX_CHECKPOINT_DOCUMENT_NAME).not.toContain(":");
    });

    it("stops compacting rather than carrying more than the carry-over limit", async () => {
      // The documented degradation. Above the limit no checkpoint is written and
      // the tenant's reads go back to folding the whole stream, which is the
      // pre-#28 cost — the alternative being a checkpoint payload that grows
      // with the backlog and one indexed read per carried id on every fold.
      const events = new InMemoryDocumentStore();
      const outbox = deliveryRounds(events);
      for (let index = 0; index < 30; index += 1) {
        await outbox.enqueueFromDomainEvent({
          event: { ...domainEvent(), id: `evt_backlog_${String(index)}` },
          targets: ["email"]
        });
      }
      const claimed = await outbox.claimPending({ tenantId: "acme", claimId: "claim-1", limit: 30, now });
      expect(claimed).toHaveLength(30);

      // The working set the delivery is planned against holds 30, then 29, then
      // 28 … so the first five deliveries are above the limit of 25 and write no
      // checkpoint. The sixth is planned against 25 and does.
      for (const record of claimed.slice(0, 5)) {
        await outbox.markDelivered({ tenantId: "acme", outboxId: record.id, claimId: "claim-1" });
      }
      expect(await checkpointCount(events)).toBe(0);
      await outbox.markDelivered({ tenantId: "acme", outboxId: claimed[5]!.id, claimId: "claim-1" });
      expect(await checkpointCount(events)).toBe(1);

      // And it recovers: nothing about being over the limit is sticky.
      for (const record of claimed.slice(6)) {
        await outbox.markDelivered({ tenantId: "acme", outboxId: record.id, claimId: "claim-1" });
      }
      await expect(outbox.list("acme")).resolves.toEqual([]);
      expect(await checkpointCount(events)).toBe(25);
    });

    it("keeps working when a checkpoint is the newest event in the stream", async () => {
      // Reachable only by writing one by hand today, because the checkpoint is
      // committed *before* the delivery it accompanies. It is asserted anyway:
      // a fold that skipped the checkpoint — because the kind is missing from
      // the payload-kind filter, or because it does not carry `version` — folds
      // this stream to a version below its true head, and then every append for
      // the tenant fails with a conflict no retry can clear. That is a silent,
      // permanent outage for one tenant, so it must not rest on the ordering of
      // two events in one commit.
      const events = new InMemoryDocumentStore();
      const outbox = deliveryRounds(events);
      await outbox.enqueueFromDomainEvent({ event: domainEvent(), targets: ["email"] });
      const stream = documentDeliveryOutboxStream("acme");
      const head = (await events.readStream(stream)).length;
      await events.append(stream, head, [
        {
          id: "evt_manual_checkpoint",
          tenantId: "acme",
          stream,
          type: "DocumentDeliveryOutboxCheckpointed",
          doctype: "__DocumentDeliveryOutbox",
          documentName: DOCUMENT_DELIVERY_OUTBOX_CHECKPOINT_DOCUMENT_NAME,
          actorId: "system",
          occurredAt: now,
          payload: {
            kind: "DocumentDeliveryOutboxCheckpointed",
            upToSequence: head,
            carryOver: ["evt_source:email"]
          },
          metadata: {}
        }
      ]);

      const [claimed] = await outbox.claimPending({ tenantId: "acme", claimId: "claim-1", now });
      expect(claimed).toMatchObject({ id: "evt_source:email", status: "claimed", attempts: 1 });
      await expect(
        outbox.markDelivered({ tenantId: "acme", outboxId: "evt_source:email", claimId: "claim-1" })
      ).resolves.toMatchObject({ status: "delivered" });
    });

    it("does not surface a carried record that finished after the checkpoint was read", async () => {
      // A torn read: the tail comes back as it was before a competitor's
      // delivery, while the per-record rehydration sees that delivery. The
      // working set holds in-flight records only, so the delivered one is
      // dropped rather than handed to `list()` as though it were still pending.
      // An append taken from such a state conflicts on its stale version and
      // retries, so this only ever shows up as a read.
      const events = new StaleTailDocumentDeliveryStore();
      const outbox = deliveryRounds(events);
      await outbox.enqueueFromDomainEvent({ event: domainEvent(), targets: ["email"] });
      await outbox.claimPending({ tenantId: "acme", claimId: "claim-1", now });
      await outbox.markDelivered({ tenantId: "acme", outboxId: "evt_source:email", claimId: "claim-1" });
      await outbox.enqueueFromDomainEvent({
        event: { ...domainEvent(), id: "evt_second" },
        targets: ["email"]
      });
      await outbox.claimPending({ tenantId: "acme", claimId: "claim-2", now });
      // Freeze the stream read at this version, then deliver behind its back.
      events.freezeTailAtCurrentVersion(await events.readStream(documentDeliveryOutboxStream("acme")));
      const competitor = new DocumentDeliveryOutboxService({
        events: new PassThroughDocumentDeliveryStore(events),
        clock: fixedClock(now),
        ids: deterministicIds(["competitor-deliver"])
      });
      await competitor.markDelivered({ tenantId: "acme", outboxId: "evt_second:email", claimId: "claim-2" });

      await expect(outbox.list("acme")).resolves.toEqual([]);
    });

    it("commits the delivery without a checkpoint on the final append attempt", async () => {
      // A checkpoint is an optimisation and must never be the reason a delivery
      // fails — not even for a reason bundling it into the delivery's own commit
      // does not cover, such as its derived id colliding with a row already in
      // the events table. The last attempt therefore drops it.
      const events = new ConflictOnceDocumentDeliveryStore();
      const outbox = deliveryRounds(events);
      await outbox.enqueueFromDomainEvent({ event: domainEvent(), targets: ["email"] });
      await outbox.claimPending({ tenantId: "acme", claimId: "claim-1", now });
      const noise = new DocumentDeliveryOutboxService({
        events: new PassThroughDocumentDeliveryStore(events),
        clock: fixedClock(now),
        ids: deterministicIds(Array.from({ length: 20 }, (_unused, index) => `noise-${String(index)}`))
      });
      // Four lost races, so the delivery commits on attempt five.
      events.conflictNextAppendsWith(4, async () => {
        await noise.enqueueFromDomainEvent({
          event: { ...domainEvent(), id: `evt_noise_${String(events.conflictsServed)}` },
          targets: ["email"]
        });
      });

      await expect(
        outbox.markDelivered({ tenantId: "acme", outboxId: "evt_source:email", claimId: "claim-1" })
      ).resolves.toMatchObject({ id: "evt_source:email", status: "delivered" });

      const stream = await events.readStream(documentDeliveryOutboxStream("acme"));
      expect(
        stream.filter((event) => event.payload.kind === "DocumentDeliveryOutboxDelivered")
      ).toHaveLength(1);
      // The winning commit was the delivery alone.
      expect(stream[stream.length - 1]?.payload.kind).toBe("DocumentDeliveryOutboxDelivered");
      expect(await checkpointCount(events)).toBe(0);
    });
  });
});

async function checkpointCount(events: InMemoryDocumentStore): Promise<number> {
  return (await events.readStream(documentDeliveryOutboxStream("acme"))).filter(
    (event) => event.payload.kind === "DocumentDeliveryOutboxCheckpointed"
  ).length;
}

function deliveryRounds(events: InMemoryDocumentStore): DocumentDeliveryOutboxService {
  return new DocumentDeliveryOutboxService({
    events,
    clock: fixedClock(now),
    // Generous, because the checkpoint deliberately does not consume one: its id
    // is derived, so every existing fixture's exactly-sized id list stays valid.
    ids: deterministicIds(Array.from({ length: 400 }, (_unused, index) => `evt_${String(index)}`))
  });
}

/**
 * One enqueue + claim + deliver per round, nothing left in flight by the round's
 * own doing, sampling the reads each sampled round costs.
 */
async function runDeliveryRounds(
  outbox: DocumentDeliveryOutboxService,
  events: InMemoryDocumentStore,
  rounds: number,
  sampleAt: readonly number[]
): Promise<Record<number, { readonly events: number; readonly queries: number }>> {
  const samples: Record<number, { readonly events: number; readonly queries: number }> = {};
  const counting = events instanceof CountingDocumentDeliveryStore ? events : undefined;
  for (let round = 1; round <= rounds; round += 1) {
    counting?.reset();
    await outbox.enqueueFromDomainEvent({
      event: { ...domainEvent(), id: `evt_round_${String(round)}` },
      targets: ["email"]
    });
    const claimed = await outbox.claimPending({ tenantId: "acme", claimId: `claim-${String(round)}`, limit: 1, now });
    const target = claimed.find((record) => record.id === `evt_round_${String(round)}:email`);
    expect(target).toBeDefined();
    await outbox.markDelivered({
      tenantId: "acme",
      outboxId: target!.id,
      claimId: `claim-${String(round)}`
    });
    if (counting !== undefined && sampleAt.includes(round)) {
      samples[round] = { events: counting.eventsRead, queries: counting.queries };
    }
  }
  return samples;
}

/**
 * Counts events returned by every read, so the central claim of issue #28 can be
 * asserted as a number instead of a duration. Both read paths are counted:
 * `readStream` for the state fold and `readDocumentEvents` for the per-record
 * lookups, because moving cost from one to the other is not a fix.
 */
class CountingDocumentDeliveryStore extends InMemoryDocumentStore {
  eventsRead = 0;
  queries = 0;

  override async readStream(stream: StreamName, options?: ReadStreamOptions): Promise<readonly DomainEvent[]> {
    return this.counted(await super.readStream(stream, options));
  }

  override async readDocumentEvents(query: AuditDocumentEventQuery): Promise<readonly DomainEvent[]> {
    return this.counted(await super.readDocumentEvents(query));
  }

  reset(): void {
    this.eventsRead = 0;
    this.queries = 0;
  }

  private counted(events: readonly DomainEvent[]): readonly DomainEvent[] {
    this.queries += 1;
    this.eventsRead += events.length;
    return events;
  }
}

function documentDeliveryOutboxPayload(
  payload: Extract<DocumentEventPayload, { readonly kind: "DocumentDeliveryOutboxEnqueued" }>
): Extract<DocumentDeliveryOutboxEventPayload, { readonly kind: "DocumentDeliveryOutboxEnqueued" }> {
  return payload;
}

/**
 * Lets one append lose an optimistic-concurrency race: the first `append` to the
 * outbox stream commits a competitor's events first, so the caller sees a
 * conflict and retries. This is the shape that exposed a stale read taken
 * outside the retry loop.
 */
class ConflictOnceDocumentDeliveryStore extends InMemoryDocumentStore {
  private pending: (() => Promise<unknown>) | undefined;
  private remaining = 0;
  conflictsServed = 0;

  conflictNextAppendWith(competitor: () => Promise<unknown>): void {
    this.conflictNextAppendsWith(1, competitor);
  }

  /** Loses `count` races in a row, so the caller's final retry is the one that commits. */
  conflictNextAppendsWith(count: number, competitor: () => Promise<unknown>): void {
    this.pending = competitor;
    this.remaining = count;
  }

  override async append(
    stream: StreamName,
    expectedVersion: number,
    events: readonly NewDomainEvent[]
  ): Promise<readonly DomainEvent[]> {
    const competitor = this.pending;
    if (competitor !== undefined && this.remaining > 0) {
      this.remaining -= 1;
      this.conflictsServed += 1;
      if (this.remaining === 0) {
        this.pending = undefined;
      }
      await competitor();
    }
    return super.append(stream, expectedVersion, events);
  }
}

/**
 * Serves `readStream` from a frozen snapshot while every other read stays live,
 * which is what a read torn by a concurrent writer looks like from inside
 * `state()`: the tail is stale, the per-record rehydration is not.
 */
class StaleTailDocumentDeliveryStore extends InMemoryDocumentStore {
  private frozen: readonly DomainEvent[] | undefined;

  freezeTailAtCurrentVersion(events: readonly DomainEvent[]): void {
    this.frozen = events;
  }

  override async readStream(stream: StreamName, options?: ReadStreamOptions): Promise<readonly DomainEvent[]> {
    const frozen = this.frozen;
    if (frozen === undefined) {
      return super.readStream(stream, options);
    }
    return frozen.filter(
      (event) => options?.minSequence === undefined || event.sequence >= options.minSequence
    );
  }
}

/**
 * Delegates to another store without inheriting its test-only behaviour, so a
 * competitor service can write to the same events a rigged store is reading.
 */
class PassThroughDocumentDeliveryStore extends InMemoryDocumentStore {
  constructor(private readonly inner: InMemoryDocumentStore) {
    super();
  }

  override readStream(stream: StreamName, options?: ReadStreamOptions): Promise<readonly DomainEvent[]> {
    return InMemoryDocumentStore.prototype.readStream.call(this.inner, stream, options);
  }

  override readDocumentEvents(query: AuditDocumentEventQuery): Promise<readonly DomainEvent[]> {
    return this.inner.readDocumentEvents(query);
  }

  override append(
    stream: StreamName,
    expectedVersion: number,
    events: readonly NewDomainEvent[]
  ): Promise<readonly DomainEvent[]> {
    return InMemoryDocumentStore.prototype.append.call(this.inner, stream, expectedVersion, events);
  }
}

class RecordingReadOptionsDocumentDeliveryStore extends InMemoryDocumentStore {
  readonly reads: Array<{
    readonly stream: StreamName;
    readonly options: ReadStreamOptions | undefined;
  }> = [];

  override readStream(stream: StreamName, options?: ReadStreamOptions): Promise<readonly DomainEvent[]> {
    this.reads.push({ stream, options });
    return super.readStream(stream, options);
  }
}

function domainEvent(): DomainEvent {
  return {
    id: "evt_source",
    tenantId: "acme",
    stream: "acme:Note:One",
    sequence: 1,
    type: "NoteCreated",
    doctype: "Note",
    documentName: "One",
    actorId: "owner@example.com",
    occurredAt: now,
    payload: { kind: "DocumentCreated", data: { title: "One" }, docstatus: "draft" },
    metadata: {}
  };
}

function snapshot(): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Note",
    name: "One",
    version: 1,
    docstatus: "draft",
    data: { title: "One" },
    createdAt: now,
    updatedAt: now
  };
}
