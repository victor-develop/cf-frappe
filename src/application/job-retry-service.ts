import { badRequest, notFound, permissionDenied } from "../core/errors.js";
import { DEFAULT_TENANT_ID, SYSTEM_MANAGER_ROLE, type Actor, type DocumentData, type TenantId } from "../core/types.js";
import type { Clock } from "../ports/clock.js";
import { systemClock } from "../ports/clock.js";
import type { JobExecutionLogReader, JobExecutionRecord } from "../ports/job-execution-log.js";
import type { JobMessage } from "../ports/job-queue.js";
import type { JobDispatcher } from "./job-dispatcher.js";

export interface JobRetryServiceOptions<TResources = unknown> {
  readonly executionLog: JobExecutionLogReader;
  readonly dispatcher: JobDispatcher<TResources>;
  readonly adminRoles?: readonly string[];
  readonly clock?: Clock;
}

export interface JobRetryResult {
  readonly original: JobExecutionRecord;
  readonly message: JobMessage;
}

export interface JobRetryPort {
  retry(actor: Actor, idempotencyKey: string): Promise<JobRetryResult>;
}

export class JobRetryService<TResources = unknown> implements JobRetryPort {
  private readonly executionLog: JobExecutionLogReader;
  private readonly dispatcher: JobDispatcher<TResources>;
  private readonly adminRoles: readonly string[];
  private readonly clock: Clock;

  constructor(options: JobRetryServiceOptions<TResources>) {
    this.executionLog = options.executionLog;
    this.dispatcher = options.dispatcher;
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
    this.clock = options.clock ?? systemClock;
  }

  async retry(actor: Actor, idempotencyKey: string): Promise<JobRetryResult> {
    const tenantId = this.authorize(actor);
    const original = await this.executionLog.get(idempotencyKey, { tenantId });
    if (!original) {
      throw notFound(`Job execution '${idempotencyKey}' was not found`, "JOB_EXECUTION_NOT_FOUND");
    }
    if (original.status !== "failed") {
      throw badRequest("Only failed job executions can be retried");
    }
    if (original.payload === undefined || original.metadata === undefined) {
      throw badRequest("Job execution cannot be retried because its original message snapshot is missing");
    }
    const message = await this.dispatcher.dispatch({
      tenantId,
      jobName: original.jobName,
      payload: original.payload,
      idempotencyKey: original.idempotencyKey,
      metadata: retryMetadata(original.metadata, actor, original.runId, this.clock.now())
    });
    return { original, message };
  }

  private authorize(actor: Actor): TenantId {
    if (!this.adminRoles.some((role) => actor.roles.includes(role))) {
      throw permissionDenied(`Actor '${actor.id}' cannot retry jobs`);
    }
    return actor.tenantId ?? DEFAULT_TENANT_ID;
  }
}

function retryMetadata(
  metadata: DocumentData,
  actor: Actor,
  runId: string,
  retriedAt: string
): DocumentData {
  return {
    ...metadata,
    retriedAt,
    retriedBy: actor.id,
    retriedFromRunId: runId
  };
}
