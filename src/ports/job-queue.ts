import type { JobName, JobPayload } from "../core/jobs.js";
import type { DocumentData } from "../core/types.js";

export const MAX_JOB_QUEUE_DELAY_SECONDS = 86_400;
export const MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH = 256;

export interface JobMessage<TPayload extends JobPayload = JobPayload> {
  readonly tenantId?: string;
  readonly jobName: JobName;
  readonly payload: TPayload;
  readonly runId: string;
  readonly idempotencyKey: string;
  readonly enqueuedAt: string;
  readonly metadata: DocumentData;
}

export interface DispatchJobCommand<TPayload extends JobPayload = JobPayload> {
  readonly tenantId?: string;
  readonly jobName: JobName;
  readonly payload: TPayload;
  readonly idempotencyKey?: string;
  readonly metadata?: DocumentData;
  readonly delaySeconds?: number;
}

export interface JobQueueSendOptions {
  readonly delaySeconds?: number;
}

export interface JobQueue {
  send(message: JobMessage, options?: JobQueueSendOptions): Promise<void>;
}
