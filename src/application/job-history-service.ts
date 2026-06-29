import { notFound, permissionDenied } from "../core/errors.js";
import { SYSTEM_MANAGER_ROLE, type Actor } from "../core/types.js";
import type { JobExecutionLogReader, JobExecutionRecord, JobExecutionStatus } from "../ports/job-execution-log.js";
import {
  jobHistoryDefinitionSummary,
  normalizeJobHistoryQuery,
  planJobHistoryAccess,
  planJobHistoryListOptions,
  planJobHistoryRecordAccess,
  planJobHistoryRecordLookup,
  type JobDefinitionForHistory,
  type JobDefinitionSummary,
  type JobExecutionHistoryQuery
} from "./job-history-policy.js";

export interface JobHistoryRegistry {
  list(): readonly JobDefinitionForHistory[];
}

export interface JobHistoryServiceOptions {
  readonly registry: JobHistoryRegistry;
  readonly executionLog: JobExecutionLogReader;
  readonly adminRoles?: readonly string[];
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
    const access = this.authorize(actor);
    const normalized = normalizeJobHistoryQuery(query);
    const executions = await this.executionLog.list(planJobHistoryListOptions(access.tenantId, normalized));
    return {
      jobs: this.registry.list().map(jobHistoryDefinitionSummary),
      executions,
      filters: normalized.filters,
      limit: normalized.limit
    };
  }

  async get(actor: Actor, idempotencyKey: string): Promise<JobExecutionRecord> {
    const access = this.authorize(actor);
    const lookup = planJobHistoryRecordLookup(
      idempotencyKey,
      await this.executionLog.get(idempotencyKey, { tenantId: access.tenantId })
    );
    if (lookup.status === "missing") {
      throw notFound(lookup.message, lookup.code);
    }
    const recordAccess = planJobHistoryRecordAccess({ actor, tenantId: access.tenantId, record: lookup.record });
    if (recordAccess.status === "deny") {
      throw permissionDenied(recordAccess.message);
    }
    return lookup.record;
  }

  private authorize(actor: Actor): Extract<ReturnType<typeof planJobHistoryAccess>, { readonly status: "allow" }> {
    const access = planJobHistoryAccess({ actor, adminRoles: this.adminRoles });
    if (access.status === "deny") {
      throw permissionDenied(access.message);
    }
    return access;
  }
}
