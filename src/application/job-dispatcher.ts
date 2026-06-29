import type { JobRegistry } from "../core/jobs.js";
import type { JobPayload } from "../core/jobs.js";
import { DEFAULT_TENANT_ID } from "../core/types.js";
import type { Clock } from "../ports/clock.js";
import { systemClock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";
import { cryptoIdGenerator } from "../ports/id-generator.js";
import {
  ensureJobQueueIdempotencyKey,
  jobQueueSendOptions,
  normalizeJobDocumentData
} from "./job-payload-policy.js";
import {
  type DispatchJobCommand,
  type JobMessage,
  type JobQueue
} from "../ports/job-queue.js";

export interface JobDispatcherOptions<TResources = unknown> {
  readonly registry: JobRegistry<TResources>;
  readonly queue: JobQueue;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}

export class JobDispatcher<TResources = unknown> {
  private readonly registry: JobRegistry<TResources>;
  private readonly queue: JobQueue;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(options: JobDispatcherOptions<TResources>) {
    this.registry = options.registry;
    this.queue = options.queue;
    this.clock = options.clock ?? systemClock;
    this.ids = options.ids ?? cryptoIdGenerator;
  }

  async dispatch<TPayload extends JobPayload>(command: DispatchJobCommand<TPayload>): Promise<JobMessage<TPayload>> {
    this.registry.get(command.jobName);
    const options = jobQueueSendOptions(command);
    ensureJobQueueIdempotencyKey(command.idempotencyKey);
    const payload = normalizeJobDocumentData(command.payload, "Job payload") as TPayload;
    const metadata = command.metadata === undefined
      ? {}
      : normalizeJobDocumentData(command.metadata, "Job metadata");
    const runId = this.ids.next("job_");
    const tenantId = command.tenantId ?? DEFAULT_TENANT_ID;
    const message: JobMessage<TPayload> = {
      tenantId,
      jobName: command.jobName,
      payload,
      runId,
      idempotencyKey: command.idempotencyKey ?? `${command.jobName}:${runId}`,
      enqueuedAt: this.clock.now(),
      metadata
    };
    await this.queue.send(message, options);
    return message;
  }
}
