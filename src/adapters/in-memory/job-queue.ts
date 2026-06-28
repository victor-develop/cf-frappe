import { badRequest } from "../../core/errors.js";
import { cloneJsonValue, isJsonValue } from "../../core/json.js";
import type { DocumentData } from "../../core/types.js";
import type { JobQueue, JobQueueSendOptions, JobMessage } from "../../ports/job-queue.js";

export interface InMemoryQueuedJob {
  readonly message: JobMessage;
  readonly delaySeconds: number | undefined;
}

export class InMemoryJobQueue implements JobQueue {
  private readonly jobs: InMemoryQueuedJob[] = [];

  async send(message: JobMessage, options: JobQueueSendOptions = {}): Promise<void> {
    this.jobs.push({
      message: cloneJobMessage(message),
      delaySeconds: options.delaySeconds
    });
  }

  queued(): readonly InMemoryQueuedJob[] {
    return this.jobs.map((job) => ({
      message: cloneJobMessage(job.message),
      delaySeconds: job.delaySeconds
    }));
  }

  clear(): void {
    this.jobs.length = 0;
  }
}

function cloneJobMessage<TMessage extends JobMessage>(message: TMessage): TMessage {
  return {
    ...message,
    payload: cloneDocumentData(message.payload, "Job payload") as TMessage["payload"],
    metadata: cloneDocumentData(message.metadata, "Job metadata")
  };
}

function cloneDocumentData(value: DocumentData, label: string): DocumentData {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !isJsonValue(value)) {
    throw badRequest(`${label} must be a JSON object`);
  }
  return cloneJsonValue(value) as DocumentData;
}
