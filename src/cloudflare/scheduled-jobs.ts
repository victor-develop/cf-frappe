import type { JobDispatcher } from "../application/job-dispatcher.js";
import type { JobPayload } from "../core/jobs.js";
import type { DocumentData } from "../core/types.js";
import type { DispatchJobCommand, JobMessage } from "../ports/job-queue.js";

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

export interface DispatchScheduledJobOptions<TEnv = unknown, TResources = unknown> {
  readonly cron: string;
  readonly scheduledTime: number;
  readonly env: TEnv;
  readonly dispatcher: JobDispatcher<TResources>;
  readonly schedule: ScheduledJobDefinition<TEnv>;
  readonly idempotencyPrefix?: string;
  readonly metadata?: DocumentData;
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
      await dispatchScheduledJob({
        cron: context.cron,
        scheduledTime: context.scheduledTime,
        env: context.env,
        dispatcher: options.dispatcher,
        schedule
      })
    );
  }

  return messages;
}

export async function dispatchScheduledJob<TEnv, TResources>(
  options: DispatchScheduledJobOptions<TEnv, TResources>
): Promise<JobMessage> {
  const context: ScheduledJobContext<TEnv> = {
    cron: options.cron,
    scheduledTime: options.scheduledTime,
    scheduledAt: new Date(options.scheduledTime).toISOString(),
    env: options.env
  };
  return await options.dispatcher.dispatch(
    await dispatchCommand(options.schedule, context, {
      ...(options.idempotencyPrefix === undefined ? {} : { idempotencyPrefix: options.idempotencyPrefix }),
      ...(options.metadata === undefined ? {} : { metadata: options.metadata })
    })
  );
}

async function dispatchCommand<TEnv>(
  schedule: ScheduledJobDefinition<TEnv>,
  context: ScheduledJobContext<TEnv>,
  options: { readonly idempotencyPrefix?: string; readonly metadata?: DocumentData } = {}
): Promise<DispatchJobCommand> {
  const payload = await resolveValue(schedule.payload, context, {});
  const tenantId = await resolveValue(schedule.tenantId, context, undefined);
  const metadata = await resolveValue(schedule.metadata, context, {});
  const idempotencyPrefix = options.idempotencyPrefix ?? "scheduled";
  const idempotencyKey =
    schedule.idempotencyKey === undefined
      ? `${idempotencyPrefix}:${context.cron}:${context.scheduledTime}:${schedule.jobName}`
      : await resolveValue(schedule.idempotencyKey, context, "");
  return {
    jobName: schedule.jobName,
    ...(tenantId === undefined ? {} : { tenantId }),
    payload,
    idempotencyKey,
    metadata: {
      ...metadata,
      ...(options.metadata ?? {}),
      cron: context.cron,
      scheduledTime: context.scheduledTime,
      scheduledAt: context.scheduledAt,
      dispatchSource: idempotencyPrefix
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
