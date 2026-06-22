import { badRequest, conflict, notFound, permissionDenied } from "../core/errors";
import { userAccountsStream } from "../core/streams";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocumentData,
  type DomainEvent,
  type NewDomainEvent,
  type TenantId
} from "../core/types";
import {
  foldUserAccount,
  normalizeUserRoles,
  publicUserAccount,
  userAccountActor,
  type UserAccount,
  type UserAccountState
} from "../core/user-accounts";
import { systemClock, type Clock } from "../ports/clock";
import type { EventStore } from "../ports/event-store";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator";
import type { PasswordHasher } from "../ports/password-hasher";
import type { UserRoleValidator } from "./user-role-validator";

const MIN_PASSWORD_LENGTH = 8;

export interface UserAccountServiceOptions {
  readonly events: EventStore;
  readonly passwords: PasswordHasher;
  readonly ids?: IdGenerator;
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

export interface AuthenticateUserAccountCommand {
  readonly userId: string;
  readonly password: string;
  readonly tenantId?: TenantId;
}

export interface AuthenticatedUserAccount {
  readonly actor: Actor;
  readonly account: UserAccount;
}

export class UserAccountService {
  private readonly events: EventStore;
  private readonly passwords: PasswordHasher;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;
  private readonly adminRoles: readonly string[];
  private readonly roleValidator: UserRoleValidator | undefined;

  constructor(options: UserAccountServiceOptions) {
    this.events = options.events;
    this.passwords = options.passwords;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.clock = options.clock ?? systemClock;
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
    this.roleValidator = options.roleValidator;
  }

  async create(command: CreateUserAccountCommand): Promise<UserAccount> {
    this.ensureAdmin(command.actor);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const userId = normalizeRequired(command.userId, "User id");
    const roles = normalizeRequiredRoles(command.roles);
    const password = normalizePassword(command.password);
    const email = normalizeOptionalEmail(command.email);
    const state = await this.stateFor(tenantId, userId);
    ensureExpectedVersion(state, command.expectedVersion);
    if (state.exists) {
      throw conflict(`User account '${userId}' already exists`);
    }
    await this.validateRoles(tenantId, roles);
    const passwordHash = await this.passwords.hash(password);
    const saved = await this.appendEvent({
      tenantId,
      stream: userAccountsStream(tenantId, userId),
      expectedVersion: state.version,
      type: "UserAccountCreated",
      documentName: userId,
      actorId: command.actor.id,
      metadata: command.metadata,
      payload: {
        kind: "UserAccountCreated",
        userId,
        ...(email === undefined ? {} : { email }),
        roles,
        passwordHash,
        enabled: command.enabled ?? true
      }
    });
    return publicUserAccount(foldUserAccount(tenantId, userId, saved));
  }

  async get(actor: Actor, userId: string, tenantId?: TenantId): Promise<UserAccount> {
    this.ensureAdmin(actor);
    const resolvedTenantId = resolveActorTenant(actor, tenantId);
    const state = await this.existingStateFor(resolvedTenantId, normalizeRequired(userId, "User id"));
    return publicUserAccount(state);
  }

  authorizeAdministration(actor: Actor, tenantId?: TenantId): void {
    this.ensureAdmin(actor);
    resolveActorTenant(actor, tenantId);
  }

  async changePassword(command: ChangeUserPasswordCommand): Promise<UserAccount> {
    this.ensureAdmin(command.actor);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const userId = normalizeRequired(command.userId, "User id");
    const password = normalizePassword(command.password);
    const state = await this.existingStateFor(tenantId, userId);
    ensureExpectedVersion(state, command.expectedVersion);
    const passwordHash = await this.passwords.hash(password);
    const saved = await this.appendEvent({
      tenantId,
      stream: userAccountsStream(tenantId, userId),
      expectedVersion: state.version,
      type: "UserPasswordChanged",
      documentName: userId,
      actorId: command.actor.id,
      metadata: command.metadata,
      payload: {
        kind: "UserPasswordChanged",
        userId,
        passwordHash
      }
    });
    return this.refold(tenantId, userId, state.version, saved);
  }

  async changeRoles(command: ChangeUserRolesCommand): Promise<UserAccount> {
    this.ensureAdmin(command.actor);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const userId = normalizeRequired(command.userId, "User id");
    const roles = normalizeRequiredRoles(command.roles);
    const state = await this.existingStateFor(tenantId, userId);
    ensureExpectedVersion(state, command.expectedVersion);
    await this.validateRoles(tenantId, roles);
    if (arrayEquals(state.roles, roles)) {
      return publicUserAccount(state);
    }
    const saved = await this.appendEvent({
      tenantId,
      stream: userAccountsStream(tenantId, userId),
      expectedVersion: state.version,
      type: "UserRolesChanged",
      documentName: userId,
      actorId: command.actor.id,
      metadata: command.metadata,
      payload: {
        kind: "UserRolesChanged",
        userId,
        roles
      }
    });
    return this.refold(tenantId, userId, state.version, saved);
  }

