import {
  AUTOMATION_RUN_DRAIN_JOB_NAME,
  createAutomationRunDrainJob,
  createDocumentDeliveryOutboxDrainJob,
  type EmailNotificationService,
  createJobRegistry,
  createRegistry,
  deterministicIds,
  D1DocumentStore,
  D1EventStore,
  D1ProjectionStore,
  DocumentService,
  DocumentDeliveryOutboxService,
  DOCUMENT_DELIVERY_OUTBOX_DRAIN_JOB_NAME,
  defineDocType,
  fixedClock,
  InMemoryJobExecutionLog,
  InMemoryJobQueue,
  UserNotificationService,
  type JobMessage,
  type JobQueue,
  type ModelRegistry
} from "../../src";
import {
  createCloudFrappeWorker,
  type AggregateCoordinatorRpc,
  type CloudFrappeRuntimeServices,
  type RealtimeHubNamespace,
  type RpcDurableObjectNamespace
} from "../../src/cloudflare";
import { createTestRegistry, now, owner } from "../helpers";

describe("CloudFrappe Worker jobs", () => {
  it("dispatches configured scheduled jobs through the Worker handler", async () => {
    const queue = new InMemoryJobQueue();
    const noRetry = vi.fn();
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner,
      jobs: {
        registry: createJobRegistry<CloudFrappeRuntimeServices>({
          jobs: [{ name: "reports.daily", handler: () => undefined }]
        }),
        queue: () => queue,
        schedules: [{ cron: "0 2 * * *", jobName: "reports.daily" }],
        clock: fixedClock(now),
        ids: deterministicIds(["001"])
      }
    });

    await worker.scheduled?.(
      { cron: "0 2 * * *", scheduledTime: Date.parse("2026-01-01T02:00:00.000Z"), noRetry },
      { DB: fakeD1(), AGGREGATES: fakeNamespace() },
      fakeExecutionContext()
    );

    expect(noRetry).not.toHaveBeenCalled();
    expect(queue.queued()[0]?.message).toMatchObject({
      jobName: "reports.daily",
      runId: "job_001",
      idempotencyKey: "scheduled:0 2 * * *:1767232800000:reports.daily"
    });
  });

  it("does not retry permanently invalid scheduled jobs", async () => {
    const noRetry = vi.fn();
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner,
      jobs: {
        registry: createJobRegistry<CloudFrappeRuntimeServices>(),
        queue: () => new InMemoryJobQueue(),
        schedules: [{ cron: "0 2 * * *", jobName: "missing" }]
      }
    });

    await worker.scheduled?.(
      { cron: "0 2 * * *", scheduledTime: Date.parse("2026-01-01T02:00:00.000Z"), noRetry },
      { DB: fakeD1(), AGGREGATES: fakeNamespace() },
      fakeExecutionContext()
    );

    expect(noRetry).toHaveBeenCalledOnce();
  });

  it("does not retry disabled scheduled jobs", async () => {
    const noRetry = vi.fn();
    const queue = new InMemoryJobQueue();
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner,
      jobs: {
        registry: createJobRegistry<CloudFrappeRuntimeServices>({
          jobs: [{ name: "reports.daily", handler: () => undefined }]
        }),
        queue: () => queue,
        schedules: [{ cron: "0 2 * * *", jobName: "reports.daily", enabled: false }]
      }
    });

    await worker.scheduled?.(
      { cron: "0 2 * * *", scheduledTime: Date.parse("2026-01-01T02:00:00.000Z"), noRetry },
      { DB: fakeD1(), AGGREGATES: fakeNamespace() },
      fakeExecutionContext()
    );

    expect(noRetry).toHaveBeenCalledOnce();
    expect(queue.queued()).toEqual([]);
  });

  it("processes queue batches through configured worker pools", async () => {
    let serialRunning = 0;
    let fastRunning = 0;
    let maxSerialRunning = 0;
    let maxFastRunning = 0;
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner,
      jobs: {
        registry: createJobRegistry<CloudFrappeRuntimeServices>({
          workerPools: [
            { name: "serial", concurrency: 1 },
            { name: "fast", concurrency: 2 }
          ],
          jobs: [
            {
              name: "serial.job",
              pool: "serial",
              handler: async () => {
                serialRunning += 1;
                maxSerialRunning = Math.max(maxSerialRunning, serialRunning);
                await Promise.resolve();
                serialRunning -= 1;
              }
            },
            {
              name: "fast.job",
              pool: "fast",
              handler: async () => {
                fastRunning += 1;
                maxFastRunning = Math.max(maxFastRunning, fastRunning);
                await Promise.resolve();
                fastRunning -= 1;
              }
            }
          ]
        }),
        queue: () => new InMemoryJobQueue()
      }
    });
    const messages = [
      queueMessage("serial.job", "serial-1"),
      queueMessage("serial.job", "serial-2"),
      queueMessage("fast.job", "fast-1"),
      queueMessage("fast.job", "fast-2")
    ];

    await worker.queue?.(
      {
        queue: "jobs",
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        messages,
        retryAll: vi.fn(),
        ackAll: vi.fn()
      },
      { DB: fakeD1(), AGGREGATES: fakeNamespace() },
      fakeExecutionContext()
    );

    expect(maxSerialRunning).toBe(1);
    expect(maxFastRunning).toBe(2);
    expect(messages.map((message) => message.ack)).toEqual([
      expect.any(Function),
      expect.any(Function),
      expect.any(Function),
      expect.any(Function)
    ]);
    expect(messages.every((message) => vi.mocked(message.ack).mock.calls.length === 1)).toBe(true);
  });

  it("drains durable document delivery outbox records through the Worker queue path", async () => {
    const env = { DB: fakeD1(), AGGREGATES: fakeNamespace() };
    const events = new D1EventStore(env.DB);
    const outbox = new DocumentDeliveryOutboxService({
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["enqueue-notification"])
    });
    await outbox.enqueueFromDomainEvent({
      event: assignmentEvent(),
      snapshot: taskSnapshot(),
      targets: ["notification"]
    });
    const message = {
      tenantId: "acme",
      jobName: DOCUMENT_DELIVERY_OUTBOX_DRAIN_JOB_NAME,
      payload: { limit: 5, claimId: "claim-notification" },
      runId: "job_outbox_001",
      idempotencyKey: "document-delivery-outbox:job_outbox_001",
      enqueuedAt: now,
      metadata: {}
    };
    const queueMessage = {
      id: "msg_outbox_001",
      timestamp: new Date(now),
      body: message,
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn()
    } as unknown as Message<JobMessage>;
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner,
      documentDeliveryOutbox: {
        clock: fixedClock(now),
        ids: deterministicIds(["claim-event", "notification-recorded", "delivered-notification"])
      },
      jobs: {
        registry: createJobRegistry<CloudFrappeRuntimeServices>({
          jobs: [createDocumentDeliveryOutboxDrainJob<CloudFrappeRuntimeServices>()]
        }),
        queue: () => new InMemoryJobQueue()
      }
    });

    await worker.queue?.(
      {
        queue: "jobs",
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        messages: [queueMessage],
        retryAll: vi.fn(),
        ackAll: vi.fn()
      },
      env,
      fakeExecutionContext()
    );

    expect(queueMessage.ack).toHaveBeenCalledOnce();
    expect(queueMessage.retry).not.toHaveBeenCalled();
    await expect(outbox.list("acme")).resolves.toMatchObject([
      { id: "evt_assign:notification", status: "delivered", claimId: "claim-notification" }
    ]);
    await expect(
      new UserNotificationService({ events }).inbox(
        { id: "support@example.com", roles: ["User"], tenantId: "acme" },
        { includeDismissed: true }
      )
    ).resolves.toMatchObject({
      notifications: [
        {
          id: "evt_assign:user:support%40example.com",
          sourceEventId: "evt_assign",
          payloadKind: "DocumentAssigned"
        }
      ]
    });
  });

  it("drains durable realtime outbox records through the Worker queue path", async () => {
    const env = { DB: fakeD1(), AGGREGATES: fakeNamespace(), REALTIME: fakeRealtimeNamespace() };
    const events = new D1EventStore(env.DB);
    const outbox = new DocumentDeliveryOutboxService({
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["enqueue-realtime"])
    });
    await outbox.enqueueFromDomainEvent({
      event: assignmentEvent(),
      snapshot: taskSnapshot(),
      targets: ["realtime"]
    });
    const message = {
      tenantId: "acme",
      jobName: DOCUMENT_DELIVERY_OUTBOX_DRAIN_JOB_NAME,
      payload: { limit: 5, claimId: "claim-realtime" },
      runId: "job_outbox_realtime",
      idempotencyKey: "document-delivery-outbox:job_outbox_realtime",
      enqueuedAt: now,
      metadata: {}
    };
    const queueMessage = {
      id: "msg_outbox_realtime",
      timestamp: new Date(now),
      body: message,
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn()
    } as unknown as Message<JobMessage>;
    const worker = createCloudFrappeWorker<typeof env>({
      registry: createTestRegistry(),
      actor: () => owner,
      documentDeliveryOutbox: {
        clock: fixedClock(now),
        ids: deterministicIds(["claim-event", "delivered-realtime"])
      },
      realtime: {
        namespace: (runtimeEnv) => runtimeEnv.REALTIME
      },
      jobs: {
        registry: createJobRegistry<CloudFrappeRuntimeServices>({
          jobs: [createDocumentDeliveryOutboxDrainJob<CloudFrappeRuntimeServices>()]
        }),
        queue: () => new InMemoryJobQueue()
      }
    });

    await worker.queue?.(
      {
        queue: "jobs",
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        messages: [queueMessage],
        retryAll: vi.fn(),
        ackAll: vi.fn()
      },
      env,
      fakeExecutionContext()
    );

    expect(queueMessage.ack).toHaveBeenCalledOnce();
    expect(queueMessage.retry).not.toHaveBeenCalled();
    await expect(outbox.list("acme")).resolves.toMatchObject([
      { id: "evt_assign:realtime", status: "delivered", claimId: "claim-realtime" }
    ]);
    expect(env.REALTIME.published).toEqual([
      expect.objectContaining({
        topic: "tenant:acme",
        event: expect.objectContaining({ id: "evt_assign", type: "NoteAssigned" })
      }),
      expect.objectContaining({
        topic: "doctype:acme:Note",
        event: expect.objectContaining({ id: "evt_assign", type: "NoteAssigned" })
      }),
      expect.objectContaining({
        topic: "document:acme:Note:Review",
        event: expect.objectContaining({ id: "evt_assign", type: "NoteAssigned" })
      }),
      expect.objectContaining({
        topic: "user:acme:support%40example.com",
        event: expect.objectContaining({ id: "evt_assign:user:support%40example.com", type: "NoteAssigned" })
      })
    ]);
  });

  it("queues durable email outbox deliveries through the Worker queue path", async () => {
    const env = { DB: fakeD1(), AGGREGATES: fakeNamespace() };
    const events = new D1EventStore(env.DB);
    const outbox = new DocumentDeliveryOutboxService({
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["enqueue-email"])
    });
    await outbox.enqueueFromDomainEvent({
      event: assignmentEvent(),
      snapshot: taskSnapshot(),
      targets: ["email"]
    });
    const queuedEmailMessages: Array<{
      readonly tenantId: string;
      readonly messageId: string;
      readonly metadata?: Record<string, unknown>;
    }> = [];
    const message = {
      tenantId: "acme",
      jobName: DOCUMENT_DELIVERY_OUTBOX_DRAIN_JOB_NAME,
      payload: { limit: 5, claimId: "claim-email" },
      runId: "job_outbox_email",
      idempotencyKey: "document-delivery-outbox:job_outbox_email",
      enqueuedAt: now,
      metadata: {}
    };
    const queueMessage = {
      id: "msg_outbox_email",
      timestamp: new Date(now),
      body: message,
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn()
    } as unknown as Message<JobMessage>;
    const worker = createCloudFrappeWorker<typeof env>({
      registry: createTestRegistry(),
      actor: () => owner,
      documentDeliveryOutbox: {
        clock: fixedClock(now),
        ids: deterministicIds(["claim-event", "delivered-email"]),
        emailNotifications: () => ({
          async sendFromDomainEvent() {
            throw new Error("email should be queued by the Worker drain path");
          },
          async queueFromDomainEvent() {
            return [
              {
                status: "queued",
                messageId: "evt_assign:rule:Email%20assignees:email:support%40example.com",
                ruleName: "Email assignees",
                recipientId: "support@example.com"
              }
            ];
          }
        }) as unknown as EmailNotificationService,
        emailNotificationDeliveryQueue: () => ({
          async enqueue(tenantId, messageId, options) {
            queuedEmailMessages.push({
              tenantId,
              messageId,
              ...(options?.metadata === undefined ? {} : { metadata: options.metadata })
            });
          }
        })
      },
      jobs: {
        registry: createJobRegistry<CloudFrappeRuntimeServices>({
          jobs: [createDocumentDeliveryOutboxDrainJob<CloudFrappeRuntimeServices>()]
        }),
        queue: () => new InMemoryJobQueue()
      }
    });

    await worker.queue?.(
      {
        queue: "jobs",
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        messages: [queueMessage],
        retryAll: vi.fn(),
        ackAll: vi.fn()
      },
      env,
      fakeExecutionContext()
    );

    expect(queueMessage.ack).toHaveBeenCalledOnce();
    expect(queueMessage.retry).not.toHaveBeenCalled();
    await expect(outbox.list("acme")).resolves.toMatchObject([
      { id: "evt_assign:email", status: "delivered", claimId: "claim-email" }
    ]);
    expect(queuedEmailMessages).toEqual([
      {
        tenantId: "acme",
        messageId: "evt_assign:rule:Email%20assignees:email:support%40example.com",
        metadata: {
          sourceEventId: "evt_assign",
          sourceEventType: "NoteAssigned",
          sourcePayloadKind: "DocumentAssigned",
          ruleName: "Email assignees",
          recipientId: "support@example.com"
        }
      }
    ]);
  });

  it("drains durable automation runs through the Worker queue path", async () => {
    const registry = automationRegistry();
    const env = {
      DB: fakeD1(),
      AGGREGATES: undefined as unknown as RpcDurableObjectNamespace<AggregateCoordinatorRpc>
    };
    env.AGGREGATES = executingNamespace(
      registry,
      env,
      deterministicIds(["target-create", "source-create", "source-update", "automation-enqueue", "target-update"])
    );
    const worker = createCloudFrappeWorker<typeof env>({
      registry,
      actor: () => owner,
      jobs: {
        registry: createJobRegistry<CloudFrappeRuntimeServices>({
          jobs: [createAutomationRunDrainJob<CloudFrappeRuntimeServices>()]
        }),
        queue: () => new InMemoryJobQueue()
      }
    });
    const fetch = worker.fetch!;

    const target = await fetch(cfRequest("http://localhost/api/resource/Target", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Target One" })
    }), env, fakeExecutionContext());
    const source = await fetch(cfRequest("http://localhost/api/resource/Source", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Source One", target: "Target One", status: "Open" })
    }), env, fakeExecutionContext());
    const update = await fetch(cfRequest("http://localhost/api/resource/Source/Source%20One", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "Done", expectedVersion: 1 })
    }), env, fakeExecutionContext());

    expect(target.status).toBe(201);
    expect(source.status).toBe(201);
    expect(update.status).toBe(200);
    const projections = new D1ProjectionStore(env.DB);
    await expect(projections.get("acme", "__AutomationRuns", "evt_source-update:Mirror Status:0")).resolves.toMatchObject({
      data: { status: "pending", sourceDoctype: "Source", sourceDocumentName: "Source One" }
    });

    const queueMessage = {
      id: "msg_automation_001",
      timestamp: new Date(now),
      body: {
        tenantId: "acme",
        jobName: AUTOMATION_RUN_DRAIN_JOB_NAME,
        payload: { limit: 5, claimId: "claim-automation" },
        runId: "job_automation_001",
        idempotencyKey: "automation-runs:job_automation_001",
        enqueuedAt: now,
        metadata: {}
      },
      attempts: 1,
      ack: vi.fn(),
      retry: vi.fn()
    } as unknown as Message<JobMessage>;

    await worker.queue?.(
      {
        queue: "jobs",
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        messages: [queueMessage],
        retryAll: vi.fn(),
        ackAll: vi.fn()
      },
      env,
      fakeExecutionContext()
    );

    expect(queueMessage.ack).toHaveBeenCalledOnce();
    expect(queueMessage.retry).not.toHaveBeenCalled();
    await expect(projections.get("acme", "__AutomationRuns", "evt_source-update:Mirror Status:0")).resolves.toMatchObject({
      data: { status: "delivered", claimId: "claim-automation" }
    });
    await expect(projections.get("acme", "Target", "Target One")).resolves.toMatchObject({
      version: 2,
      data: {
        title: "Target One",
        mirrored_status: "Done",
        source_name: "Source One"
      }
    });
  });

  it("retries failed durable outbox records through later Worker queue drains", async () => {
    let currentTime = now;
    let failDelivery = true;
    const retryAt = "2026-01-01T00:01:00.000Z";
    const clock = { now: () => currentTime };
    const env = { DB: fakeD1(), AGGREGATES: fakeNamespace() };
    const events = new D1EventStore(env.DB);
    const outbox = new DocumentDeliveryOutboxService({
      events,
      clock: fixedClock(now),
      ids: deterministicIds(["enqueue-email"])
    });
    await outbox.enqueueFromDomainEvent({
      event: assignmentEvent(),
      snapshot: taskSnapshot(),
      targets: ["email"]
    });
    const worker = createCloudFrappeWorker<typeof env>({
      registry: createTestRegistry(),
      actor: () => owner,
      documentDeliveryOutbox: {
        clock,
        retry: { baseDelaySeconds: 60, maxDelaySeconds: 60 },
        ids: deterministicIds(["claim-1", "fail-1", "claim-2", "deliver-2"]),
        emailNotifications: () => ({
          async sendFromDomainEvent() {
            if (failDelivery) {
              throw new Error("email provider unavailable");
            }
          }
        }) as unknown as EmailNotificationService
      },
      jobs: {
        registry: createJobRegistry<CloudFrappeRuntimeServices>({
          jobs: [createDocumentDeliveryOutboxDrainJob<CloudFrappeRuntimeServices>()]
        }),
        queue: () => new InMemoryJobQueue()
      }
    });
    const firstDrain = queueMessageForOutboxDrain("msg_outbox_retry_1", "claim-email-1");

    await worker.queue?.(
      {
        queue: "jobs",
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        messages: [firstDrain],
        retryAll: vi.fn(),
        ackAll: vi.fn()
      },
      env,
      fakeExecutionContext()
    );

    expect(firstDrain.ack).toHaveBeenCalledOnce();
    expect(firstDrain.retry).not.toHaveBeenCalled();
    await expect(outbox.list("acme")).resolves.toMatchObject([
      {
        id: "evt_assign:email",
        status: "failed",
        claimId: "claim-email-1",
        retryAt,
        attempts: 1,
        error: "email provider unavailable"
      }
    ]);

    failDelivery = false;
    currentTime = "2026-01-01T00:00:30.000Z";
    const earlyDrain = queueMessageForOutboxDrain("msg_outbox_retry_early", "claim-email-early");
    await worker.queue?.(
      {
        queue: "jobs",
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        messages: [earlyDrain],
        retryAll: vi.fn(),
        ackAll: vi.fn()
      },
      env,
      fakeExecutionContext()
    );
    expect(earlyDrain.ack).toHaveBeenCalledOnce();
    await expect(outbox.list("acme")).resolves.toMatchObject([
      { id: "evt_assign:email", status: "failed", retryAt, attempts: 1 }
    ]);

    currentTime = retryAt;
    const retryDrain = queueMessageForOutboxDrain("msg_outbox_retry_2", "claim-email-2");
    await worker.queue?.(
      {
        queue: "jobs",
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        messages: [retryDrain],
        retryAll: vi.fn(),
        ackAll: vi.fn()
      },
      env,
      fakeExecutionContext()
    );

    expect(retryDrain.ack).toHaveBeenCalledOnce();
    expect(retryDrain.retry).not.toHaveBeenCalled();
    await expect(outbox.list("acme")).resolves.toMatchObject([
      { id: "evt_assign:email", status: "delivered", claimId: "claim-email-2", attempts: 2 }
    ]);
  });

  it("allows transient scheduled dispatch failures to retry", async () => {
    const noRetry = vi.fn();
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner,
      jobs: {
        registry: createJobRegistry<CloudFrappeRuntimeServices>({
          jobs: [{ name: "reports.daily", handler: () => undefined }]
        }),
        queue: (): JobQueue => ({
          async send() {
            throw new Error("queue unavailable");
          }
        }),
        schedules: [{ cron: "0 2 * * *", jobName: "reports.daily" }]
      }
    });

    await expect(
      worker.scheduled?.(
        { cron: "0 2 * * *", scheduledTime: Date.parse("2026-01-01T02:00:00.000Z"), noRetry },
        { DB: fakeD1(), AGGREGATES: fakeNamespace() },
        fakeExecutionContext()
      )
    ).rejects.toThrow("queue unavailable");
    expect(noRetry).not.toHaveBeenCalled();
  });

  it("exposes configured schedules for admin inspection and manual dispatch", async () => {
    const queue = new InMemoryJobQueue();
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => ({ id: "admin@example.com", roles: ["System Manager"], tenantId: "acme" }),
      jobs: {
        registry: createJobRegistry<CloudFrappeRuntimeServices>({
          jobs: [{ name: "reports.daily", description: "Build reports", handler: () => undefined }]
        }),
        queue: () => queue,
        schedules: [{ cron: "0 2 * * *", jobName: "reports.daily", tenantId: "acme" }],
        clock: fixedClock(now),
        ids: deterministicIds(["manual-001"])
      }
    });
    const env = { DB: fakeD1(), AGGREGATES: fakeNamespace() };

    const list = await worker.fetch!(
      cfRequest("http://localhost/api/jobs/schedules?job=reports.daily"),
      env,
      fakeExecutionContext()
    );

    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      data: {
        schedules: [
          {
            id: "1",
            cron: "0 2 * * *",
            jobName: "reports.daily",
            tenantId: "acme",
            registered: true
          }
        ]
      }
    });

    const run = await worker.fetch!(
      cfRequest("http://localhost/api/jobs/schedules/1/run", { method: "POST" }),
      env,
      fakeExecutionContext()
    );

    expect(run.status).toBe(201);
    expect(queue.queued()[0]?.message).toMatchObject({
      tenantId: "acme",
      runId: "job_manual-001",
      idempotencyKey: `manual:0 2 * * *:${Date.parse(now)}:reports.daily`,
      metadata: {
        dispatchSource: "manual",
        dispatchedBy: "admin@example.com",
        dispatchedAt: now
      }
    });
  });

  it("exposes and dispatches runtime-only schedules when their cron trigger is configured", async () => {
    const queue = new InMemoryJobQueue();
    const noRetry = vi.fn();
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => ({ id: "admin@example.com", roles: ["System Manager"], tenantId: "acme" }),
      jobs: {
        registry: createJobRegistry<CloudFrappeRuntimeServices>({
          jobs: [{ name: "reports.daily", description: "Build reports", handler: () => undefined }]
        }),
        queue: () => queue,
        schedules: [],
        cronTriggers: ["15 4 * * *"],
        clock: fixedClock(now),
        ids: deterministicIds(["save-runtime", "manual-001", "cron-001"])
      }
    });
    const env = { DB: fakeD1(), AGGREGATES: fakeNamespace() };

    const rejected = await worker.fetch!(
      cfRequest("http://localhost/api/jobs/schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "runtime-hourly", cron: "0 * * * *", jobName: "reports.daily" })
      }),
      env,
      fakeExecutionContext()
    );
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toMatchObject({
      error: { message: "Job schedule cron '0 * * * *' is not configured as a Worker Cron Trigger" }
    });

    const created = await worker.fetch!(
      cfRequest("http://localhost/api/jobs/schedules", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: "runtime-daily",
          cron: "15 4 * * *",
          jobName: "reports.daily",
          payload: { source: "runtime" }
        })
      }),
      env,
      fakeExecutionContext()
    );
    expect(created.status).toBe(201);

    const list = await worker.fetch!(
      cfRequest("http://localhost/api/jobs/schedules"),
      env,
      fakeExecutionContext()
    );
    await expect(list.json()).resolves.toMatchObject({
      data: {
        schedules: [
          {
            id: "runtime-daily",
            source: "runtime",
            editable: true,
            cron: "15 4 * * *",
            jobName: "reports.daily",
            tenantId: "acme",
            dispatchable: true
          }
        ]
      }
    });

    const run = await worker.fetch!(
      cfRequest("http://localhost/api/jobs/schedules/runtime-daily/run", { method: "POST" }),
      env,
      fakeExecutionContext()
    );
    expect(run.status).toBe(201);
    expect(queue.queued()[0]?.message).toMatchObject({
      tenantId: "acme",
      runId: "job_manual-001",
      payload: { source: "runtime" },
      idempotencyKey: `manual:15 4 * * *:${Date.parse(now)}:reports.daily`
    });

    await worker.scheduled?.(
      { cron: "15 4 * * *", scheduledTime: Date.parse("2026-01-01T04:15:00.000Z"), noRetry },
      env,
      fakeExecutionContext()
    );

    expect(noRetry).not.toHaveBeenCalled();
    expect(queue.queued()[1]?.message).toMatchObject({
      tenantId: "acme",
      runId: "job_cron-001",
      payload: { source: "runtime" },
      idempotencyKey: "scheduled:15 4 * * *:1767240900000:reports.daily"
    });
  });

  it("shares configured job execution history with the Desk admin surface", async () => {
    const executionLog = new InMemoryJobExecutionLog();
    const queue = new InMemoryJobQueue();
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => ({ id: "admin@example.com", roles: ["System Manager"], tenantId: "acme" }),
      jobs: {
        registry: createJobRegistry<CloudFrappeRuntimeServices>({
          jobs: [{ name: "reports.daily", handler: () => "done" }]
        }),
        queue: () => queue,
        executionLog: () => executionLog,
        clock: fixedClock(now),
        ids: deterministicIds(["retry-001"])
      }
    });
    const env = { DB: fakeD1(), AGGREGATES: fakeNamespace() };
    const message = {
      tenantId: "acme",
      jobName: "reports.daily",
      payload: {},
      runId: "job_001",
      idempotencyKey: "reports.daily:job_001",
      enqueuedAt: now,
      metadata: {}
    };

    await worker.queue?.(
      {
        queue: "jobs",
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
        messages: [
          {
            id: "msg_001",
            timestamp: new Date(now),
            body: message,
            attempts: 1,
            ack: vi.fn(),
            retry: vi.fn()
          } as unknown as Message<JobMessage>
        ],
        retryAll: vi.fn(),
        ackAll: vi.fn()
      },
      env,
      fakeExecutionContext()
    );
    const response = await worker.fetch!(
      cfRequest("http://localhost/desk/admin/jobs?status=succeeded"),
      env,
      fakeExecutionContext()
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("reports.daily:job_001");
    expect(html).toContain("succeeded");

    const failedMessage = {
      ...message,
      runId: "job_002",
      idempotencyKey: "reports.daily:job_002"
    };
    await executionLog.begin(failedMessage, "2026-01-01T00:02:00.000Z");
    await executionLog.fail(failedMessage, "2026-01-01T00:03:00.000Z", "down");

    const retried = await worker.fetch!(
      cfRequest("http://localhost/api/jobs/executions/reports.daily%3Ajob_002/retry", { method: "POST" }),
      env,
      fakeExecutionContext()
    );

    expect(retried.status).toBe(201);
    expect(queue.queued().at(-1)?.message).toMatchObject({
      tenantId: "acme",
      runId: "job_retry-001",
      idempotencyKey: "reports.daily:job_002"
    });
  });
});

