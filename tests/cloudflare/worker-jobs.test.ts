import {
  createJobRegistry,
  deterministicIds,
  fixedClock,
  InMemoryJobExecutionLog,
  InMemoryJobQueue,
  type JobMessage,
  type JobQueue
} from "../../src";
import {
  createCloudFrappeWorker,
  type AggregateCoordinatorRpc,
  type CloudFrappeRuntimeServices,
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

function fakeNamespace(): RpcDurableObjectNamespace<AggregateCoordinatorRpc> {
  return {
    idFromName(name: string) {
      return name as unknown as DurableObjectId;
    },
    get() {
      return {
        transact() {
          throw new Error("Command path should not be used in this test");
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
  return {
    prepare(sql: string) {
      return {
        params: [] as unknown[],
        bind(...params: unknown[]) {
          this.params = params;
          return this;
        },
        async all() {
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
