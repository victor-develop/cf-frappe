import { conflict, FrameworkError, permissionDenied } from "../core/errors.js";
import { fieldPropertyOverridesStream } from "../core/streams.js";
import {
  applyFieldPropertyOverridesToDocType,
  foldFieldPropertyOverrides,
  type FieldPropertyOverrideState
} from "../core/field-property-overrides.js";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocTypeDefinition,
  type DocumentData,
  type FieldDefinition,
  type FieldPropertyOverrides,
  type JsonValue,
  type NewDomainEvent,
  type TenantId
} from "../core/types.js";
import type { FieldPropertyEventPayload } from "./field-property-events.js";
import type { ModelRegistry } from "../core/registry.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { EventStore } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";

export type { FieldPropertyEventPayload } from "./field-property-events.js";

export type PrePropertyDocTypeResolver = (
  base: DocTypeDefinition,
  context: { readonly tenantId: TenantId }
) => DocTypeDefinition | Promise<DocTypeDefinition>;

export interface FieldPropertyServiceOptions {
  readonly registry: ModelRegistry;
  readonly events: EventStore;
  readonly ids?: IdGenerator;
  readonly clock?: Clock;
  readonly adminRoles?: readonly string[];
  readonly prePropertyDocTypeResolver?: PrePropertyDocTypeResolver;
}

export interface SaveFieldPropertyOverrideCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly fieldName: string;
  readonly overrides: FieldPropertyOverrides;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface ClearFieldPropertyOverrideCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly fieldName: string;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export class FieldPropertyService {
  private readonly registry: ModelRegistry;
  private readonly events: EventStore;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;
  private readonly adminRoles: readonly string[];
  private readonly prePropertyDocTypeResolver: PrePropertyDocTypeResolver | undefined;

  constructor(options: FieldPropertyServiceOptions) {
    this.registry = options.registry;
    this.events = options.events;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.clock = options.clock ?? systemClock;
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
    this.prePropertyDocTypeResolver = options.prePropertyDocTypeResolver;
  }

  async list(actor: Actor, doctypeName: string, tenantId?: TenantId): Promise<FieldPropertyOverrideState> {
    this.authorizeAdministration(actor, tenantId);
    const doctype = this.registry.get(doctypeName);
    return this.stateFor(resolveActorTenant(actor, tenantId), doctype.name);
  }

  async effectiveDocType(
    doctypeName: string,
    tenantId: TenantId = DEFAULT_TENANT_ID,
    base?: DocTypeDefinition
  ): Promise<DocTypeDefinition> {
    const doctype = base ?? await this.prePropertyDocTypeFor(doctypeName, tenantId);
    return applyFieldPropertyOverridesToDocType(doctype, await this.stateFor(tenantId, doctype.name));
  }

  authorizeAdministration(actor: Actor, tenantId?: TenantId): void {
    this.ensureAdmin(actor);
    resolveActorTenant(actor, tenantId);
  }

  async save(command: SaveFieldPropertyOverrideCommand): Promise<FieldPropertyOverrideState> {
    this.authorizeAdministration(command.actor, command.tenantId);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const doctype = await this.prePropertyDocTypeFor(command.doctype, tenantId);
    const field = requireField(doctype, command.fieldName);
    let overrides = normalizeOverrides(field, command.overrides);
    const state = await this.stateFor(tenantId, doctype.name);
    ensureExpectedVersion(state, command.expectedVersion);
    const pending = replaceStateOverride(state, field.name, overrides, this.clock.now());
    const effective = applyFieldPropertyOverridesToDocType(doctype, pending);
    overrides = normalizeOverrideExpressions(effective, field.name, overrides);
    const existing = state.fields.find((entry) => entry.fieldName === field.name);
    if (existing && jsonEqual(existing.overrides, overrides)) {
      return state;
    }
    return this.appendAndFold(state, {
      actor: command.actor,
      type: "FieldPropertyOverrideSaved",
      metadata: command.metadata,
      payload: {
        kind: "FieldPropertyOverrideSaved",
        doctypeName: doctype.name,
        fieldName: field.name,
        overrides
      }
    });
  }

  async clear(command: ClearFieldPropertyOverrideCommand): Promise<FieldPropertyOverrideState> {
    this.authorizeAdministration(command.actor, command.tenantId);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const doctype = await this.prePropertyDocTypeFor(command.doctype, tenantId);
    const fieldName = normalizeRequired(command.fieldName, "Field name");
    const state = await this.stateFor(tenantId, doctype.name);
    ensureExpectedVersion(state, command.expectedVersion);
    const existing = state.fields.find((entry) => entry.fieldName === fieldName);
    if (!doctype.fields.some((field) => field.name === fieldName) && !existing) {
      throw new FrameworkError("FIELD_PROPERTY_INVALID", `Field '${fieldName}' is not defined on ${doctype.name}`, {
        status: 400
      });
    }
    if (!existing) {
      return state;
    }
    return this.appendAndFold(state, {
      actor: command.actor,
      type: "FieldPropertyOverrideCleared",
      metadata: command.metadata,
      payload: {
        kind: "FieldPropertyOverrideCleared",
        doctypeName: doctype.name,
        fieldName
      }
    });
  }

  private async stateFor(tenantId: TenantId, doctypeName: string): Promise<FieldPropertyOverrideState> {
    return foldFieldPropertyOverrides(
      tenantId,
      doctypeName,
      await this.events.readStream(fieldPropertyOverridesStream(tenantId), {
        payloadKinds: ["FieldPropertyOverrideSaved", "FieldPropertyOverrideCleared"]
      })
    );
  }

  private async prePropertyDocTypeFor(doctypeName: string, tenantId: TenantId): Promise<DocTypeDefinition> {
    const base = this.registry.get(doctypeName);
    return this.prePropertyDocTypeResolver ? await this.prePropertyDocTypeResolver(base, { tenantId }) : base;
  }

  private async appendAndFold<TPayload extends FieldPropertyEventPayload>(
    state: FieldPropertyOverrideState,
    options: {
      readonly actor: Actor;
      readonly type: string;
      readonly metadata: DocumentData | undefined;
      readonly payload: TPayload;
    }
  ): Promise<FieldPropertyOverrideState> {
    const stream = fieldPropertyOverridesStream(state.tenantId);
    const event: NewDomainEvent<TPayload> = {
      id: this.ids.next("evt_"),
      tenantId: state.tenantId,
      stream,
      type: options.type,
      doctype: "__FieldProperties",
      documentName: `${state.doctype}:${documentNameForPayload(options.payload)}`,
      actorId: options.actor.id,
      occurredAt: this.clock.now(),
      payload: options.payload,
      metadata: options.metadata ?? {}
    };
    const saved = await this.events.append(stream, state.version, [event]);
    return foldFieldPropertyOverrides(
      state.tenantId,
      state.doctype,
      [...(await this.events.readStream(stream, { maxSequence: state.version })), ...saved]
    );
  }

  private ensureAdmin(actor: Actor): void {
    if (!this.adminRoles.some((role) => actor.roles.includes(role))) {
      throw permissionDenied(`Actor '${actor.id}' cannot manage field properties`);
    }
  }
}

