import { badRequest, notFound, permissionDenied } from "../core/errors";
import type { JobRetryPolicy } from "../core/jobs";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type TenantId
} from "../core/types";
import type { JobMessage } from "../ports/job-queue";

export interface JobScheduleDefinitionForAdmin {
  readonly cron: string;
  readonly jobName: string;
  readonly tenantId?: unknown;
  readonly payload?: unknown;
  readonly metadata?: unknown;
  readonly idempotencyKey?: unknown;
  readonly delaySeconds?: number;
}

export interface JobDefinitionForSchedule {
  readonly name: string;
  readonly description?: string;
  readonly retry?: JobRetryPolicy;
}

export interface JobScheduleRegistry {
  has(name: string): boolean;
  get(name: string): JobDefinitionForSchedule;
}

export interface JobScheduleRunner<TSchedule extends JobScheduleDefinitionForAdmin = JobScheduleDefinitionForAdmin> {
  run(schedule: TSchedule, actor: Actor): Promise<JobMessage>;
}

export interface JobScheduleServiceOptions<TSchedule extends JobScheduleDefinitionForAdmin = JobScheduleDefinitionForAdmin> {
  readonly registry: JobScheduleRegistry;
  readonly schedules: readonly TSchedule[];
  readonly runner?: JobScheduleRunner<TSchedule>;
  readonly adminRoles?: readonly string[];
}

export interface JobScheduleQuery {
  readonly cron?: string;
  readonly jobName?: string;
}

export interface JobScheduleSummary {
  readonly id: string;
  readonly cron: string;
  readonly jobName: string;
  readonly registered: boolean;
  readonly dispatchable: boolean;
  readonly description?: string;
  readonly retry?: JobRetryPolicy;
  readonly delaySeconds?: number;
  readonly tenantId?: string;
  readonly dynamic: {
    readonly tenantId: boolean;
    readonly payload: boolean;
    readonly metadata: boolean;
    readonly idempotencyKey: boolean;
  };
}

export interface JobScheduleDashboard {
  readonly schedules: readonly JobScheduleSummary[];
  readonly filters: {
    readonly cron?: string;
    readonly jobName?: string;
  };
}

export interface JobScheduleDispatchResult {
  readonly schedule: JobScheduleSummary;
  readonly message: JobMessage;
}

export class JobScheduleService<TSchedule extends JobScheduleDefinitionForAdmin = JobScheduleDefinitionForAdmin> {
  private readonly registry: JobScheduleRegistry;
  private readonly schedules: readonly TSchedule[];
  private readonly runner: JobScheduleRunner<TSchedule> | undefined;
  private readonly adminRoles: readonly string[];

  constructor(options: JobScheduleServiceOptions<TSchedule>) {
    this.registry = options.registry;
    this.schedules = options.schedules;
    this.runner = options.runner;
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
  }

  canDispatch(): boolean {
    return this.runner !== undefined;
  }

  async dashboard(actor: Actor, query: JobScheduleQuery = {}): Promise<JobScheduleDashboard> {
    const tenantId = this.authorize(actor);
    const filters = normalizeQuery(query);
    return {
      schedules: this.summarizeSchedules()
        .filter((schedule) => canInspectSchedule(schedule, tenantId))
        .filter((schedule) => filters.cron === undefined || schedule.cron === filters.cron)
        .filter((schedule) => filters.jobName === undefined || schedule.jobName === filters.jobName),
      filters
    };
  }

  async dispatch(actor: Actor, scheduleId: string): Promise<JobScheduleDispatchResult> {
    const tenantId = this.authorize(actor);
    if (!this.runner) {
      throw notFound("Job schedule dispatch is not enabled", "JOB_SCHEDULE_NOT_FOUND");
    }
    const { schedule, summary } = this.requireSchedule(scheduleId);
    if (!canInspectSchedule(summary, tenantId)) {
      throw notFound(`Job schedule '${scheduleId}' was not found`, "JOB_SCHEDULE_NOT_FOUND");
    }
    if (summary.dynamic.tenantId) {
      throw badRequest("Dynamic tenant job schedules cannot be manually dispatched");
    }
    if (!summary.registered) {
      throw badRequest(`Scheduled job '${schedule.jobName}' is not registered`);
    }
    const message = await this.runner.run(schedule, actor);
    return { schedule: summary, message };
  }

  private authorize(actor: Actor): TenantId {
    if (!this.adminRoles.some((role) => actor.roles.includes(role))) {
      throw permissionDenied(`Actor '${actor.id}' cannot inspect job schedules`);
    }
    return actor.tenantId ?? DEFAULT_TENANT_ID;
  }

  private requireSchedule(scheduleId: string): {
    readonly schedule: TSchedule;
    readonly summary: JobScheduleSummary;
  } {
    const index = Number(scheduleId) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= this.schedules.length) {
      throw notFound(`Job schedule '${scheduleId}' was not found`, "JOB_SCHEDULE_NOT_FOUND");
    }
    const schedule = this.schedules[index]!;
    return { schedule, summary: this.summaryFor(schedule, index) };
  }

  private summarizeSchedules(): readonly JobScheduleSummary[] {
    return this.schedules.map((schedule, index) => this.summaryFor(schedule, index));
  }

  private summaryFor(schedule: TSchedule, index: number): JobScheduleSummary {
    const registered = this.registry.has(schedule.jobName);
    const job = registered ? this.registry.get(schedule.jobName) : undefined;
    const tenantId = staticTenantId(schedule);
    const dynamic = {
      tenantId: isDynamic(schedule.tenantId),
      payload: isDynamic(schedule.payload),
      metadata: isDynamic(schedule.metadata),
      idempotencyKey: isDynamic(schedule.idempotencyKey)
    };
    return {
      id: String(index + 1),
      cron: schedule.cron,
      jobName: schedule.jobName,
      registered,
      dispatchable: registered && this.canDispatch() && !dynamic.tenantId,
      ...(job?.description === undefined ? {} : { description: job.description }),
      ...(job?.retry === undefined ? {} : { retry: job.retry }),
      ...(schedule.delaySeconds === undefined ? {} : { delaySeconds: schedule.delaySeconds }),
      ...(tenantId === undefined ? {} : { tenantId }),
      dynamic
    };
  }
}

function normalizeQuery(query: JobScheduleQuery): JobScheduleDashboard["filters"] {
  return {
    ...(query.cron === undefined || query.cron === "" ? {} : { cron: query.cron }),
    ...(query.jobName === undefined || query.jobName === "" ? {} : { jobName: query.jobName })
  };
}

function isDynamic(value: unknown): boolean {
  return typeof value === "function";
}

function staticTenantId(schedule: JobScheduleDefinitionForAdmin): TenantId | undefined {
  if (isDynamic(schedule.tenantId)) {
    return undefined;
  }
  return typeof schedule.tenantId === "string" ? schedule.tenantId : DEFAULT_TENANT_ID;
}

function canInspectSchedule(schedule: JobScheduleSummary, tenantId: TenantId): boolean {
  if (schedule.dynamic.tenantId) {
    return tenantId === DEFAULT_TENANT_ID;
  }
  return schedule.tenantId === tenantId;
}
