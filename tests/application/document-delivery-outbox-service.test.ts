import {
  DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KINDS,
  DocumentDeliveryOutboxService,
  InMemoryDocumentStore,
  createDocumentDeliveryHooks,
  documentDeliveryOutboxStream,
  fixedClock,
  deterministicIds
} from "../../src";
import type {
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

    expect(events.reads).toContainEqual({
      stream: documentDeliveryOutboxStream("acme"),
      options: { payloadKinds: DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KINDS }
    });
    // One read per operation, not two: the post-append fold resumes from the
    // state already in memory instead of re-reading the stream up to the version
    // it was folded from. See issue #28.
    expect(events.reads.every((read) => read.options?.maxSequence === undefined)).toBe(true);
    expect(events.reads).toHaveLength(2);
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
});

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

  conflictNextAppendWith(competitor: () => Promise<unknown>): void {
    this.pending = competitor;
  }

  override async append(
    stream: StreamName,
    expectedVersion: number,
    events: readonly NewDomainEvent[]
  ): Promise<readonly DomainEvent[]> {
    const competitor = this.pending;
    if (competitor !== undefined) {
      this.pending = undefined;
      await competitor();
    }
    return super.append(stream, expectedVersion, events);
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