function queueMessage(jobName: string, id: string): Message<JobMessage> {
  return {
    id,
    timestamp: new Date(now),
    body: {
      tenantId: "acme",
      jobName,
      payload: {},
      runId: `job_${id}`,
      idempotencyKey: `${jobName}:${id}`,
      enqueuedAt: now,
      metadata: {}
    },
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn()
  } as unknown as Message<JobMessage>;
}

function assignmentEvent() {
  return {
    id: "evt_assign",
    tenantId: "acme",
    stream: "acme:Note:Review",
    sequence: 1,
    type: "NoteAssigned",
    doctype: "Note",
    documentName: "Review",
    actorId: "owner@example.com",
    occurredAt: now,
    payload: { kind: "DocumentAssigned", assigneeId: "support@example.com" },
    metadata: {}
  } as const;
}

function taskSnapshot() {
  return {
    tenantId: "acme",
    doctype: "Note",
    name: "Review",
    version: 1,
    docstatus: "draft",
    data: { title: "Review" },
    createdAt: now,
    updatedAt: now
  } as const;
}

function queueMessageForOutboxDrain(messageId: string, claimId: string): Message<JobMessage> {
  return {
    id: messageId,
    timestamp: new Date(now),
    body: {
      tenantId: "acme",
      jobName: DOCUMENT_DELIVERY_OUTBOX_DRAIN_JOB_NAME,
      payload: { limit: 5, claimId },
      runId: `job_${messageId}`,
      idempotencyKey: `document-delivery-outbox:${messageId}`,
      enqueuedAt: now,
      metadata: {}
    },
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn()
  } as unknown as Message<JobMessage>;
}

