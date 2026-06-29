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
    expect(events.reads).toContainEqual({
      stream: documentDeliveryOutboxStream("acme"),
      options: {
        maxSequence: 0,
        payloadKinds: DOCUMENT_DELIVERY_OUTBOX_PAYLOAD_KINDS
      }
    });
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
