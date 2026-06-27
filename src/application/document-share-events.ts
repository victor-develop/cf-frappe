import type { DocumentSharePermission } from "../core/document-shares.js";

export type DocumentShareEventPayload =
  | {
      readonly kind: "DocumentShared";
      readonly userId: string;
      readonly permissions: readonly DocumentSharePermission[];
    }
  | {
      readonly kind: "DocumentShareRevoked";
      readonly userId: string;
    };

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly DocumentShared: Extract<
      DocumentShareEventPayload,
      { readonly kind: "DocumentShared" }
    >;
    readonly DocumentShareRevoked: Extract<
      DocumentShareEventPayload,
      { readonly kind: "DocumentShareRevoked" }
    >;
  }
}
