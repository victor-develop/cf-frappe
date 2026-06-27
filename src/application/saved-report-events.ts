import type { JsonObject } from "../core/types.js";

export type SavedReportEventPayload =
  | {
      readonly kind: "SavedReportSaved";
      readonly reportId: string;
      readonly label: string;
      readonly ownerId: string;
      readonly definition: JsonObject;
    }
  | {
      readonly kind: "SavedReportDeleted";
      readonly reportId: string;
      readonly ownerId: string;
    };

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly SavedReportSaved: Extract<
      SavedReportEventPayload,
      { readonly kind: "SavedReportSaved" }
    >;
    readonly SavedReportDeleted: Extract<
      SavedReportEventPayload,
      { readonly kind: "SavedReportDeleted" }
    >;
  }
}
