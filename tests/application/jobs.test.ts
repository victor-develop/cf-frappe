import {
  badRequest,
  classifyJobError,
  createJobRegistry,
  deterministicIds,
  fixedClock,
  InMemoryJobExecutionLog,
  InMemoryJobQueue,
  JobDispatcher,
  JobExecutor,
  permanentJobError,
  retryableJobError
} from "../../src";
import { now } from "../helpers";

describe("JobDispatcher", () => {
  it("creates deterministic queue envelopes", async () => {
    const queue = new InMemoryJobQueue();
    const dispatcher = new JobDispatcher({
      registry: createJobRegistry({
        jobs: [{ name: "email.digest", handler: () => undefined }]
      }),
      queue,
      clock: fixedClock(now),
      ids: deterministicIds(["001"])
    });

    const message = await dispatcher.dispatch({
      jobName: "email.digest",
      payload: { account: "acme" },
      metadata: { source: "test" },
      delaySeconds: 90
    });

    expect(message).toEqual({
      jobName: "email.digest",
      payload: { account: "acme" },
      runId: "job_001",
      idempotencyKey: "email.digest:job_001",
      enqueuedAt: now,
      metadata: { source: "test" }
    });
    expect(queue.queued()).toEqual([{ message, delaySeconds: 90 }]);
  });
});

describe("JobExecutor", () => {
  it("passes job context and skips duplicate idempotency keys", async () => {
    const handler = vi.fn(() => "done");
    const registry = createJobRegistry<{ readonly service: string }>({
      jobs: [{ name: "reports.weekly", handler }]
    });
    const executionLog = new InMemoryJobExecutionLog();
    const executor = new JobExecutor({
      registry,
      resources: { service: "documents" },
      executionLog,
      clock: fixedClock(now)
    });
    const message = {
      jobName: "reports.weekly",
      payload: { week: "2026-W01" },
      runId: "job_001",
      idempotencyKey: "reports.weekly:2026-W01",
      enqueuedAt: now,
      metadata: {}
    };

    await expect(executor.execute(message, { attempt: 1 })).resolves.toEqual({
      status: "succeeded",
      result: "done"
    });
    await expect(executor.execute(message, { attempt: 2 })).resolves.toEqual({
      status: "skipped",
      reason: "duplicate"
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: { week: "2026-W01" },
        resources: { service: "documents" },
        attempt: 1
      })
    );
    expect(executionLog.get("reports.weekly:2026-W01")).toMatchObject({
      status: "succeeded",
      result: "done"
    });
  });
});

describe("job retry classification", () => {
  it("uses exponential backoff for retryable failures", () => {
    expect(
      classifyJobError(retryableJobError("busy"), { maxAttempts: 3, baseDelaySeconds: 5 }, 2)
    ).toEqual({ action: "retry", delaySeconds: 10 });
  });

  it("honors explicit retry delays", () => {
    expect(classifyJobError(retryableJobError("rate limited", 120), { maxAttempts: 3 }, 1)).toEqual({
      action: "retry",
      delaySeconds: 120
    });
  });

  it("fails permanent and exhausted errors", () => {
    expect(classifyJobError(permanentJobError("bad payload"), {}, 1)).toEqual({ action: "fail" });
    expect(classifyJobError(retryableJobError("still down"), { maxAttempts: 2 }, 2)).toEqual({
      action: "fail"
    });
    expect(classifyJobError(badRequest("invalid"), {}, 1)).toEqual({ action: "fail" });
  });
});
