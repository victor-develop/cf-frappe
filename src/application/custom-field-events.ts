import type { DocTypeName, DomainEvent, PersistedFieldDefinition } from "../core/types.js";
import { domainEventPayloadKind } from "../core/domain-events.js";

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

export type CustomFieldPayloadKind = CustomFieldEventPayload["kind"];

export const CUSTOM_FIELD_PAYLOAD_KINDS = Object.freeze([
  "CustomFieldSaved",
  "CustomFieldDisabled"
] as const satisfies readonly CustomFieldPayloadKind[]);

const CUSTOM_FIELD_PAYLOAD_KIND_SET = new Set<string>(CUSTOM_FIELD_PAYLOAD_KINDS);

export interface CustomFieldSavedPayloadInput {
  readonly doctypeName: DocTypeName;
  readonly field: PersistedFieldDefinition;
}

export interface CustomFieldDisabledPayloadInput {
  readonly doctypeName: DocTypeName;
  readonly fieldName: string;
}

export function customFieldSavedPayload(
  input: CustomFieldSavedPayloadInput
): Extract<CustomFieldEventPayload, { readonly kind: "CustomFieldSaved" }> {
  return {
    kind: "CustomFieldSaved",
    doctypeName: input.doctypeName,
    field: input.field
  };
}

export function customFieldDisabledPayload(
  input: CustomFieldDisabledPayloadInput
): Extract<CustomFieldEventPayload, { readonly kind: "CustomFieldDisabled" }> {
  return {
    kind: "CustomFieldDisabled",
    doctypeName: input.doctypeName,
    fieldName: input.fieldName
  };
}

export function customFieldEventType(payload: CustomFieldEventPayload): CustomFieldPayloadKind {
  return payload.kind;
}

export function isCustomFieldPayloadKind(kind: string): kind is CustomFieldPayloadKind {
  return CUSTOM_FIELD_PAYLOAD_KIND_SET.has(kind);
}

export function isCustomFieldEvent(event: DomainEvent): event is DomainEvent<CustomFieldEventPayload> {
  return isCustomFieldPayloadKind(domainEventPayloadKind(event));
}

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
