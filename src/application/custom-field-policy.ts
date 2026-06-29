import { cloneJsonValue, isJsonValue } from "../core/json.js";
import { badRequest, conflict, FrameworkError, permissionDenied } from "../core/errors.js";
import { defineDocType, validateDocumentData } from "../core/schema.js";
import {
  DEFAULT_TENANT_ID,
  type Actor,
  type DocTypeDefinition,
  type DomainEvent,
  type FieldDefinition,
  type PersistedFieldDefinition,
  type TenantId
} from "../core/types.js";
import type { CustomFieldState } from "../core/custom-fields.js";

export interface CustomFieldEventSet {
  readonly catalog: readonly DomainEvent[];
  readonly legacy: readonly DomainEvent[];
  readonly catalogVersion: number;
}

export interface CustomFieldTableGraphBlame {
  readonly doctype: string;
  readonly field: FieldDefinition;
}

interface CustomFieldTableGraphEdge {
  readonly source: string;
  readonly target: string;
  readonly fieldName: string;
  readonly custom: boolean;
}

export function resolveCustomFieldTenant(command: {
  readonly actor: Actor;
  readonly tenantId?: TenantId | undefined;
}): TenantId {
  const actorTenantId = command.actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = command.tenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    throw permissionDenied(`Actor '${command.actor.id}' cannot manage custom fields for tenant '${tenantId}'`);
  }
  return tenantId;
}

export function authorizeCustomFieldAdministration(command: {
  readonly actor: Actor;
  readonly adminRoles: readonly string[];
  readonly tenantId?: TenantId | undefined;
}): TenantId {
  if (!command.adminRoles.some((role) => command.actor.roles.includes(role))) {
    throw permissionDenied(`Actor '${command.actor.id}' cannot manage custom fields`);
  }
  return resolveCustomFieldTenant(command);
}

export function normalizeRequiredCustomFieldText(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new FrameworkError("CUSTOM_FIELD_INVALID", `${label} must be a string`, { status: 400 });
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new FrameworkError("CUSTOM_FIELD_INVALID", `${label} is required`, { status: 400 });
  }
  return normalized;
}

export function normalizeCustomField(field: FieldDefinition): PersistedFieldDefinition {
  const name = normalizeRequiredCustomFieldText(field.name, "Custom field name");
  const label = field.label?.trim();
  const linkTo = trimmedOptional(field.linkTo);
  const tableOf = trimmedOptional(field.tableOf);
  let defaultValue: PersistedFieldDefinition["defaultValue"];
  if (field.defaultValue !== undefined) {
    if (!isJsonValue(field.defaultValue)) {
      throw new FrameworkError(
        "CUSTOM_FIELD_INVALID",
        `Custom field '${name}' defaultValue must be JSON-serializable`,
        { status: 400 }
      );
    }
    defaultValue = cloneJsonValue(field.defaultValue);
  }
  return Object.freeze({
    name,
    type: field.type,
    ...(label === undefined || label.length === 0 ? {} : { label }),
    ...(field.description === undefined || field.description.trim().length === 0
      ? {}
      : { description: field.description.trim() }),
    ...(field.placeholder === undefined || field.placeholder.trim().length === 0
      ? {}
      : { placeholder: field.placeholder.trim() }),
    ...(field.required === undefined ? {} : { required: field.required }),
    ...(field.mandatoryDependsOn === undefined ? {} : { mandatoryDependsOn: field.mandatoryDependsOn }),
    ...(field.readOnly === undefined ? {} : { readOnly: field.readOnly }),
    ...(field.readOnlyDependsOn === undefined ? {} : { readOnlyDependsOn: field.readOnlyDependsOn }),
    ...(field.hidden === undefined ? {} : { hidden: field.hidden }),
    ...(field.hiddenDependsOn === undefined ? {} : { hiddenDependsOn: field.hiddenDependsOn }),
    ...(field.printHide === undefined ? {} : { printHide: field.printHide }),
    ...(field.printHideIfNoValue === undefined ? {} : { printHideIfNoValue: field.printHideIfNoValue }),
    ...(field.unique === undefined ? {} : { unique: field.unique }),
    ...(field.noCopy === undefined ? {} : { noCopy: field.noCopy }),
    ...(field.allowOnSubmit === undefined ? {} : { allowOnSubmit: field.allowOnSubmit }),
    ...(field.fetchFrom === undefined || field.fetchFrom.trim().length === 0 ? {} : { fetchFrom: field.fetchFrom.trim() }),
    ...(field.fetchIfEmpty === undefined ? {} : { fetchIfEmpty: field.fetchIfEmpty }),
    ...(field.inFormView === undefined ? {} : { inFormView: field.inFormView }),
    ...(field.inListView === undefined ? {} : { inListView: field.inListView }),
    ...(field.inListFilter === undefined ? {} : { inListFilter: field.inListFilter }),
    ...customFieldOptions(field),
    ...(linkTo === undefined ? {} : { linkTo }),
    ...(tableOf === undefined ? {} : { tableOf }),
    ...customFieldBounds(name, field),
    ...(defaultValue === undefined ? {} : { defaultValue })
  });
}

