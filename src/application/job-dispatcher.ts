import type { JobRegistry } from "../core/jobs.js";
import type { JobPayload } from "../core/jobs.js";
import { DEFAULT_TENANT_ID } from "../core/types.js";
import type { Clock } from "../ports/clock.js";
import { systemClock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";
import { cryptoIdGenerator } from "../ports/id-generator.js";
import type { DispatchJobCommand, JobMessage, JobQueue, JobQueueSendOptions } from "../ports/job-queue.js";

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
    const runId = this.ids.next("job_");
    const tenantId = command.tenantId ?? DEFAULT_TENANT_ID;
    const message: JobMessage<TPayload> = {
      tenantId,
      jobName: command.jobName,
      payload: command.payload,
      runId,
      idempotencyKey: command.idempotencyKey ?? `${command.jobName}:${runId}`,
      enqueuedAt: this.clock.now(),
      metadata: command.metadata ?? {}
    };
    await this.queue.send(message, sendOptions(command));
    return message;
  }
}

function sendOptions(command: DispatchJobCommand): JobQueueSendOptions | undefined {
  if (command.delaySeconds === undefined) {
    return undefined;
  }
  return { delaySeconds: command.delaySeconds };
}
