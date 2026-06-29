import { DEFAULT_TENANT_ID, type Actor, type DocumentData, type TenantId } from "../core/types.js";
import type { JobExecutionRecord } from "../ports/job-execution-log.js";
import type { DispatchJobCommand } from "../ports/job-queue.js";

export type JobRetryAccessDecision =
  | { readonly status: "allow"; readonly tenantId: TenantId }
  | { readonly status: "deny"; readonly message: string };

export type JobRetryExecutionDecision =
  | { readonly status: "retry"; readonly command: DispatchJobCommand }
  | { readonly status: "reject"; readonly message: string };

export function planJobRetryAccess(options: {
  readonly actor: Actor;
  readonly adminRoles: readonly string[];
}): JobRetryAccessDecision {
  if (options.adminRoles.some((role) => options.actor.roles.includes(role))) {
    return { status: "allow", tenantId: options.actor.tenantId ?? DEFAULT_TENANT_ID };
  }
  return {
    status: "deny",
    message: `Actor '${options.actor.id}' cannot retry jobs`
  };
}

export function planJobExecutionRetry(options: {
  readonly actor: Actor;
  readonly original: JobExecutionRecord;
  readonly retriedAt: string;
}): JobRetryExecutionDecision {
  if (options.original.status !== "failed") {
    return { status: "reject", message: "Only failed job executions can be retried" };
  }
  if (options.original.payload === undefined || options.original.metadata === undefined) {
    return {
      status: "reject",
      message: "Job execution cannot be retried because its original message snapshot is missing"
    };
  }
  return {
    status: "retry",
    command: {
      tenantId: options.original.tenantId,
      jobName: options.original.jobName,
      payload: options.original.payload,
      idempotencyKey: options.original.idempotencyKey,
      metadata: retryMetadata(
        options.original.metadata,
        options.actor,
        options.original.runId,
        options.retriedAt
      )
    }
  };
}

export function retryMetadata(
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
