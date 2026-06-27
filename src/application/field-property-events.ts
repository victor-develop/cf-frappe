import type { DocTypeName, FieldPropertyOverrides } from "../core/types.js";

export type FieldPropertyEventPayload =
  | {
      readonly kind: "FieldPropertyOverrideSaved";
      readonly doctypeName: DocTypeName;
      readonly fieldName: string;
      readonly overrides: FieldPropertyOverrides;
    }
  | {
      readonly kind: "FieldPropertyOverrideCleared";
      readonly doctypeName: DocTypeName;
      readonly fieldName: string;
    };

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly FieldPropertyOverrideSaved: Extract<
      FieldPropertyEventPayload,
      { readonly kind: "FieldPropertyOverrideSaved" }
    >;
    readonly FieldPropertyOverrideCleared: Extract<
      FieldPropertyEventPayload,
      { readonly kind: "FieldPropertyOverrideCleared" }
    >;
  }
}