  async enable(command: SetUserAccountEnabledCommand): Promise<UserAccount> {
    return this.changeEnabled(command, true);
  }

  async disable(command: SetUserAccountEnabledCommand): Promise<UserAccount> {
    return this.changeEnabled(command, false);
  }

  async authenticate(command: AuthenticateUserAccountCommand): Promise<Actor> {
    return (await this.authenticateAccount(command)).actor;
  }

  async authenticateAccount(command: AuthenticateUserAccountCommand): Promise<AuthenticatedUserAccount> {
    const tenantId = command.tenantId ?? DEFAULT_TENANT_ID;
    const userId = normalizeRequired(command.userId, "User id");
    const password = normalizeLoginPassword(command.password);
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

  async resolveSessionActor(actor: Actor, accountVersion: number | undefined): Promise<Actor> {
    if (accountVersion === undefined) {
      throw permissionDenied("Session is no longer valid");
    }
    const tenantId = actor.tenantId ?? DEFAULT_TENANT_ID;
    const state = await this.stateFor(tenantId, normalizeRequired(actor.id, "User id"));
    if (!state.exists || !state.enabled || state.version !== accountVersion) {
      throw permissionDenied("Session is no longer valid");
    }
    return userAccountActor(state);
  }

  private async changeEnabled(command: SetUserAccountEnabledCommand, enabled: boolean): Promise<UserAccount> {
    this.ensureAdmin(command.actor);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const userId = normalizeRequired(command.userId, "User id");
    const state = await this.existingStateFor(tenantId, userId);
    ensureExpectedVersion(state, command.expectedVersion);
    if (state.enabled === enabled) {
      return publicUserAccount(state);
    }
    const saved = await this.appendEvent({
      tenantId,
      stream: userAccountsStream(tenantId, userId),
      expectedVersion: state.version,
      type: enabled ? "UserAccountEnabled" : "UserAccountDisabled",
      documentName: userId,
      actorId: command.actor.id,
      metadata: command.metadata,
      payload: {
        kind: enabled ? "UserAccountEnabled" : "UserAccountDisabled",
        userId
      }
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
      foldUserAccount(
        tenantId,
        userId,
        [...(await this.events.readStream(userAccountsStream(tenantId, userId), { maxSequence: previousVersion })), ...saved]
      )
    );
  }

  private async appendEvent<TPayload extends NewDomainEvent["payload"]>(options: {
    readonly tenantId: TenantId;
    readonly stream: string;
    readonly expectedVersion: number;
    readonly type: string;
    readonly documentName: string;
    readonly actorId: string;
    readonly metadata: DocumentData | undefined;
    readonly payload: TPayload;
  }) {
    const event: NewDomainEvent<TPayload> = {
      id: this.ids.next("evt_"),
      tenantId: options.tenantId,
      stream: options.stream,
      type: options.type,
      doctype: "__UserAccounts",
      documentName: options.documentName,
      actorId: options.actorId,
      occurredAt: this.clock.now(),
      payload: options.payload,
      metadata: options.metadata ?? {}
    };
    return this.events.append(options.stream, options.expectedVersion, [event]);
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
}

function resolveActorTenant(actor: Actor, explicitTenantId: TenantId | undefined): TenantId {
  const actorTenantId = actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = explicitTenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    throw permissionDenied(`Actor '${actor.id}' cannot manage user accounts for tenant '${tenantId}'`);
  }
  return tenantId;
}

function normalizeRequired(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw badRequest(`${label} is required`);
  }
  return normalized;
}

function normalizeOptionalEmail(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 ? undefined : normalized;
}

function normalizeRequiredRoles(roles: readonly string[]): readonly string[] {
  const normalized = normalizeUserRoles(roles);
  if (normalized.length === 0) {
    throw badRequest("At least one role is required");
  }
  return normalized;
}

function normalizePassword(password: string): string {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  return password;
}

function normalizeLoginPassword(password: string): string {
  if (password.length === 0) {
    throw permissionDenied("Invalid credentials");
  }
  return password;
}

function ensureExpectedVersion(state: UserAccountState, expectedVersion: number | undefined): void {
  if (expectedVersion !== undefined && state.version !== expectedVersion) {
    throw conflict(`Expected user account '${state.userId}' at version ${expectedVersion}, found ${state.version}`);
  }
}

function arrayEquals(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}
