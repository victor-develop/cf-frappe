import { badRequest, conflict, permissionDenied } from "../core/errors.js";
import {
  DEFAULT_TENANT_ID,
  type Actor,
  type TenantId
} from "../core/types.js";
import {
  normalizeUserPermissionGrant,
  type UserPermissionGrant,
  type UserPermissionState
} from "../core/user-permissions.js";

export function resolveUserPermissionTenant(command: {
  readonly actor: Actor;
  readonly tenantId?: TenantId | undefined;
}): TenantId {
  const actorTenantId = command.actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = command.tenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    throw permissionDenied(`Actor '${command.actor.id}' cannot manage user permissions for tenant '${tenantId}'`);
  }
  return tenantId;
}

export function normalizeUserPermissionRequiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw badRequest(`${label} is required`);
  }
  return normalized;
}

export function normalizeValidUserPermissionGrant(grant: UserPermissionGrant): UserPermissionGrant {
  const normalized = normalizeUserPermissionGrant(grant);
  if (normalized.targetDoctype.length === 0) {
    throw badRequest("Target DocType is required");
  }
  if (normalized.targetName.length === 0) {
    throw badRequest("Target name is required");
  }
  return normalized;
}

export function authorizeUserPermissionAdministration(command: {
  readonly actor: Actor;
  readonly adminRoles: readonly string[];
  readonly tenantId?: TenantId | undefined;
}): TenantId {
  if (!command.adminRoles.some((role) => command.actor.roles.includes(role))) {
    throw permissionDenied(`Actor '${command.actor.id}' cannot manage user permissions`);
  }
  return resolveUserPermissionTenant(command);
}

export function ensureUserPermissionExpectedVersion(
  state: UserPermissionState,
  expectedVersion: number | undefined
): void {
  if (expectedVersion !== undefined && state.version !== expectedVersion) {
    throw conflict(`Expected user permissions for '${state.userId}' at version ${expectedVersion}, found ${state.version}`);
  }
}
