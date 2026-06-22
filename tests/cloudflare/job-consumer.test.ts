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
