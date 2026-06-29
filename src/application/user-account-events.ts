export type UserAccountEventPayload =
  | {
      readonly kind: "UserAccountCreated";
      readonly userId: string;
      readonly email?: string;
      readonly roles: readonly string[];
      readonly passwordHash?: string;
      readonly enabled: boolean;
      readonly emailVerifiedAt?: string;
    }
  | {
      readonly kind: "UserAuthProviderLinked";
      readonly userId: string;
      readonly provider: string;
      readonly subject: string;
      readonly email?: string;
      readonly roles?: readonly string[];
      readonly enabled?: boolean;
      readonly emailVerifiedAt?: string | null;
    }
  | {
      readonly kind: "UserAuthProviderSynced";
      readonly userId: string;
      readonly provider: string;
      readonly subject: string;
      readonly email?: string;
      readonly roles?: readonly string[];
      readonly enabled?: boolean;
      readonly emailVerifiedAt?: string | null;
    }
  | {
      readonly kind: "UserPasswordChanged";
      readonly userId: string;
      readonly passwordHash: string;
    }
  | {
      readonly kind: "UserPasswordResetRequested";
      readonly userId: string;
      readonly tokenHash: string;
      readonly expiresAt: string;
    }
  | {
      readonly kind: "UserPasswordResetCompleted";
      readonly userId: string;
      readonly passwordHash: string;
    }
  | {
      readonly kind: "UserPasswordResetDeliveryFailed";
      readonly userId: string;
    }
  | {
      readonly kind: "UserEmailVerificationRequested";
      readonly userId: string;
      readonly email: string;
      readonly tokenHash: string;
      readonly expiresAt: string;
    }
  | {
      readonly kind: "UserEmailVerified";
      readonly userId: string;
      readonly email: string;
    }
  | {
      readonly kind: "UserEmailVerificationDeliveryFailed";
      readonly userId: string;
      readonly email: string;
    }
  | {
      readonly kind: "UserRolesChanged";
      readonly userId: string;
      readonly roles: readonly string[];
    }
  | {
      readonly kind: "UserAccountEnabled";
      readonly userId: string;
    }
  | {
      readonly kind: "UserAccountDisabled";
      readonly userId: string;
    };

export interface UserPasswordChangedPayloadInput {
  readonly userId: string;
  readonly passwordHash: string;
}

export interface UserAccountCreatedPayloadInput {
  readonly userId: string;
  readonly email?: string;
  readonly roles: readonly string[];
  readonly passwordHash?: string;
  readonly enabled: boolean;
  readonly emailVerifiedAt?: string;
}

export interface UserAuthProviderPayloadInput {
  readonly userId: string;
  readonly provider: string;
  readonly subject: string;
  readonly email?: string;
  readonly roles?: readonly string[];
  readonly enabled?: boolean;
  readonly emailVerifiedAt?: string | null;
}

export interface UserRolesChangedPayloadInput {
  readonly userId: string;
  readonly roles: readonly string[];
}

export interface UserPasswordResetRequestedPayloadInput {
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: string;
}

export interface UserEmailVerificationRequestedPayloadInput {
  readonly userId: string;
  readonly email: string;
  readonly tokenHash: string;
  readonly expiresAt: string;
}

export interface UserEmailPayloadInput {
  readonly userId: string;
  readonly email: string;
}

export interface UserAccountStatusPayloadInput {
  readonly userId: string;
}

export function userPasswordChangedPayload(
  input: UserPasswordChangedPayloadInput
): Extract<UserAccountEventPayload, { readonly kind: "UserPasswordChanged" }> {
  return {
    kind: "UserPasswordChanged",
    userId: input.userId,
    passwordHash: input.passwordHash
  };
}

export function userAccountCreatedPayload(
  input: UserAccountCreatedPayloadInput
): Extract<UserAccountEventPayload, { readonly kind: "UserAccountCreated" }> {
  return {
    kind: "UserAccountCreated",
    userId: input.userId,
    ...(input.email === undefined ? {} : { email: input.email }),
    roles: input.roles,
    ...(input.passwordHash === undefined ? {} : { passwordHash: input.passwordHash }),
    enabled: input.enabled,
    ...(input.emailVerifiedAt === undefined ? {} : { emailVerifiedAt: input.emailVerifiedAt })
  };
}

export function userAuthProviderLinkedPayload(
  input: UserAuthProviderPayloadInput
): Extract<UserAccountEventPayload, { readonly kind: "UserAuthProviderLinked" }> {
  return {
    kind: "UserAuthProviderLinked",
    userId: input.userId,
    provider: input.provider,
    subject: input.subject,
    ...(input.email === undefined ? {} : { email: input.email }),
    ...(input.roles === undefined ? {} : { roles: input.roles }),
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    ...(input.emailVerifiedAt === undefined ? {} : { emailVerifiedAt: input.emailVerifiedAt })
  };
}

