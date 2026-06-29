import { badRequest } from "../core/errors.js";
import type { JobHandlerResult } from "../core/jobs.js";
import { cloneJsonValue, isJsonValue } from "../core/json.js";
import type { DocumentData, JsonValue } from "../core/types.js";
import {
  MAX_JOB_QUEUE_DELAY_SECONDS,
  MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH,
  type DispatchJobCommand,
  type JobQueueSendOptions
} from "../ports/job-queue.js";

export function normalizeJobDocumentData(value: DocumentData, label: string): DocumentData {
  if (typeof value !== "object" || value === null || Array.isArray(value) || !isJsonValue(value)) {
    throw badRequest(`${label} must be a JSON object`);
  }
  return cloneJsonValue(value) as DocumentData;
}

export function normalizeJobHandlerResult(value: JobHandlerResult): JsonValue | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isJsonValue(value)) {
    throw badRequest("Job result must be JSON-serializable");
  }
  return cloneJsonValue(value);
}

export function jobQueueSendOptions(command: Pick<DispatchJobCommand, "delaySeconds">): JobQueueSendOptions | undefined {
  if (command.delaySeconds === undefined) {
    return undefined;
  }
  if (
    !Number.isInteger(command.delaySeconds) ||
    command.delaySeconds < 0 ||
    command.delaySeconds > MAX_JOB_QUEUE_DELAY_SECONDS
  ) {
    throw badRequest(`Job queue delaySeconds must be an integer between 0 and ${MAX_JOB_QUEUE_DELAY_SECONDS}`);
  }
  return { delaySeconds: command.delaySeconds };
}

export function ensureJobQueueIdempotencyKey(idempotencyKey: string | undefined): void {
  if (idempotencyKey === undefined) {
    return;
  }
  if (idempotencyKey.length > MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH) {
    throw badRequest(`Job queue idempotencyKey must be at most ${MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH} characters`);
  }
}
