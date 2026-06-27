import type { DocumentData } from "../core/types.js";

export type PrintSettingsEventPayload = {
  readonly kind: "PrintSettingsChanged";
  readonly settings: DocumentData;
};

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly PrintSettingsChanged: PrintSettingsEventPayload;
  }
}
