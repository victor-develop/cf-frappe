import { classifyJobError } from "../application/job-errors.js";
import type { JobExecutor } from "../application/job-executor.js";
import type { JobRetryPolicy } from "../core/jobs.js";
import type { DocumentData, JsonValue } from "../core/types.js";
import type { JobMessage } from "../ports/job-queue.js";

export interface CloudflareJobBatchOptions<TResources = unknown> {
  readonly executor: JobExecutor<TResources>;
  readonly retry?: JobRetryPolicy;
  readonly onError?: (context: CloudflareJobErrorContext) => void | Promise<void>;
}

export interface CloudflareJobErrorContext {
  readonly error: unknown;
  readonly message: JobMessage | null;
  readonly queueMessageId: string;
  readonly attempt: number;
  readonly decision: ReturnType<typeof classifyJobError>;
}

export async function processCloudflareJobBatch<TResources>(
  batch: MessageBatch<unknown>,
  options: CloudflareJobBatchOptions<TResources>
): Promise<void> {
  for (const message of batch.messages) {
    const jobMessage = parseJobMessage(message.body);
    if (!jobMessage) {
      message.ack();
      continue;
    }

    try {
      await options.executor.execute(jobMessage, { attempt: message.attempts });
      message.ack();
    } catch (error) {
      const decision = classifyJobError(
        error,
        retryPolicyFor(options, jobMessage.jobName),
        message.attempts
      );
      await reportError(options, {
        error,
        message: jobMessage,
        queueMessageId: message.id,
        attempt: message.attempts,
        decision
      });
      if (decision.action === "retry") {
        message.retry({ delaySeconds: decision.delaySeconds });
      } else {
        message.ack();
      }
    }
  }
}

function parseJobMessage(value: unknown): JobMessage | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    (value.tenantId !== undefined && typeof value.tenantId !== "string") ||
    typeof value.jobName !== "string" ||
    typeof value.runId !== "string" ||
    typeof value.idempotencyKey !== "string" ||
    typeof value.enqueuedAt !== "string" ||
    !isDocumentData(value.payload) ||
    !isDocumentData(value.metadata)
  ) {
    return null;
  }
  return {
    ...(value.tenantId === undefined ? {} : { tenantId: value.tenantId }),
    jobName: value.jobName,
    payload: value.payload,
    runId: value.runId,
    idempotencyKey: value.idempotencyKey,
    enqueuedAt: value.enqueuedAt,
    metadata: value.metadata
  };
}

function isDocumentData(value: unknown): value is DocumentData {
  if (!isRecord(value) || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(isJsonValue);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  if (isRecord(value)) {
    return Object.values(value).every(isJsonValue);
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function mergeRetryPolicy(base: JobRetryPolicy | undefined, override: JobRetryPolicy | undefined): JobRetryPolicy {
  return {
    ...(base ?? {}),
    ...(override ?? {})
  };
}

function retryPolicyFor<TResources>(
  options: CloudflareJobBatchOptions<TResources>,
  jobName: string
): JobRetryPolicy {
  try {
    return mergeRetryPolicy(options.retry, options.executor.retryPolicyFor(jobName));
  } catch {
    return options.retry ?? {};
  }
}

async function reportError<TResources>(
  options: CloudflareJobBatchOptions<TResources>,
  context: CloudflareJobErrorContext
): Promise<void> {
  try {
    await options.onError?.(context);
  } catch (error) {
    console.error("cf-frappe job error hook failed", error);
  }
}