function automationRegistry(): ModelRegistry {
  const Target = defineDocType({
    name: "Target",
    naming: { kind: "field", field: "title" },
    fields: [
      { name: "title", type: "text", required: true },
      { name: "mirrored_status", type: "text" },
      { name: "source_name", type: "text" }
    ],
    permissions: [{ roles: ["User"], actions: ["read", "create", "update"] }]
  });
  const Source = defineDocType({
    name: "Source",
    naming: { kind: "field", field: "title" },
    fields: [
      { name: "title", type: "text", required: true },
      { name: "target", type: "link", linkTo: "Target" },
      { name: "status", type: "select", options: ["Open", "Done"] }
    ],
    automationRules: [{
      name: "Mirror Status",
      events: ["DocumentUpdated"],
      changedFields: ["status"],
      actions: [{
        kind: "updateDocument",
        target: { doctype: "Target", name: { kind: "field", field: "target" } },
        patch: {
          mirrored_status: { kind: "field", field: "status" },
          source_name: { kind: "documentName" }
        }
      }]
    }],
    permissions: [{ roles: ["User"], actions: ["read", "create", "update"] }]
  });
  return createRegistry({ doctypes: [Target, Source] });
}

function executingNamespace(
  registry: ModelRegistry,
  env: { readonly DB: D1Database },
  ids: ReturnType<typeof deterministicIds>
): RpcDurableObjectNamespace<AggregateCoordinatorRpc> {
  const documents = new DocumentService({
    registry,
    store: new D1DocumentStore(env.DB),
    clock: fixedClock(now),
    ids
  });
  return {
    idFromName(name: string) {
      return name as unknown as DurableObjectId;
    },
    get() {
      const stub = {
        async transact(command: any) {
          switch (command.kind) {
            case "create":
              return documents.create(command);
            case "update":
              return documents.update(command);
            default:
              throw new Error(`Unsupported test aggregate command '${String(command.kind)}'`);
          }
        },
        async tryTransact(command: any) {
          try {
            return { ok: true, snapshot: await stub.transact(command) };
          } catch (error) {
            return { ok: false, failure: { name: command.name ?? "", error: String(error) } };
          }
        }
      };
      return stub as AggregateCoordinatorRpc;
    }
  };
}

