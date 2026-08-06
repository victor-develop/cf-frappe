import { foldDocument } from "../core/events.js";
import { FrameworkError, permissionDenied } from "../core/errors.js";
import {
  applyNamingConfigurationToDocType,
  foldNamingConfiguration,
  type NamingConfigurationState
} from "../core/naming-configuration.js";
import {
  namingSeriesCurrentValue,
  nextNamingCandidates,
  normalizeNamingStrategy,
  resolveNamingSeriesIdentity,
  type NamingCandidate
} from "../core/naming.js";
import type { ModelRegistry } from "../core/registry.js";
import { namingConfigurationStream, namingSeriesStream } from "../core/streams.js";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocTypeDefinition,
  type DocumentData,
  type DocumentSnapshot,
  type NamingSeriesStrategy,
  type NamingStrategy,
  type NewDomainEvent,
  type TenantId
} from "../core/types.js";
import type { DocumentStore } from "../ports/document-store.js";
import type { EventStore } from "../ports/event-store.js";
import {
  appendMetadataMutation,
  metadataRevisionVersion,
  type MetadataMutationStore
} from "./metadata-revision.js";
import { systemClock, type Clock } from "../ports/clock.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";
import {
  snapshotFromCommittedDocumentEvent,
  snapshotFromDocumentCreatedEvent
} from "./document-lifecycle-events.js";
import {
  namingSeriesEventCommand,
  planNamingSeriesEvent
} from "./document-naming.js";
import {
  namingEventType,
  namingStrategyClearedPayload,
  namingStrategySavedPayload,
  type NamingEventPayload
} from "./naming-events.js";

export type PreNamingDocTypeResolver = (
  base: DocTypeDefinition,
  context: { readonly tenantId: TenantId }
) => DocTypeDefinition | Promise<DocTypeDefinition>;

export interface NamingServiceOptions {
  readonly registry: ModelRegistry;
  readonly events: MetadataMutationStore;
  readonly store: DocumentStore;
  readonly ids?: IdGenerator;
  readonly clock?: Clock;
  readonly adminRoles?: readonly string[];
  readonly preNamingDocTypeResolver?: PreNamingDocTypeResolver;
}

export interface SaveNamingStrategyCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly strategy: NamingStrategy;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface ClearNamingStrategyCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface PreviewNamingCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly data?: DocumentData;
  readonly count?: number;
  readonly tenantId?: TenantId;
}

export interface AdjustNamingCounterCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly current: number;
  readonly data?: DocumentData;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface NamingPreview {
  readonly tenantId: TenantId;
  readonly doctype: string;
  readonly counter: string;
  readonly scope: string;
  readonly counterVersion: number;
  readonly current?: number;
  readonly candidates: readonly NamingCandidate[];
}

export class NamingService {
  private readonly registry: ModelRegistry;
  private readonly events: MetadataMutationStore;
  private readonly store: DocumentStore;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;
  private readonly adminRoles: readonly string[];
  private readonly preNamingDocTypeResolver: PreNamingDocTypeResolver | undefined;

  constructor(options: NamingServiceOptions) {
    this.registry = options.registry;
    this.events = options.events;
    this.store = options.store;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.clock = options.clock ?? systemClock;
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
    this.preNamingDocTypeResolver = options.preNamingDocTypeResolver;
  }

  async get(actor: Actor, doctypeName: string, tenantId?: TenantId): Promise<NamingConfigurationState> {
    const resolvedTenantId = this.authorizeAdministration(actor, tenantId);
    const doctype = await this.preNamingDocTypeFor(doctypeName, resolvedTenantId);
    return this.stateFor(resolvedTenantId, doctype);
  }

  async effectiveDocType(
    doctypeName: string,
    tenantId: TenantId = DEFAULT_TENANT_ID,
    base?: DocTypeDefinition
  ): Promise<DocTypeDefinition> {
    const doctype = base ?? await this.preNamingDocTypeFor(doctypeName, tenantId);
    return applyNamingConfigurationToDocType(doctype, await this.stateFor(tenantId, doctype));
  }

