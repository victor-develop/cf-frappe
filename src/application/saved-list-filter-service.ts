import { badRequest, notFound, permissionDenied } from "../core/errors.js";
import { mergeListFilters, normalizeListFilters } from "../core/list-view.js";
import { can } from "../core/permissions.js";
import type { ModelRegistry } from "../core/registry.js";
import { savedListFiltersStream } from "../core/streams.js";
import {
  DEFAULT_TENANT_ID,
  type Actor,
  type DocTypeDefinition,
  type DomainEvent,
  type ListDocumentsFilter,
  type NewDomainEvent,
  type TenantId
} from "../core/types.js";
import type { Clock } from "../ports/clock.js";
import { systemClock } from "../ports/clock.js";
import type { EventStore } from "../ports/event-store.js";
import type { IdGenerator } from "../ports/id-generator.js";
import { cryptoIdGenerator } from "../ports/id-generator.js";

const MAX_FILTER_LABEL_LENGTH = 140;

export interface SavedListFilterServiceOptions {
  readonly registry: ModelRegistry;
  readonly events: EventStore;
  readonly doctypeResolver?: SavedListFilterDocTypeResolver;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}

export type SavedListFilterDocTypeResolver = (
  base: DocTypeDefinition,
  context: { readonly actor: Actor; readonly tenantId: string }
) => DocTypeDefinition | Promise<DocTypeDefinition>;

export interface SavedListFilter {
  readonly tenantId: TenantId;
  readonly doctype: string;
  readonly id: string;
  readonly label: string;
  readonly ownerId: string;
  readonly filters: readonly ListDocumentsFilter[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SaveListFilterCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly label: string;
  readonly filters: readonly ListDocumentsFilter[];
  readonly id?: string;
  readonly tenantId?: TenantId;
}

export interface DeleteListFilterCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly id: string;
  readonly tenantId?: TenantId;
}

export class SavedListFilterService {
  private readonly registry: ModelRegistry;
  private readonly events: EventStore;
  private readonly doctypeResolver: SavedListFilterDocTypeResolver | undefined;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(options: SavedListFilterServiceOptions) {
    this.registry = options.registry;
    this.events = options.events;
    this.doctypeResolver = options.doctypeResolver;
    this.clock = options.clock ?? systemClock;
    this.ids = options.ids ?? cryptoIdGenerator;
  }

  async list(actor: Actor, doctypeName: string, tenantId = resolveTenant(actor)): Promise<readonly SavedListFilter[]> {
    const doctype = await this.readableDoctype(actor, doctypeName, tenantId);
    const filters = await this.readAll(tenantId, doctype, actor.id);
    return [...filters].sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  }

  async get(
    actor: Actor,
    doctypeName: string,
    id: string,
    tenantId = resolveTenant(actor)
  ): Promise<SavedListFilter> {
    const doctype = await this.readableDoctype(actor, doctypeName, tenantId);
    const filter = (await this.readAll(tenantId, doctype, actor.id)).find((item) => item.id === id);
    if (!filter) {
      throw notFound(`Saved filter '${id}' was not found`);
    }
    return filter;
  }

  async save(command: SaveListFilterCommand): Promise<SavedListFilter> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const doctype = await this.readableDoctype(command.actor, command.doctype, tenantId);
    const stream = savedListFiltersStream(tenantId, doctype.name, command.actor.id);
    const events = await this.events.readStream(stream, {
      payloadKinds: ["SavedListFilterSaved", "SavedListFilterDeleted"]
    });
    const current = foldSavedListFilters(tenantId, doctype, events).filter(
      (filter) => filter.ownerId === command.actor.id
    );
    const existing = command.id ? current.find((filter) => filter.id === command.id) : undefined;
    if (command.id && !existing) {
      throw notFound(`Saved filter '${command.id}' was not found`);
    }
    const id = command.id ?? this.ids.next("filter_");
    const label = normalizeLabel(command.label);
    const normalizedFilters = normalizeListFilters(doctype, command.filters);
    const now = this.clock.now();
    const event = newEvent({
      id: this.ids.next("evt_"),
      tenantId,
      stream,
      type: `${doctype.name}SavedListFilterSaved`,
      doctype: doctype.name,
      documentName: id,
      actorId: command.actor.id,
      occurredAt: now,
      payload: {
        kind: "SavedListFilterSaved",
        filterId: id,
        label,
        ownerId: command.actor.id,
        filters: normalizedFilters
      },
      metadata: {}
    });
    await this.events.append(stream, currentVersion(events), [event]);
    return {
      tenantId,
      doctype: doctype.name,
      id,
      label,
      ownerId: command.actor.id,
      filters: normalizedFilters,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
  }

