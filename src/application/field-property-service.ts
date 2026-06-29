import { FrameworkError } from "../core/errors.js";
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
  type FieldPropertyOverrides,
  type NewDomainEvent,
  type TenantId
} from "../core/types.js";
import {
  FIELD_PROPERTY_PAYLOAD_KINDS,
  fieldPropertyEventType,
  fieldPropertyOverrideClearedPayload,
  fieldPropertyOverrideSavedPayload,
  type FieldPropertyEventPayload
} from "./field-property-events.js";
import {
  authorizeFieldPropertyAdministration,
  ensureFieldPropertyExpectedVersion,
  fieldPropertyEventDocumentName,
  findFieldPropertyOverride,
  normalizeFieldPropertyOverrideExpressions,
  normalizeFieldPropertyOverrides,
  normalizeRequiredFieldPropertyText,
  planFieldPropertyOverrideClear,
  planFieldPropertyOverrideSave,
  replaceFieldPropertyOverride,
  requireFieldPropertyField
} from "./field-property-policy.js";
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
    const resolvedTenantId = this.authorizeAdministration(actor, tenantId);
    const doctype = this.registry.get(doctypeName);
    return this.stateFor(resolvedTenantId, doctype.name);
  }

  async effectiveDocType(
    doctypeName: string,
    tenantId: TenantId = DEFAULT_TENANT_ID,
    base?: DocTypeDefinition
  ): Promise<DocTypeDefinition> {
    const doctype = base ?? await this.prePropertyDocTypeFor(doctypeName, tenantId);
    return applyFieldPropertyOverridesToDocType(doctype, await this.stateFor(tenantId, doctype.name));
  }

  authorizeAdministration(actor: Actor, tenantId?: TenantId): TenantId {
    return authorizeFieldPropertyAdministration({ actor, tenantId, adminRoles: this.adminRoles });
  }

  async save(command: SaveFieldPropertyOverrideCommand): Promise<FieldPropertyOverrideState> {
    const tenantId = this.authorizeAdministration(command.actor, command.tenantId);
    const doctype = await this.prePropertyDocTypeFor(command.doctype, tenantId);
    const field = requireFieldPropertyField(doctype, command.fieldName);
    let overrides = normalizeFieldPropertyOverrides(field, command.overrides);
    const state = await this.stateFor(tenantId, doctype.name);
    ensureFieldPropertyExpectedVersion(state, command.expectedVersion);
    const pending = replaceFieldPropertyOverride(state, field.name, overrides, this.clock.now());
    const effective = applyFieldPropertyOverridesToDocType(doctype, pending);
    overrides = normalizeFieldPropertyOverrideExpressions(effective, field.name, overrides);
    const existing = findFieldPropertyOverride(state, field.name);
    if (planFieldPropertyOverrideSave(existing, overrides).status === "noop") {
      return state;
    }
    return this.appendAndFold(state, {
      actor: command.actor,
      metadata: command.metadata,
      payload: fieldPropertyOverrideSavedPayload({
        doctypeName: doctype.name,
        fieldName: field.name,
        overrides
      })
    });
  }

  async clear(command: ClearFieldPropertyOverrideCommand): Promise<FieldPropertyOverrideState> {
    const tenantId = this.authorizeAdministration(command.actor, command.tenantId);
    const doctype = await this.prePropertyDocTypeFor(command.doctype, tenantId);
    const fieldName = normalizeRequiredFieldPropertyText(command.fieldName, "Field name");
    const state = await this.stateFor(tenantId, doctype.name);
    ensureFieldPropertyExpectedVersion(state, command.expectedVersion);
    const existing = findFieldPropertyOverride(state, fieldName);
    if (!doctype.fields.some((field) => field.name === fieldName) && !existing) {
      throw new FrameworkError("FIELD_PROPERTY_INVALID", `Field '${fieldName}' is not defined on ${doctype.name}`, {
        status: 400
      });
    }
    if (planFieldPropertyOverrideClear(existing).status === "noop") {
      return state;
    }
    return this.appendAndFold(state, {
      actor: command.actor,
      metadata: command.metadata,
      payload: fieldPropertyOverrideClearedPayload({
        doctypeName: doctype.name,
        fieldName
      })
    });
  }

  private async stateFor(tenantId: TenantId, doctypeName: string): Promise<FieldPropertyOverrideState> {
    return foldFieldPropertyOverrides(
      tenantId,
      doctypeName,
      await this.events.readStream(fieldPropertyOverridesStream(tenantId), {
        payloadKinds: FIELD_PROPERTY_PAYLOAD_KINDS
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
      readonly metadata: DocumentData | undefined;
      readonly payload: TPayload;
    }
  ): Promise<FieldPropertyOverrideState> {
    const stream = fieldPropertyOverridesStream(state.tenantId);
    const event: NewDomainEvent<TPayload> = {
      id: this.ids.next("evt_"),
      tenantId: state.tenantId,
      stream,
      type: fieldPropertyEventType(options.payload),
      doctype: "__FieldProperties",
      documentName: `${state.doctype}:${fieldPropertyEventDocumentName(options.payload)}`,
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
}