function requireField(doctype: DocTypeDefinition, fieldName: string): FieldDefinition {
  const normalized = normalizeRequired(fieldName, "Field name");
  const field = doctype.fields.find((item) => item.name === normalized);
  if (!field) {
    throw new FrameworkError("FIELD_PROPERTY_INVALID", `Field '${normalized}' is not defined on ${doctype.name}`, {
      status: 400
    });
  }
  return field;
}

function normalizeOverrides(field: FieldDefinition, overrides: FieldPropertyOverrides): FieldPropertyOverrides {
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

function normalizeOverrideExpressions(
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

function replaceStateOverride(
  state: FieldPropertyOverrideState,
  fieldName: string,
  overrides: FieldPropertyOverrides,
  now: string
): FieldPropertyOverrideState {
  const existing = state.fields.find((entry) => entry.fieldName === fieldName);
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
    throw new FrameworkError("FIELD_PROPERTY_INVALID", `Only select fields can override options`, { status: 400 });
  }
  if (!Array.isArray(value) || value.length === 0) {
    throw new FrameworkError("FIELD_PROPERTY_INVALID", "options must contain at least one item", { status: 400 });
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const option of value) {
    const item = normalizeRequired(option, "Option");
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
  return { defaultValue: value };
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return true;
  }
  if (typeof value === "number") {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return value.every((item) => isJsonValue(item, seen));
  }
  if (typeof value !== "object") {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }
  if (seen.has(value)) {
    return false;
  }
  seen.add(value);
  return Object.values(value).every((item) => item !== undefined && isJsonValue(item, seen));
}

function normalizeRequired(value: string, label: string): string {
  if (typeof value !== "string") {
    throw new FrameworkError("FIELD_PROPERTY_INVALID", `${label} must be a string`, { status: 400 });
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new FrameworkError("FIELD_PROPERTY_INVALID", `${label} is required`, { status: 400 });
  }
  return normalized;
}

function ensureExpectedVersion(state: FieldPropertyOverrideState, expectedVersion: number | undefined): void {
  if (expectedVersion !== undefined && state.version !== expectedVersion) {
    throw conflict(`Expected field property overrides at version ${expectedVersion}, found ${state.version}`);
  }
}

function resolveActorTenant(actor: Actor, explicitTenantId: TenantId | undefined): TenantId {
  const actorTenantId = actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = explicitTenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    throw permissionDenied(`Actor '${actor.id}' cannot manage field properties for tenant '${tenantId}'`);
  }
  return tenantId;
}

function documentNameForPayload(payload: NewDomainEvent["payload"]): string {
  return "fieldName" in payload ? payload.fieldName : "override";
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
