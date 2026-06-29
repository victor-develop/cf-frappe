import { domainEventPayloadKind } from "../core/domain-events.js";
import {
  FIELD_PROPERTY_OVERRIDE_STATE_PAYLOAD_KINDS,
  fieldPropertyOverrideStateEventType,
  isFieldPropertyOverrideStatePayloadKind,
  type FieldPropertyOverrideStateEventPayload,
  type FieldPropertyOverrideStatePayloadKind
} from "../core/field-property-overrides.js";
import type { DocTypeName, DomainEvent, FieldPropertyOverrides } from "../core/types.js";

export type FieldPropertyEventPayload = FieldPropertyOverrideStateEventPayload;

export type FieldPropertyPayloadKind = FieldPropertyOverrideStatePayloadKind;

export const FIELD_PROPERTY_PAYLOAD_KINDS = FIELD_PROPERTY_OVERRIDE_STATE_PAYLOAD_KINDS;

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
  return fieldPropertyOverrideStateEventType(payload);
}

export function isFieldPropertyPayloadKind(kind: string): kind is FieldPropertyPayloadKind {
  return isFieldPropertyOverrideStatePayloadKind(kind);
}

export function isFieldPropertyEvent(event: DomainEvent): event is DomainEvent<FieldPropertyEventPayload> {
  return isFieldPropertyPayloadKind(domainEventPayloadKind(event));
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
