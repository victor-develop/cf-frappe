import type { DomainEvent, NamingStrategy } from "../core/types.js";
import {
  NAMING_CONFIGURATION_PAYLOAD_KINDS,
  isNamingConfigurationPayloadKind,
  type NamingConfigurationEventPayload,
  type NamingConfigurationPayloadKind
} from "../core/naming-configuration.js";
import { domainEventPayloadKind } from "../core/domain-events.js";

export type NamingEventPayload = NamingConfigurationEventPayload;
export type NamingPayloadKind = NamingConfigurationPayloadKind;
export const NAMING_PAYLOAD_KINDS = NAMING_CONFIGURATION_PAYLOAD_KINDS;

export function namingStrategySavedPayload(
  doctypeName: string,
  strategy: NamingStrategy
): Extract<NamingEventPayload, { readonly kind: "NamingStrategySaved" }> {
  return { kind: "NamingStrategySaved", doctypeName, strategy };
}

export function namingStrategyClearedPayload(
  doctypeName: string
): Extract<NamingEventPayload, { readonly kind: "NamingStrategyCleared" }> {
  return { kind: "NamingStrategyCleared", doctypeName };
}

export function namingEventType(payload: NamingEventPayload): NamingPayloadKind {
  return payload.kind;
}

export function isNamingEvent(event: DomainEvent): event is DomainEvent<NamingEventPayload> {
  return isNamingConfigurationPayloadKind(domainEventPayloadKind(event));
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly NamingStrategySaved: Extract<NamingEventPayload, { readonly kind: "NamingStrategySaved" }>;
    readonly NamingStrategyCleared: Extract<NamingEventPayload, { readonly kind: "NamingStrategyCleared" }>;
  }
}