  async save(command: SaveNamingStrategyCommand): Promise<NamingConfigurationState> {
    const tenantId = this.authorizeAdministration(command.actor, command.tenantId);
    const metadataRevision = await metadataRevisionVersion(this.events, tenantId, command.doctype);
    const doctype = await this.preNamingDocTypeFor(command.doctype, tenantId);
    const strategy = normalizeNamingStrategy(doctype, command.strategy);
    const state = await this.stateFor(tenantId, doctype);
    ensureExpectedVersion(state.version, command.expectedVersion, "Naming configuration");
    if (sameJson(state.runtimeStrategy, strategy)) {
      return state;
    }
    const stream = namingConfigurationStream(tenantId, doctype.name);
    const event = this.configurationEvent({
      tenantId,
      stream,
      actor: command.actor,
      doctypeName: doctype.name,
      payload: namingStrategySavedPayload(doctype.name, strategy),
      ...(command.metadata === undefined ? {} : { metadata: command.metadata })
    });
    await appendMetadataMutation(this.events, {
      tenantId,
      doctype: doctype.name,
      sourceStream: stream,
      sourceExpectedVersion: state.version,
      sourceEvent: event,
      metadataRevision
    });
    return this.stateFor(tenantId, doctype);
  }

  async clear(command: ClearNamingStrategyCommand): Promise<NamingConfigurationState> {
    const tenantId = this.authorizeAdministration(command.actor, command.tenantId);
    const metadataRevision = await metadataRevisionVersion(this.events, tenantId, command.doctype);
    const doctype = await this.preNamingDocTypeFor(command.doctype, tenantId);
    const state = await this.stateFor(tenantId, doctype);
    ensureExpectedVersion(state.version, command.expectedVersion, "Naming configuration");
    if (state.runtimeStrategy === undefined) {
      return state;
    }
    const stream = namingConfigurationStream(tenantId, doctype.name);
    const event = this.configurationEvent({
      tenantId,
      stream,
      actor: command.actor,
      doctypeName: doctype.name,
      payload: namingStrategyClearedPayload(doctype.name),
      ...(command.metadata === undefined ? {} : { metadata: command.metadata })
    });
    await appendMetadataMutation(this.events, {
      tenantId,
      doctype: doctype.name,
      sourceStream: stream,
      sourceExpectedVersion: state.version,
      sourceEvent: event,
      metadataRevision
    });
    return this.stateFor(tenantId, doctype);
  }

  async preview(command: PreviewNamingCommand): Promise<NamingPreview> {
    const tenantId = this.authorizeAdministration(command.actor, command.tenantId);
    const doctype = await this.effectiveDocType(command.doctype, tenantId);
    const strategy = requireSeriesStrategy(doctype);
    const data = command.data ?? {};
    const context = { tenantId, now: this.clock.now() };
    const identity = resolveNamingSeriesIdentity(doctype, strategy, data, context);
    const stream = namingSeriesStream(tenantId, doctype.name, identity.counter, identity.scope);
    const existing = foldDocument(await this.store.readStream(stream));
    const current = namingSeriesCurrentValue(existing?.data.current);
    return Object.freeze({
      tenantId,
      doctype: doctype.name,
      counter: identity.counter,
      scope: identity.scope,
      counterVersion: existing?.version ?? 0,
      ...(current === undefined ? {} : { current }),
      candidates: nextNamingCandidates({
        doctype,
        strategy,
        data,
        context,
        ...(current === undefined ? {} : { current }),
        ...(command.count === undefined ? {} : { count: command.count })
      })
    });
  }

