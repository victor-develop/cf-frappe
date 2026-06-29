import { domainEventPayloadKind } from "../core/domain-events.js";
import type { DocumentData, DomainEvent } from "../core/types.js";

export type PrintSettingsEventPayload = {
  readonly kind: "PrintSettingsChanged";
  readonly settings: DocumentData;
};

export type PrintSettingsPayloadKind = PrintSettingsEventPayload["kind"];

export const PRINT_SETTINGS_PAYLOAD_KINDS = Object.freeze([
  "PrintSettingsChanged"
] as const satisfies readonly PrintSettingsPayloadKind[]);

const PRINT_SETTINGS_PAYLOAD_KIND_SET = new Set<string>(PRINT_SETTINGS_PAYLOAD_KINDS);

export interface PrintSettingsChangedPayloadInput {
  readonly settings: DocumentData;
}

export function printSettingsChangedPayload(
  input: PrintSettingsChangedPayloadInput
): PrintSettingsEventPayload {
  return {
    kind: "PrintSettingsChanged",
    settings: input.settings
  };
}

export function printSettingsEventType(payload: PrintSettingsEventPayload): PrintSettingsPayloadKind {
  return payload.kind;
}

export function isPrintSettingsPayloadKind(kind: string): kind is PrintSettingsPayloadKind {
  return PRINT_SETTINGS_PAYLOAD_KIND_SET.has(kind);
}

export function isPrintSettingsEvent(event: DomainEvent): event is DomainEvent<PrintSettingsEventPayload> {
  return isPrintSettingsPayloadKind(domainEventPayloadKind(event));
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly PrintSettingsChanged: PrintSettingsEventPayload;
  }
}
