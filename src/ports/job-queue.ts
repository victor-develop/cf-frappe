import type { JobName, JobPayload } from "../core/jobs";
import type { DocumentData } from "../core/types";

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