export function userAuthProviderSyncedPayload(
  input: UserAuthProviderPayloadInput
): Extract<UserAccountEventPayload, { readonly kind: "UserAuthProviderSynced" }> {
  return {
    kind: "UserAuthProviderSynced",
    userId: input.userId,
    provider: input.provider,
    subject: input.subject,
    ...(input.email === undefined ? {} : { email: input.email }),
    ...(input.roles === undefined ? {} : { roles: input.roles }),
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    ...(input.emailVerifiedAt === undefined ? {} : { emailVerifiedAt: input.emailVerifiedAt })
  };
}

export function userPasswordResetCompletedPayload(
  input: UserPasswordChangedPayloadInput
): Extract<UserAccountEventPayload, { readonly kind: "UserPasswordResetCompleted" }> {
  return {
    kind: "UserPasswordResetCompleted",
    userId: input.userId,
    passwordHash: input.passwordHash
  };
}

export function userPasswordResetRequestedPayload(
  input: UserPasswordResetRequestedPayloadInput
): Extract<UserAccountEventPayload, { readonly kind: "UserPasswordResetRequested" }> {
  return {
    kind: "UserPasswordResetRequested",
    userId: input.userId,
    tokenHash: input.tokenHash,
    expiresAt: input.expiresAt
  };
}

export function userPasswordResetDeliveryFailedPayload(
  input: UserAccountStatusPayloadInput
): Extract<UserAccountEventPayload, { readonly kind: "UserPasswordResetDeliveryFailed" }> {
  return {
    kind: "UserPasswordResetDeliveryFailed",
    userId: input.userId
  };
}

export function userEmailVerificationRequestedPayload(
  input: UserEmailVerificationRequestedPayloadInput
): Extract<UserAccountEventPayload, { readonly kind: "UserEmailVerificationRequested" }> {
  return {
    kind: "UserEmailVerificationRequested",
    userId: input.userId,
    email: input.email,
    tokenHash: input.tokenHash,
    expiresAt: input.expiresAt
  };
}

export function userEmailVerifiedPayload(
  input: UserEmailPayloadInput
): Extract<UserAccountEventPayload, { readonly kind: "UserEmailVerified" }> {
  return {
    kind: "UserEmailVerified",
    userId: input.userId,
    email: input.email
  };
}

export function userEmailVerificationDeliveryFailedPayload(
  input: UserEmailPayloadInput
): Extract<UserAccountEventPayload, { readonly kind: "UserEmailVerificationDeliveryFailed" }> {
  return {
    kind: "UserEmailVerificationDeliveryFailed",
    userId: input.userId,
    email: input.email
  };
}

export function userRolesChangedPayload(
  input: UserRolesChangedPayloadInput
): Extract<UserAccountEventPayload, { readonly kind: "UserRolesChanged" }> {
  return {
    kind: "UserRolesChanged",
    userId: input.userId,
    roles: input.roles
  };
}

export function userAccountEnabledPayload(
  input: UserAccountStatusPayloadInput
): Extract<UserAccountEventPayload, { readonly kind: "UserAccountEnabled" }> {
  return {
    kind: "UserAccountEnabled",
    userId: input.userId
  };
}

export function userAccountDisabledPayload(
  input: UserAccountStatusPayloadInput
): Extract<UserAccountEventPayload, { readonly kind: "UserAccountDisabled" }> {
  return {
    kind: "UserAccountDisabled",
    userId: input.userId
  };
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly UserAccountCreated: Extract<
      UserAccountEventPayload,
      { readonly kind: "UserAccountCreated" }
    >;
    readonly UserAuthProviderLinked: Extract<
      UserAccountEventPayload,
      { readonly kind: "UserAuthProviderLinked" }
    >;
    readonly UserAuthProviderSynced: Extract<
      UserAccountEventPayload,
      { readonly kind: "UserAuthProviderSynced" }
    >;
    readonly UserPasswordChanged: Extract<
      UserAccountEventPayload,
      { readonly kind: "UserPasswordChanged" }
    >;
    readonly UserPasswordResetRequested: Extract<
      UserAccountEventPayload,
      { readonly kind: "UserPasswordResetRequested" }
    >;
    readonly UserPasswordResetCompleted: Extract<
      UserAccountEventPayload,
      { readonly kind: "UserPasswordResetCompleted" }
    >;
    readonly UserPasswordResetDeliveryFailed: Extract<
      UserAccountEventPayload,
      { readonly kind: "UserPasswordResetDeliveryFailed" }
    >;
    readonly UserEmailVerificationRequested: Extract<
      UserAccountEventPayload,
      { readonly kind: "UserEmailVerificationRequested" }
    >;
    readonly UserEmailVerified: Extract<
      UserAccountEventPayload,
      { readonly kind: "UserEmailVerified" }
    >;
    readonly UserEmailVerificationDeliveryFailed: Extract<
      UserAccountEventPayload,
      { readonly kind: "UserEmailVerificationDeliveryFailed" }
    >;
    readonly UserRolesChanged: Extract<
      UserAccountEventPayload,
      { readonly kind: "UserRolesChanged" }
    >;
    readonly UserAccountEnabled: Extract<
      UserAccountEventPayload,
      { readonly kind: "UserAccountEnabled" }
    >;
    readonly UserAccountDisabled: Extract<
      UserAccountEventPayload,
      { readonly kind: "UserAccountDisabled" }
    >;
  }
}
