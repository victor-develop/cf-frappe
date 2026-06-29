import { notFound } from "../core/errors.js";
import { customFieldsCatalogStream, customFieldsStream } from "../core/streams.js";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocumentData,
  type FieldDefinition,
  type NewDomainEvent,
  type TenantId
} from "../core/types.js";
import {
  CUSTOM_FIELD_PAYLOAD_KINDS,
  customFieldDisabledPayload,
  customFieldEventType,
  customFieldSavedPayload,
  isCustomFieldEvent,
  type CustomFieldEventPayload
} from "./custom-field-events.js";
import {
  applyCustomFieldsToDocType,
  assertCustomFieldCanExtend,
  foldCustomFields,
  type CustomFieldState
} from "../core/custom-fields.js";
import {
  assertCustomFieldDefaultValueValid,
  assertCustomFieldReferencesResolve,
  assertCustomFieldRuntimeSupported,
  assertCustomTableFieldDoesNotSelfTarget,
  assertCustomTableGraphAcyclicFrom,
  authorizeCustomFieldAdministration,
  ensureCustomFieldExpectedVersion,
  findCustomFieldEntry,
  normalizeCustomField,
  normalizeCustomFieldExpressions,
  normalizeRequiredCustomFieldText,
  planCustomFieldDisable,
  planCustomFieldSave,
  projectPendingCustomFieldState,
  resequenceCustomFieldEventsForFold,
  resolveCustomFieldTenant,
  withSavedCustomFieldCatalogEvents,
  type CustomFieldEventSet
} from "./custom-field-policy.js";
import type { ModelRegistry } from "../core/registry.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { EventStore } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";

