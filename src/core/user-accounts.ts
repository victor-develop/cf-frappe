import { normalizeRoleName } from "./roles.js";
import type { Actor, DomainEvent, TenantId } from "./types.js";

export interface UserAccountState {
  readonly tenantId: TenantId;
  readonly userId: string;
  readonly version: number;
  readonly exists: boolean;
  readonly email?: string;
  readonly emailVerifiedAt?: string;
  readonly roles: readonly string[];
  readonly passwordHash?: string;
  readonly passwordReset?: UserAccountRecoveryChallenge;
  readonly emailVerification?: UserAccountEmailVerificationChallenge;
  readonly enabled: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface UserAccount {
  readonly tenantId: TenantId;
  readonly userId: string;
  readonly version: number;
  readonly email?: string;
  readonly emailVerifiedAt?: string;
  readonly roles: readonly string[];
  readonly enabled: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface UserAccountRecoveryChallenge {
  readonly tokenHash: string;
  readonly expiresAt: string;
  readonly requestedAt: string;
}

export interface UserAccountEmailVerificationChallenge extends UserAccountRecoveryChallenge {
  readonly email: string;
}

export function foldUserAccount(
  tenantId: TenantId,
  userId: string,
  events: readonly DomainEvent[]
): UserAccountState {
  let state: UserAccountState = {
    tenantId,
    userId,
    version: 0,
    exists: false,
    roles: [],
    enabled: false
  };
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    state = { ...state, version: Math.max(state.version, event.sequence) };
    switch (event.payload.kind) {
      case "UserAccountCreated":
        if (event.payload.userId !== userId) {
          break;
        }
        state = {
          tenantId,
          userId,
          version: event.sequence,
          exists: true,
          ...(event.payload.email === undefined ? {} : { email: event.payload.email }),
          roles: normalizeUserRoles(event.payload.roles),
          passwordHash: event.payload.passwordHash,
          enabled: event.payload.enabled,
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt
        };
        break;
      case "UserPasswordChanged":
        if (event.payload.userId !== userId || !state.exists) {
          break;
        }
        {
          const { passwordReset: _passwordReset, ...withoutReset } = state;
          state = {
            ...withoutReset,
            version: event.sequence,
            passwordHash: event.payload.passwordHash,
            updatedAt: event.occurredAt
          };
        }
        break;
      case "UserPasswordResetRequested":
        if (event.payload.userId !== userId || !state.exists) {
          break;
        }
        state = {
          ...state,
          version: event.sequence,
          passwordReset: {
            tokenHash: event.payload.tokenHash,
            expiresAt: event.payload.expiresAt,
            requestedAt: event.occurredAt
          },
          updatedAt: event.occurredAt
        };
        break;
      case "UserPasswordResetCompleted":
        if (event.payload.userId !== userId || !state.exists) {
          break;
        }
        {
          const { passwordReset: _passwordReset, ...withoutReset } = state;
          state = {
            ...withoutReset,
            version: event.sequence,
            passwordHash: event.payload.passwordHash,
            updatedAt: event.occurredAt
          };
        }
        break;
      case "UserPasswordResetDeliveryFailed":
        if (event.payload.userId !== userId || !state.exists) {
          break;
        }
        {
          const { passwordReset: _passwordReset, ...withoutReset } = state;
          state = {
            ...withoutReset,
            version: event.sequence,
            updatedAt: event.occurredAt
          };
        }
        break;
      case "UserEmailVerificationRequested":
        if (event.payload.userId !== userId || !state.exists) {
          break;
        }
        state = {
          ...state,
          version: event.sequence,
          emailVerification: {
            email: event.payload.email,
            tokenHash: event.payload.tokenHash,
            expiresAt: event.payload.expiresAt,
            requestedAt: event.occurredAt
          },
          updatedAt: event.occurredAt
        };
        break;
      case "UserEmailVerified":
        if (event.payload.userId !== userId || !state.exists) {
          break;
        }
        {
          const { emailVerification: _emailVerification, ...withoutVerification } = state;
          state = {
            ...withoutVerification,
            version: event.sequence,
            emailVerifiedAt: event.occurredAt,
            updatedAt: event.occurredAt
          };
        }
        break;
      case "UserEmailVerificationDeliveryFailed":
        if (event.payload.userId !== userId || !state.exists) {
          break;
        }
        {
          const { emailVerification: _emailVerification, ...withoutVerification } = state;
          state = {
            ...withoutVerification,
            version: event.sequence,
            updatedAt: event.occurredAt
          };
        }
        break;
      case "UserRolesChanged":
        if (event.payload.userId !== userId || !state.exists) {
          break;
        }
        state = {
          ...state,
          version: event.sequence,
          roles: normalizeUserRoles(event.payload.roles),
          updatedAt: event.occurredAt
        };
        break;
      case "UserAccountEnabled":
        if (event.payload.userId !== userId || !state.exists) {
          break;
        }
        state = {
          ...state,
          version: event.sequence,
          enabled: true,
          updatedAt: event.occurredAt
        };
        break;
      case "UserAccountDisabled":
        if (event.payload.userId !== userId || !state.exists) {
          break;
        }
        {
          const {
            passwordReset: _passwordReset,
            emailVerification: _emailVerification,
            ...withoutChallenges
          } = state;
          state = {
            ...withoutChallenges,
            version: event.sequence,
            enabled: false,
            updatedAt: event.occurredAt
          };
        }
        break;
    }
  }
  return state;
}

export function userAccountActor(state: UserAccountState): Actor {
  return {
    id: state.userId,
    roles: state.roles,
    tenantId: state.tenantId,
    ...(state.email === undefined ? {} : { email: state.email })
  };
}

export function publicUserAccount(state: UserAccountState): UserAccount {
  return {
    tenantId: state.tenantId,
    userId: state.userId,
    version: state.version,
    ...(state.email === undefined ? {} : { email: state.email }),
    ...(state.emailVerifiedAt === undefined ? {} : { emailVerifiedAt: state.emailVerifiedAt }),
    roles: state.roles,
    enabled: state.enabled,
    ...(state.createdAt === undefined ? {} : { createdAt: state.createdAt }),
    ...(state.updatedAt === undefined ? {} : { updatedAt: state.updatedAt })
  };
}

export function normalizeUserRoles(roles: readonly string[]): readonly string[] {
  return uniqueSorted(roles.map(normalizeRoleName).filter(Boolean));
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
