import { badRequest, conflict, notFound } from "../core/errors.js";
import type { AutomationRunRecord } from "./automation-run-events.js";

export const AUTOMATION_RUN_DEFAULT_CLAIM_LIMIT = 25;
export const AUTOMATION_RUN_MAX_CLAIM_LIMIT = 100;
export const AUTOMATION_RUN_DEFAULT_CLAIM_LEASE_SECONDS = 300;
export const AUTOMATION_RUN_MAX_CLAIM_LEASE_SECONDS = 3_600;
export const AUTOMATION_RUN_DEFAULT_MAX_ATTEMPTS = 10;
export const AUTOMATION_RUN_DEFAULT_RETRY_BASE_DELAY_SECONDS = 30;
export const AUTOMATION_RUN_DEFAULT_RETRY_MAX_DELAY_SECONDS = 1_800;

export function ensureAutomationRunServiceAvailable<T>(service: T | undefined): asserts service is T {
  if (service === undefined) {
    throw notFound("Automation runs are not enabled", "AUTOMATION_RUN_NOT_FOUND");
  }
}

export function automationRunClaimLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return AUTOMATION_RUN_DEFAULT_CLAIM_LIMIT;
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > AUTOMATION_RUN_MAX_CLAIM_LIMIT) {
    throw badRequest(`Automation run claim limit must be an integer between 1 and ${AUTOMATION_RUN_MAX_CLAIM_LIMIT}`);
  }
  return limit;
}

export function automationRunClaimLeaseSeconds(value: number | undefined): number {
  if (value === undefined) {
    return AUTOMATION_RUN_DEFAULT_CLAIM_LEASE_SECONDS;
  }
  if (!Number.isSafeInteger(value) || value < 1 || value > AUTOMATION_RUN_MAX_CLAIM_LEASE_SECONDS) {
    throw badRequest(
      `Automation run claim lease seconds must be an integer between 1 and ${AUTOMATION_RUN_MAX_CLAIM_LEASE_SECONDS}`
    );
  }
  return value;
}

export function automationRunFailureError(error: string): string {
  const normalized = error.trim();
  if (!normalized) {
    throw badRequest("Automation run failure error is required");
  }
  return normalized;
}

export function automationRunRetryAt(input: {
  readonly now: string;
  readonly attempts: number;
  readonly baseDelaySeconds: number;
  readonly maxDelaySeconds: number;
}): string {
  const delay = Math.min(
    input.maxDelaySeconds,
    input.baseDelaySeconds * 2 ** Math.max(0, input.attempts - 1)
  );
  return new Date(Date.parse(input.now) + delay * 1000).toISOString();
}

export function automationRunRetryDue(record: AutomationRunRecord, now: string): boolean {
  return record.retryAt === undefined || record.retryAt <= now;
}

export function automationRunClaimExpired(record: AutomationRunRecord, now: string): boolean {
  return record.status === "claimed" && record.claimExpiresAt !== undefined && record.claimExpiresAt <= now;
}

export function claimableAutomationRuns(
  records: readonly AutomationRunRecord[],
  now: string,
  limit: number
): readonly AutomationRunRecord[] {
  return records
    .filter((record) =>
      record.status === "pending" ||
      (record.status === "failed" && automationRunRetryDue(record, now)) ||
      automationRunClaimExpired(record, now)
    )
    .sort((left, right) => left.enqueuedAt.localeCompare(right.enqueuedAt) || left.id.localeCompare(right.id))
    .slice(0, limit);
}

export function ensureAutomationRunClaimed(record: AutomationRunRecord, claimId: string): void {
  if (record.status !== "claimed" || record.claimId !== claimId) {
    throw conflict(`Automation run '${record.id}' is not claimed by '${claimId}'`);
  }
}

export function automationRunShouldDeadLetter(record: AutomationRunRecord): boolean {
  return record.attempts >= record.retry.maxAttempts;
}

export function normalizeAutomationRunRetryPolicy(value: {
  readonly maxAttempts?: number;
  readonly baseDelaySeconds?: number;
  readonly maxDelaySeconds?: number;
} = {}): { readonly maxAttempts: number; readonly baseDelaySeconds: number; readonly maxDelaySeconds: number } {
  const maxAttempts = value.maxAttempts ?? AUTOMATION_RUN_DEFAULT_MAX_ATTEMPTS;
  const baseDelaySeconds = value.baseDelaySeconds ?? AUTOMATION_RUN_DEFAULT_RETRY_BASE_DELAY_SECONDS;
  const maxDelaySeconds = value.maxDelaySeconds ?? AUTOMATION_RUN_DEFAULT_RETRY_MAX_DELAY_SECONDS;
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw badRequest("Automation run retry maxAttempts must be a positive integer");
  }
  if (!Number.isSafeInteger(baseDelaySeconds) || baseDelaySeconds < 1) {
    throw badRequest("Automation run retry baseDelaySeconds must be a positive integer");
  }
  if (!Number.isSafeInteger(maxDelaySeconds) || maxDelaySeconds < baseDelaySeconds) {
    throw badRequest("Automation run retry maxDelaySeconds must be greater than or equal to baseDelaySeconds");
  }
  return { maxAttempts, baseDelaySeconds, maxDelaySeconds };
}
