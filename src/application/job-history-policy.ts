import { badRequest, notFound } from "../core/errors.js";
import { DEFAULT_JOB_WORKER_POOL, type JobRetryPolicy } from "../core/jobs.js";
import { DEFAULT_TENANT_ID, type Actor, type TenantId } from "../core/types.js";
import type {
  JobExecutionRecord,
  JobExecutionStatus,
  ListJobExecutionsOptions
} from "../ports/job-execution-log.js";

export const DEFAULT_JOB_HISTORY_LIMIT = 50;
export const MAX_JOB_HISTORY_LIMIT = 200;

const JOB_EXECUTION_STATUSES = new Set<JobExecutionStatus>(["running", "succeeded", "failed"]);

export interface JobExecutionHistoryQuery {
  readonly jobName?: string;
  readonly runId?: string;
  readonly status?: string;
  readonly limit?: number;
}

export interface JobDefinitionForHistory {
  readonly name: string;
  readonly description?: string;
  readonly pool?: string;
  readonly retry?: JobRetryPolicy;
}

export interface JobDefinitionSummary {
  readonly name: string;
  readonly description?: string;
  readonly pool: string;
  readonly retry?: JobRetryPolicy;
}

export interface NormalizedJobExecutionHistoryQuery {
  readonly filters: {
    readonly jobName?: string;
    readonly runId?: string;
    readonly status?: JobExecutionStatus;
  };
  readonly limit: number;
}

export type JobHistoryAccessDecision =
  | { readonly status: "allow"; readonly tenantId: TenantId }
  | { readonly status: "deny"; readonly message: string };

export type JobHistoryRecordAccessDecision =
  | { readonly status: "allow" }
  | { readonly status: "deny"; readonly message: string };

export type JobHistoryRecordLookupDecision =
  | { readonly status: "found"; readonly record: JobExecutionRecord }
  | {
      readonly status: "missing";
      readonly idempotencyKey: string;
      readonly message: string;
      readonly code: "JOB_EXECUTION_NOT_FOUND";
    };

export function ensureJobHistoryServiceAvailable<T>(jobs: T | undefined): asserts jobs is T {
  if (jobs === undefined) {
    throw notFound("Jobs are not enabled", "JOB_NOT_FOUND");
  }
}

export function ensureJobHistoryApiAvailable<T>(jobs: T | undefined): asserts jobs is T {
  if (jobs === undefined) {
    throw notFound("Job history is not enabled", "JOB_NOT_FOUND");
  }
}

export function planJobHistoryAccess(options: {
  readonly actor: Actor;
  readonly adminRoles: readonly string[];
}): JobHistoryAccessDecision {
  if (options.adminRoles.some((role) => options.actor.roles.includes(role))) {
    return { status: "allow", tenantId: options.actor.tenantId ?? DEFAULT_TENANT_ID };
  }
  return {
    status: "deny",
    message: `Actor '${options.actor.id}' cannot inspect job history`
  };
}

export function planJobHistoryRecordAccess(options: {
  readonly actor: Actor;
  readonly tenantId: TenantId;
  readonly record: JobExecutionRecord;
}): JobHistoryRecordAccessDecision {
  if (options.record.tenantId === options.tenantId) {
    return { status: "allow" };
  }
  return {
    status: "deny",
    message: `Actor '${options.actor.id}' cannot inspect job history for tenant '${options.record.tenantId}'`
  };
}

export function planJobHistoryRecordLookup(
  idempotencyKey: string,
  record: JobExecutionRecord | null | undefined
): JobHistoryRecordLookupDecision {
  if (record === null || record === undefined) {
    return {
      status: "missing",
      idempotencyKey,
      message: `Job execution '${idempotencyKey}' was not found`,
      code: "JOB_EXECUTION_NOT_FOUND"
    };
  }
  return { status: "found", record };
}

export function normalizeJobHistoryQuery(
  query: JobExecutionHistoryQuery
): NormalizedJobExecutionHistoryQuery {
  const status = normalizeJobHistoryStatus(query.status);
  return {
    filters: {
      ...(query.jobName === undefined || query.jobName === "" ? {} : { jobName: query.jobName }),
      ...(query.runId === undefined || query.runId === "" ? {} : { runId: query.runId }),
      ...(status === undefined ? {} : { status })
    },
    limit: normalizeJobHistoryLimit(query.limit)
  };
}

export function planJobHistoryListOptions(
  tenantId: TenantId,
  query: NormalizedJobExecutionHistoryQuery
): ListJobExecutionsOptions {
  return {
    tenantId,
    ...(query.filters.jobName === undefined ? {} : { jobName: query.filters.jobName }),
    ...(query.filters.runId === undefined ? {} : { runId: query.filters.runId }),
    ...(query.filters.status === undefined ? {} : { status: query.filters.status }),
    limit: query.limit
  };
}

export function jobHistoryDefinitionSummary(job: JobDefinitionForHistory): JobDefinitionSummary {
  return {
    name: job.name,
    ...(job.description === undefined ? {} : { description: job.description }),
    pool: job.pool ?? DEFAULT_JOB_WORKER_POOL,
    ...(job.retry === undefined ? {} : { retry: job.retry })
  };
}

function normalizeJobHistoryStatus(status: string | undefined): JobExecutionStatus | undefined {
  if (status === undefined || status === "") {
    return undefined;
  }
  if (!JOB_EXECUTION_STATUSES.has(status as JobExecutionStatus)) {
    throw badRequest(`Unknown job execution status '${status}'`);
  }
  return status as JobExecutionStatus;
}

function normalizeJobHistoryLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_JOB_HISTORY_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest("Job history limit must be a positive integer");
  }
  return Math.min(limit, MAX_JOB_HISTORY_LIMIT);
}