  async delete(command: DeleteListFilterCommand): Promise<void> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const doctype = await this.readableDoctype(command.actor, command.doctype, tenantId);
    const stream = savedListFiltersStream(tenantId, doctype.name, command.actor.id);
    const events = await this.events.readStream(stream, {
      payloadKinds: ["SavedListFilterSaved", "SavedListFilterDeleted"]
    });
    const existing = foldSavedListFilters(tenantId, doctype, events)
      .filter((filter) => filter.ownerId === command.actor.id)
      .find((filter) => filter.id === command.id);
    if (!existing) {
      throw notFound(`Saved filter '${command.id}' was not found`);
    }
    const now = this.clock.now();
    await this.events.append(stream, currentVersion(events), [
      newEvent({
        id: this.ids.next("evt_"),
        tenantId,
        stream,
        type: `${doctype.name}SavedListFilterDeleted`,
        doctype: doctype.name,
        documentName: command.id,
        actorId: command.actor.id,
        occurredAt: now,
        payload: {
          kind: "SavedListFilterDeleted",
          filterId: command.id,
          ownerId: command.actor.id
        },
        metadata: {}
      })
    ]);
  }

  mergeSavedFilter(
    savedFilter: SavedListFilter | undefined,
    explicitFilters: readonly ListDocumentsFilter[]
  ): readonly ListDocumentsFilter[] {
    return savedFilter ? mergeListFilters(savedFilter.filters, explicitFilters) : explicitFilters;
  }

  private async readableDoctype(actor: Actor, doctypeName: string, tenantId: TenantId): Promise<DocTypeDefinition> {
    const base = this.registry.get(doctypeName);
    const doctype = (await this.doctypeResolver?.(base, { actor, tenantId })) ?? base;
    if (!can(actor, doctype, "read")) {
      throw permissionDenied(`Actor '${actor.id}' cannot read ${doctype.name}`);
    }
    return doctype;
  }

  private async readAll(
    tenantId: TenantId,
    doctype: DocTypeDefinition,
    ownerId: string
  ): Promise<readonly SavedListFilter[]> {
    const stream = savedListFiltersStream(tenantId, doctype.name, ownerId);
    const events = await this.events.readStream(stream, {
      payloadKinds: ["SavedListFilterSaved", "SavedListFilterDeleted"]
    });
    return foldSavedListFilters(tenantId, doctype, events).filter((filter) => filter.ownerId === ownerId);
  }
}

function foldSavedListFilters(
  tenantId: TenantId,
  doctype: DocTypeDefinition,
  events: readonly DomainEvent[]
): readonly SavedListFilter[] {
  const filters = new Map<string, SavedListFilter>();
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    switch (event.payload.kind) {
      case "SavedListFilterSaved": {
        const existing = filters.get(event.payload.filterId);
        filters.set(event.payload.filterId, {
          tenantId,
          doctype: doctype.name,
          id: event.payload.filterId,
          label: event.payload.label,
          ownerId: event.payload.ownerId,
          filters: event.payload.filters,
          createdAt: existing?.createdAt ?? event.occurredAt,
          updatedAt: event.occurredAt
        });
        break;
      }
      case "SavedListFilterDeleted":
        filters.delete(event.payload.filterId);
        break;
    }
  }
  return [...filters.values()];
}

function normalizeLabel(label: string): string {
  const normalized = label.trim();
  if (normalized.length === 0) {
    throw badRequest("Saved filter label is required");
  }
  if (normalized.length > MAX_FILTER_LABEL_LENGTH) {
    throw badRequest(`Saved filter label exceeds ${MAX_FILTER_LABEL_LENGTH} characters`);
  }
  return normalized;
}

function resolveTenant(actor: Actor, explicitTenantId?: TenantId): TenantId {
  return explicitTenantId ?? actor.tenantId ?? DEFAULT_TENANT_ID;
}

function currentVersion(events: readonly DomainEvent[]): number {
  return events.at(-1)?.sequence ?? 0;
}

function newEvent<TPayload extends NewDomainEvent["payload"]>(event: NewDomainEvent<TPayload>): NewDomainEvent<TPayload> {
  return event;
}
