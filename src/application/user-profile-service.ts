import { badRequest, conflict, notFound, permissionDenied } from "../core/errors.js";
import { userAccountsStream, userProfilesStream } from "../core/streams.js";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocumentData,
  type DomainEvent,
  type NewDomainEvent,
  type TenantId
} from "../core/types.js";
import {
  userProfileChangedPayload,
  userProfileEventType,
  USER_PROFILE_PAYLOAD_KINDS,
  type UserProfileEventPayload
} from "./user-profile-events.js";
import { foldUserAccount } from "../core/user-accounts.js";
import {
  foldUserProfile,
  normalizeUserProfilePatch,
  type UserProfileInput,
  type UserProfilePatch,
  type UserProfileState
} from "../core/user-profiles.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { EventStore } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";

export type { UserProfileEventPayload } from "./user-profile-events.js";

export interface UserProfileServiceOptions {
  readonly events: EventStore;
  readonly ids?: IdGenerator;
  readonly clock?: Clock;
  readonly adminRoles?: readonly string[];
}

export interface ChangeUserProfileCommand {
  readonly actor: Actor;
  readonly userId: string;
  readonly profile: UserProfileInput | Record<string, unknown>;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export class UserProfileService {
  private readonly events: EventStore;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;
  private readonly adminRoles: readonly string[];

  constructor(options: UserProfileServiceOptions) {
    this.events = options.events;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.clock = options.clock ?? systemClock;
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
  }

  async get(actor: Actor, userId: string, tenantId?: TenantId): Promise<UserProfileState> {
    const resolvedTenantId = this.authorizeProfileAccess(actor, userId, tenantId);
    const normalizedUserId = normalizeRequired(userId, "User id");
    await this.ensureAccountExists(resolvedTenantId, normalizedUserId);
    return this.stateFor(resolvedTenantId, normalizedUserId);
  }

  authorizeProfileAccess(actor: Actor, userId: string, tenantId?: TenantId): TenantId {
    const normalizedUserId = normalizeRequired(userId, "User id");
    const resolvedTenantId = resolveActorTenant(actor, tenantId, "access user profiles");
    if (this.isAdmin(actor) || actor.id === normalizedUserId) {
      return resolvedTenantId;
    }
    throw permissionDenied(`Actor '${actor.id}' cannot access user profile '${normalizedUserId}'`);
  }

  async change(command: ChangeUserProfileCommand): Promise<UserProfileState> {
    const tenantId = this.authorizeProfileAccess(command.actor, command.userId, command.tenantId);
    const userId = normalizeRequired(command.userId, "User id");
    await this.ensureAccountExists(tenantId, userId);
    const patch = normalizeProfilePatch(command.profile);
    const state = await this.stateFor(tenantId, userId);
    ensureExpectedVersion(state, command.expectedVersion);
    if (Object.keys(patch).length === 0) {
      return state;
    }
    const saved = await this.appendProfileChangedEvent({
      tenantId,
      userId,
      expectedVersion: state.version,
      actorId: command.actor.id,
      metadata: command.metadata,
      profile: patch
    });
    return foldUserProfile(tenantId, userId, [
      ...(await this.events.readStream(userProfilesStream(tenantId, userId), {
        maxSequence: state.version,
        payloadKinds: USER_PROFILE_PAYLOAD_KINDS
      })),
      ...saved
    ]);
  }

  private async appendProfileChangedEvent(options: {
    readonly tenantId: TenantId;
    readonly userId: string;
    readonly expectedVersion: number;
    readonly actorId: string;
    readonly metadata: DocumentData | undefined;
    readonly profile: UserProfilePatch;
  }): Promise<readonly DomainEvent[]> {
    const stream = userProfilesStream(options.tenantId, options.userId);
    const payload = userProfileChangedPayload({
      userId: options.userId,
      profile: options.profile as DocumentData
    });
    const event: NewDomainEvent<UserProfileEventPayload> = {
      id: this.ids.next("evt_"),
      tenantId: options.tenantId,
      stream,
      type: userProfileEventType(payload),
      doctype: "__UserProfiles",
      documentName: options.userId,
      actorId: options.actorId,
      occurredAt: this.clock.now(),
      payload,
      metadata: options.metadata ?? {}
    };
    return this.events.append(stream, options.expectedVersion, [event]);
  }

  private async ensureAccountExists(tenantId: TenantId, userId: string): Promise<void> {
    const account = foldUserAccount(tenantId, userId, await this.events.readStream(userAccountsStream(tenantId, userId)));
    if (!account.exists) {
      throw notFound(`User account '${userId}' was not found`);
    }
  }

  private async stateFor(tenantId: TenantId, userId: string): Promise<UserProfileState> {
    return foldUserProfile(tenantId, userId, await this.events.readStream(userProfilesStream(tenantId, userId), {
      payloadKinds: USER_PROFILE_PAYLOAD_KINDS
    }));
  }

  private isAdmin(actor: Actor): boolean {
    return this.adminRoles.some((role) => actor.roles.includes(role));
  }
}

function resolveActorTenant(actor: Actor, explicitTenantId: TenantId | undefined, action: string): TenantId {
  const actorTenantId = actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = explicitTenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    throw permissionDenied(`Actor '${actor.id}' cannot ${action} for tenant '${tenantId}'`);
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

function normalizeProfilePatch(input: UserProfileInput | Record<string, unknown>): UserProfilePatch {
  try {
    return normalizeUserProfilePatch(input as Record<string, unknown>);
  } catch (error) {
    throw badRequest(error instanceof Error ? error.message : "User profile is invalid");
  }
}

function ensureExpectedVersion(state: UserProfileState, expectedVersion: number | undefined): void {
  if (expectedVersion !== undefined && state.version !== expectedVersion) {
    throw conflict(`Expected user profile '${state.userId}' at version ${expectedVersion}, found ${state.version}`);
  }
}
