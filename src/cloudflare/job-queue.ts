import type { JobQueue, JobQueueSendOptions, JobMessage } from "../ports/job-queue.js";

export class CloudflareJobQueue implements JobQueue {
  private readonly queue: Queue<JobMessage>;

  constructor(queue: Queue<JobMessage>) {
    this.queue = queue;
  }

  async send(message: JobMessage, options: JobQueueSendOptions = {}): Promise<void> {
    const sendOptions: QueueSendOptions = { contentType: "json" };
    if (options.delaySeconds !== undefined) {
      sendOptions.delaySeconds = options.delaySeconds;
    }
    await this.queue.send(message, sendOptions);
  }
}
