import type { DocumentData } from "../core/types.js";

export type DocumentCommandEventPayload =
  | {
      readonly kind: "WorkflowTransitioned";
      readonly action: string;
      readonly from: string;
      readonly to: string;
      readonly patch: DocumentData;
    }
  | {
      readonly kind: "DomainCommandApplied";
      readonly command: string;
      readonly input: DocumentData;
      readonly patch: DocumentData;
    };

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly WorkflowTransitioned: Extract<
      DocumentCommandEventPayload,
      { readonly kind: "WorkflowTransitioned" }
    >;
    readonly DomainCommandApplied: Extract<
      DocumentCommandEventPayload,
      { readonly kind: "DomainCommandApplied" }
    >;
  }
}