  async adjust(command: AdjustNamingCounterCommand): Promise<NamingPreview> {
    const tenantId = this.authorizeAdministration(command.actor, command.tenantId);
    if (!Number.isSafeInteger(command.current) || command.current < 0) {
      throw new FrameworkError("NAMING_INVALID", "Naming counter current value must be a non-negative safe integer", {
        status: 400
      });
    }
    const doctype = await this.effectiveDocType(command.doctype, tenantId);
    const strategy = requireSeriesStrategy(doctype);
    const data = command.data ?? {};
    const now = this.clock.now();
    const context = { tenantId, now };
    const identity = resolveNamingSeriesIdentity(doctype, strategy, data, context);
    const stream = namingSeriesStream(tenantId, doctype.name, identity.counter, identity.scope);
    const existing = foldDocument(await this.store.readStream(stream));
    ensureExpectedVersion(existing?.version ?? 0, command.expectedVersion, "Naming counter");
    const current = namingSeriesCurrentValue(existing?.data.current);
    if (current !== undefined && command.current < current) {
      throw new FrameworkError(
        "NAMING_INVALID",
        `Naming counter can only move forward from ${String(current)}`,
        { status: 409 }
      );
    }
    if (current !== command.current) {
      const plan = planNamingSeriesEvent({
        doctypeName: doctype.name,
        pattern: strategy.pattern,
        counter: identity.counter,
        scope: identity.scope,
        next: command.current,
        existing
      });
      const event = {
        ...namingSeriesEventCommand({
          tenantId,
          stream,
          actorId: command.actor.id,
          occurredAt: now,
          plan
        }),
        id: this.ids.next("evt_"),
        metadata: { ...(command.metadata ?? {}), ...plan.metadata }
      };
      await this.store.commit(stream, existing?.version ?? 0, [event], (saved) => {
        const [committed] = saved;
        if (committed === undefined) {
          throw new FrameworkError("NAMING_INVALID", "Naming counter event was not committed", { status: 500 });
        }
        return existing === null
          ? snapshotFromDocumentCreatedEvent(committed)
          : snapshotFromCommittedDocumentEvent(existing, committed, {
              data: {
                ...existing.data,
                ...(committed.payload.kind === "DocumentUpdated" ? committed.payload.patch : {}),
                current: command.current
              }
            });
      });
    }
    return this.preview({
      actor: command.actor,
      doctype: doctype.name,
      data,
      tenantId,
      count: 5
    });
  }

  authorizeAdministration(actor: Actor, tenantId?: TenantId): TenantId {
    const resolvedTenantId = tenantId ?? actor.tenantId ?? DEFAULT_TENANT_ID;
    if (actor.tenantId !== undefined && actor.tenantId !== resolvedTenantId) {
      throw permissionDenied(`Actor '${actor.id}' cannot administer naming for tenant '${resolvedTenantId}'`);
    }
    if (!this.adminRoles.some((role) => actor.roles.includes(role))) {
      throw permissionDenied(`Actor '${actor.id}' cannot administer naming`);
    }
    return resolvedTenantId;
  }

  private async stateFor(tenantId: TenantId, doctype: DocTypeDefinition): Promise<NamingConfigurationState> {
    return foldNamingConfiguration(tenantId, doctype, await this.configurationEvents(tenantId, doctype.name));
  }

  private configurationEvents(tenantId: TenantId, doctypeName: string) {
    return this.events.readStream(namingConfigurationStream(tenantId, doctypeName));
  }

  private async preNamingDocTypeFor(doctypeName: string, tenantId: TenantId): Promise<DocTypeDefinition> {
    const base = this.registry.get(doctypeName);
    return this.preNamingDocTypeResolver === undefined
      ? base
      : await this.preNamingDocTypeResolver(base, { tenantId });
  }

  private configurationEvent(input: {
    readonly tenantId: TenantId;
    readonly stream: string;
    readonly actor: Actor;
    readonly doctypeName: string;
    readonly payload: NamingEventPayload;
    readonly metadata?: DocumentData;
  }): NewDomainEvent<NamingEventPayload> {
    return {
      id: this.ids.next("evt_"),
      tenantId: input.tenantId,
      stream: input.stream,
      type: namingEventType(input.payload),
      doctype: "__NamingConfiguration",
      documentName: input.doctypeName,
      actorId: input.actor.id,
      occurredAt: this.clock.now(),
      payload: input.payload,
      metadata: input.metadata ?? {}
    };
  }
}

function requireSeriesStrategy(doctype: DocTypeDefinition): NamingSeriesStrategy {
  const naming = doctype.naming;
  if (naming?.kind !== "series") {
    throw new FrameworkError("NAMING_INVALID", `DocType '${doctype.name}' does not use a naming series`, { status: 400 });
  }
  return naming;
}

function ensureExpectedVersion(current: number, expected: number | undefined, label: string): void {
  if (expected !== undefined && expected !== current) {
    throw new FrameworkError(
      "DOCUMENT_CONFLICT",
      `${label} expected version ${String(expected)}, found ${String(current)}`,
      { status: 409 }
    );
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
