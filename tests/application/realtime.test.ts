import {
  createDocumentEmailNotificationHooks,
  createDocumentDeliveryHooks,
  createDocumentNotificationHooks,
  createDocumentDeliveryOutboxHooks,
  createDocumentQueuedEmailNotificationHooks,
  createDocumentRealtimeHooks,
  createEmailNotificationDeliveryJob,
  createJobRegistry,
  EmailNotificationService,
  EmailNotificationDeliveryQueueService,
  EMAIL_NOTIFICATION_DELIVERY_JOB_NAME,
  type EmailMessage,
  InMemoryEventStore,
  InMemoryJobQueue,
  InMemoryRealtimePublisher
} from "../../src";
import { UserNotificationService, deterministicIds, fixedClock, JobDispatcher } from "../../src";
import { createServices, data, now, owner } from "../helpers";
import type { AfterCommitContext, JsonValue, RealtimeEvent, RealtimePublishResult } from "../../src";

describe("in-memory realtime publisher", () => {
  it("clones published events before storing them", async () => {
    const publisher = new InMemoryRealtimePublisher();
    const topics = ["tenant:acme"];
    const payload = { nested: { count: 1 } };
    const event = {
      id: "realtime-1",
      type: "NoteChanged",
      topics,
      tenantId: "acme",
      occurredAt: now,
      payload
    } satisfies RealtimeEvent;

    await publisher.publish(event);

    topics.push("tenant:other");
    payload.nested.count = 2;

    expect(publisher.events()).toEqual([
      {
        id: "realtime-1",
        type: "NoteChanged",
        topics: ["tenant:acme"],
        tenantId: "acme",
        occurredAt: now,
        payload: { nested: { count: 1 } }
      }
    ]);
  });

  it("clones recorded events before exposing them", async () => {
    const publisher = new InMemoryRealtimePublisher();
    await publisher.publish({
      id: "realtime-1",
      type: "NoteChanged",
      topics: ["tenant:acme"],
      tenantId: "acme",
      occurredAt: now,
      payload: { nested: { count: 1 } }
    });

    const exposed = publisher.events();
    const exposedEvent = exposed[0] as unknown as { topics: string[]; payload: Record<string, JsonValue> };
    exposedEvent.topics.push("tenant:other");
    (exposedEvent.payload.nested as Record<string, JsonValue>).count = 2;

    expect(publisher.events()).toEqual([
      {
        id: "realtime-1",
        type: "NoteChanged",
        topics: ["tenant:acme"],
        tenantId: "acme",
        occurredAt: now,
        payload: { nested: { count: 1 } }
      }
    ]);
  });

  it("rejects realtime payloads that cannot cross a JSON boundary", async () => {
    const publisher = new InMemoryRealtimePublisher();

    await expect(
      publisher.publish({
        id: "realtime-1",
        type: "NoteChanged",
        topics: ["tenant:acme"],
        tenantId: "acme",
        occurredAt: now,
        payload: { count: Number.POSITIVE_INFINITY } as never
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Realtime event payload must be JSON-serializable"
    });
    expect(publisher.events()).toEqual([]);
  });
});

describe("document realtime hooks", () => {
  it("returns frozen document hook definitions from delivery hook factories", () => {
    const publisher = new InMemoryRealtimePublisher();
    const emailNotifications = {
      sendFromDomainEvent: vi.fn(),
      queueFromDomainEvent: vi.fn()
    } as unknown as EmailNotificationService;
    const notifications = {
      recordFromDomainEvent: vi.fn()
    } as unknown as UserNotificationService;
    const outbox = {
      enqueueFromDomainEvent: vi.fn()
    };
    const queue = { enqueue: vi.fn() };

    const hooks = [
      createDocumentRealtimeHooks(publisher),
      createDocumentDeliveryHooks({}),
      createDocumentDeliveryHooks({ realtime: publisher }),
      createDocumentDeliveryOutboxHooks(outbox, ["realtime"]),
      createDocumentNotificationHooks(notifications),
      createDocumentEmailNotificationHooks(emailNotifications),
      createDocumentQueuedEmailNotificationHooks(emailNotifications, queue)
    ];

    expect(hooks.every(Object.isFrozen)).toBe(true);
    expect(() => ((hooks[0] as { afterCommit?: unknown }).afterCommit = undefined)).toThrow(TypeError);
  });

  it("publishes committed domain events to realtime topics", async () => {
    const publisher = new InMemoryRealtimePublisher();
    const hooks = createDocumentRealtimeHooks(publisher);
    const services = createServices(["evt1"], {
      afterCommit: async (context) => {
        await hooks.afterCommit?.(context);
      }
    });

    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "Realtime" }) });

    expect(publisher.events()).toHaveLength(1);
    expect(publisher.events()[0]).toMatchObject({
      id: "evt_evt1",
      type: "NoteCreated",
      topics: ["tenant:acme", "doctype:acme:Note", "document:acme:Note:Realtime"]
    });
  });

  it("publishes redacted per-user notifications for explicit user-recipient events", async () => {
    const publisher = new InMemoryRealtimePublisher();
    const hooks = createDocumentRealtimeHooks(publisher);
    const services = createServices(["create-1", "assign-1"], {
      afterCommit: async (context) => {
        await hooks.afterCommit?.(context);
      }
    });

    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "Assigned Realtime" }) });
    await services.documents.assign({
      actor: owner,
      doctype: "Note",
      name: "Assigned Realtime",
      assignee: "support@example.com",
      expectedVersion: 1
    });

    expect(publisher.events()).toHaveLength(3);
    expect(publisher.events()[1]).toMatchObject({
      id: "evt_assign-1",
      type: "NoteAssigned",
      topics: ["tenant:acme", "doctype:acme:Note", "document:acme:Note:Assigned%20Realtime"]
    });
    expect(publisher.events()[2]).toMatchObject({
      id: "evt_assign-1:user:support%40example.com",
      type: "NoteAssigned",
      topics: ["user:acme:support%40example.com"],
      payload: {
        kind: "DocumentUserNotification",
        eventId: "evt_assign-1",
        payloadKind: "DocumentAssigned",
        doctype: "Note",
        documentName: "Assigned Realtime",
        actorId: owner.id,
        recipientId: "support@example.com"
      }
    });
    expect(JSON.stringify(publisher.events()[2]?.payload)).not.toContain("snapshot");
    expect(JSON.stringify(publisher.events()[2]?.payload)).not.toContain('"event":');
  });

  it("records durable notifications even when realtime fan-out fails", async () => {
    const notifications = new UserNotificationService({
      events: new InMemoryEventStore(),
      ids: deterministicIds(["record-1"])
    });
    const hooks = createDocumentDeliveryHooks({
      notifications,
      realtime: {
        publish(): Promise<RealtimePublishResult> {
          throw new Error("realtime unavailable");
        }
      }
    });
    const services = createServices(["create-1", "assign-1"], {
      afterCommit: async (context) => {
        await hooks.afterCommit?.(context);
      }
    });

    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "Delivery" }) });
    await services.documents.assign({
      actor: owner,
      doctype: "Note",
      name: "Delivery",
      assignee: "support@example.com",
      expectedVersion: 1
    });

    await expect(notifications.inbox({ id: "support@example.com", roles: ["User"], tenantId: "acme" })).resolves.toMatchObject({
      notifications: [{ id: "evt_assign-1:user:support%40example.com", documentName: "Delivery" }]
    });
  });

  it("runs email notification delivery from the shared after-commit hook", async () => {
    const events = new InMemoryEventStore();
    const messages: EmailMessage[] = [];
    const emailNotifications = new EmailNotificationService({
      events,
      from: { email: "notifications@example.com" },
      sender: {
        async send(message) {
          messages.push(message);
          return {};
        }
      },
      notificationRules: {
        async notificationRulesFor() {
          return [
            {
              name: "Email assignees",
              events: ["DocumentAssigned"],
              recipients: [{ kind: "user", userId: "support@example.com" }],
              channels: ["email"],
              subject: "{{ doctype }} {{ name }} assigned"
            }
          ];
        }
      }
    });
    const hooks = createDocumentDeliveryHooks({ emailNotifications });
    const services = createServices(["create-1", "assign-1"], {
      afterCommit: async (context) => {
        await hooks.afterCommit?.(context);
      }
    });

    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "Email Delivery" }) });
    await services.documents.assign({
      actor: owner,
      doctype: "Note",
      name: "Email Delivery",
      assignee: "support@example.com",
      expectedVersion: 1
    });

    expect(messages).toEqual([
      expect.objectContaining({
        from: { email: "notifications@example.com" },
        to: [{ email: "support@example.com" }],
        subject: "Note Email Delivery assigned"
      })
    ]);
  });

  it("can queue email notification delivery jobs from the shared after-commit hook", async () => {
    const events = new InMemoryEventStore();
    const messages: EmailMessage[] = [];
    const emailNotifications = new EmailNotificationService({
      events,
      from: { email: "notifications@example.com" },
      sender: {
        async send(message) {
          messages.push(message);
          return {};
        }
      },
      notificationRules: {
        async notificationRulesFor() {
          return [
            {
              name: "Email assignees",
              events: ["DocumentAssigned"],
              recipients: [{ kind: "user", userId: "support@example.com" }],
              channels: ["email"],
              subject: "{{ doctype }} {{ name }} assigned"
            }
          ];
        }
      }
    });
    const queue = new InMemoryJobQueue();
    const dispatcher = new JobDispatcher({
      registry: createJobRegistry({ jobs: [createEmailNotificationDeliveryJob()] }),
      queue,
      clock: fixedClock(now),
      ids: deterministicIds(["email-delivery-1"])
    });
    const deliveryQueue = new EmailNotificationDeliveryQueueService({ dispatcher });
    const hooks = createDocumentDeliveryHooks({
      emailNotifications,
      emailNotificationDeliveryQueue: deliveryQueue
    });
    const services = createServices(["create-1", "assign-1"], {
      afterCommit: async (context) => {
        await hooks.afterCommit?.(context);
      }
    });

    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "Queued Email" }) });
    await services.documents.assign({
      actor: owner,
      doctype: "Note",
      name: "Queued Email",
      assignee: "support@example.com",
      expectedVersion: 1
    });

    expect(messages).toEqual([]);
    expect(queue.queued()).toEqual([
      expect.objectContaining({
        message: expect.objectContaining({
          tenantId: "acme",
          jobName: EMAIL_NOTIFICATION_DELIVERY_JOB_NAME,
          runId: "job_email-delivery-1",
          payload: {
            messageId: "evt_assign-1:rule:Email%20assignees:email:support%40example.com"
          },
          metadata: expect.objectContaining({
            dispatchSource: "email-notifications",
            sourceEventId: "evt_assign-1",
            sourceEventType: "NoteAssigned",
            sourcePayloadKind: "DocumentAssigned",
            ruleName: "Email assignees",
            recipientId: "support@example.com"
          })
        })
      })
    ]);
  });

  it("can replay queued email delivery when enqueue fails after recording the outbox intent", async () => {
    const events = new InMemoryEventStore();
    const messages: EmailMessage[] = [];
    const emailNotifications = new EmailNotificationService({
      events,
      from: { email: "notifications@example.com" },
      sender: {
        async send(message) {
          messages.push(message);
          return {};
        }
      },
      notificationRules: {
        async notificationRulesFor() {
          return [
            {
              name: "Email assignees",
              events: ["DocumentAssigned"],
              recipients: [{ kind: "user", userId: "support@example.com" }],
              channels: ["email"]
            }
          ];
        }
      },
      ids: deterministicIds(["email-outbox-1"])
    });
    const enqueued: Array<{ readonly tenantId: string; readonly messageId: string }> = [];
    let enqueueAttempts = 0;
    const hooks = createDocumentDeliveryHooks({
      emailNotifications,
      emailNotificationDeliveryQueue: {
        async enqueue(tenantId, messageId) {
          enqueueAttempts += 1;
          if (enqueueAttempts === 1) {
            throw new Error("queue unavailable");
          }
          enqueued.push({ tenantId, messageId });
        }
      }
    });
    const contexts: AfterCommitContext[] = [];
    const hookErrors: string[] = [];
    const services = createServices(["create-1", "assign-1"], {
      afterCommit: async (context) => {
        contexts.push(context);
        await hooks.afterCommit?.(context);
      },
      onHookError: (error) => {
        hookErrors.push(error instanceof Error ? error.message : String(error));
      }
    });

    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "Replay Queue Hook" }) });
    await services.documents.assign({
      actor: owner,
      doctype: "Note",
      name: "Replay Queue Hook",
      assignee: "support@example.com",
      expectedVersion: 1
    });

    expect(hookErrors).toEqual(["queue unavailable"]);
    expect(messages).toEqual([]);
    expect(enqueued).toEqual([]);

    const assignContext = contexts.find((context) => context.event.payload.kind === "DocumentAssigned");
    expect(assignContext).toBeDefined();
    await hooks.afterCommit?.(assignContext!);

    expect(messages).toEqual([]);
    expect(enqueued).toEqual([
      {
        tenantId: "acme",
        messageId: "evt_assign-1:rule:Email%20assignees:email:support%40example.com"
      }
    ]);
  });

  it("does not enqueue queued email jobs for skipped recipients", async () => {
    const events = new InMemoryEventStore();
    const messages: EmailMessage[] = [];
    const emailNotifications = new EmailNotificationService({
      events,
      from: { email: "notifications@example.com" },
      sender: {
        async send(message) {
          messages.push(message);
          return {};
        }
      },
      notificationRules: {
        async notificationRulesFor() {
          return [
            {
              name: "Email assignees",
              events: ["DocumentAssigned"],
              recipients: [{ kind: "user", userId: "support-user" }],
              channels: ["email"]
            }
          ];
        }
      },
      recipients: { async emailForUser() { return undefined; } },
      ids: deterministicIds(["email-skipped-1"])
    });
    const enqueued: Array<{ readonly tenantId: string; readonly messageId: string }> = [];
    const hooks = createDocumentQueuedEmailNotificationHooks(emailNotifications, {
      async enqueue(tenantId, messageId) {
        enqueued.push({ tenantId, messageId });
      }
    });
    const services = createServices(["create-1", "assign-1"], {
      afterCommit: async (context) => {
        await hooks.afterCommit?.(context);
      }
    });

    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "Skipped Queue Hook" }) });
    await services.documents.assign({
      actor: owner,
      doctype: "Note",
      name: "Skipped Queue Hook",
      assignee: "support-user",
      expectedVersion: 1
    });

    expect(messages).toEqual([]);
    expect(enqueued).toEqual([]);
  });

  it("exposes a direct queued email hook for apps that assemble delivery hooks themselves", async () => {
    const events = new InMemoryEventStore();
    const emailNotifications = new EmailNotificationService({
      events,
      from: { email: "notifications@example.com" },
      sender: { async send() { return {}; } },
      notificationRules: {
        async notificationRulesFor() {
          return [
            {
              name: "Email assignees",
              events: ["DocumentAssigned"],
              recipients: [{ kind: "user", userId: "support@example.com" }],
              channels: ["email"]
            }
          ];
        }
      }
    });
    const enqueued: Array<{ readonly tenantId: string; readonly messageId: string }> = [];
    const hooks = createDocumentQueuedEmailNotificationHooks(emailNotifications, {
      async enqueue(tenantId, messageId) {
        enqueued.push({ tenantId, messageId });
      }
    });
    const services = createServices(["create-1", "assign-1"], {
      afterCommit: async (context) => {
        await hooks.afterCommit?.(context);
      }
    });

    await services.documents.create({ actor: owner, doctype: "Note", data: data({ title: "Direct Queue Hook" }) });
    await services.documents.assign({
      actor: owner,
      doctype: "Note",
      name: "Direct Queue Hook",
      assignee: "support@example.com",
      expectedVersion: 1
    });

    expect(enqueued).toEqual([
      {
        tenantId: "acme",
        messageId: "evt_assign-1:rule:Email%20assignees:email:support%40example.com"
      }
    ]);
  });
});
