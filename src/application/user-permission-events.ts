import type { DocTypeName, DocumentName } from "../core/types.js";

export type UserPermissionEventPayload =
  | {
      readonly kind: "UserPermissionAllowed";
      readonly userId: string;
      readonly targetDoctype: DocTypeName;
      readonly targetName: DocumentName;
      readonly applicableDoctypes?: readonly DocTypeName[];
    }
  | {
      readonly kind: "UserPermissionRevoked";
      readonly userId: string;
      readonly targetDoctype: DocTypeName;
      readonly targetName: DocumentName;
      readonly applicableDoctypes?: readonly DocTypeName[];
    };

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly UserPermissionAllowed: Extract<
      UserPermissionEventPayload,
      { readonly kind: "UserPermissionAllowed" }
    >;
    readonly UserPermissionRevoked: Extract<
      UserPermissionEventPayload,
      { readonly kind: "UserPermissionRevoked" }
    >;
  }
}
