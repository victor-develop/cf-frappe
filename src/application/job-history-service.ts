import { badRequest, notFound, permissionDenied } from "../core/errors";
import type { JobRetryPolicy } from "../core/jobs";
import { DEFAULT_TENANT_ID, SYSTEM_MANAGER_ROLE, type Actor, type TenantId } from "../core/types";
import type {
  JobExecutionLogReader,
  JobExecutionRecord,
  JobExecutionStatus,
  ListJobExecutionsOptions
} from "../ports/job-execution-log";

const DEFAULT_JOB_HISTORY_LIMIT = 50;
const MAX_JOB_HISTORY_LIMIT = 200;
const JOB_EXECUTION_STATUSES = new Set<JobExecutionStatus>(["running", "succeeded", "failed"]);

export interface JobHistoryRegistry {
  list(): readonly JobDefinitionForHistory[];
}

export interface JobDefinitionForHistory {
  readonly name: string;
  readonly description?: string;
  readonly retry?: JobRetryPolicy;
}

export interface JobHistoryServiceOptions {
  readonly registry: JobHistoryRegistry;
  readonly executionLog: JobExecutionLogReader;
  readonly adminRoles?: readonly string[];
}

export interface JobExecutionHistoryQuery {
  readonly jobName?: string;
  readonly runId?: string;
  readonly status?: string;
  readonly limit?: number;
}

export interface JobDefinitionSummary {
  readonly name: string;
  readonly description?: string;
  readonly retry?: JobRetryPolicy;
}

export interface JobExecutionDashboard {
  readonly jobs: readonly JobDefinitionSummary[];
  readonly executions: readonly JobExecutionRecord[];
  readonly filters: {
    readonly jobName?: string;
    readonly runId?: string;
    readonly status?: JobExecutionStatus;
  };
  readonly limit: number;
}

export class JobHistoryService {
  private readonly registry: JobHistoryRegistry;
  private readonly executionLog: JobExecutionLogReader;
  private readonly adminRoles: readonly string[];

  constructor(options: JobHistoryServiceOptions) {
    this.registry = options.registry;
    this.executionLog = options.executionLog;
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
  }

  async dashboard(actor: Actor, query: JobExecutionHistoryQuery = {}): Promise<JobExecutionDashboard> {
    const tenantId = this.authorize(actor);
    const normalized = normalizeQuery(query);
    const executions = await this.executionLog.list({
      tenantId,
      ...(normalized.filters.jobName === undefined ? {} : { jobName: normalized.filters.jobName }),
      ...(normalized.filters.runId === undefined ? {} : { runId: normalized.filters.runId }),
      ...(normalized.filters.status === undefined ? {} : { status: normalized.filters.status }),
      limit: normalized.limit
    });
    return {
      jobs: this.registry.list().map(jobSummary),
      executions,
      filters: normalized.filters,
      limit: normalized.limit
    };
  }

  async get(actor: Actor, idempotencyKey: string): Promise<JobExecutionRecord> {
    const tenantId = this.authorize(actor);
    const record = await this.executionLog.get(idempotencyKey, { tenantId });
    if (!record) {
      throw notFound(`Job execution '${idempotencyKey}' was not found`, "JOB_EXECUTION_NOT_FOUND");
    }
    if (record.tenantId !== tenantId) {
      throw permissionDenied(`Actor '${actor.id}' cannot inspect job history for tenant '${record.tenantId}'`);
    }
    return record;
  }

  private authorize(actor: Actor): TenantId {
    if (!this.adminRoles.some((role) => actor.roles.includes(role))) {
      throw permissionDenied(`Actor '${actor.id}' cannot inspect job history`);
    }
    return actor.tenantId ?? DEFAULT_TENANT_ID;
  }
}

function normalizeQuery(query: JobExecutionHistoryQuery): {
  readonly filters: JobExecutionDashboard["filters"];
  readonly limit: number;
} {
  const status = normalizeStatus(query.status);
  return {
    filters: {
      ...(query.jobName === undefined || query.jobName === "" ? {} : { jobName: query.jobName }),
      ...(query.runId === undefined || query.runId === "" ? {} : { runId: query.runId }),
      ...(status === undefined ? {} : { status })
    },
    limit: normalizeLimit(query.limit)
  };
}

function normalizeStatus(status: string | undefined): JobExecutionStatus | undefined {
  if (status === undefined || status === "") {
    return undefined;
  }
  if (!JOB_EXECUTION_STATUSES.has(status as JobExecutionStatus)) {
    throw badRequest(`Unknown job execution status '${status}'`);
  }
  return status as JobExecutionStatus;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_JOB_HISTORY_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest("Job history limit must be a positive integer");
  }
  return Math.min(limit, MAX_JOB_HISTORY_LIMIT);
}

function jobSummary(job: JobDefinitionForHistory): JobDefinitionSummary {
  return {
    name: job.name,
    ...(job.description === undefined ? {} : { description: job.description }),
    ...(job.retry === undefined ? {} : { retry: job.retry })
  };
}
