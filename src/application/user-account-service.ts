import { conflict, FrameworkError, notFound, permissionDenied } from "../core/errors.js";
import { userAccountsStream } from "../core/streams.js";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocumentData,
  type DomainEvent,
  type TenantId
} from "../core/types.js";
import {
  userAccountDisabledPayload,
  userAccountCreatedPayload,
  userAccountEnabledPayload,
  findUserAuthProviderLink,
  userAccountEvent,
  userAuthProviderLinkedPayload,
  userAuthProviderSyncedPayload,
  userEmailVerificationDeliveryFailedPayload,
  userEmailVerificationRequestedPayload,
  userEmailVerifiedPayload,
  userPasswordChangedPayload,
  userPasswordResetDeliveryFailedPayload,
  userPasswordResetCompletedPayload,
  userPasswordResetRequestedPayload,
  providerSyncChangesState,
  replayUserAccountAppend,
  userRolesChangedPayload,
  type UserAccountEventPayload
} from "./user-account-events.js";
import {
  foldUserAccount,
  publicUserAccount,
  userAccountActor,
  type UserAccount,
  type UserAccountEmailVerificationChallenge,
  type UserAccountRecoveryChallenge,
  type UserAccountState
} from "../core/user-accounts.js";
import type { AccountRecoveryNotifier } from "../ports/account-recovery.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { EventStore } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";
import type { PasswordHasher } from "../ports/password-hasher.js";
import {
  emailVerificationPatch,
  ensureUserAccountExpectedVersion,
  normalizeRecoveryExpirySeconds,
  normalizeOptionalUserEmail,
  normalizeRequiredUserAccountText,
  normalizeRequiredUserRoles,
  normalizeUserLoginPassword,
  normalizeUserPassword,
  normalizeUserRecoveryToken,
  recoveryChallengeExpired,
  recoveryExpiresAtFrom,
  userAccountRolesEqual
} from "./user-account-policy.js";
import type { UserRoleValidator } from "./user-role-validator.js";

export type { UserAccountEventPayload } from "./user-account-events.js";

const DEFAULT_PASSWORD_RESET_EXPIRY_SECONDS = 3_600;
const DEFAULT_EMAIL_VERIFICATION_EXPIRY_SECONDS = 86_400;
const RECOVERY_ACTOR_ID = "anonymous";
const DEFAULT_PROVIDER_ROLE = "User";

export interface UserAccountServiceOptions {
  readonly events: EventStore;
  readonly passwords: PasswordHasher;
  readonly tokenSecrets?: PasswordHasher;
  readonly recovery?: AccountRecoveryNotifier;
  readonly ids?: IdGenerator;
  readonly recoveryTokens?: IdGenerator;
  readonly passwordResetExpiresInSeconds?: number;
  readonly emailVerificationExpiresInSeconds?: number;
  readonly clock?: Clock;
  readonly adminRoles?: readonly string[];
  readonly roleValidator?: UserRoleValidator;
}