export function normalizeCustomFieldExpressions(
  base: DocTypeDefinition,
  field: PersistedFieldDefinition
): PersistedFieldDefinition {
  const composed = defineDocType({
    ...base,
    fields: Object.freeze([...base.fields, field])
  });
  const normalized = composed.fields.find((item) => item.name === field.name);
  if (normalized === undefined) {
    throw new FrameworkError("CUSTOM_FIELD_INVALID", `Custom field '${field.name}' was not normalized`, { status: 400 });
  }
  return Object.freeze({
    ...field,
    ...(normalized.mandatoryDependsOn === undefined ? {} : { mandatoryDependsOn: normalized.mandatoryDependsOn }),
    ...(normalized.readOnlyDependsOn === undefined ? {} : { readOnlyDependsOn: normalized.readOnlyDependsOn }),
    ...(normalized.hiddenDependsOn === undefined ? {} : { hiddenDependsOn: normalized.hiddenDependsOn })
  });
}

export function assertCustomFieldDefaultValueValid(
  base: DocTypeDefinition,
  field: PersistedFieldDefinition
): void {
  if (field.defaultValue === undefined) {
    return;
  }
  const issues = validateDocumentData(
    { ...base, fields: Object.freeze([...base.fields, field]) },
    { [field.name]: field.defaultValue },
    { partial: true }
  );
  if (issues.length > 0) {
    throw new FrameworkError("CUSTOM_FIELD_INVALID", issues[0]?.message ?? "Custom field default value is invalid", {
      status: 400,
      issues
    });
  }
}

export function ensureCustomFieldExpectedVersion(
  state: CustomFieldState,
  expectedVersion: number | undefined
): void {
  if (expectedVersion !== undefined && state.version !== expectedVersion) {
    throw conflict(`Expected custom fields for '${state.doctype}' at version ${expectedVersion}, found ${state.version}`);
  }
}

export function customFieldsEqual(left: FieldDefinition, right: FieldDefinition): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function projectPendingCustomFieldState(
  tenantId: TenantId,
  states: readonly CustomFieldState[],
  doctype: string,
  field: PersistedFieldDefinition,
  now: string
): readonly CustomFieldState[] {
  return states.map((state) => {
    if (state.doctype !== doctype) {
      return state;
    }
    const existing = state.fields.find((entry) => entry.field.name === field.name);
    return Object.freeze({
      ...state,
      fields: Object.freeze([
        ...state.fields.filter((entry) => entry.field.name !== field.name),
        {
          tenantId,
          doctype,
          field,
          enabled: true,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now
        }
      ])
    });
  });
}

export function withSavedCustomFieldCatalogEvents(
  events: CustomFieldEventSet,
  saved: readonly DomainEvent[]
): CustomFieldEventSet {
  return {
    ...events,
    catalog: Object.freeze([...events.catalog, ...saved]),
    catalogVersion: saved.reduce((version, event) => Math.max(version, event.sequence), events.catalogVersion)
  };
}

export function resequenceCustomFieldEventsForFold(events: readonly DomainEvent[]): readonly DomainEvent[] {
  return events.map((event, index) => ({
    ...event,
    sequence: index + 1
  }));
}

export function assertCustomFieldReferencesResolve(
  field: FieldDefinition,
  hasDocType: (name: string) => boolean
): void {
  if (field.type === "link" && field.linkTo !== undefined && !hasDocType(field.linkTo)) {
    throw badRequest(`Custom field '${field.name}' links to unknown DocType '${field.linkTo}'`);
  }
  if (field.type === "table" && field.tableOf !== undefined && !hasDocType(field.tableOf)) {
    throw badRequest(`Custom field '${field.name}' targets unknown child DocType '${field.tableOf}'`);
  }
}

export function assertCustomFieldRuntimeSupported(field: FieldDefinition): void {
  if (field.type !== "table") {
    return;
  }
  if (field.inListFilter) {
    throw new FrameworkError("CUSTOM_FIELD_INVALID", `Custom table field '${field.name}' cannot be a list filter`, {
      status: 400
    });
  }
}