export type { CustomFieldEventPayload } from "./custom-field-events.js";

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
    return this.stateFor(resolveCustomFieldTenant({ actor, tenantId }), doctype.name);
  }

  async effectiveDocType(doctypeName: string, tenantId: TenantId = DEFAULT_TENANT_ID) {
    const doctype = this.registry.get(doctypeName);
    const events = await this.tenantCustomFieldEvents(tenantId);
    const state = this.stateFromEvents(tenantId, doctype.name, events);
    const states = this.statesFromEvents(tenantId, events);
    for (const entry of state.fields) {
      if (entry.enabled) {
        assertCustomFieldRuntimeSupported(entry.field);
        assertCustomFieldReferencesResolve(entry.field, (name) => this.registry.has(name));
        assertCustomTableFieldDoesNotSelfTarget(doctype, entry.field);
      }
    }
    assertCustomTableGraphAcyclicFrom(doctype.name, this.registry.list(), states);
    return applyCustomFieldsToDocType(doctype, state);
  }

  async saveField(command: SaveCustomFieldCommand): Promise<CustomFieldState> {
    this.authorizeAdministration(command.actor, command.tenantId);
    const doctype = this.registry.get(command.doctype);
    const tenantId = resolveCustomFieldTenant({ actor: command.actor, tenantId: command.tenantId });
    let field = normalizeCustomField(command.field);
    const events = await this.tenantCustomFieldEvents(tenantId);
    const states = this.statesFromEvents(tenantId, events);
    const state = this.stateFromEvents(tenantId, doctype.name, events);
    assertCustomFieldRuntimeSupported(field);
    assertCustomFieldCanExtend(doctype, field);
    field = normalizeCustomFieldExpressions(doctype, field);
    assertCustomFieldDefaultValueValid(doctype, field);
    assertCustomFieldReferencesResolve(field, (name) => this.registry.has(name));
    assertCustomTableFieldDoesNotSelfTarget(doctype, field);
    assertCustomTableGraphAcyclicFrom(
      doctype.name,
      this.registry.list(),
      projectPendingCustomFieldState(tenantId, states, doctype.name, field, this.clock.now()),
      { doctype: doctype.name, field }
    );
    ensureCustomFieldExpectedVersion(state, command.expectedVersion);
    if (planCustomFieldSave(findCustomFieldEntry(state, field.name), field).status === "noop") {
      return state;
    }
    const stream = customFieldsCatalogStream(tenantId);
    const event = this.event({
      tenantId,
      stream,
      documentName: field.name,
      actor: command.actor,
      ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
      payload: customFieldSavedPayload({
        doctypeName: doctype.name,
        field
      })
    });
    const saved = await this.events.append(stream, state.version, [event]);
    return this.stateFromEvents(tenantId, doctype.name, withSavedCustomFieldCatalogEvents(events, saved));
  }

  async disableField(command: DisableCustomFieldCommand): Promise<CustomFieldState> {
    this.authorizeAdministration(command.actor, command.tenantId);
    const doctype = this.registry.get(command.doctype);
    const tenantId = resolveCustomFieldTenant({ actor: command.actor, tenantId: command.tenantId });
    const fieldName = normalizeRequiredCustomFieldText(command.fieldName, "Custom field name");
    const events = await this.tenantCustomFieldEvents(tenantId);
    const state = this.stateFromEvents(tenantId, doctype.name, events);
    ensureCustomFieldExpectedVersion(state, command.expectedVersion);
    const decision = planCustomFieldDisable(findCustomFieldEntry(state, fieldName));
    if (decision.status === "missing") {
      throw notFound(`Custom field '${fieldName}' was not found`, "DOCUMENT_NOT_FOUND");
    }
    if (decision.status === "noop") {
      return state;
    }
    const stream = customFieldsCatalogStream(tenantId);
    const event = this.event({
      tenantId,
      stream,
      documentName: fieldName,
      actor: command.actor,
      ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
      payload: customFieldDisabledPayload({
        doctypeName: doctype.name,
        fieldName
      })
    });
    const saved = await this.events.append(stream, state.version, [event]);
    return this.stateFromEvents(tenantId, doctype.name, withSavedCustomFieldCatalogEvents(events, saved));
  }

  private async stateFor(tenantId: TenantId, doctype: string): Promise<CustomFieldState> {
    return this.stateFromEvents(tenantId, doctype, await this.tenantCustomFieldEvents(tenantId));
  }

  private async tenantCustomFieldEvents(tenantId: TenantId): Promise<CustomFieldEventSet> {
    const readOptions = {
      payloadKinds: CUSTOM_FIELD_PAYLOAD_KINDS
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
    events: CustomFieldEventSet
  ): CustomFieldState {
    const legacyForDoctype = events.legacy.filter((event) =>
      isCustomFieldEvent(event) && event.payload.doctypeName === doctype
    );
    const folded = foldCustomFields(
      tenantId,
      doctype,
      resequenceCustomFieldEventsForFold([...legacyForDoctype, ...events.catalog])
    );
    return Object.freeze({
      ...folded,
      version: events.catalogVersion
    });
  }

  private statesFromEvents(tenantId: TenantId, events: CustomFieldEventSet): readonly CustomFieldState[] {
    return this.registry.list().map((doctype) => this.stateFromEvents(tenantId, doctype.name, events));
  }

  authorizeAdministration(actor: Actor, tenantId?: TenantId): void {
    authorizeCustomFieldAdministration({ actor, adminRoles: this.adminRoles, tenantId });
  }

  private event(options: {
    readonly tenantId: TenantId;
    readonly stream: string;
    readonly documentName: string;
    readonly actor: Actor;
    readonly metadata?: DocumentData;
    readonly payload: CustomFieldEventPayload;
  }): NewDomainEvent<CustomFieldEventPayload> {
    return {
      id: this.ids.next("evt_"),
      tenantId: options.tenantId,
      stream: options.stream,
      type: customFieldEventType(options.payload),
      doctype: "__CustomFields",
      documentName: options.documentName,
      actorId: options.actor.id,
      occurredAt: this.clock.now(),
      payload: options.payload,
      metadata: options.metadata ?? {}
    };
  }

}
