import type { DocumentData } from "../core/types.js";

export type UserProfileEventPayload = {
  readonly kind: "UserProfileChanged";
  readonly userId: string;
  readonly profile: DocumentData;
};

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly UserProfileChanged: UserProfileEventPayload;
  }
}
