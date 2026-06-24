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
  readonly providers: readonly UserAuthProviderLink[];
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
  readonly providers?: readonly UserAuthProviderLink[];
  readonly enabled: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export interface UserAuthProviderLink {
  readonly provider: string;
  readonly subject: string;
  readonly email?: string;
  readonly roles?: readonly string[];
  readonly enabled?: boolean;
  readonly emailVerifiedAt?: string;
  readonly linkedAt: string;
  readonly lastSyncedAt: string;
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
    providers: [],
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
          ...(event.payload.emailVerifiedAt === undefined ? {} : { emailVerifiedAt: event.payload.emailVerifiedAt }),
          roles: normalizeUserRoles(event.payload.roles),
          ...(event.payload.passwordHash === undefined ? {} : { passwordHash: event.payload.passwordHash }),
          providers: [],
          enabled: event.payload.enabled,
          createdAt: event.occurredAt,
          updatedAt: event.occurredAt
        };
        break;
      case "UserAuthProviderLinked":
        if (event.payload.userId !== userId || !state.exists) {
          break;
        }
        state = {
          ...applyProviderAccountPatch(state, event.payload, event.occurredAt),
          version: event.sequence,
          providers: upsertProviderLink(state.providers, event.payload, event.occurredAt, event.occurredAt),
          updatedAt: event.occurredAt
        };
        break;
      case "UserAuthProviderSynced":
        if (event.payload.userId !== userId || !state.exists) {
          break;
        }
        state = {
          ...applyProviderAccountPatch(state, event.payload, event.occurredAt),
          version: event.sequence,
          providers: upsertProviderLink(state.providers, event.payload, undefined, event.occurredAt),
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
    ...(state.providers.length === 0 ? {} : { providers: state.providers }),
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

function applyProviderAccountPatch(
  state: UserAccountState,
  payload: {
    readonly email?: string;
    readonly roles?: readonly string[];
    readonly enabled?: boolean;
    readonly emailVerifiedAt?: string | null;
  },
  occurredAt: string
): UserAccountState {
  let next: UserAccountState = {
    ...state,
    ...(payload.email === undefined ? {} : { email: payload.email }),
    ...(payload.roles === undefined ? {} : { roles: normalizeUserRoles(payload.roles) }),
    ...(payload.enabled === undefined ? {} : { enabled: payload.enabled }),
    updatedAt: occurredAt
  };
  if (payload.enabled === false) {
    const {
      passwordReset: _passwordReset,
      emailVerification: _emailVerification,
      ...withoutChallenges
    } = next;
    next = withoutChallenges;
  }
  if (!Object.prototype.hasOwnProperty.call(payload, "emailVerifiedAt")) {
    return next;
  }
  if (payload.emailVerifiedAt === null) {
    const { emailVerifiedAt: _emailVerifiedAt, ...withoutEmailVerifiedAt } = next;
    return withoutEmailVerifiedAt;
  }
  return {
    ...next,
    ...(payload.emailVerifiedAt === undefined ? {} : { emailVerifiedAt: payload.emailVerifiedAt })
  };
}

function upsertProviderLink(
  providers: readonly UserAuthProviderLink[],
  payload: {
    readonly provider: string;
    readonly subject: string;
    readonly email?: string;
    readonly roles?: readonly string[];
    readonly enabled?: boolean;
    readonly emailVerifiedAt?: string | null;
  },
  linkedAt: string | undefined,
  lastSyncedAt: string
): readonly UserAuthProviderLink[] {
  const current = providers.find(
    (provider) => provider.provider === payload.provider && provider.subject === payload.subject
  );
  const link: UserAuthProviderLink = {
    provider: payload.provider,
    subject: payload.subject,
    ...(payload.email === undefined ? (current?.email === undefined ? {} : { email: current.email }) : { email: payload.email }),
    ...(payload.roles === undefined
      ? (current?.roles === undefined ? {} : { roles: current.roles })
      : { roles: normalizeUserRoles(payload.roles) }),
    ...(payload.enabled === undefined
      ? (current?.enabled === undefined ? {} : { enabled: current.enabled })
      : { enabled: payload.enabled }),
    ...(providerLinkEmailVerifiedAt(current, payload)),
    linkedAt: current?.linkedAt ?? linkedAt ?? lastSyncedAt,
    lastSyncedAt
  };
  return [
    ...providers.filter((provider) => provider.provider !== payload.provider || provider.subject !== payload.subject),
    link
  ].sort((left, right) => `${left.provider}:${left.subject}`.localeCompare(`${right.provider}:${right.subject}`));
}

function providerLinkEmailVerifiedAt(
  current: UserAuthProviderLink | undefined,
  payload: { readonly emailVerifiedAt?: string | null }
): { readonly emailVerifiedAt?: string } {
  if (!Object.prototype.hasOwnProperty.call(payload, "emailVerifiedAt")) {
    return current?.emailVerifiedAt === undefined ? {} : { emailVerifiedAt: current.emailVerifiedAt };
  }
  if (payload.emailVerifiedAt === null || payload.emailVerifiedAt === undefined) {
    return {};
  }
  return { emailVerifiedAt: payload.emailVerifiedAt };
}
