import {
  createDocumentDeliveryOutboxDeliveryHandlers,
  createDocumentDeliveryOutboxDrainJob,
  createJobRegistry,
  deterministicIds,
  DocumentDeliveryOutboxConsumer,
  DocumentDeliveryOutboxService,
  DOCUMENT_DELIVERY_OUTBOX_DRAIN_JOB_NAME,
  fixedClock,
  InMemoryDocumentStore,
  InMemoryRealtimePublisher,
  JobExecutor,
  type DocumentData,
  type DomainEvent,
  type DocumentSnapshot,
  type JobMessage
} from "../../src";

const now = "2026-01-01T00:00:00.000Z";
const retryAt = "2026-01-01T00:01:00.000Z";

describe("DocumentDeliveryOutboxConsumer", () => {
  it("claims pending records, dispatches target handlers, and marks delivery terminal", async () => {
    const outbox = new DocumentDeliveryOutboxService({
      events: new InMemoryDocumentStore(),
      ids: deterministicIds([
        "enqueue-notification",
        "enqueue-realtime",
        "enqueue-email",
        "claim-notification",
        "claim-realtime",
        "claim-email",
        "deliver-notification",
        "deliver-realtime",
        "deliver-email"
      ]),
      clock: fixedClock(now)
    });
    await outbox.enqueueFromDomainEvent({
      event: domainEvent(),
      snapshot: snapshot(),
      targets: ["notification", "realtime", "email"]
    });
    const delivered: string[] = [];
    const consumer = new DocumentDeliveryOutboxConsumer({
      outbox,
      clock: fixedClock(now),
      deliveries: {
        notification: { async deliver(record) { delivered.push(record.id); } },
        realtime: { async deliver(record) { delivered.push(record.id); } },
        email: { async deliver(record) { delivered.push(record.id); } }
      }
    });

    await expect(consumer.drain({ tenantId: "acme", claimId: "claim-1", now })).resolves.toMatchObject({
      tenantId: "acme",
      claimed: 3,
      delivered: 3,
      failed: 0,
      outcomes: [
        { outboxId: "evt_source:email", status: "delivered", attempts: 1 },
        { outboxId: "evt_source:notification", status: "delivered", attempts: 1 },
        { outboxId: "evt_source:realtime", status: "delivered", attempts: 1 }
      ]
    });
    expect(delivered).toEqual(["evt_source:email", "evt_source:notification", "evt_source:realtime"]);
    await expect(outbox.list("acme")).resolves.toMatchObject([
      { id: "evt_source:email", status: "delivered", claimId: "claim-1" },
      { id: "evt_source:notification", status: "delivered", claimId: "claim-1" },
      { id: "evt_source:realtime", status: "delivered", claimId: "claim-1" }
    ]);
  });

  it("marks handler failures retryable and only retries when due", async () => {
    const outbox = new DocumentDeliveryOutboxService({
      events: new InMemoryDocumentStore(),
      ids: deterministicIds(["enqueue-email", "claim-1-event", "fail-1-event", "claim-2-event", "deliver-2-event"]),
      clock: fixedClock(now)
    });
    await outbox.enqueueFromDomainEvent({ event: domainEvent(), snapshot: snapshot(), targets: ["email"] });
    let fail = true;
    const consumer = new DocumentDeliveryOutboxConsumer({
      outbox,
      clock: fixedClock(now),
      retry: { baseDelaySeconds: 60, maxDelaySeconds: 60 },
      deliveries: {
        email: {
          async deliver() {
            if (fail) {
              throw new Error("email provider unavailable");
            }
            return { provider: "ok" };
          }
        }
      }
    });

    await expect(consumer.drain({ tenantId: "acme", claimId: "claim-1", now })).resolves.toMatchObject({
      claimed: 1,
      delivered: 0,
      failed: 1,
      outcomes: [{ outboxId: "evt_source:email", status: "failed", error: "email provider unavailable", retryAt }]
    });
    await expect(outbox.list("acme")).resolves.toMatchObject([
      { id: "evt_source:email", status: "failed", claimId: "claim-1", retryAt }
    ]);

    fail = false;
    await expect(
      consumer.drain({ tenantId: "acme", claimId: "claim-too-early", now: "2026-01-01T00:00:30.000Z" })
    ).resolves.toMatchObject({ claimed: 0, delivered: 0, failed: 0, outcomes: [] });
    await expect(consumer.drain({ tenantId: "acme", claimId: "claim-2", now: retryAt })).resolves.toMatchObject({
      claimed: 1,
      delivered: 1,
      failed: 0,
      outcomes: [{ outboxId: "evt_source:email", status: "delivered", attempts: 2 }]
    });
  });

  it("builds delivery handlers for notification, realtime, and queued email services", async () => {
    const outbox = new DocumentDeliveryOutboxService({
      events: new InMemoryDocumentStore(),
      ids: deterministicIds([
        "enqueue-notification",
        "enqueue-realtime",
        "enqueue-email",
        "claim-notification",
        "claim-realtime",
        "claim-email",
        "deliver-notification",
        "deliver-realtime",
        "deliver-email"
      ]),
      clock: fixedClock(now)
    });
    await outbox.enqueueFromDomainEvent({
      event: domainEvent(),
      snapshot: snapshot(),
      targets: ["notification", "realtime", "email"]
    });
    const recordedNotifications: string[] = [];
    const queuedEmailMessages: Array<{ readonly tenantId: string; readonly messageId: string; readonly metadata?: DocumentData }> = [];
    const realtime = new InMemoryRealtimePublisher();
    const consumer = new DocumentDeliveryOutboxConsumer({
      outbox,
      clock: fixedClock(now),
      deliveries: createDocumentDeliveryOutboxDeliveryHandlers({
        notifications: {
          async recordFromDomainEvent(event) {
            recordedNotifications.push(event.id);
          }
        },
        realtime,
        emailNotifications: {
          async sendFromDomainEvent() {
            throw new Error("should queue email instead of sending directly");
          },
          async queueFromDomainEvent() {
            return [{ status: "queued", messageId: "msg_001", ruleName: "Owners", recipientId: "owner@example.com" }];
          }
        },
        emailNotificationDeliveryQueue: {
          async enqueue(tenantId, messageId, options) {
            queuedEmailMessages.push({
              tenantId,
              messageId,
              ...(options?.metadata === undefined ? {} : { metadata: options.metadata })
            });
          }
        }
      })
    });

    await expect(consumer.drain({ tenantId: "acme", claimId: "claim-1", now })).resolves.toMatchObject({
      claimed: 3,
      delivered: 3,
      failed: 0
    });
    expect(recordedNotifications).toEqual(["evt_source"]);
    expect(realtime.events()).toMatchObject([{ id: "evt_source", type: "NoteCreated" }]);
    expect(queuedEmailMessages).toEqual([
      {
        tenantId: "acme",
        messageId: "msg_001",
        metadata: {
          sourceEventId: "evt_source",
          sourceEventType: "NoteCreated",
          sourcePayloadKind: "DocumentCreated",
          ruleName: "Owners",
          recipientId: "owner@example.com"
        }
      }
    ]);
  });

  it("runs through the built-in drain job", async () => {
    const registry = createJobRegistry({
      jobs: [createDocumentDeliveryOutboxDrainJob()]
    });
    const executor = new JobExecutor({
      registry,
      resources: {
        documentDeliveryOutboxConsumer: {
          async drain(command) {
            return {
              tenantId: command.tenantId,
              claimed: command.limit ?? 25,
              delivered: 1,
              failed: 0,
              outcomes: [{ outboxId: "evt_source:email", target: "email", status: "delivered", attempts: 1 }]
            };
          }
        }
      },
      clock: fixedClock(now)
    });

    await expect(executor.execute(jobMessage({ limit: 7, claimId: "claim-job" }))).resolves.toEqual({
      status: "succeeded",
      result: {
        tenantId: "acme",
        claimed: 7,
        delivered: 1,
        failed: 0,
        outcomes: [{ outboxId: "evt_source:email", target: "email", status: "delivered", attempts: 1 }]
      }
    });
  });
});

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

function jobMessage(payload: DocumentData = {}): JobMessage {
  return {
    tenantId: "acme",
    jobName: DOCUMENT_DELIVERY_OUTBOX_DRAIN_JOB_NAME,
    payload,
    runId: "run_001",
    idempotencyKey: "drain_001",
    enqueuedAt: now,
    metadata: {}
  };
}
