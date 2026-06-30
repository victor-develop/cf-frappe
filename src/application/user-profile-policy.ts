import { badRequest, conflict, notFound, permissionDenied } from "../core/errors.js";
import {
  DEFAULT_TENANT_ID,
  type Actor,
  type TenantId
} from "../core/types.js";
import type { UserAccountState } from "../core/user-accounts.js";
import {
  normalizeUserProfilePatch,
  type UserProfileInput,
  type UserProfilePatch,
  type UserProfileState
} from "../core/user-profiles.js";
import { ensureUserAccountExists } from "./user-account-policy.js";

export function ensureUserProfileServiceAvailable<T>(userProfiles: T | undefined): asserts userProfiles is T {
  if (userProfiles === undefined) {
    throw notFound("User profiles are not enabled");
  }
}

export function resolveUserProfileTenant(command: {
  readonly actor: Actor;
  readonly tenantId?: TenantId | undefined;
  readonly action: string;
}): TenantId {
  const actorTenantId = command.actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = command.tenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    throw permissionDenied(`Actor '${command.actor.id}' cannot ${command.action} for tenant '${tenantId}'`);
  }
  return tenantId;
}

export function normalizeUserProfileRequiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw badRequest(`${label} is required`);
  }
  return normalized;
}

export function authorizeUserProfileAccess(command: {
  readonly actor: Actor;
  readonly userId: string;
  readonly tenantId?: TenantId | undefined;
  readonly adminRoles: readonly string[];
}): TenantId {
  const normalizedUserId = normalizeUserProfileRequiredText(command.userId, "User id");
  const tenantId = resolveUserProfileTenant({
    actor: command.actor,
    tenantId: command.tenantId,
    action: "access user profiles"
  });
  if (isUserProfileAdmin(command.actor, command.adminRoles) || command.actor.id === normalizedUserId) {
    return tenantId;
  }
  throw permissionDenied(`Actor '${command.actor.id}' cannot access user profile '${normalizedUserId}'`);
}

export function normalizeUserProfilePatchInput(input: UserProfileInput | Record<string, unknown>): UserProfilePatch {
  try {
    return normalizeUserProfilePatch(input as Record<string, unknown>);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : "User profile is invalid");
  }
}

export type UserProfilePatchChangeDecision =
  | { readonly status: "write" }
  | { readonly status: "noop" };

export function planUserProfilePatchChange(patch: UserProfilePatch): UserProfilePatchChangeDecision {
  return Object.keys(patch).length === 0 ? { status: "noop" } : { status: "write" };
}

export function ensureUserProfileAccountExists(state: UserAccountState): void {
  ensureUserAccountExists(state);
}

export function ensureUserProfileExpectedVersion(
  state: UserProfileState,
  expectedVersion: number | undefined
): void {
  if (expectedVersion !== undefined && state.version !== expectedVersion) {
    throw conflict(`Expected user profile '${state.userId}' at version ${expectedVersion}, found ${state.version}`);
  }
}

function isUserProfileAdmin(actor: Actor, adminRoles: readonly string[]): boolean {
  return adminRoles.some((role) => actor.roles.includes(role));
}
