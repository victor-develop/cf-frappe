import {
  createCloudFrappeWorker,
  createJobRegistry,
  deterministicIds,
  fixedClock,
  InMemoryJobQueue,
  type AggregateCoordinatorRpc,
  type CloudFrappeRuntimeServices,
  type JobQueue,
  type RpcDurableObjectNamespace
} from "../../src";
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

function fakeExecutionContext(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {}
  } as unknown as ExecutionContext;
}
