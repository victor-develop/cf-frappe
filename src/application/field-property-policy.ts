import {
  type FieldPropertyOverrideEntry,
  type FieldPropertyOverrideState
} from "../core/field-property-overrides.js";
import { conflict, FrameworkError, permissionDenied } from "../core/errors.js";
import {
  DEFAULT_TENANT_ID,
  type Actor,
  type DocTypeDefinition,
  type FieldDefinition,
  type FieldPropertyOverrides,
  type TenantId
} from "../core/types.js";

export function resolveFieldPropertyTenant(command: {
  readonly actor: Actor;
  readonly tenantId?: TenantId | undefined;
}): TenantId {
  const actorTenantId = command.actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = command.tenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    throw permissionDenied(`Actor '${command.actor.id}' cannot manage field properties for tenant '${tenantId}'`);
  }
  return tenantId;
}

export function authorizeFieldPropertyAdministration(command: {
  readonly actor: Actor;
  readonly adminRoles: readonly string[];
  readonly tenantId?: TenantId | undefined;
}): TenantId {
  if (!command.adminRoles.some((role) => command.actor.roles.includes(role))) {
    throw permissionDenied(`Actor '${command.actor.id}' cannot manage field properties`);
  }
  return resolveFieldPropertyTenant(command);
}

export function normalizeRequiredFieldPropertyText(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new FrameworkError("FIELD_PROPERTY_INVALID", `${label} must be a string`, { status: 400 });
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new FrameworkError("FIELD_PROPERTY_INVALID", `${label} is required`, { status: 400 });
  }
  return normalized;
}

export function requireFieldPropertyField(doctype: DocTypeDefinition, fieldName: string): FieldDefinition {
  const normalized = normalizeRequiredFieldPropertyText(fieldName, "Field name");
  const field = doctype.fields.find((item) => item.name === normalized);
  if (!field) {
    throw new FrameworkError("FIELD_PROPERTY_INVALID", `Field '${normalized}' is not defined on ${doctype.name}`, {
      status: 400
    });
  }
  return field;
}

export function ensureFieldPropertyExpectedVersion(
  state: FieldPropertyOverrideState,
  expectedVersion: number | undefined
): void {
  if (expectedVersion !== undefined && state.version !== expectedVersion) {
    throw conflict(`Expected field property overrides at version ${expectedVersion}, found ${state.version}`);
  }
}

export function findFieldPropertyOverride(
  state: FieldPropertyOverrideState,
  fieldName: string
): FieldPropertyOverrideEntry | undefined {
  return state.fields.find((entry) => entry.fieldName === fieldName);
}

export function fieldPropertyOverridesEqual(
  left: FieldPropertyOverrides,
  right: FieldPropertyOverrides
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function replaceFieldPropertyOverride(
  state: FieldPropertyOverrideState,
  fieldName: string,
  overrides: FieldPropertyOverrides,
  now: string
): FieldPropertyOverrideState {
  const existing = findFieldPropertyOverride(state, fieldName);
  return Object.freeze({
    ...state,
    fields: Object.freeze([
      ...state.fields.filter((entry) => entry.fieldName !== fieldName),
      {
        tenantId: state.tenantId,
        doctype: state.doctype,
        fieldName,
        overrides,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now
      }
    ].sort((left, right) => left.fieldName.localeCompare(right.fieldName)))
  });
}
