import {
  createJobRegistry,
  deterministicIds,
  dispatchScheduledJobs,
  fixedClock,
  InMemoryJobQueue,
  JobDispatcher
} from "../../src";
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
});

function scheduledController(cron: string, scheduledTime: number): ScheduledController {
  return {
    cron,
    scheduledTime,
    noRetry() {}
  };
}
