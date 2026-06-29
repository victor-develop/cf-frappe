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
  type JsonValue,
  type TenantId
} from "../core/types.js";
import { cloneJsonValue, isJsonValue } from "../core/json.js";
import type { FieldPropertyEventPayload } from "./field-property-events.js";

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

export function normalizeFieldPropertyOverrides(
  field: FieldDefinition,
  overrides: FieldPropertyOverrides
): FieldPropertyOverrides {
  if (typeof overrides !== "object" || overrides === null || Array.isArray(overrides)) {
    throw new FrameworkError("FIELD_PROPERTY_INVALID", "Field property overrides must be an object", { status: 400 });
  }
  const normalized: FieldPropertyOverrides = {
    ...optionalTrimmedString(overrides.label, "label", "label"),
    ...optionalTrimmedString(overrides.description, "description", "description"),
    ...optionalTrimmedString(overrides.placeholder, "placeholder", "placeholder"),
    ...optionalBoolean(overrides.required, "required", "required"),
    ...(overrides.mandatoryDependsOn === undefined ? {} : { mandatoryDependsOn: overrides.mandatoryDependsOn }),
    ...optionalBoolean(overrides.readOnly, "readOnly", "readOnly"),
    ...(overrides.readOnlyDependsOn === undefined ? {} : { readOnlyDependsOn: overrides.readOnlyDependsOn }),
    ...optionalBoolean(overrides.hidden, "hidden", "hidden"),
    ...(overrides.hiddenDependsOn === undefined ? {} : { hiddenDependsOn: overrides.hiddenDependsOn }),
    ...optionalBoolean(overrides.printHide, "printHide", "printHide"),
    ...optionalBoolean(overrides.printHideIfNoValue, "printHideIfNoValue", "printHideIfNoValue"),
    ...optionalBoolean(overrides.noCopy, "noCopy", "noCopy"),
    ...optionalBoolean(overrides.allowOnSubmit, "allowOnSubmit", "allowOnSubmit"),
    ...optionalTrimmedString(overrides.fetchFrom, "fetchFrom", "fetchFrom"),
    ...optionalBoolean(overrides.fetchIfEmpty, "fetchIfEmpty", "fetchIfEmpty"),
    ...optionalBoolean(overrides.inFormView, "inFormView", "inFormView"),
    ...optionalBoolean(overrides.inGlobalSearch, "inGlobalSearch", "inGlobalSearch"),
    ...optionalBoolean(overrides.inListView, "inListView", "inListView"),
    ...optionalBoolean(overrides.inListFilter, "inListFilter", "inListFilter"),
    ...optionalNumber(overrides.min, "min", "min"),
    ...optionalNumber(overrides.max, "max", "max"),
    ...optionalOptions(field, overrides.options),
    ...optionalDefaultValue(field, overrides.defaultValue)
  };
  if (Object.keys(normalized).length === 0) {
    throw new FrameworkError("FIELD_PROPERTY_INVALID", "At least one field property override is required", {
      status: 400
    });
  }
  if (normalized.inListFilter && field.type === "table") {
    throw new FrameworkError("FIELD_PROPERTY_INVALID", `Table field '${field.name}' cannot be a list filter`, {
      status: 400
    });
  }
  const min = normalized.min ?? field.min;
  const max = normalized.max ?? field.max;
  if (min !== undefined && max !== undefined && min > max) {
    throw new FrameworkError("FIELD_PROPERTY_INVALID", `Field '${field.name}' min cannot exceed max`, { status: 400 });
  }
  return Object.freeze(normalized);
}

export function normalizeFieldPropertyOverrideExpressions(
  effective: DocTypeDefinition,
  fieldName: string,
  overrides: FieldPropertyOverrides
): FieldPropertyOverrides {
  const field = effective.fields.find((item) => item.name === fieldName);
  if (field === undefined) {
    throw new FrameworkError("FIELD_PROPERTY_INVALID", `Field '${fieldName}' was not normalized on ${effective.name}`, {
      status: 400
    });
  }
  return Object.freeze({
    ...overrides,
    ...(overrides.mandatoryDependsOn === undefined ? {} : { mandatoryDependsOn: field.mandatoryDependsOn }),
    ...(overrides.readOnlyDependsOn === undefined ? {} : { readOnlyDependsOn: field.readOnlyDependsOn }),
    ...(overrides.hiddenDependsOn === undefined ? {} : { hiddenDependsOn: field.hiddenDependsOn })
  });
}

export function fieldPropertyEventDocumentName(payload: FieldPropertyEventPayload): string {
  return "fieldName" in payload ? payload.fieldName : "override";
}

function optionalTrimmedString<TKey extends string>(
  value: string | undefined,
  field: string,
  key: TKey
): { readonly [K in TKey]?: string } {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "string") {
    throw new FrameworkError("FIELD_PROPERTY_INVALID", `${field} must be a string`, { status: 400 });
  }
  const normalized = value.trim();
  return normalized.length === 0 ? {} : { [key]: normalized } as { readonly [K in TKey]: string };
}

function optionalBoolean<TKey extends string>(
  value: boolean | undefined,
  field: string,
  key: TKey
): { readonly [K in TKey]?: boolean } {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "boolean") {
    throw new FrameworkError("FIELD_PROPERTY_INVALID", `${field} must be a boolean`, { status: 400 });
  }
  return { [key]: value } as { readonly [K in TKey]: boolean };
}

function optionalNumber<TKey extends string>(
  value: number | undefined,
  field: string,
  key: TKey
): { readonly [K in TKey]?: number } {
  if (value === undefined) {
    return {};
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new FrameworkError("FIELD_PROPERTY_INVALID", `${field} must be a finite number`, { status: 400 });
  }
  return { [key]: value } as { readonly [K in TKey]: number };
}

function optionalOptions(
  field: FieldDefinition,
  value: readonly string[] | undefined
): { readonly options?: readonly string[] } {
  if (value === undefined) {
    return {};
  }
  if (field.type !== "select") {
    throw new FrameworkError("FIELD_PROPERTY_INVALID", "Only select fields can override options", { status: 400 });
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new FrameworkError("FIELD_PROPERTY_INVALID", "options must contain at least one item", { status: 400 });
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const option of value) {
    const item = normalizeRequiredFieldPropertyText(option, "Option");
    if (seen.has(item)) {
      throw new FrameworkError("FIELD_PROPERTY_INVALID", `options contains duplicate '${item}'`, { status: 400 });
    }
    seen.add(item);
    normalized.push(item);
  }
  return { options: Object.freeze(normalized) };
}

function optionalDefaultValue(
  field: FieldDefinition,
  value: FieldPropertyOverrides["defaultValue"] | undefined
): { readonly defaultValue?: JsonValue } {
  if (value === undefined) {
    return {};
  }
  if (!isJsonValue(value)) {
    throw new FrameworkError(
      "FIELD_PROPERTY_INVALID",
      `Field '${field.name}' defaultValue must be JSON-serializable`,
      { status: 400 }
    );
  }
  return { defaultValue: cloneJsonValue(value) };
}
