import type { DocumentData } from "../core/types.js";

export type PrintSettingsEventPayload = {
  readonly kind: "PrintSettingsChanged";
  readonly settings: DocumentData;
};

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

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly PrintSettingsChanged: PrintSettingsEventPayload;
  }
}
