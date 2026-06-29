import { userAccountsStream, userProfilesStream } from "../core/streams.js";
import {
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
  type UserProfileInput,
  type UserProfilePatch,
  type UserProfileState
} from "../core/user-profiles.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { EventStore } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";
import {
  authorizeUserProfileAccess,
  ensureUserProfileAccountExists,
  ensureUserProfileExpectedVersion,
  normalizeUserProfilePatchInput,
  normalizeUserProfileRequiredText,
  planUserProfilePatchChange
} from "./user-profile-policy.js";

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
    const normalizedUserId = normalizeUserProfileRequiredText(userId, "User id");
    await this.ensureAccountExists(resolvedTenantId, normalizedUserId);
    return this.stateFor(resolvedTenantId, normalizedUserId);
  }

  authorizeProfileAccess(actor: Actor, userId: string, tenantId?: TenantId): TenantId {
    return authorizeUserProfileAccess({ actor, userId, tenantId, adminRoles: this.adminRoles });
  }

  async change(command: ChangeUserProfileCommand): Promise<UserProfileState> {
    const tenantId = this.authorizeProfileAccess(command.actor, command.userId, command.tenantId);
    const userId = normalizeUserProfileRequiredText(command.userId, "User id");
    await this.ensureAccountExists(tenantId, userId);
    const patch = normalizeUserProfilePatchInput(command.profile);
    const state = await this.stateFor(tenantId, userId);
    ensureUserProfileExpectedVersion(state, command.expectedVersion);
    if (planUserProfilePatchChange(patch).status === "noop") {
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
    ensureUserProfileAccountExists(account);
  }

  private async stateFor(tenantId: TenantId, userId: string): Promise<UserProfileState> {
    return foldUserProfile(tenantId, userId, await this.events.readStream(userProfilesStream(tenantId, userId), {
      payloadKinds: USER_PROFILE_PAYLOAD_KINDS
    }));
  }
}
