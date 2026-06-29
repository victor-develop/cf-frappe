import { badRequest, conflict, permissionDenied } from "../core/errors.js";
import {
  normalizeUserRoles,
  type UserAccountEmailVerificationChallenge,
  type UserAccountRecoveryChallenge,
  type UserAccountState
} from "../core/user-accounts.js";
import { DEFAULT_TENANT_ID, type Actor, type TenantId } from "../core/types.js";

export const MAX_ACCOUNT_RECOVERY_EXPIRY_SECONDS = 604_800;
export const MIN_USER_PASSWORD_LENGTH = 8;

export function ensureUserAccountAdmin(actor: Actor, adminRoles: readonly string[]): void {
  if (!adminRoles.some((role) => actor.roles.includes(role))) {
    throw permissionDenied(`Actor '${actor.id}' cannot manage user accounts`);
  }
}

export function resolveUserAccountActorTenant(actor: Actor, explicitTenantId: TenantId | undefined): TenantId {
  const actorTenantId = actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = explicitTenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    throw permissionDenied(`Actor '${actor.id}' cannot manage user accounts for tenant '${tenantId}'`);
  }
  return tenantId;
}

export function resolveUserAccountSessionTenant(actor: Actor): TenantId {
  return actor.tenantId ?? DEFAULT_TENANT_ID;
}

export function ensureUserAccountSessionCurrent(
  state: UserAccountState,
  accountVersion: number | undefined
): void {
  if (accountVersion === undefined || !state.exists || !state.enabled || state.version !== accountVersion) {
    throw permissionDenied("Session is no longer valid");
  }
}

export function normalizeRequiredUserAccountText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw badRequest(`${label} is required`);
  }
  return normalized;
}

export function normalizeOptionalUserEmail(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 ? undefined : normalized;
}

export function normalizeRequiredUserRoles(roles: readonly string[]): readonly string[] {
  const normalized = normalizeUserRoles(roles);
  if (normalized.length === 0) {
    throw badRequest("At least one role is required");
  }
  return normalized;
}

export function normalizeUserPassword(password: string): string {
  if (password.length < MIN_USER_PASSWORD_LENGTH) {
    throw badRequest(`Password must be at least ${MIN_USER_PASSWORD_LENGTH} characters`);
  }
  return password;
}

export function normalizeUserLoginPassword(password: string): string {
  if (password.length === 0) {
    throw permissionDenied("Invalid credentials");
  }
  return password;
}

export function userAccountPasswordHashForLogin(state: UserAccountState): string {
  if (!state.exists || state.passwordHash === undefined) {
    throw permissionDenied("Invalid credentials");
  }
  return state.passwordHash;
}

export function ensureUserAccountPasswordLoginAllowed(state: UserAccountState, passwordVerified: boolean): void {
  if (!passwordVerified || !state.enabled) {
    throw permissionDenied("Invalid credentials");
  }
}

export function userAccountPasswordResetDeliveryEmail(
  state: UserAccountState,
  recoveryAvailable: boolean
): string | undefined {
  if (!state.exists || !state.enabled || state.passwordHash === undefined || state.email === undefined || !recoveryAvailable) {
    return undefined;
  }
  return state.email;
}

export function userAccountEmailVerificationDeliveryEmail(
  state: UserAccountState,
  recoveryAvailable: boolean
): string | undefined {
  if (!state.exists || !state.enabled || state.email === undefined || state.emailVerifiedAt !== undefined || !recoveryAvailable) {
    return undefined;
  }
  return state.email;
}

export function normalizeUserRecoveryToken(token: string): string {
  const normalized = token.trim();
  if (normalized.length === 0) {
    throw permissionDenied("Invalid recovery token");
  }
  return normalized;
}

export function userAccountRolesEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function ensureUserAccountExpectedVersion(
  state: UserAccountState,
  expectedVersion: number | undefined
): void {
  if (expectedVersion !== undefined && state.version !== expectedVersion) {
    throw conflict(`Expected user account '${state.userId}' at version ${expectedVersion}, found ${state.version}`);
  }
}

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

export function ensureUserRecoveryChallengeUsable(
  state: UserAccountState,
  challenge: UserAccountRecoveryChallenge | UserAccountEmailVerificationChallenge | undefined,
  now: string
): asserts challenge is UserAccountRecoveryChallenge | UserAccountEmailVerificationChallenge {
  if (!state.exists || !state.enabled || challenge === undefined || recoveryChallengeExpired(challenge.expiresAt, now)) {
    throw permissionDenied("Invalid recovery token");
  }
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
