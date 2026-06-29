import { badRequest } from "../core/errors.js";

export const MAX_ACCOUNT_RECOVERY_EXPIRY_SECONDS = 604_800;

export function normalizeRecoveryExpirySeconds(value: number | undefined, defaultSeconds: number): number {
  const seconds = value ?? defaultSeconds;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_ACCOUNT_RECOVERY_EXPIRY_SECONDS) {
    throw badRequest(`Recovery token expiry must be between 1 and ${MAX_ACCOUNT_RECOVERY_EXPIRY_SECONDS} seconds`);
  }
  return seconds;
}

export function recoveryExpiresAtFrom(now: string, seconds: number): string {
  const nowMillis = Date.parse(now);
  if (!Number.isFinite(nowMillis)) {
    throw new Error(`Clock returned invalid timestamp '${now}'`);
  }
  return new Date(nowMillis + seconds * 1_000).toISOString();
}

export function recoveryChallengeExpired(expiresAt: string, now: string): boolean {
  return Date.parse(expiresAt) <= Date.parse(now);
}

export function emailVerificationPatch(
  emailVerified: boolean | undefined,
  effectiveEmail: string | undefined,
  currentEmail: string | undefined,
  currentEmailVerifiedAt: string | undefined,
  now: string
): string | null | undefined {
  if (emailVerified === undefined) {
    return undefined;
  }
  if (!emailVerified) {
    return null;
  }
  if (effectiveEmail === undefined) {
    throw badRequest("email is required when emailVerified is true");
  }
  return currentEmail === effectiveEmail ? currentEmailVerifiedAt ?? now : now;
}
