import { domainEventPayloadKind } from "../core/domain-events.js";
import {
  CUSTOM_FIELD_STATE_PAYLOAD_KINDS,
  customFieldStateEventType,
  isCustomFieldStatePayloadKind,
  type CustomFieldStateEventPayload,
  type CustomFieldStatePayloadKind
} from "../core/custom-fields.js";
import type { DocTypeName, DomainEvent, PersistedFieldDefinition } from "../core/types.js";

export type CustomFieldEventPayload = CustomFieldStateEventPayload;

export type CustomFieldPayloadKind = CustomFieldStatePayloadKind;

export const CUSTOM_FIELD_PAYLOAD_KINDS = CUSTOM_FIELD_STATE_PAYLOAD_KINDS;

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
  return customFieldStateEventType(payload);
}

export function isCustomFieldPayloadKind(kind: string): kind is CustomFieldPayloadKind {
  return isCustomFieldStatePayloadKind(kind);
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
