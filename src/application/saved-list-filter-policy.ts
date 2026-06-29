import type { SavedListFilter } from "./saved-list-filter-events.js";
import { notFound } from "../core/errors.js";
import { can } from "../core/permissions.js";
import type {
  Actor,
  DocTypeDefinition,
  ListDocumentsFilter,
  ListFilterExpression,
  TenantId
} from "../core/types.js";

export type SavedListFilterWriteDecision =
  | { readonly status: "missing"; readonly message: string }
  | { readonly status: "write" };

export type SavedListFilterLookupDecision =
  | { readonly status: "found"; readonly filter: SavedListFilter }
  | { readonly status: "missing"; readonly message: string };

export type SavedListFilterReadAccessDecision =
  | { readonly status: "allow" }
  | { readonly status: "deny"; readonly message: string };

export function findSavedListFilter(
  filters: readonly SavedListFilter[],
  id: string
): SavedListFilter | undefined {
  return filters.find((filter) => filter.id === id);
}

export function ensureSavedListFilterServiceAvailable<T>(savedFilters: T | undefined): asserts savedFilters is T {
  if (savedFilters === undefined) {
    throw notFound("Saved filters are not enabled");
  }
}

export function planSavedListFilterReadAccess(command: {
  readonly actor: Actor;
  readonly doctype: DocTypeDefinition;
}): SavedListFilterReadAccessDecision {
  if (!can(command.actor, command.doctype, "read")) {
    return {
      status: "deny",
      message: `Actor '${command.actor.id}' cannot read ${command.doctype.name}`
    };
  }
  return { status: "allow" };
}

export function planSavedListFilterLookup(
  filter: SavedListFilter | undefined,
  id: string
): SavedListFilterLookupDecision {
  return filter === undefined
    ? { status: "missing", message: `Saved filter '${id}' was not found` }
    : { status: "found", filter };
}

export function planSavedListFilterSave(
  existing: SavedListFilter | undefined,
  requestedId: string | undefined
): SavedListFilterWriteDecision {
  return requestedId !== undefined && existing === undefined
    ? { status: "missing", message: `Saved filter '${requestedId}' was not found` }
    : { status: "write" };
}

export function planSavedListFilterDelete(
  existing: SavedListFilter | undefined,
  id: string
): SavedListFilterWriteDecision {
  return existing === undefined
    ? { status: "missing", message: `Saved filter '${id}' was not found` }
    : { status: "write" };
}

export function projectSavedListFilterSave(input: {
  readonly tenantId: TenantId;
  readonly doctype: string;
  readonly id: string;
  readonly label: string;
  readonly ownerId: string;
  readonly filters: readonly ListDocumentsFilter[];
  readonly filterExpression?: ListFilterExpression | undefined;
  readonly existing?: SavedListFilter | undefined;
  readonly now: string;
}): SavedListFilter {
  return {
    tenantId: input.tenantId,
    doctype: input.doctype,
    id: input.id,
    label: input.label,
    ownerId: input.ownerId,
    filters: input.filters,
    ...(input.filterExpression === undefined ? {} : { filterExpression: input.filterExpression }),
    createdAt: input.existing?.createdAt ?? input.now,
    updatedAt: input.now
  };
}
