import { FrameworkError } from "../core/errors.js";
import { normalizeJobRetryDelaySeconds, normalizeJobRetryPolicy, type JobRetryPolicy } from "../core/jobs.js";

export type JobFailureKind = "retryable" | "permanent";

export class JobExecutionError extends Error {
  readonly kind: JobFailureKind;
  readonly delaySeconds: number | undefined;

  constructor(message: string, options: { readonly kind: JobFailureKind; readonly delaySeconds?: number }) {
    super(message);
    this.name = "JobExecutionError";
    this.kind = options.kind;
    this.delaySeconds =
      options.delaySeconds === undefined ? undefined : normalizeJobRetryDelaySeconds(options.delaySeconds);
  }
}

export type JobRetryDecision =
  | { readonly action: "retry"; readonly delaySeconds: number }
  | { readonly action: "fail" };

export function retryableJobError(message: string, delaySeconds?: number): JobExecutionError {
  return new JobExecutionError(message, { kind: "retryable", ...(delaySeconds === undefined ? {} : { delaySeconds }) });
}

export function permanentJobError(message: string): JobExecutionError {
  return new JobExecutionError(message, { kind: "permanent" });
}

export function classifyJobError(
  error: unknown,
  policy: JobRetryPolicy = {},
  attempt = 1
): JobRetryDecision {
  if (!isRetryableJobError(error)) {
    return { action: "fail" };
  }

  const normalizedPolicy = normalizeJobRetryPolicy(policy) ?? {};
  const maxAttempts = normalizedPolicy.maxAttempts ?? 3;
  const normalizedAttempt = Math.max(1, attempt);
  if (normalizedAttempt >= maxAttempts) {
    return { action: "fail" };
  }

  const baseDelaySeconds = normalizedPolicy.baseDelaySeconds ?? 30;
  const maxDelaySeconds = normalizedPolicy.maxDelaySeconds ?? 43_200;
  const explicitDelay = error instanceof JobExecutionError ? error.delaySeconds : undefined;
  const delaySeconds =
    explicitDelay ?? Math.min(baseDelaySeconds * 2 ** (normalizedAttempt - 1), maxDelaySeconds);
  return { action: "retry", delaySeconds };
}

function isRetryableJobError(error: unknown): boolean {
  if (error instanceof JobExecutionError) {
    return error.kind === "retryable";
  }
  if (error instanceof FrameworkError) {
    return error.status >= 500;
  }
  if (error instanceof Response) {
    return error.status === 429 || error.status >= 500;
  }
  return false;
}
