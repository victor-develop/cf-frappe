import { badRequest, conflict, notFound, permissionDenied } from "../core/errors.js";
import {
  normalizeRoleName,
  type RoleCatalogState,
  type RoleRecord
} from "../core/roles.js";
import {
  DEFAULT_TENANT_ID,
  type Actor,
  type TenantId
} from "../core/types.js";

export function ensureRoleServiceAvailable<T>(roles: T | undefined): asserts roles is T {
  if (roles === undefined) {
    throw notFound("Roles are not enabled");
  }
}

export function resolveRoleTenant(command: {
  readonly actor: Actor;
  readonly tenantId?: TenantId | undefined;
}): TenantId {
  const actorTenantId = command.actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = command.tenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    throw permissionDenied(`Actor '${command.actor.id}' cannot manage roles for tenant '${tenantId}'`);
  }
  return tenantId;
}

export function authorizeRoleAdministration(command: {
  readonly actor: Actor;
  readonly adminRoles: readonly string[];
  readonly tenantId?: TenantId | undefined;
}): TenantId {
  if (!command.adminRoles.some((role) => command.actor.roles.includes(role))) {
    throw permissionDenied(`Actor '${command.actor.id}' cannot manage roles`);
  }
  return resolveRoleTenant(command);
}

export function normalizeRequiredRoleName(role: string): string {
  const normalized = normalizeRoleName(role);
  if (normalized.length === 0) {
    throw badRequest("Role name is required");
  }
  if (normalized.includes("/")) {
    throw badRequest("Role name cannot contain '/'");
  }
  return normalized;
}

export function existingRole(state: RoleCatalogState, role: string): RoleRecord {
  const existing = state.roles.find((item) => item.name === role);
  if (!existing) {
    throw notFound(`Role '${role}' was not found`);
  }
  return existing;
}

export type RoleChangeDecision =
  | { readonly status: "append" }
  | { readonly status: "noop" };

export function planRoleDescriptionChange(
  existing: RoleRecord,
  description: string | undefined
): RoleChangeDecision {
  return existing.description === description ? { status: "noop" } : { status: "append" };
}

export function planRoleStatusChange(
  existing: RoleRecord,
  enabled: boolean
): RoleChangeDecision {
  return existing.enabled === enabled ? { status: "noop" } : { status: "append" };
}

export function ensureRoleDoesNotExist(state: RoleCatalogState, role: string): void {
  if (state.roles.some((existing) => existing.name === role)) {
    throw conflict(`Role '${role}' already exists`);
  }
}

export function ensureRoleExpectedVersion(
  state: RoleCatalogState,
  expectedVersion: number | undefined
): void {
  if (expectedVersion !== undefined && state.version !== expectedVersion) {
    throw conflict(`Expected role catalog at version ${expectedVersion}, found ${state.version}`);
  }
}
