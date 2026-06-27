import type { ListDocumentsFilter, ListFilterExpression } from "../core/types.js";

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
