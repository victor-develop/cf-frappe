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

export interface DocumentSharePayloadInput {
  readonly userId: string;
  readonly permissions: readonly DocumentSharePermission[];
}

export function documentSharedPayload(
  input: DocumentSharePayloadInput
): Extract<DocumentShareEventPayload, { readonly kind: "DocumentShared" }> {
  return {
    kind: "DocumentShared",
    userId: input.userId,
    permissions: input.permissions
  };
}

export function documentShareRevokedPayload(
  userId: string
): Extract<DocumentShareEventPayload, { readonly kind: "DocumentShareRevoked" }> {
  return { kind: "DocumentShareRevoked", userId };
}

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
