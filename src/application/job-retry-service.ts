import { badRequest, notFound, permissionDenied } from "../core/errors.js";
import { SYSTEM_MANAGER_ROLE, type Actor } from "../core/types.js";
import type { Clock } from "../ports/clock.js";
import { systemClock } from "../ports/clock.js";
import type { JobExecutionLogReader, JobExecutionRecord } from "../ports/job-execution-log.js";
import type { JobMessage } from "../ports/job-queue.js";
import type { JobDispatcher } from "./job-dispatcher.js";
import {
  planJobExecutionRetry,
  planJobRetryAccess,
  planJobRetryExecutionLookup
} from "./job-retry-policy.js";

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
    const access = planJobRetryAccess({ actor, adminRoles: this.adminRoles });
    if (access.status === "deny") {
      throw permissionDenied(access.message);
    }
    const lookup = planJobRetryExecutionLookup(
      idempotencyKey,
      await this.executionLog.get(idempotencyKey, { tenantId: access.tenantId })
    );
    if (lookup.status === "missing") {
      throw notFound(`Job execution '${lookup.idempotencyKey}' was not found`, "JOB_EXECUTION_NOT_FOUND");
    }
    const retry = planJobExecutionRetry({ actor, original: lookup.original, retriedAt: this.clock.now() });
    if (retry.status === "reject") {
      throw badRequest(retry.message);
    }
    const message = await this.dispatcher.dispatch(retry.command);
    return { original: lookup.original, message };
  }
}
