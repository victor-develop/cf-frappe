import { badRequest, conflict, FrameworkError, notFound, permissionDenied } from "../core/errors.js";
import { customFieldsCatalogStream, customFieldsStream } from "../core/streams.js";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocumentData,
  type DomainEvent,
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

interface TenantCustomFieldEvents {
  readonly catalog: readonly DomainEvent[];
  readonly legacy: readonly DomainEvent[];
  readonly catalogVersion: number;
}

interface TableGraphEdge {
  readonly source: string;
  readonly target: string;
  readonly fieldName: string;
  readonly custom: boolean;
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
    const events = await this.tenantCustomFieldEvents(tenantId);
    const state = this.stateFromEvents(tenantId, doctype.name, events);
    const states = this.statesFromEvents(tenantId, events);
    for (const entry of state.fields) {
      if (entry.enabled) {
        this.assertCustomFieldRuntimeSupported(entry.field);
        this.assertReferencesResolve(entry.field);
        this.assertTableFieldDoesNotSelfTarget(doctype, entry.field);
      }
    }
    this.assertTableGraphAcyclicFrom(doctype.name, states);
    return applyCustomFieldsToDocType(doctype, state);
  }

  async saveField(command: SaveCustomFieldCommand): Promise<CustomFieldState> {
    this.authorizeAdministration(command.actor, command.tenantId);
    const doctype = this.registry.get(command.doctype);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const field = normalizeField(command.field);
    const events = await this.tenantCustomFieldEvents(tenantId);
    const states = this.statesFromEvents(tenantId, events);
    const state = this.stateFromEvents(tenantId, doctype.name, events);
    this.assertCustomFieldRuntimeSupported(field);
    assertCustomFieldCanExtend(doctype, field);
    this.assertReferencesResolve(field);
    this.assertTableFieldDoesNotSelfTarget(doctype, field);
    this.assertTableGraphAcyclicFrom(
      doctype.name,
      statesWithPendingField(tenantId, states, doctype.name, field, this.clock.now()),
      { doctype: doctype.name, field }
    );
    ensureExpectedVersion(state, command.expectedVersion);
    const existing = state.fields.find((entry) => entry.field.name === field.name);
    if (existing?.enabled && fieldsEqual(existing.field, field)) {
      return state;
    }
    const stream = customFieldsCatalogStream(tenantId);
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
    return this.stateFromEvents(tenantId, doctype.name, withSavedCatalogEvents(events, saved));
  }

  async disableField(command: DisableCustomFieldCommand): Promise<CustomFieldState> {
    this.authorizeAdministration(command.actor, command.tenantId);
    const doctype = this.registry.get(command.doctype);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const fieldName = normalizeRequired(command.fieldName, "Custom field name");
    const events = await this.tenantCustomFieldEvents(tenantId);
    const state = this.stateFromEvents(tenantId, doctype.name, events);
    ensureExpectedVersion(state, command.expectedVersion);
    const existing = state.fields.find((entry) => entry.field.name === fieldName);
    if (!existing) {
      throw notFound(`Custom field '${fieldName}' was not found`, "DOCUMENT_NOT_FOUND");
    }
    if (!existing.enabled) {
      return state;
    }
    const stream = customFieldsCatalogStream(tenantId);
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
    return this.stateFromEvents(tenantId, doctype.name, withSavedCatalogEvents(events, saved));
  }

  private async stateFor(tenantId: TenantId, doctype: string): Promise<CustomFieldState> {
    return this.stateFromEvents(tenantId, doctype, await this.tenantCustomFieldEvents(tenantId));
  }

  private async tenantCustomFieldEvents(tenantId: TenantId): Promise<TenantCustomFieldEvents> {
    const readOptions = {
      payloadKinds: ["CustomFieldSaved", "CustomFieldDisabled"]
    } as const;
    const catalog = await this.events.readStream(customFieldsCatalogStream(tenantId), readOptions);
    const legacy = (
      await Promise.all(
        this.registry.list().map((doctype) => this.events.readStream(customFieldsStream(tenantId, doctype.name), readOptions))
      )
    ).flat();
    return {
      catalog,
      legacy,
      catalogVersion: catalog.reduce((version, event) => Math.max(version, event.sequence), 0)
    };
  }

  private stateFromEvents(
    tenantId: TenantId,
    doctype: string,
    events: TenantCustomFieldEvents
  ): CustomFieldState {
    const legacyForDoctype = events.legacy.filter((event) =>
      (event.payload.kind === "CustomFieldSaved" || event.payload.kind === "CustomFieldDisabled") &&
      event.payload.doctypeName === doctype
    );
    const folded = foldCustomFields(tenantId, doctype, resequenceForFold([...legacyForDoctype, ...events.catalog]));
    return Object.freeze({
      ...folded,
      version: events.catalogVersion
    });
  }

  private statesFromEvents(tenantId: TenantId, events: TenantCustomFieldEvents): readonly CustomFieldState[] {
    return this.registry.list().map((doctype) => this.stateFromEvents(tenantId, doctype.name, events));
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
    if (field.inListFilter) {
      throw new FrameworkError(
        "CUSTOM_FIELD_INVALID",
        `Custom table field '${field.name}' cannot be a list filter`,
        { status: 400 }
      );
    }
  }

  private assertTableFieldDoesNotSelfTarget(
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

  private assertTableGraphAcyclicFrom(
    root: string,
    states: readonly CustomFieldState[],
    blame?: { readonly doctype: string; readonly field: FieldDefinition }
  ): void {
    const graph = this.tableGraph(states);
    const visited = new Set<string>();
    const visit = (doctype: string, path: readonly string[]): void => {
      visited.add(doctype);
      for (const edge of graph.get(doctype) ?? []) {
        const cycleStart = path.indexOf(edge.target);
        if (cycleStart >= 0) {
          this.throwRecursiveTableField(edge, [...path.slice(cycleStart), edge.target], blame);
        }
        if (!visited.has(edge.target)) {
          visit(edge.target, [...path, edge.target]);
        }
      }
    };
    visit(root, [root]);
  }

  private tableGraph(states: readonly CustomFieldState[]): ReadonlyMap<string, readonly TableGraphEdge[]> {
    const graph = new Map<string, TableGraphEdge[]>();
    const add = (edge: TableGraphEdge) => {
      graph.set(edge.source, [...(graph.get(edge.source) ?? []), edge]);
    };
    for (const doctype of this.registry.list()) {
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

  private throwRecursiveTableField(
    edge: TableGraphEdge,
    path: readonly string[],
    blame: { readonly doctype: string; readonly field: FieldDefinition } | undefined
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
    ...(field.description === undefined || field.description.trim().length === 0
      ? {}
      : { description: field.description.trim() }),
    ...(field.required === undefined ? {} : { required: field.required }),
    ...(field.readOnly === undefined ? {} : { readOnly: field.readOnly }),
    ...(field.hidden === undefined ? {} : { hidden: field.hidden }),
    ...(field.unique === undefined ? {} : { unique: field.unique }),
    ...(field.noCopy === undefined ? {} : { noCopy: field.noCopy }),
    ...(field.allowOnSubmit === undefined ? {} : { allowOnSubmit: field.allowOnSubmit }),
    ...(field.fetchFrom === undefined || field.fetchFrom.trim().length === 0 ? {} : { fetchFrom: field.fetchFrom.trim() }),
    ...(field.fetchIfEmpty === undefined ? {} : { fetchIfEmpty: field.fetchIfEmpty }),
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

function statesWithPendingField(
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

function withSavedCatalogEvents(
  events: TenantCustomFieldEvents,
  saved: readonly DomainEvent[]
): TenantCustomFieldEvents {
  return {
    ...events,
    catalog: Object.freeze([...events.catalog, ...saved]),
    catalogVersion: saved.reduce((version, event) => Math.max(version, event.sequence), events.catalogVersion)
  };
}

function resequenceForFold(events: readonly DomainEvent[]): readonly DomainEvent[] {
  return events.map((event, index) => ({
    ...event,
    sequence: index + 1
  }));
}
