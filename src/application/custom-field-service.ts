import { badRequest, conflict, FrameworkError, notFound, permissionDenied } from "../core/errors.js";
import { customFieldsStream } from "../core/streams.js";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocumentData,
  type FieldDefinition,
  type NewDomainEvent,
  type PersistedFieldDefinition,
  type TenantId
} from "../core/types.js";
import {
  applyCustomFieldsToDocType,
  assertCustomFieldCanExtend,
  foldCustomFields,
  type CustomFieldState
} from "../core/custom-fields.js";
import type { ModelRegistry } from "../core/registry.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { EventStore } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";

export interface CustomFieldServiceOptions {
  readonly registry: ModelRegistry;
  readonly events: EventStore;
  readonly ids?: IdGenerator;
  readonly clock?: Clock;
  readonly adminRoles?: readonly string[];
}

export interface SaveCustomFieldCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly field: FieldDefinition;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface DisableCustomFieldCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly fieldName: string;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export class CustomFieldService {
  private readonly registry: ModelRegistry;
  private readonly events: EventStore;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;
  private readonly adminRoles: readonly string[];

  constructor(options: CustomFieldServiceOptions) {
    this.registry = options.registry;
    this.events = options.events;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.clock = options.clock ?? systemClock;
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
  }

  async list(actor: Actor, doctypeName: string, tenantId?: TenantId): Promise<CustomFieldState> {
    this.authorizeAdministration(actor, tenantId);
    const doctype = this.registry.get(doctypeName);
    return this.stateFor(resolveActorTenant(actor, tenantId), doctype.name);
  }

  async effectiveDocType(doctypeName: string, tenantId: TenantId = DEFAULT_TENANT_ID) {
    const doctype = this.registry.get(doctypeName);
    const state = await this.stateFor(tenantId, doctype.name);
    if (state.fields.some((entry) => entry.enabled)) {
      this.assertCustomFieldsSupportedOn(doctype);
    }
    for (const entry of state.fields) {
      if (entry.enabled) {
        this.assertCustomFieldRuntimeSupported(entry.field);
        this.assertReferencesResolve(entry.field);
      }
    }
    return applyCustomFieldsToDocType(doctype, state);
  }

  async saveField(command: SaveCustomFieldCommand): Promise<CustomFieldState> {
    this.authorizeAdministration(command.actor, command.tenantId);
    const doctype = this.registry.get(command.doctype);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const field = normalizeField(command.field);
    this.assertCustomFieldRuntimeSupported(field);
    this.assertCustomFieldsSupportedOn(doctype);
    assertCustomFieldCanExtend(doctype, field);
    this.assertReferencesResolve(field);
    const state = await this.stateFor(tenantId, doctype.name);
    ensureExpectedVersion(state, command.expectedVersion);
    const existing = state.fields.find((entry) => entry.field.name === field.name);
    if (existing?.enabled && fieldsEqual(existing.field, field)) {
      return state;
    }
    const stream = customFieldsStream(tenantId, doctype.name);
    const event = this.event({
      tenantId,
      stream,
      documentName: field.name,
      actor: command.actor,
      ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
      payload: {
        kind: "CustomFieldSaved",
        doctypeName: doctype.name,
        field
      }
    });
    const saved = await this.events.append(stream, state.version, [event]);
    return foldCustomFields(tenantId, doctype.name, [...(await this.events.readStream(stream, { maxSequence: state.version })), ...saved]);
  }

  async disableField(command: DisableCustomFieldCommand): Promise<CustomFieldState> {
    this.authorizeAdministration(command.actor, command.tenantId);
    const doctype = this.registry.get(command.doctype);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const fieldName = normalizeRequired(command.fieldName, "Custom field name");
    const state = await this.stateFor(tenantId, doctype.name);
    ensureExpectedVersion(state, command.expectedVersion);
    const existing = state.fields.find((entry) => entry.field.name === fieldName);
    if (!existing) {
      throw notFound(`Custom field '${fieldName}' was not found`, "DOCUMENT_NOT_FOUND");
    }
    if (!existing.enabled) {
      return state;
    }
    const stream = customFieldsStream(tenantId, doctype.name);
    const event = this.event({
      tenantId,
      stream,
      documentName: fieldName,
      actor: command.actor,
      ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
      payload: {
        kind: "CustomFieldDisabled",
        doctypeName: doctype.name,
        fieldName
      }
    });
    const saved = await this.events.append(stream, state.version, [event]);
    return foldCustomFields(tenantId, doctype.name, [...(await this.events.readStream(stream, { maxSequence: state.version })), ...saved]);
  }

  private async stateFor(tenantId: TenantId, doctype: string): Promise<CustomFieldState> {
    return foldCustomFields(tenantId, doctype, await this.events.readStream(customFieldsStream(tenantId, doctype), {
      payloadKinds: ["CustomFieldSaved", "CustomFieldDisabled"]
    }));
  }

