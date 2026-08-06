import { FrameworkError, notFound, permissionDenied } from "../core/errors.js";
import { normalizeListFilterExpression, normalizeListFilters } from "../core/list-view.js";
import {
  andPredicateExpressions,
  normalizePredicateExpression,
  predicateExpressionFromListFilterExpression
} from "../core/predicates.js";
import type { ModelRegistry } from "../core/registry.js";
import { savedListFiltersStream } from "../core/streams.js";
import {
  DEFAULT_TENANT_ID,
  type Actor,
  type DocTypeDefinition,
  type JsonValue,
  type ListDocumentsFilter,
  type ListFilterExpression,
  type ListFilterValue,
  type PredicateExpression,
  type TenantId
} from "../core/types.js";
import {
  foldSavedListFilters,
  mergeSavedListFilterInputs,
  normalizeSavedListFilterLabel,
  SAVED_LIST_FILTER_PAYLOAD_KINDS,
  savedListFilterCurrentVersion,
  savedListFilterEvent,
  savedListFiltersForOwner,
  sortedSavedListFilters,
  type SavedListFilter,
  type SavedListFilterEventPayload
} from "./saved-list-filter-events.js";
import {
  findSavedListFilter,
  planSavedListFilterLookup,
  planSavedListFilterReadAccess,
  planSavedListFilterDelete,
  planSavedListFilterSave,
  projectSavedListFilterSave
} from "./saved-list-filter-policy.js";
import type { Clock } from "../ports/clock.js";
import { systemClock } from "../ports/clock.js";
import type { EventStore } from "../ports/event-store.js";
import type { IdGenerator } from "../ports/id-generator.js";
import { cryptoIdGenerator } from "../ports/id-generator.js";
import { projectDocTypeForFieldQueries } from "./document-field-access-policy.js";

export type { SavedListFilter, SavedListFilterEventPayload } from "./saved-list-filter-events.js";

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

export interface SaveListFilterCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly label: string;
  readonly filters: readonly ListDocumentsFilter[];
  readonly filterExpression?: ListFilterExpression;
  readonly id?: string;
  readonly tenantId?: TenantId;
}

export interface DeleteListFilterCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly id: string;
  readonly tenantId?: TenantId;
}

export interface SavedListFilterMerge {
  readonly filters: readonly ListDocumentsFilter[];
  readonly filterExpression?: ListFilterExpression;
}

