import type { DocumentData } from "../core/types.js";

export type UserProfileEventPayload = {
  readonly kind: "UserProfileChanged";
  readonly userId: string;
  readonly profile: DocumentData;
};

export interface UserProfileChangedPayloadInput {
  readonly userId: string;
  readonly profile: DocumentData;
}

export function userProfileChangedPayload(
  input: UserProfileChangedPayloadInput
): UserProfileEventPayload {
  return {
    kind: "UserProfileChanged",
    userId: input.userId,
    profile: input.profile
  };
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly UserProfileChanged: UserProfileEventPayload;
  }
}
