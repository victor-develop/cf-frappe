import type { JobDispatcher } from "../application/job-dispatcher";
import type { JobPayload } from "../core/jobs";
import type { DocumentData } from "../core/types";
import type { DispatchJobCommand, JobMessage } from "../ports/job-queue";

type MaybePromise<T> = T | Promise<T>;

export interface ScheduledJobContext<TEnv = unknown> {
  readonly cron: string;
  readonly scheduledTime: number;
  readonly scheduledAt: string;
  readonly env: TEnv;
}

export interface ScheduledJobDefinition<TEnv = unknown> {
  readonly cron: string;
  readonly jobName: string;
  readonly tenantId?: string | ((context: ScheduledJobContext<TEnv>) => MaybePromise<string>);
  readonly payload?: JobPayload | ((context: ScheduledJobContext<TEnv>) => MaybePromise<JobPayload>);
  readonly metadata?: DocumentData | ((context: ScheduledJobContext<TEnv>) => MaybePromise<DocumentData>);
  readonly idempotencyKey?: string | ((context: ScheduledJobContext<TEnv>) => MaybePromise<string>);
  readonly delaySeconds?: number;
}

export interface DispatchScheduledJobsOptions<TEnv = unknown, TResources = unknown> {
  readonly controller: ScheduledController;
  readonly env: TEnv;
  readonly dispatcher: JobDispatcher<TResources>;
  readonly schedules: readonly ScheduledJobDefinition<TEnv>[];
}

export async function dispatchScheduledJobs<TEnv, TResources>(
  options: DispatchScheduledJobsOptions<TEnv, TResources>
): Promise<readonly JobMessage[]> {
  const context: ScheduledJobContext<TEnv> = {
    cron: options.controller.cron,
    scheduledTime: options.controller.scheduledTime,
    scheduledAt: new Date(options.controller.scheduledTime).toISOString(),
    env: options.env
  };
  const messages: JobMessage[] = [];

  for (const schedule of options.schedules.filter((item) => item.cron === options.controller.cron)) {
    messages.push(
      await options.dispatcher.dispatch(
        await dispatchCommand(schedule, context)
      )
    );
  }

  return messages;
}

async function dispatchCommand<TEnv>(
  schedule: ScheduledJobDefinition<TEnv>,
  context: ScheduledJobContext<TEnv>
): Promise<DispatchJobCommand> {
  const payload = await resolveValue(schedule.payload, context, {});
  const tenantId = await resolveValue(schedule.tenantId, context, undefined);
  const metadata = await resolveValue(schedule.metadata, context, {});
  const idempotencyKey =
    schedule.idempotencyKey === undefined
      ? `scheduled:${context.cron}:${context.scheduledTime}:${schedule.jobName}`
      : await resolveValue(schedule.idempotencyKey, context, "");
  return {
    jobName: schedule.jobName,
    ...(tenantId === undefined ? {} : { tenantId }),
    payload,
    idempotencyKey,
    metadata: {
      cron: context.cron,
      scheduledTime: context.scheduledTime,
      scheduledAt: context.scheduledAt,
      ...metadata
    },
    ...(schedule.delaySeconds === undefined ? {} : { delaySeconds: schedule.delaySeconds })
  };
}

async function resolveValue<TEnv, TValue>(
  value: TValue | ((context: ScheduledJobContext<TEnv>) => MaybePromise<TValue>) | undefined,
  context: ScheduledJobContext<TEnv>,
  fallback: TValue
): Promise<TValue> {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value === "function") {
    return await (value as (context: ScheduledJobContext<TEnv>) => MaybePromise<TValue>)(context);
  }
  return value;
}
