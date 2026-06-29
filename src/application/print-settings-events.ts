import { domainEventPayloadKind } from "../core/domain-events.js";
import {
  PRINT_SETTINGS_STATE_PAYLOAD_KINDS,
  isPrintSettingsStatePayloadKind,
  printSettingsStateEventType,
  type PrintSettingsStateEventPayload,
  type PrintSettingsStatePayloadKind
} from "../core/print-settings.js";
import type { DocumentData, DomainEvent } from "../core/types.js";

export type PrintSettingsEventPayload = PrintSettingsStateEventPayload;

export type PrintSettingsPayloadKind = PrintSettingsStatePayloadKind;

export const PRINT_SETTINGS_PAYLOAD_KINDS = PRINT_SETTINGS_STATE_PAYLOAD_KINDS;

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
  return printSettingsStateEventType(payload);
}

export function isPrintSettingsPayloadKind(kind: string): kind is PrintSettingsPayloadKind {
  return isPrintSettingsStatePayloadKind(kind);
}

export function isPrintSettingsEvent(event: DomainEvent): event is DomainEvent<PrintSettingsEventPayload> {
  return isPrintSettingsPayloadKind(domainEventPayloadKind(event));
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly PrintSettingsChanged: PrintSettingsEventPayload;
  }
}
