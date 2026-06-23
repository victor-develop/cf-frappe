import {
  createJobRegistry,
  JobExecutor,
  permanentJobError,
  retryableJobError
} from "../../src";
import { processCloudflareJobBatch } from "../../src/cloudflare";
import { now } from "../helpers";

describe("processCloudflareJobBatch", () => {
  it("acks malformed queue messages", async () => {
    const message = queueMessage({ nope: true });

    await processCloudflareJobBatch(batch([message]), {
      executor: new JobExecutor({
        registry: createJobRegistry({ jobs: [{ name: "ok", handler: () => undefined }] }),
        resources: {}
      })
    });

    expect(message.actions).toEqual([{ kind: "ack" }]);
  });

  it("acks unknown jobs as permanent failures", async () => {
    const message = queueMessage(jobMessage("missing"));

    await processCloudflareJobBatch(batch([message]), {
      executor: new JobExecutor({ registry: createJobRegistry(), resources: {} })
    });

    expect(message.actions).toEqual([{ kind: "ack" }]);
  });

  it("handles success and retryable failure per message", async () => {
    const ok = queueMessage(jobMessage("ok"));
    const flaky = queueMessage(jobMessage("flaky"), { id: "msg-flaky", attempts: 1 });
    const registry = createJobRegistry({
      jobs: [
        { name: "ok", handler: () => undefined },
        { name: "flaky", handler: () => { throw retryableJobError("try later", 45); } }
      ]
    });

    await processCloudflareJobBatch(batch([ok, flaky]), {
      executor: new JobExecutor({ registry, resources: {} })
    });

    expect(ok.actions).toEqual([{ kind: "ack" }]);
    expect(flaky.actions).toEqual([{ kind: "retry", delaySeconds: 45 }]);
  });

  it("processes queue messages through worker-pool concurrency lanes", async () => {
    let serialRunning = 0;
    let fastRunning = 0;
    let maxSerialRunning = 0;
    let maxFastRunning = 0;
    const registry = createJobRegistry({
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
    });
    const messages = [
      queueMessage(jobMessage("serial.job"), { id: "serial-1" }),
      queueMessage(jobMessage("serial.job"), { id: "serial-2" }),
      queueMessage(jobMessage("fast.job"), { id: "fast-1" }),
      queueMessage(jobMessage("fast.job"), { id: "fast-2" })
    ];

    await processCloudflareJobBatch(batch(messages), {
      executor: new JobExecutor({ registry, resources: {} })
    });

    expect(maxSerialRunning).toBe(1);
    expect(maxFastRunning).toBe(2);
    expect(messages.flatMap((message) => message.actions)).toEqual([
      { kind: "ack" },
      { kind: "ack" },
      { kind: "ack" },
      { kind: "ack" }
    ]);
  });

  it("applies worker-pool retry defaults below job retry overrides", async () => {
    const poolDefault = queueMessage(jobMessage("pool.flaky"), { id: "pool-flaky", attempts: 1 });
    const jobOverride = queueMessage(jobMessage("job.flaky"), { id: "job-flaky", attempts: 1 });
    const registry = createJobRegistry({
      workerPools: [{ name: "slow", concurrency: 1, retry: { maxAttempts: 3, baseDelaySeconds: 20 } }],
      jobs: [
        {
          name: "pool.flaky",
          pool: "slow",
          handler: () => { throw retryableJobError("pool retry"); }
        },
        {
          name: "job.flaky",
          pool: "slow",
          retry: { baseDelaySeconds: 5 },
          handler: () => { throw retryableJobError("job retry"); }
        }
      ]
    });

    await processCloudflareJobBatch(batch([poolDefault, jobOverride]), {
      executor: new JobExecutor({ registry, resources: {} })
    });

    expect(poolDefault.actions).toEqual([{ kind: "retry", delaySeconds: 20 }]);
    expect(jobOverride.actions).toEqual([{ kind: "retry", delaySeconds: 5 }]);
  });

  it("acks permanent handler failures", async () => {
    const message = queueMessage(jobMessage("bad"));
    const registry = createJobRegistry({
      jobs: [{ name: "bad", handler: () => { throw permanentJobError("bad payload"); } }]
    });

    await processCloudflareJobBatch(batch([message]), {
      executor: new JobExecutor({ registry, resources: {} })
    });

    expect(message.actions).toEqual([{ kind: "ack" }]);
  });
});

interface QueueAction {
  readonly kind: "ack" | "retry";
  readonly delaySeconds?: number;
}

interface TestMessage extends Message<unknown> {
  readonly actions: QueueAction[];
}

function jobMessage(jobName: string) {
  return {
    jobName,
    payload: { example: true },
    runId: `${jobName}-run`,
    idempotencyKey: `${jobName}-key`,
    enqueuedAt: now,
    metadata: {}
  };
}

function queueMessage(body: unknown, overrides: { readonly id?: string; readonly attempts?: number } = {}): TestMessage {
  const actions: QueueAction[] = [];
  return {
    id: overrides.id ?? "msg-1",
    timestamp: new Date(now),
    body,
    attempts: overrides.attempts ?? 1,
    actions,
    retry(options?: QueueRetryOptions) {
      actions.push({ kind: "retry", ...(options?.delaySeconds === undefined ? {} : { delaySeconds: options.delaySeconds }) });
    },
    ack() {
      actions.push({ kind: "ack" });
    }
  };
}

function batch(messages: readonly TestMessage[]): MessageBatch<unknown> {
  return {
    messages,
    queue: "jobs",
    metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    retryAll() {},
    ackAll() {}
  };
}
