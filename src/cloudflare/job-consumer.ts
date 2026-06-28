import { classifyJobError } from "../application/job-errors.js";
import type { JobExecutor } from "../application/job-executor.js";
import {
  DEFAULT_JOB_WORKER_POOL,
  normalizeJobRetryPolicy,
  type JobRetryPolicy,
  type ResolvedJobWorkerPool
} from "../core/jobs.js";
import { isJsonValue } from "../core/json.js";
import type { DocumentData } from "../core/types.js";
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

interface JobLaneEntry {
  readonly queueMessage: Message<unknown>;
  readonly jobMessage: JobMessage;
}

export async function processCloudflareJobBatch<TResources>(
  batch: MessageBatch<unknown>,
  options: CloudflareJobBatchOptions<TResources>
): Promise<void> {
  const normalizedOptions = normalizeBatchOptions(options);
  const lanes = new Map<string, { readonly pool: ResolvedJobWorkerPool; readonly entries: JobLaneEntry[] }>();
  for (const message of batch.messages) {
    const jobMessage = parseJobMessage(message.body);
    if (!jobMessage) {
      message.ack();
      continue;
    }
    const pool = workerPoolFor(normalizedOptions, jobMessage.jobName);
    const entry = { queueMessage: message, jobMessage };
    const lane = lanes.get(pool.name);
    if (lane) {
      lane.entries.push(entry);
    } else {
      lanes.set(pool.name, { pool, entries: [entry] });
    }
  }

  await Promise.all(
    [...lanes.values()].map((lane) => processJobLane(lane.entries, lane.pool.concurrency, normalizedOptions))
  );
}

async function processJobLane<TResources>(
  entries: readonly JobLaneEntry[],
  concurrency: number,
  options: CloudflareJobBatchOptions<TResources>
): Promise<void> {
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, entries.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < entries.length) {
        const entry = entries[nextIndex++];
        if (entry) {
          await processJobMessage(entry, options);
        }
      }
    })
  );
}

async function processJobMessage<TResources>(
  entry: JobLaneEntry,
  options: CloudflareJobBatchOptions<TResources>
): Promise<void> {
  const { queueMessage, jobMessage } = entry;
  try {
    await options.executor.execute(jobMessage, { attempt: queueMessage.attempts });
    queueMessage.ack();
  } catch (error) {
    const decision = classifyJobError(error, retryPolicyFor(options, jobMessage.jobName), queueMessage.attempts);
    await reportError(options, {
      error,
      message: jobMessage,
      queueMessageId: queueMessage.id,
      attempt: queueMessage.attempts,
      decision
    });
    if (decision.action === "retry") {
      queueMessage.retry({ delaySeconds: decision.delaySeconds });
    } else {
      queueMessage.ack();
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
  if (!isRecord(value)) {
    return false;
  }
  return isJsonValue(value);
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
  const pool = workerPoolFor(options, jobName);
  const base = mergeRetryPolicy(options.retry, pool.retry);
  try {
    return mergeRetryPolicy(base, options.executor.retryPolicyFor(jobName));
  } catch {
    return base;
  }
}

function workerPoolFor<TResources>(
  options: CloudflareJobBatchOptions<TResources>,
  jobName: string
): ResolvedJobWorkerPool {
  try {
    return options.executor.workerPoolFor(jobName);
  } catch {
    return { name: DEFAULT_JOB_WORKER_POOL, concurrency: 1 };
  }
}

function normalizeBatchOptions<TResources>(
  options: CloudflareJobBatchOptions<TResources>
): CloudflareJobBatchOptions<TResources> {
  const retry = normalizeJobRetryPolicy(options.retry, "Cloudflare job batch retry");
  return {
    executor: options.executor,
    ...(options.onError === undefined ? {} : { onError: options.onError }),
    ...(retry === undefined ? {} : { retry })
  };
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
