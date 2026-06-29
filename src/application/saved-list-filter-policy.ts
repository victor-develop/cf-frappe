import type { SavedListFilter } from "./saved-list-filter-events.js";
import type { ListDocumentsFilter, ListFilterExpression, TenantId } from "../core/types.js";

export type SavedListFilterWriteDecision =
  | { readonly status: "missing"; readonly message: string }
  | { readonly status: "write" };

export function findSavedListFilter(
  filters: readonly SavedListFilter[],
  id: string
): SavedListFilter | undefined {
  return filters.find((filter) => filter.id === id);
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