export interface CreateUserAccountCommand {
  readonly actor: Actor;
  readonly userId: string;
  readonly email?: string;
  readonly password: string;
  readonly roles: readonly string[];
  readonly enabled?: boolean;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface ChangeUserPasswordCommand {
  readonly actor: Actor;
  readonly userId: string;
  readonly password: string;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface ChangeUserRolesCommand {
  readonly actor: Actor;
  readonly userId: string;
  readonly roles: readonly string[];
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface SetUserAccountEnabledCommand {
  readonly actor: Actor;
  readonly userId: string;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface SyncAuthProviderAccountCommand {
  readonly actor: Actor;
  readonly provider: string;
  readonly subject: string;
  readonly userId?: string;
  readonly email?: string;
  readonly roles?: readonly string[];
  readonly enabled?: boolean;
  readonly emailVerified?: boolean;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface AuthenticateUserAccountCommand {
  readonly userId: string;
  readonly password: string;
  readonly tenantId?: TenantId;
}

export interface RequestUserPasswordResetCommand {
  readonly userId: string;
  readonly tenantId?: TenantId;
  readonly metadata?: DocumentData;
}

export interface ResetUserPasswordCommand {
  readonly userId: string;
  readonly token: string;
  readonly password: string;
  readonly tenantId?: TenantId;
  readonly metadata?: DocumentData;
}

export interface RequestUserEmailVerificationCommand {
  readonly userId: string;
  readonly tenantId?: TenantId;
  readonly metadata?: DocumentData;
}

export interface VerifyUserEmailCommand {
  readonly userId: string;
  readonly token: string;
  readonly tenantId?: TenantId;
  readonly metadata?: DocumentData;
}

export interface AccountRecoveryRequestResult {
  readonly tenantId: TenantId;
  readonly userId: string;
  readonly delivered: boolean;
}

export interface AuthenticatedUserAccount {
  readonly actor: Actor;
  readonly account: UserAccount;
}

export class UserAccountService {
  private readonly events: EventStore;
  private readonly passwords: PasswordHasher;
  private readonly tokenSecrets: PasswordHasher;
  private readonly recovery: AccountRecoveryNotifier | undefined;
  private readonly ids: IdGenerator;
  private readonly recoveryTokens: IdGenerator;
  private readonly passwordResetExpiresInSeconds: number;
  private readonly emailVerificationExpiresInSeconds: number;
  private readonly clock: Clock;
  private readonly adminRoles: readonly string[];
  private readonly roleValidator: UserRoleValidator | undefined;

  constructor(options: UserAccountServiceOptions) {
    this.events = options.events;
    this.passwords = options.passwords;
    this.tokenSecrets = options.tokenSecrets ?? options.passwords;
    this.recovery = options.recovery;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.recoveryTokens = options.recoveryTokens ?? cryptoIdGenerator;
    this.passwordResetExpiresInSeconds = normalizeRecoveryExpirySeconds(
      options.passwordResetExpiresInSeconds,
      DEFAULT_PASSWORD_RESET_EXPIRY_SECONDS
    );
    this.emailVerificationExpiresInSeconds = normalizeRecoveryExpirySeconds(
      options.emailVerificationExpiresInSeconds,
      DEFAULT_EMAIL_VERIFICATION_EXPIRY_SECONDS
    );
    this.clock = options.clock ?? systemClock;
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
    this.roleValidator = options.roleValidator;
  }

  async create(command: CreateUserAccountCommand): Promise<UserAccount> {
    this.ensureAdmin(command.actor);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const userId = normalizeRequiredUserAccountText(command.userId, "User id");
    const roles = normalizeRequiredUserRoles(command.roles);
    const password = normalizeUserPassword(command.password);
    const email = normalizeOptionalUserEmail(command.email);
    const state = await this.stateFor(tenantId, userId);
    ensureUserAccountExpectedVersion(state, command.expectedVersion);
    if (state.exists) {
      throw conflict(`User account '${userId}' already exists`);
    }
    await this.validateRoles(tenantId, roles);
    const passwordHash = await this.passwords.hash(password);
    const saved = await this.appendEvent({
      tenantId,
      stream: userAccountsStream(tenantId, userId),
      expectedVersion: state.version,
      actorId: command.actor.id,
      metadata: command.metadata,
      payload: userAccountCreatedPayload({
        userId,
        ...(email === undefined ? {} : { email }),
        roles,
        passwordHash,
        enabled: command.enabled ?? true
      })
    });
    return publicUserAccount(foldUserAccount(tenantId, userId, saved));
  }

  async get(actor: Actor, userId: string, tenantId?: TenantId): Promise<UserAccount> {
    this.ensureAdmin(actor);
    const resolvedTenantId = resolveActorTenant(actor, tenantId);
    const state = await this.existingStateFor(resolvedTenantId, normalizeRequiredUserAccountText(userId, "User id"));
    return publicUserAccount(state);
  }

  authorizeAdministration(actor: Actor, tenantId?: TenantId): void {
    this.ensureAdmin(actor);
    resolveActorTenant(actor, tenantId);
  }

  async changePassword(command: ChangeUserPasswordCommand): Promise<UserAccount> {
    this.ensureAdmin(command.actor);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const userId = normalizeRequiredUserAccountText(command.userId, "User id");
    const password = normalizeUserPassword(command.password);
    const state = await this.existingStateFor(tenantId, userId);
    ensureUserAccountExpectedVersion(state, command.expectedVersion);
    const passwordHash = await this.passwords.hash(password);
    const saved = await this.appendEvent({
      tenantId,
      stream: userAccountsStream(tenantId, userId),
      expectedVersion: state.version,
      actorId: command.actor.id,
      metadata: command.metadata,
      payload: userPasswordChangedPayload({
        userId,
        passwordHash
      })
    });
    return this.refold(tenantId, userId, state.version, saved);
  }

  async changeRoles(command: ChangeUserRolesCommand): Promise<UserAccount> {
    this.ensureAdmin(command.actor);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const userId = normalizeRequiredUserAccountText(command.userId, "User id");
    const roles = normalizeRequiredUserRoles(command.roles);
    const state = await this.existingStateFor(tenantId, userId);
    ensureUserAccountExpectedVersion(state, command.expectedVersion);
    await this.validateRoles(tenantId, roles);
    if (userAccountRolesEqual(state.roles, roles)) {
      return publicUserAccount(state);
    }
    const saved = await this.appendEvent({
      tenantId,
      stream: userAccountsStream(tenantId, userId),
      expectedVersion: state.version,
      actorId: command.actor.id,
      metadata: command.metadata,
      payload: userRolesChangedPayload({
        userId,
        roles
      })
    });
    return this.refold(tenantId, userId, state.version, saved);
  }

  async enable(command: SetUserAccountEnabledCommand): Promise<UserAccount> {
    return this.changeEnabled(command, true);
  }

  async disable(command: SetUserAccountEnabledCommand): Promise<UserAccount> {
    return this.changeEnabled(command, false);
  }

  async syncProvider(command: SyncAuthProviderAccountCommand): Promise<UserAccount> {
    this.ensureAdmin(command.actor);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const provider = normalizeRequiredUserAccountText(command.provider, "Provider");
    const subject = normalizeRequiredUserAccountText(command.subject, "Provider subject");
    const email = normalizeOptionalUserEmail(command.email);
    const userId = normalizeRequiredUserAccountText(command.userId ?? email ?? `${provider}:${subject}`, "User id");
    const roles = command.roles === undefined ? undefined : normalizeRequiredUserRoles(command.roles);
    const state = await this.stateFor(tenantId, userId);
    ensureUserAccountExpectedVersion(state, command.expectedVersion);
    const verifiedPatch = emailVerificationPatch(
      command.emailVerified,
      email ?? state.email,
      state.email,
      state.emailVerifiedAt,
      this.clock.now()
    );

    if (!state.exists) {
      const createdRoles = roles ?? normalizeRequiredUserRoles([DEFAULT_PROVIDER_ROLE]);
      const enabled = command.enabled ?? true;
      await this.validateRoles(tenantId, createdRoles);
      const createdPayload = userAccountCreatedPayload({
        userId,
        ...(email === undefined ? {} : { email }),
        roles: createdRoles,
        enabled,
        ...(typeof verifiedPatch === "string" ? { emailVerifiedAt: verifiedPatch } : {})
      });
      const linkedPayload = userAuthProviderLinkedPayload({
        userId,
        provider,
        subject,
        ...(email === undefined ? {} : { email }),
        roles: createdRoles,
        enabled,
        ...(verifiedPatch === undefined ? {} : { emailVerifiedAt: verifiedPatch })
      });
      const saved = await this.appendEvents({
        tenantId,
        stream: userAccountsStream(tenantId, userId),
        expectedVersion: state.version,
        actorId: command.actor.id,
        metadata: command.metadata,
        events: [
          { payload: createdPayload },
          { payload: linkedPayload }
        ]
      });
      return publicUserAccount(foldUserAccount(tenantId, userId, saved));
    }

    if (roles !== undefined) {
      await this.validateRoles(tenantId, roles);
    }
    const link = findUserAuthProviderLink(state.providers, provider, subject);
    const providerPayloadInput = {
      userId,
      provider,
      subject,
      ...(email === undefined ? {} : { email }),
      ...(roles === undefined ? {} : { roles }),
      ...(command.enabled === undefined ? {} : { enabled: command.enabled }),
      ...(verifiedPatch === undefined ? {} : { emailVerifiedAt: verifiedPatch })
    };
    const payload = link === undefined
      ? userAuthProviderLinkedPayload(providerPayloadInput)
      : userAuthProviderSyncedPayload(providerPayloadInput);
    if (link !== undefined && !providerSyncChangesState(state, link, payload)) {
      return publicUserAccount(state);
    }
    const saved = await this.appendEvents({
      tenantId,
      stream: userAccountsStream(tenantId, userId),
      expectedVersion: state.version,
      actorId: command.actor.id,
      metadata: command.metadata,
      events: [
        {
          payload
        }
      ]
    });
    return this.refold(tenantId, userId, state.version, saved);
  }

  async authenticate(command: AuthenticateUserAccountCommand): Promise<Actor> {
    return (await this.authenticateAccount(command)).actor;
  }

  async authenticateAccount(command: AuthenticateUserAccountCommand): Promise<AuthenticatedUserAccount> {
    const tenantId = command.tenantId ?? DEFAULT_TENANT_ID;
    const userId = normalizeRequiredUserAccountText(command.userId, "User id");
    const password = normalizeUserLoginPassword(command.password);
    const state = await this.stateFor(tenantId, userId);
    if (!state.exists || state.passwordHash === undefined) {
      throw permissionDenied("Invalid credentials");
    }
    const verified = await this.passwords.verify(password, state.passwordHash);
    if (!verified) {
      throw permissionDenied("Invalid credentials");
    }
    if (!state.enabled) {
      throw permissionDenied("Invalid credentials");
    }
    return { actor: userAccountActor(state), account: publicUserAccount(state) };
  }

  async requestPasswordReset(command: RequestUserPasswordResetCommand): Promise<AccountRecoveryRequestResult> {
    const tenantId = command.tenantId ?? DEFAULT_TENANT_ID;
    const userId = normalizeRequiredUserAccountText(command.userId, "User id");
    const state = await this.stateFor(tenantId, userId);
    const recovery = this.recovery;
    const email = state.email;
    if (!state.exists || !state.enabled || state.passwordHash === undefined || email === undefined || recovery === undefined) {
      return { tenantId, userId, delivered: false };
    }
    const token = this.recoveryTokens.next("tok_");
    const expiresAt = recoveryExpiresAtFrom(this.clock.now(), this.passwordResetExpiresInSeconds);
    const tokenHash = await this.tokenSecrets.hash(token);
    let saved: readonly DomainEvent[];
    try {
      saved = await this.appendEvent({
        tenantId,
        stream: userAccountsStream(tenantId, userId),
        expectedVersion: state.version,
        actorId: RECOVERY_ACTOR_ID,
        metadata: command.metadata,
        payload: userPasswordResetRequestedPayload({
          userId,
          tokenHash,
          expiresAt
        })
      });
    } catch (error) {
      if (isConflict(error)) {
        return { tenantId, userId, delivered: false };
      }
      throw error;
    }
    try {
      await recovery.sendPasswordReset({ tenantId, userId, email, token, expiresAt });
    } catch {
      await this.markRecoveryDeliveryFailed({
        tenantId,
        userId,
        expectedVersion: lastSequence(saved, state.version),
        metadata: command.metadata,
        payload: userPasswordResetDeliveryFailedPayload({
          userId
        })
      });
      return { tenantId, userId, delivered: false };
    }
    return { tenantId, userId, delivered: true };
  }

  async resetPassword(command: ResetUserPasswordCommand): Promise<UserAccount> {
    const tenantId = command.tenantId ?? DEFAULT_TENANT_ID;
    const userId = normalizeRequiredUserAccountText(command.userId, "User id");
    const token = normalizeUserRecoveryToken(command.token);
    const password = normalizeUserPassword(command.password);
    const state = await this.stateFor(tenantId, userId);
    if (state.passwordHash === undefined) {
      throw invalidRecoveryToken();
    }
    await this.ensureValidRecoveryChallenge(state, state.passwordReset, token);
    const passwordHash = await this.passwords.hash(password);
    const saved = await this.appendEvent({
      tenantId,
      stream: userAccountsStream(tenantId, userId),
      expectedVersion: state.version,
      actorId: RECOVERY_ACTOR_ID,
      metadata: command.metadata,
      payload: userPasswordResetCompletedPayload({
        userId,
        passwordHash
      })
    });
    return this.refold(tenantId, userId, state.version, saved);
  }

  async requestEmailVerification(command: RequestUserEmailVerificationCommand): Promise<AccountRecoveryRequestResult> {
    const tenantId = command.tenantId ?? DEFAULT_TENANT_ID;
    const userId = normalizeRequiredUserAccountText(command.userId, "User id");
    const state = await this.stateFor(tenantId, userId);
    const recovery = this.recovery;
    const email = state.email;
    if (!state.exists || !state.enabled || email === undefined || state.emailVerifiedAt !== undefined || recovery === undefined) {
      return { tenantId, userId, delivered: false };
    }
    const token = this.recoveryTokens.next("tok_");
    const expiresAt = recoveryExpiresAtFrom(this.clock.now(), this.emailVerificationExpiresInSeconds);
    const tokenHash = await this.tokenSecrets.hash(token);
    let saved: readonly DomainEvent[];
    try {
      saved = await this.appendEvent({
        tenantId,
        stream: userAccountsStream(tenantId, userId),
        expectedVersion: state.version,
        actorId: RECOVERY_ACTOR_ID,
        metadata: command.metadata,
        payload: userEmailVerificationRequestedPayload({
          userId,
          email,
          tokenHash,
          expiresAt
        })
      });
    } catch (error) {
      if (isConflict(error)) {
        return { tenantId, userId, delivered: false };
      }
      throw error;
    }
    try {
      await recovery.sendEmailVerification({ tenantId, userId, email, token, expiresAt });
    } catch {
      await this.markRecoveryDeliveryFailed({
        tenantId,
        userId,
        expectedVersion: lastSequence(saved, state.version),
        metadata: command.metadata,
        payload: userEmailVerificationDeliveryFailedPayload({
          userId,
          email
        })
      });
      return { tenantId, userId, delivered: false };
    }
    return { tenantId, userId, delivered: true };
  }

  async verifyEmail(command: VerifyUserEmailCommand): Promise<UserAccount> {
    const tenantId = command.tenantId ?? DEFAULT_TENANT_ID;
    const userId = normalizeRequiredUserAccountText(command.userId, "User id");
    const token = normalizeUserRecoveryToken(command.token);
    const state = await this.stateFor(tenantId, userId);
    const challenge = state.emailVerification;
    await this.ensureValidRecoveryChallenge(state, challenge, token);
    if (challenge === undefined) {
      throw invalidRecoveryToken();
    }
    const saved = await this.appendEvent({
      tenantId,
      stream: userAccountsStream(tenantId, userId),
      expectedVersion: state.version,
      actorId: RECOVERY_ACTOR_ID,
      metadata: command.metadata,
      payload: userEmailVerifiedPayload({
        userId,
        email: challenge.email
      })
    });
    return this.refold(tenantId, userId, state.version, saved);
  }

  async resolveSessionActor(actor: Actor, accountVersion: number | undefined): Promise<Actor> {
    if (accountVersion === undefined) {
      throw permissionDenied("Session is no longer valid");
    }
    const tenantId = actor.tenantId ?? DEFAULT_TENANT_ID;
    const state = await this.stateFor(tenantId, normalizeRequiredUserAccountText(actor.id, "User id"));
    if (!state.exists || !state.enabled || state.version !== accountVersion) {
      throw permissionDenied("Session is no longer valid");
    }
    return userAccountActor(state);
  }

  private async changeEnabled(command: SetUserAccountEnabledCommand, enabled: boolean): Promise<UserAccount> {
    this.ensureAdmin(command.actor);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const userId = normalizeRequiredUserAccountText(command.userId, "User id");
    const state = await this.existingStateFor(tenantId, userId);
    ensureUserAccountExpectedVersion(state, command.expectedVersion);
    if (state.enabled === enabled) {
      return publicUserAccount(state);
    }
    const saved = await this.appendEvent({
      tenantId,
      stream: userAccountsStream(tenantId, userId),
      expectedVersion: state.version,
      actorId: command.actor.id,
      metadata: command.metadata,
      payload: enabled ? userAccountEnabledPayload({ userId }) : userAccountDisabledPayload({ userId })
    });
    return this.refold(tenantId, userId, state.version, saved);
  }

  private async refold(
    tenantId: TenantId,
    userId: string,
    previousVersion: number,
    saved: readonly DomainEvent[]
  ): Promise<UserAccount> {
    return publicUserAccount(
      replayUserAccountAppend(
        tenantId,
        userId,
        await this.events.readStream(userAccountsStream(tenantId, userId), { maxSequence: previousVersion }),
        saved
      )
    );
  }

  private async appendEvent<TPayload extends UserAccountEventPayload>(options: {
    readonly tenantId: TenantId;
    readonly stream: string;
    readonly expectedVersion: number;
    readonly actorId: string;
    readonly metadata: DocumentData | undefined;
    readonly payload: TPayload;
  }) {
    return this.appendEvents({
      tenantId: options.tenantId,
      stream: options.stream,
      expectedVersion: options.expectedVersion,
      actorId: options.actorId,
      metadata: options.metadata,
      events: [{ payload: options.payload }]
    });
  }

  private async appendEvents(options: {
    readonly tenantId: TenantId;
    readonly stream: string;
    readonly expectedVersion: number;
    readonly actorId: string;
    readonly metadata: DocumentData | undefined;
    readonly events: readonly {
      readonly payload: UserAccountEventPayload;
    }[];
  }) {
    const occurredAt = this.clock.now();
    return this.events.append(
      options.stream,
      options.expectedVersion,
      options.events.map((item) => userAccountEvent({
        id: this.ids.next("evt_"),
        tenantId: options.tenantId,
        stream: options.stream,
        actorId: options.actorId,
        occurredAt,
        payload: item.payload,
        ...(options.metadata === undefined ? {} : { metadata: options.metadata })
      }))
    );
  }

  private async markRecoveryDeliveryFailed<TPayload extends UserAccountEventPayload>(options: {
    readonly tenantId: TenantId;
    readonly userId: string;
    readonly expectedVersion: number;
    readonly metadata: DocumentData | undefined;
    readonly payload: TPayload;
  }): Promise<void> {
    try {
      await this.appendEvent({
        tenantId: options.tenantId,
        stream: userAccountsStream(options.tenantId, options.userId),
        expectedVersion: options.expectedVersion,
        actorId: RECOVERY_ACTOR_ID,
        metadata: options.metadata,
        payload: options.payload
      });
    } catch (error) {
      if (isConflict(error)) {
        return;
      }
      throw error;
    }
  }

  private async existingStateFor(tenantId: TenantId, userId: string): Promise<UserAccountState> {
    const state = await this.stateFor(tenantId, userId);
    if (!state.exists) {
      throw notFound(`User account '${userId}' was not found`);
    }
    return state;
  }

  private async stateFor(tenantId: TenantId, userId: string): Promise<UserAccountState> {
    return foldUserAccount(tenantId, userId, await this.events.readStream(userAccountsStream(tenantId, userId)));
  }

  private ensureAdmin(actor: Actor): void {
    if (!this.adminRoles.some((role) => actor.roles.includes(role))) {
      throw permissionDenied(`Actor '${actor.id}' cannot manage user accounts`);
    }
  }

  private async validateRoles(tenantId: TenantId, roles: readonly string[]): Promise<void> {
    await this.roleValidator?.validateRoles({ tenantId, roles });
  }

  private async ensureValidRecoveryChallenge(
    state: UserAccountState,
    challenge: UserAccountRecoveryChallenge | UserAccountEmailVerificationChallenge | undefined,
    token: string
  ): Promise<void> {
    if (!state.exists || !state.enabled || challenge === undefined || recoveryChallengeExpired(challenge.expiresAt, this.clock.now())) {
      throw invalidRecoveryToken();
    }
    if (!(await this.tokenSecrets.verify(token, challenge.tokenHash))) {
      throw invalidRecoveryToken();
    }
  }
}

function resolveActorTenant(actor: Actor, explicitTenantId: TenantId | undefined): TenantId {
  const actorTenantId = actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = explicitTenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    throw permissionDenied(`Actor '${actor.id}' cannot manage user accounts for tenant '${tenantId}'`);
  }
  return tenantId;
}

function invalidRecoveryToken(): Error {
  return permissionDenied("Invalid recovery token");
}

function isConflict(error: unknown): boolean {
  return error instanceof FrameworkError && error.code === "DOCUMENT_CONFLICT";
}

function lastSequence(events: readonly DomainEvent[], fallback: number): number {
  return events.at(-1)?.sequence ?? fallback;
}