export function assertCustomTableFieldDoesNotSelfTarget(
  doctype: { readonly name: string },
  field: FieldDefinition
): void {
  if (field.type !== "table" || field.tableOf !== doctype.name) {
    return;
  }
  throw new FrameworkError(
    "CUSTOM_FIELD_INVALID",
    `Custom table field '${field.name}' cannot target its own DocType '${doctype.name}' until recursive table overlays are supported`,
    { status: 400 }
  );
}

export function assertCustomTableGraphAcyclicFrom(
  root: string,
  doctypes: readonly DocTypeDefinition[],
  states: readonly CustomFieldState[],
  blame?: CustomFieldTableGraphBlame
): void {
  const graph = customFieldTableGraph(doctypes, states);
  const visited = new Set<string>();
  const visit = (doctype: string, path: readonly string[]): void => {
    visited.add(doctype);
    for (const edge of graph.get(doctype) ?? []) {
      const cycleStart = path.indexOf(edge.target);
      if (cycleStart >= 0) {
        throwRecursiveCustomTableField(edge, [...path.slice(cycleStart), edge.target], blame);
      }
      if (!visited.has(edge.target)) {
        visit(edge.target, [...path, edge.target]);
      }
    }
  };
  visit(root, [root]);
}

function customFieldTableGraph(
  doctypes: readonly DocTypeDefinition[],
  states: readonly CustomFieldState[]
): ReadonlyMap<string, readonly CustomFieldTableGraphEdge[]> {
  const graph = new Map<string, CustomFieldTableGraphEdge[]>();
  const add = (edge: CustomFieldTableGraphEdge) => {
    graph.set(edge.source, [...(graph.get(edge.source) ?? []), edge]);
  };
  for (const doctype of doctypes) {
    for (const field of doctype.fields) {
      if (field.type === "table" && field.tableOf) {
        add({ source: doctype.name, target: field.tableOf, fieldName: field.name, custom: false });
      }
    }
  }
  for (const state of states) {
    for (const entry of state.fields) {
      if (entry.enabled && entry.field.type === "table" && entry.field.tableOf) {
        add({
          source: state.doctype,
          target: entry.field.tableOf,
          fieldName: entry.field.name,
          custom: true
        });
      }
    }
  }
  return graph;
}

function throwRecursiveCustomTableField(
  edge: CustomFieldTableGraphEdge,
  path: readonly string[],
  blame: CustomFieldTableGraphBlame | undefined
): never {
  const field = blame?.field ?? { name: edge.fieldName };
  const prefix = blame || edge.custom
    ? `Custom table field '${field.name}'`
    : `Table field '${edge.fieldName}' on DocType '${edge.source}'`;
  throw new FrameworkError(
    "CUSTOM_FIELD_INVALID",
    `${prefix} creates recursive table path ${path.join(" -> ")}, which is not supported until recursive table controls are supported`,
    { status: 400 }
  );
}

function trimmedOptional(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function customFieldBounds(
  name: string,
  field: FieldDefinition
): { readonly min?: number; readonly max?: number } {
  const min = customFieldBound(field.min, "min");
  const max = customFieldBound(field.max, "max");
  if (min !== undefined && max !== undefined && min > max) {
    throw new FrameworkError("CUSTOM_FIELD_INVALID", `Custom field '${name}' min cannot exceed max`, { status: 400 });
  }
  return {
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max })
  };
}

function customFieldBound(value: number | undefined, field: "min" | "max"): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new FrameworkError("CUSTOM_FIELD_INVALID", `${field} must be a finite number`, { status: 400 });
  }
  return value;
}

function customFieldOptions(field: FieldDefinition): { readonly options?: readonly string[] } {
  if (field.options === undefined) {
    return {};
  }
  if (field.type !== "select") {
    throw new FrameworkError("CUSTOM_FIELD_INVALID", "Only select custom fields can define options", { status: 400 });
  }
  if (!Array.isArray(field.options) || field.options.length === 0) {
    throw new FrameworkError("CUSTOM_FIELD_INVALID", "options must contain at least one item", { status: 400 });
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const option of field.options) {
    const item = normalizeCustomFieldOption(option);
    if (seen.has(item)) {
      throw new FrameworkError("CUSTOM_FIELD_INVALID", `options contains duplicate '${item}'`, { status: 400 });
    }
    seen.add(item);
    normalized.push(item);
  }
  return { options: Object.freeze(normalized) };
}

function normalizeCustomFieldOption(value: string): string {
  if (typeof value !== "string") {
    throw new FrameworkError("CUSTOM_FIELD_INVALID", "Option must be a string", { status: 400 });
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new FrameworkError("CUSTOM_FIELD_INVALID", "Option is required", { status: 400 });
  }
  return normalized;
}
