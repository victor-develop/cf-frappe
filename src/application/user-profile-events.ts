import { domainEventPayloadKind } from "../core/domain-events.js";
import type { DocumentData, DomainEvent } from "../core/types.js";

export type UserProfileEventPayload = {
  readonly kind: "UserProfileChanged";
  readonly userId: string;
  readonly profile: DocumentData;
};

export type UserProfilePayloadKind = UserProfileEventPayload["kind"];

export const USER_PROFILE_PAYLOAD_KINDS = Object.freeze([
  "UserProfileChanged"
] as const satisfies readonly UserProfilePayloadKind[]);

const USER_PROFILE_PAYLOAD_KIND_SET = new Set<string>(USER_PROFILE_PAYLOAD_KINDS);

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

export function userProfileEventType(payload: UserProfileEventPayload): UserProfilePayloadKind {
  return payload.kind;
}

export function isUserProfilePayloadKind(kind: string): kind is UserProfilePayloadKind {
  return USER_PROFILE_PAYLOAD_KIND_SET.has(kind);
}

export function isUserProfileEvent(event: DomainEvent): event is DomainEvent<UserProfileEventPayload> {
  return isUserProfilePayloadKind(domainEventPayloadKind(event));
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly UserProfileChanged: UserProfileEventPayload;
  }
}
