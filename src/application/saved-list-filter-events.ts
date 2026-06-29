import { badRequest } from "../core/errors.js";
import type {
  DocTypeDefinition,
  DomainEvent,
  ListDocumentsFilter,
  ListFilterExpression,
  NewDomainEvent,
  TenantId
} from "../core/types.js";

const MAX_FILTER_LABEL_LENGTH = 140;

export type SavedListFilterEventPayload =
  | {
      readonly kind: "SavedListFilterSaved";
      readonly filterId: string;
      readonly label: string;
      readonly ownerId: string;
      readonly filters: readonly ListDocumentsFilter[];
      readonly filterExpression?: ListFilterExpression;
    }
  | {
      readonly kind: "SavedListFilterDeleted";
      readonly filterId: string;
      readonly ownerId: string;
    };

export const SAVED_LIST_FILTER_PAYLOAD_KINDS = Object.freeze([
  "SavedListFilterSaved",
  "SavedListFilterDeleted"
] as const);

export interface SavedListFilter {
  readonly tenantId: TenantId;
  readonly doctype: string;
  readonly id: string;
  readonly label: string;
  readonly ownerId: string;
  readonly filters: readonly ListDocumentsFilter[];
  readonly filterExpression?: ListFilterExpression;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SavedListFilterState {
  readonly tenantId: TenantId;
  readonly doctype: string;
  readonly version: number;
  readonly filters: ReadonlyMap<string, SavedListFilter>;
}

export function foldSavedListFilters(
  tenantId: TenantId,
  doctype: DocTypeDefinition,
  events: readonly DomainEvent[]
): SavedListFilterState {
  const filters = new Map<string, SavedListFilter>();
  let version = 0;
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    version = Math.max(version, event.sequence);
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
          ...(event.payload.filterExpression === undefined ? {} : { filterExpression: event.payload.filterExpression }),
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
  return {
    tenantId,
    doctype: doctype.name,
    version,
    filters
  };
}

export function savedListFiltersForOwner(
  state: SavedListFilterState,
  ownerId: string
): readonly SavedListFilter[] {
  return [...state.filters.values()].filter((filter) => filter.ownerId === ownerId);
}

export function sortedSavedListFilters(filters: readonly SavedListFilter[]): readonly SavedListFilter[] {
  return [...filters].sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}

export function normalizeSavedListFilterLabel(label: string): string {
  const normalized = label.trim();
  if (normalized.length === 0) {
    throw badRequest("Saved filter label is required");
  }
  if (normalized.length > MAX_FILTER_LABEL_LENGTH) {
    throw badRequest(`Saved filter label exceeds ${MAX_FILTER_LABEL_LENGTH} characters`);
  }
  return normalized;
}

export function savedListFilterCurrentVersion(events: readonly DomainEvent[]): number {
  return events.at(-1)?.sequence ?? 0;
}

export function savedListFilterEvent<TPayload extends SavedListFilterEventPayload>(
  event: NewDomainEvent<TPayload>
): NewDomainEvent<TPayload> {
  return event;
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly SavedListFilterSaved: Extract<
      SavedListFilterEventPayload,
      { readonly kind: "SavedListFilterSaved" }
    >;
    readonly SavedListFilterDeleted: Extract<
      SavedListFilterEventPayload,
      { readonly kind: "SavedListFilterDeleted" }
    >;
  }
}