  private assertReferencesResolve(field: FieldDefinition): void {
    if (field.type === "link" && field.linkTo !== undefined && !this.registry.has(field.linkTo)) {
      throw badRequest(`Custom field '${field.name}' links to unknown DocType '${field.linkTo}'`);
    }
    if (field.type === "table" && field.tableOf !== undefined && !this.registry.has(field.tableOf)) {
      throw badRequest(`Custom field '${field.name}' targets unknown child DocType '${field.tableOf}'`);
    }
  }

  private assertCustomFieldRuntimeSupported(field: FieldDefinition): void {
    if (field.type !== "table") {
      return;
    }
    throw new FrameworkError(
      "CUSTOM_FIELD_INVALID",
      `Custom field '${field.name}' cannot be a table field until recursive table overlays are supported`,
      { status: 400 }
    );
  }

  private assertCustomFieldsSupportedOn(doctype: { readonly name: string }): void {
    const parent = this.registry
      .list()
      .find((candidate) =>
        candidate.fields.some((field) => field.type === "table" && field.tableOf === doctype.name)
      );
    if (!parent) {
      return;
    }
    throw new FrameworkError(
      "CUSTOM_FIELD_INVALID",
      `Custom fields on child table DocType '${doctype.name}' are not supported yet`,
      { status: 400 }
    );
  }

  authorizeAdministration(actor: Actor, tenantId?: TenantId): void {
    this.ensureAdmin(actor);
    resolveActorTenant(actor, tenantId);
  }

  private event(options: {
    readonly tenantId: TenantId;
    readonly stream: string;
    readonly documentName: string;
    readonly actor: Actor;
    readonly metadata?: DocumentData;
    readonly payload: NewDomainEvent["payload"];
  }): NewDomainEvent {
    return {
      id: this.ids.next("evt_"),
      tenantId: options.tenantId,
      stream: options.stream,
      type: options.payload.kind,
      doctype: "__CustomFields",
      documentName: options.documentName,
      actorId: options.actor.id,
      occurredAt: this.clock.now(),
      payload: options.payload,
      metadata: options.metadata ?? {}
    };
  }

  private ensureAdmin(actor: Actor): void {
    if (!this.adminRoles.some((role) => actor.roles.includes(role))) {
      throw permissionDenied(`Actor '${actor.id}' cannot manage custom fields`);
    }
  }
}

function normalizeField(field: FieldDefinition): PersistedFieldDefinition {
  const name = normalizeRequired(field.name, "Custom field name");
  const label = field.label?.trim();
  if (typeof field.defaultValue === "function") {
    throw new FrameworkError(
      "CUSTOM_FIELD_INVALID",
      `Custom field '${name}' defaultValue must be JSON-serializable`,
      { status: 400 }
    );
  }
  return Object.freeze({
    name,
    type: field.type,
    ...(label === undefined || label.length === 0 ? {} : { label }),
    ...(field.required === undefined ? {} : { required: field.required }),
    ...(field.readOnly === undefined ? {} : { readOnly: field.readOnly }),
    ...(field.hidden === undefined ? {} : { hidden: field.hidden }),
    ...(field.inFormView === undefined ? {} : { inFormView: field.inFormView }),
    ...(field.inListView === undefined ? {} : { inListView: field.inListView }),
    ...(field.inListFilter === undefined ? {} : { inListFilter: field.inListFilter }),
    ...(field.options === undefined ? {} : { options: Object.freeze([...field.options]) }),
    ...(field.linkTo === undefined ? {} : { linkTo: field.linkTo }),
    ...(field.tableOf === undefined ? {} : { tableOf: field.tableOf }),
    ...(field.min === undefined ? {} : { min: field.min }),
    ...(field.max === undefined ? {} : { max: field.max }),
    ...(field.defaultValue === undefined ? {} : { defaultValue: field.defaultValue })
  });
}

function normalizeRequired(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw badRequest(`${label} is required`);
  }
  return normalized;
}

function resolveActorTenant(actor: Actor, explicitTenantId: TenantId | undefined): TenantId {
  const actorTenantId = actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = explicitTenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    throw permissionDenied(`Actor '${actor.id}' cannot manage custom fields for tenant '${tenantId}'`);
  }
  return tenantId;
}

function ensureExpectedVersion(state: CustomFieldState, expectedVersion: number | undefined): void {
  if (expectedVersion !== undefined && state.version !== expectedVersion) {
    throw conflict(`Expected custom fields for '${state.doctype}' at version ${expectedVersion}, found ${state.version}`);
  }
}

function fieldsEqual(left: FieldDefinition, right: FieldDefinition): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
