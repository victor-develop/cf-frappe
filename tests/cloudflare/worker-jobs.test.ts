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
  return {
    prepare() {
      return {
        bind() {
          return this;
        },
        async all() {
          return { results: [] };
        },
        async first() {
          return null;
        },
        async run() {
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
