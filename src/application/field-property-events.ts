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

export type FieldPropertyPayloadKind = FieldPropertyEventPayload["kind"];

export const FIELD_PROPERTY_PAYLOAD_KINDS = Object.freeze([
  "FieldPropertyOverrideSaved",
  "FieldPropertyOverrideCleared"
] as const satisfies readonly FieldPropertyPayloadKind[]);

export interface FieldPropertyOverrideSavedPayloadInput {
  readonly doctypeName: DocTypeName;
  readonly fieldName: string;
  readonly overrides: FieldPropertyOverrides;
}

export interface FieldPropertyOverrideClearedPayloadInput {
  readonly doctypeName: DocTypeName;
  readonly fieldName: string;
}

export function fieldPropertyOverrideSavedPayload(
  input: FieldPropertyOverrideSavedPayloadInput
): Extract<FieldPropertyEventPayload, { readonly kind: "FieldPropertyOverrideSaved" }> {
  return {
    kind: "FieldPropertyOverrideSaved",
    doctypeName: input.doctypeName,
    fieldName: input.fieldName,
    overrides: input.overrides
  };
}

export function fieldPropertyOverrideClearedPayload(
  input: FieldPropertyOverrideClearedPayloadInput
): Extract<FieldPropertyEventPayload, { readonly kind: "FieldPropertyOverrideCleared" }> {
  return {
    kind: "FieldPropertyOverrideCleared",
    doctypeName: input.doctypeName,
    fieldName: input.fieldName
  };
}

export function fieldPropertyEventType(payload: FieldPropertyEventPayload): FieldPropertyPayloadKind {
  return payload.kind;
}

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
