import type { DomainEvent, TenantId } from "./types.js";

export const USER_PROFILE_FIELDS = [
  "firstName",
  "middleName",
  "lastName",
  "fullName",
  "username",
  "language",
  "timeZone",
  "deskTheme",
  "dateFormat",
  "timeFormat",
  "numberFormat",
  "weekStart",
  "defaultWorkspace",
  "userImage",
  "phone",
  "mobileNo",
  "location",
  "bio"
] as const;

export type UserProfileField = (typeof USER_PROFILE_FIELDS)[number];

export type UserProfile = Partial<Record<UserProfileField, string>>;

export type UserProfilePatch = Partial<Record<UserProfileField, string | null>>;

export type UserProfileInput = Partial<Record<UserProfileField, string | null | undefined>>;

export interface UserProfileState {
  readonly tenantId: TenantId;
  readonly userId: string;
  readonly version: number;
  readonly profile: UserProfile;
  readonly updatedAt?: string;
}

export function foldUserProfile(
  tenantId: TenantId,
  userId: string,
  events: readonly DomainEvent[]
): UserProfileState {
  let state: UserProfileState = {
    tenantId,
    userId,
    version: 0,
    profile: {}
  };
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    state = { ...state, version: Math.max(state.version, event.sequence) };
    switch (event.payload.kind) {
      case "UserProfileChanged":
        if (event.payload.userId !== userId) {
          break;
        }
        state = {
          ...state,
          version: event.sequence,
          profile: applyUserProfilePatch(state.profile, normalizeUserProfilePatch(event.payload.profile)),
          updatedAt: event.occurredAt
        };
        break;
    }
  }
  return state;
}

export function normalizeUserProfilePatch(input: Record<string, unknown>): UserProfilePatch {
  const patch: Record<string, string | null> = {};
  for (const key of Object.keys(input).sort()) {
    if (!isUserProfileField(key)) {
      throw new Error(`Unknown user profile field '${key}'`);
    }
    const value = input[key];
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      patch[key] = null;
      continue;
    }
    if (typeof value !== "string") {
      throw new Error(`User profile field '${key}' must be a string`);
    }
    const normalized = value.trim();
    patch[key] = normalized.length === 0 ? null : normalized;
  }
  return patch;
}

export function applyUserProfilePatch(profile: UserProfile, patch: UserProfilePatch): UserProfile {
  const next: Record<string, string> = { ...profile };
  for (const key of USER_PROFILE_FIELDS) {
    const value = patch[key];
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      delete next[key];
      continue;
    }
    next[key] = value;
  }
  return next;
}

export function isUserProfileField(value: string): value is UserProfileField {
  return (USER_PROFILE_FIELDS as readonly string[]).includes(value);
}
