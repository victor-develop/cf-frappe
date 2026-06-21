import type { JobQueue, JobQueueSendOptions, JobMessage } from "../../ports/job-queue";

export interface InMemoryQueuedJob {
  readonly message: JobMessage;
  readonly delaySeconds: number | undefined;
}

export class InMemoryJobQueue implements JobQueue {
  private readonly jobs: InMemoryQueuedJob[] = [];

  async send(message: JobMessage, options: JobQueueSendOptions = {}): Promise<void> {
    this.jobs.push({
      message,
      delaySeconds: options.delaySeconds
    });
  }

  queued(): readonly InMemoryQueuedJob[] {
    return [...this.jobs];
  }

  clear(): void {
    this.jobs.length = 0;
  }
}
