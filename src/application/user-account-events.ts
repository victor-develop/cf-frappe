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