export interface SavedListFilterPresentation extends Omit<SavedListFilter, "predicate"> {
  readonly filters: readonly ListDocumentsFilter[];
  readonly filterExpression?: ListFilterExpression;
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
    return sortedSavedListFilters(this.queryableFilters(actor, doctype, filters));
  }

  async get(
    actor: Actor,
    doctypeName: string,
    id: string,
    tenantId = resolveTenant(actor)
  ): Promise<SavedListFilter> {
    const doctype = await this.readableDoctype(actor, doctypeName, tenantId);
    const decision = planSavedListFilterLookup(
      findSavedListFilter(this.queryableFilters(actor, doctype, await this.readAll(tenantId, doctype, actor.id)), id),
      id
    );
    if (decision.status === "missing") {
      throw notFound(decision.message);
    }
    return decision.filter;
  }

  async save(command: SaveListFilterCommand): Promise<SavedListFilter> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const doctype = await this.readableDoctype(command.actor, command.doctype, tenantId);
    const stream = savedListFiltersStream(tenantId, doctype.name, command.actor.id);
    const events = await this.events.readStream(stream, {
      payloadKinds: SAVED_LIST_FILTER_PAYLOAD_KINDS
    });
    const current = savedListFiltersForOwner(foldSavedListFilters(tenantId, doctype, events), command.actor.id);
    const existing = command.id === undefined ? undefined : findSavedListFilter(current, command.id);
    const decision = planSavedListFilterSave(existing, command.id);
    if (decision.status === "missing") {
      throw notFound(decision.message);
    }
    const id = command.id ?? this.ids.next("filter_");
    const label = normalizeSavedListFilterLabel(command.label);
    const queryableDoctype = projectDocTypeForFieldQueries({ actor: command.actor, doctype });
    const normalizedFilters = normalizeListFilters(queryableDoctype, command.filters);
    const filtersPredicate = normalizedFilters.length === 0
      ? undefined
      : predicateExpressionFromListFilterExpression({
          kind: "group",
          match: "all",
          filters: normalizedFilters
        });
    const expressionPredicate = command.filterExpression === undefined
      ? undefined
      : normalizeListFilterExpression(queryableDoctype, command.filterExpression);
    const combinedPredicate = andPredicateExpressions([filtersPredicate, expressionPredicate]);
    const normalizedPredicate = combinedPredicate === undefined
      ? undefined
      : normalizePredicateExpression(queryableDoctype, combinedPredicate, { availableScopes: ["after"] });
    const now = this.clock.now();
    const event = savedListFilterEvent({
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
        ...(normalizedPredicate === undefined ? {} : { predicate: normalizedPredicate })
      },
      metadata: {}
    });
    await this.events.append(stream, savedListFilterCurrentVersion(events), [event]);
    return projectSavedListFilterSave({
      tenantId,
      doctype: doctype.name,
      id,
      label,
      ownerId: command.actor.id,
      predicate: normalizedPredicate,
      existing,
      now
    });
  }

  async delete(command: DeleteListFilterCommand): Promise<void> {
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const doctype = await this.readableDoctype(command.actor, command.doctype, tenantId);
    const stream = savedListFiltersStream(tenantId, doctype.name, command.actor.id);
    const events = await this.events.readStream(stream, {
      payloadKinds: SAVED_LIST_FILTER_PAYLOAD_KINDS
    });
    const existing = findSavedListFilter(
      savedListFiltersForOwner(foldSavedListFilters(tenantId, doctype, events), command.actor.id),
      command.id
    );
    const decision = planSavedListFilterDelete(existing, command.id);
    if (decision.status === "missing") {
      throw notFound(decision.message);
    }
    const now = this.clock.now();
    await this.events.append(stream, savedListFilterCurrentVersion(events), [
      savedListFilterEvent({
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

  mergeSavedFilterInputs(
    savedFilter: SavedListFilter | undefined,
    explicitFilters: readonly ListDocumentsFilter[],
    explicitFilterExpression: ListFilterExpression | undefined
  ): SavedListFilterMerge {
    if (savedFilter === undefined) {
      return {
        filters: explicitFilters,
        ...(explicitFilterExpression === undefined
          ? {}
          : { filterExpression: explicitFilterExpression })
      };
    }

    const explicitFiltersPredicate = explicitFilters.length === 0
      ? undefined
      : predicateExpressionFromListFilterExpression({
          kind: "group",
          match: "all",
          filters: explicitFilters
        });
    const explicitExpressionPredicate = explicitFilterExpression === undefined
      ? undefined
      : predicateExpressionFromListFilterExpression(explicitFilterExpression);
    const merged = mergeSavedListFilterInputs({
      savedFilter,
      ...((explicitFiltersPredicate === undefined && explicitExpressionPredicate === undefined)
        ? {}
        : { explicitPredicate: andPredicateExpressions([explicitFiltersPredicate, explicitExpressionPredicate]) })
    });
    return listFilterInputFromPredicate(merged.predicate);
  }

  private async readableDoctype(actor: Actor, doctypeName: string, tenantId: TenantId): Promise<DocTypeDefinition> {
    const base = this.registry.get(doctypeName);
    const doctype = (await this.doctypeResolver?.(base, { actor, tenantId })) ?? base;
    const decision = planSavedListFilterReadAccess({ actor, doctype });
    if (decision.status === "deny") {
      throw permissionDenied(decision.message);
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
      payloadKinds: SAVED_LIST_FILTER_PAYLOAD_KINDS
    });
    return savedListFiltersForOwner(foldSavedListFilters(tenantId, doctype, events), ownerId);
  }

  private queryableFilters(
    actor: Actor,
    doctype: DocTypeDefinition,
    filters: readonly SavedListFilter[]
  ): readonly SavedListFilter[] {
    const queryableDoctype = projectDocTypeForFieldQueries({ actor, doctype });
    return filters.filter((filter) => savedFilterIsQueryable(queryableDoctype, filter));
  }
}

function resolveTenant(actor: Actor, explicitTenantId?: TenantId): TenantId {
  return explicitTenantId ?? actor.tenantId ?? DEFAULT_TENANT_ID;
}

function savedFilterIsQueryable(doctype: DocTypeDefinition, filter: SavedListFilter): boolean {
  try {
    if (filter.predicate !== undefined) {
      const normalized = normalizePredicateExpression(doctype, filter.predicate, { availableScopes: ["after"] });
      listFilterExpressionFromPredicate(normalized);
    }
    return true;
  } catch (error) {
    if (error instanceof FrameworkError && error.code === "BAD_REQUEST") {
      return false;
    }
    throw error;
  }
}

export function presentSavedListFilter(filter: SavedListFilter): SavedListFilterPresentation {
  const input = listFilterInputFromPredicate(filter.predicate);
  return {
    tenantId: filter.tenantId,
    doctype: filter.doctype,
    id: filter.id,
    label: filter.label,
    ownerId: filter.ownerId,
    ...input,
    createdAt: filter.createdAt,
    updatedAt: filter.updatedAt
  };
}

function listFilterInputFromPredicate(predicate: PredicateExpression | undefined): SavedListFilterMerge {
  if (predicate === undefined) {
    return { filters: [] };
  }
  const filters: ListDocumentsFilter[] = [];
  const residual: PredicateExpression[] = [];
  for (const expression of flattenAllPredicates(predicate)) {
    if (expression.kind === "compare") {
      filters.push(listFilterFromPredicateComparison(expression));
    } else {
      residual.push(expression);
    }
  }
  const filterExpression = residual.length === 0
    ? undefined
    : listFilterExpressionFromPredicate(residual.length === 1
      ? residual[0]!
      : { kind: "group", match: "all", predicates: residual });
  return {
    filters: Object.freeze(filters),
    ...(filterExpression === undefined ? {} : { filterExpression })
  };
}

function flattenAllPredicates(expression: PredicateExpression): readonly PredicateExpression[] {
  return expression.kind === "group" && expression.match === "all"
    ? expression.predicates
    : [expression];
}

function listFilterExpressionFromPredicate(expression: PredicateExpression): ListFilterExpression {
  switch (expression.kind) {
    case "group":
      return {
        kind: "group",
        match: expression.match,
        filters: expression.predicates.map(listFilterExpressionFromPredicate)
      };
    case "compare":
      return listFilterFromPredicateComparison(expression);
    case "not":
      throw new FrameworkError("BAD_REQUEST", "Saved filter predicate cannot be represented as a list filter", {
        status: 400
      });
  }
}

function listFilterFromPredicateComparison(
  expression: Extract<PredicateExpression, { readonly kind: "compare" }>
): ListDocumentsFilter {
  if (
    expression.left.kind !== "field" ||
    expression.left.scope !== "after" ||
    expression.right.kind !== "literal" ||
    !isListFilterValue(expression.right.value)
  ) {
    throw new FrameworkError("BAD_REQUEST", "Saved filter predicate cannot be represented as a list filter", {
      status: 400
    });
  }
  return {
    field: expression.left.field,
    ...(expression.operator === "eq" ? {} : { operator: expression.operator }),
    value: expression.right.value
  };
}

function isListFilterValue(value: JsonValue): value is ListFilterValue {
  return value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    (Array.isArray(value) && value.every((item) =>
      item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean"
    ));
}
