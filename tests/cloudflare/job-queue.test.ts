import { CloudflareJobQueue } from "../../src";
import type { JobMessage } from "../../src";
import { now } from "../helpers";

describe("CloudflareJobQueue", () => {
  it("sends JSON queue messages with delay options", async () => {
    const sent: { readonly message: JobMessage; readonly options: QueueSendOptions | undefined }[] = [];
    const queue: Queue<JobMessage> = {
      async send(message, options) {
        sent.push({ message, options });
        return queueResponse();
      },
      async sendBatch() {
        return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };
      },
      async metrics() {
        return { backlogCount: 0, backlogBytes: 0 };
      }
    };
    const message: JobMessage = {
      jobName: "reports.daily",
      payload: { date: "2026-01-01" },
      runId: "job_001",
      idempotencyKey: "reports.daily:2026-01-01",
      enqueuedAt: now,
      metadata: {}
    };

    await new CloudflareJobQueue(queue).send(message, { delaySeconds: 60 });

    expect(sent).toEqual([{ message, options: { contentType: "json", delaySeconds: 60 } }]);
  });
});

function queueResponse(): QueueSendResponse {
  return { metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } } };
}
