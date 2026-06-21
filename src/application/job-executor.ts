import type { JobHandlerResult, JobRegistry } from "../core/jobs";
import type { Clock } from "../ports/clock";
import { systemClock } from "../ports/clock";
import type { JobExecutionLog } from "../ports/job-execution-log";
import type { JobMessage } from "../ports/job-queue";

export interface JobExecutorOptions<TResources = unknown> {
  readonly registry: JobRegistry<TResources>;
  readonly resources: TResources;
  readonly clock?: Clock;
  readonly executionLog?: JobExecutionLog;
}

export interface ExecuteJobOptions {
  readonly attempt?: number;
}

export type JobExecutionOutcome =
  | { readonly status: "succeeded"; readonly result: JobHandlerResult }
  | { readonly status: "skipped"; readonly reason: "duplicate" };

export class JobExecutor<TResources = unknown> {
  private readonly registry: JobRegistry<TResources>;
  private readonly resources: TResources;
  private readonly clock: Clock;
  private readonly executionLog: JobExecutionLog | undefined;

  constructor(options: JobExecutorOptions<TResources>) {
    this.registry = options.registry;
    this.resources = options.resources;
    this.clock = options.clock ?? systemClock;
    this.executionLog = options.executionLog;
  }

  async execute(message: JobMessage, options: ExecuteJobOptions = {}): Promise<JobExecutionOutcome> {
    const definition = this.registry.get(message.jobName);
    const startedAt = this.clock.now();
    const begin = await this.executionLog?.begin(message, startedAt);
    if (begin?.status === "duplicate") {
      return { status: "skipped", reason: "duplicate" };
    }

    try {
      const result = await definition.handler({
        jobName: message.jobName,
        payload: message.payload,
        runId: message.runId,
        idempotencyKey: message.idempotencyKey,
        enqueuedAt: message.enqueuedAt,
        attempt: options.attempt ?? 1,
        metadata: message.metadata,
        resources: this.resources
      });
      await this.executionLog?.complete(message, this.clock.now(), result === undefined ? undefined : result);
      return { status: "succeeded", result };
    } catch (error) {
      await this.executionLog?.fail(message, this.clock.now(), error);
      throw error;
    }
  }

  retryPolicyFor(jobName: string) {
    return this.registry.get(jobName).retry;
  }
}
