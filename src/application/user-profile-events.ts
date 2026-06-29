import { domainEventPayloadKind } from "../core/domain-events.js";
import {
  USER_PROFILE_STATE_PAYLOAD_KINDS,
  isUserProfileStatePayloadKind,
  userProfileStateEventType,
  type UserProfileStateEventPayload,
  type UserProfileStatePayloadKind
} from "../core/user-profiles.js";
import type { DocumentData, DomainEvent } from "../core/types.js";

export type UserProfileEventPayload = UserProfileStateEventPayload;

export type UserProfilePayloadKind = UserProfileStatePayloadKind;

export const USER_PROFILE_PAYLOAD_KINDS = USER_PROFILE_STATE_PAYLOAD_KINDS;

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
  return userProfileStateEventType(payload);
}

export function isUserProfilePayloadKind(kind: string): kind is UserProfilePayloadKind {
  return isUserProfileStatePayloadKind(kind);
}

export function isUserProfileEvent(event: DomainEvent): event is DomainEvent<UserProfileEventPayload> {
  return isUserProfilePayloadKind(domainEventPayloadKind(event));
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly UserProfileChanged: UserProfileEventPayload;
  }
}
