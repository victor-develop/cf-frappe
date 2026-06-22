import {
  createJobRegistry,
  deterministicIds,
  fixedClock,
  InMemoryJobQueue,
  JobDispatcher
} from "../../src";
import { dispatchScheduledJob, dispatchScheduledJobs } from "../../src/cloudflare";
import { now } from "../helpers";

describe("dispatchScheduledJobs", () => {
  it("dispatches matching cron schedules with stable idempotency keys", async () => {
    const queue = new InMemoryJobQueue();
    const dispatcher = new JobDispatcher({
      registry: createJobRegistry({ jobs: [{ name: "reports.daily", handler: () => undefined }] }),
      queue,
      clock: fixedClock(now),
      ids: deterministicIds(["001"])
    });
    const scheduledTime = Date.parse("2026-01-01T02:00:00.000Z");
    const controller = scheduledController("0 2 * * *", scheduledTime);

    const messages = await dispatchScheduledJobs({
      controller,
      env: { region: "test" },
      dispatcher,
      schedules: [
        {
          cron: "0 2 * * *",
          jobName: "reports.daily",
          payload: ({ scheduledAt }) => ({ scheduledAt }),
          metadata: { source: "cron" }
        }
      ]
    });

    expect(messages).toHaveLength(1);
    expect(queue.queued()[0]?.message).toMatchObject({
      jobName: "reports.daily",
      runId: "job_001",
      idempotencyKey: `scheduled:0 2 * * *:${scheduledTime}:reports.daily`,
      payload: { scheduledAt: "2026-01-01T02:00:00.000Z" },
      metadata: {
        cron: "0 2 * * *",
        scheduledTime,
        scheduledAt: "2026-01-01T02:00:00.000Z",
        dispatchSource: "scheduled",
        source: "cron"
      }
    });
  });

  it("ignores unmatched cron expressions", async () => {
    const queue = new InMemoryJobQueue();
    const dispatcher = new JobDispatcher({
      registry: createJobRegistry({ jobs: [{ name: "reports.daily", handler: () => undefined }] }),
      queue,
      clock: fixedClock(now),
      ids: deterministicIds(["001"])
    });

    await expect(
      dispatchScheduledJobs({
        controller: scheduledController("*/5 * * * *", 1_767_228_400_000),
        env: {},
        dispatcher,
        schedules: [{ cron: "0 2 * * *", jobName: "reports.daily" }]
      })
    ).resolves.toEqual([]);
    expect(queue.queued()).toEqual([]);
  });

  it("dispatches a single schedule with manual idempotency and metadata", async () => {
    const queue = new InMemoryJobQueue();
    const dispatcher = new JobDispatcher({
      registry: createJobRegistry({ jobs: [{ name: "reports.daily", handler: () => undefined }] }),
      queue,
      clock: fixedClock(now),
      ids: deterministicIds(["manual-001"])
    });
    const scheduledTime = Date.parse(now);

    const message = await dispatchScheduledJob({
      cron: "0 2 * * *",
      scheduledTime,
      env: { region: "test" },
      dispatcher,
      schedule: {
        cron: "0 2 * * *",
        jobName: "reports.daily",
        tenantId: "acme",
        metadata: {
          cron: "spoofed",
          scheduledTime: 1,
          scheduledAt: "spoofed",
          dispatchSource: "spoofed",
          source: "cron"
        }
      },
      idempotencyPrefix: "manual",
      metadata: {
        cron: "still-spoofed",
        dispatchSource: "manual",
        dispatchedBy: "admin@example.com",
        dispatchedAt: now
      }
    });

    expect(message).toMatchObject({
      tenantId: "acme",
      runId: "job_manual-001",
      idempotencyKey: `manual:0 2 * * *:${scheduledTime}:reports.daily`,
      metadata: {
        cron: "0 2 * * *",
        scheduledTime,
        scheduledAt: now,
        dispatchSource: "manual",
        source: "cron",
        dispatchedBy: "admin@example.com",
        dispatchedAt: now
      }
    });
  });
});

function scheduledController(cron: string, scheduledTime: number): ScheduledController {
  return {
    cron,
    scheduledTime,
    noRetry() {}
  };
}
