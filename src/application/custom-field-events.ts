import type { DocTypeName, PersistedFieldDefinition } from "../core/types.js";

export type CustomFieldEventPayload =
  | {
      readonly kind: "CustomFieldSaved";
      readonly doctypeName: DocTypeName;
      readonly field: PersistedFieldDefinition;
    }
  | {
      readonly kind: "CustomFieldDisabled";
      readonly doctypeName: DocTypeName;
      readonly fieldName: string;
    };

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly CustomFieldSaved: Extract<
      CustomFieldEventPayload,
      { readonly kind: "CustomFieldSaved" }
    >;
    readonly CustomFieldDisabled: Extract<
      CustomFieldEventPayload,
      { readonly kind: "CustomFieldDisabled" }
    >;
  }
}