function fakeNamespace(): RpcDurableObjectNamespace<AggregateCoordinatorRpc> {
  return {
    idFromName(name: string) {
      return name as unknown as DurableObjectId;
    },
    get() {
      return {
        transact() {
          throw new Error("Command path should not be used in this test");
        },
        tryTransact() {
          throw new Error("Command path should not be used in this test");
        }
      };
    }
  };
}

function fakeRealtimeNamespace(): RealtimeHubNamespace & {
  readonly published: Array<{ readonly topic: string; readonly event: { readonly id: string; readonly type: string } }>;
} {
  const published: Array<{ readonly topic: string; readonly event: { readonly id: string; readonly type: string } }> = [];
  return {
    published,
    idFromName(name: string) {
      return name as unknown as DurableObjectId;
    },
    get() {
      return {
        async publish(topic, event) {
          published.push({ topic, event });
          return 1;
        },
        async presence() {
          return { topic: "", connections: [] };
        },
        async replay() {
          return { topic: "", events: [], nextCursor: null };
        },
        async fetch() {
          return new Response(null, { status: 101 });
        }
      };
    }
  };
}

function fakeD1(): D1Database {
  const events: Array<{
    readonly id: string;
    readonly tenant_id: string;
    readonly stream: string;
    readonly sequence: number;
    readonly type: string;
    readonly doctype: string;
    readonly document_name: string;
    readonly actor_id: string;
    readonly occurred_at: string;
    readonly payload_json: string;
    readonly metadata_json: string;
  }> = [];
  const documents = new Map<string, {
    readonly tenant_id: string;
    readonly doctype: string;
    readonly name: string;
    readonly version: number;
    readonly docstatus: string;
    readonly data_json: string;
    readonly created_at: string;
    readonly updated_at: string;
  }>();
  const automationRuns = new Map<string, {
    readonly tenant_id: string;
    readonly run_id: string;
    readonly status: string;
    readonly available_at: string | null;
    readonly enqueued_at: string;
    readonly updated_at: string;
  }>();
  return {
    prepare(sql: string) {
      return {
        params: [] as unknown[],
        bind(...params: unknown[]) {
          this.params = params;
          return this;
        },
        async all() {
          if (sql.includes("FROM cf_frappe_automation_runs")) {
            const tenantId = String(this.params[0] ?? "");
            const nowValue = String(this.params[1] ?? "");
            const limit = Number(this.params[2] ?? 50);
            const due = [...automationRuns.values()]
              .filter((run) => run.tenant_id === tenantId)
              .filter((run) => ["pending", "failed", "claimed"].includes(run.status))
              .filter((run) => run.available_at !== null && run.available_at <= nowValue)
              .sort((left, right) =>
                left.enqueued_at.localeCompare(right.enqueued_at) || left.run_id.localeCompare(right.run_id)
              )
              .slice(0, limit);
            return {
              results: due
                .map((run) => documents.get(`${run.tenant_id}:__AutomationRuns:${run.run_id}`))
                .filter((document) => document !== undefined)
            };
          }
          if (sql.includes("FROM cf_frappe_events")) {
            const stream = String(this.params[0] ?? "");
            const maxSequence = sql.includes("sequence <= ?") ? Number(this.params[1]) : undefined;
            const limit = sql.includes("LIMIT ?") ? Number(this.params.at(-1)) : undefined;
            const ordered = events
              .filter((event) => event.stream === stream)
              .filter((event) => maxSequence === undefined || event.sequence <= maxSequence)
              .sort((left, right) =>
                sql.includes("ORDER BY sequence DESC")
                  ? right.sequence - left.sequence
                  : left.sequence - right.sequence
              );
            return { results: limit === undefined ? ordered : ordered.slice(0, limit) };
          }
          return { results: [] };
        },
        async first() {
          if (sql.includes("COALESCE(MAX(sequence), 0)")) {
            const stream = String(this.params[0] ?? "");
            return {
              version: events
                .filter((event) => event.stream === stream)
              .reduce((version, event) => Math.max(version, event.sequence), 0)
            };
          }
          if (sql.includes("FROM cf_frappe_documents")) {
            const tenantId = String(this.params[0] ?? "");
            const doctype = String(this.params[1] ?? "");
            const name = String(this.params[2] ?? "");
            return documents.get(`${tenantId}:${doctype}:${name}`) ?? null;
          }
          return null;
        },
        async run() {
          if (sql.includes("INSERT INTO cf_frappe_events")) {
            const [
              id,
              tenantId,
              stream,
              sequence,
              type,
              doctype,
              documentName,
              actorId,
              occurredAt,
              payloadJson,
              metadataJson
            ] = this.params;
            events.push({
              id: String(id),
              tenant_id: String(tenantId),
              stream: String(stream),
              sequence: Number(sequence),
              type: String(type),
              doctype: String(doctype),
              document_name: String(documentName),
              actor_id: String(actorId),
              occurred_at: String(occurredAt),
              payload_json: String(payloadJson),
              metadata_json: String(metadataJson)
            });
          }
          if (sql.includes("INSERT INTO cf_frappe_documents")) {
            const [tenantId, doctype, name, version, docstatus, dataJson, createdAt, updatedAt] = this.params;
            documents.set(`${tenantId}:${doctype}:${name}`, {
              tenant_id: String(tenantId),
              doctype: String(doctype),
              name: String(name),
              version: Number(version),
              docstatus: String(docstatus),
              data_json: String(dataJson),
              created_at: String(createdAt),
              updated_at: String(updatedAt)
            });
          }
          if (sql.includes("INSERT INTO cf_frappe_automation_runs")) {
            const [tenantId, runId, status, availableAt, enqueuedAt, updatedAt] = this.params;
            automationRuns.set(`${tenantId}:${runId}`, {
              tenant_id: String(tenantId),
              run_id: String(runId),
              status: String(status),
              available_at: availableAt === null ? null : String(availableAt),
              enqueued_at: String(enqueuedAt),
              updated_at: String(updatedAt)
            });
          }
          return { success: true };
        }
      };
    },
    async batch(statements: any[]) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    dump() {
      throw new Error("Not implemented");
    },
    exec() {
      throw new Error("Not implemented");
    },
    withSession() {
      throw new Error("Not implemented");
    }
  } as unknown as D1Database;
}

function cfRequest(url: string, init?: RequestInit): Parameters<NonNullable<ReturnType<typeof createCloudFrappeWorker>["fetch"]>>[0] {
  return new Request(url, init) as unknown as Parameters<NonNullable<ReturnType<typeof createCloudFrappeWorker>["fetch"]>>[0];
}

function fakeExecutionContext(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {}
  } as unknown as ExecutionContext;
}
