import { userPermissionsStream } from "../core/streams.js";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocumentData,
  type TenantId
} from "../core/types.js";
import {
  replayUserPermissionAppend,
  USER_PERMISSION_PAYLOAD_KINDS,
  userPermissionEvent,
  userPermissionPayload,
  type UserPermissionEventPayload
} from "./user-permission-events.js";
import {
  foldUserPermissions,
  userPermissionGrantKey,
  type UserPermissionGrant,
  type UserPermissionProvider,
  type UserPermissionState
} from "../core/user-permissions.js";
import {
  authorizeUserPermissionAdministration,
  ensureUserPermissionExpectedVersion,
  normalizeUserPermissionRequiredText,
  normalizeValidUserPermissionGrant
} from "./user-permission-policy.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { EventStore } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";
import type { UserPermissionGrantValidator } from "./user-permission-grant-validator.js";

export type { UserPermissionEventPayload } from "./user-permission-events.js";

export interface UserPermissionServiceOptions {
  readonly events: EventStore;
  readonly ids?: IdGenerator;
  readonly clock?: Clock;
  readonly adminRoles?: readonly string[];
  readonly validator?: UserPermissionGrantValidator;
}

export interface AllowUserPermissionCommand extends UserPermissionGrant {
  readonly actor: Actor;
  readonly userId: string;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface RevokeUserPermissionCommand extends UserPermissionGrant {
  readonly actor: Actor;
  readonly userId: string;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export class UserPermissionService implements UserPermissionProvider {
  private readonly events: EventStore;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;
  private readonly adminRoles: readonly string[];
  private readonly validator: UserPermissionGrantValidator | undefined;

  constructor(options: UserPermissionServiceOptions) {
    this.events = options.events;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.clock = options.clock ?? systemClock;
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
    this.validator = options.validator;
  }

  async allow(command: AllowUserPermissionCommand): Promise<UserPermissionState> {
    return this.changePermission({
      command,
      eventKind: "UserPermissionAllowed",
      alreadyDone: (state, grant) => state.grants.some((existing) => userPermissionGrantKey(existing) === userPermissionGrantKey(grant))
    });
  }

  async revoke(command: RevokeUserPermissionCommand): Promise<UserPermissionState> {
    return this.changePermission({
      command,
      eventKind: "UserPermissionRevoked",
      alreadyDone: (state, grant) => state.grants.every((existing) => userPermissionGrantKey(existing) !== userPermissionGrantKey(grant))
    });
  }

  async permissionsFor(actor: Actor, tenantId: TenantId = actor.tenantId ?? DEFAULT_TENANT_ID): Promise<readonly UserPermissionGrant[]> {
    return (await this.stateFor(tenantId, actor.id)).grants;
  }

  async getUserPermissions(
    actor: Actor,
    userId: string,
    tenantId?: TenantId
  ): Promise<UserPermissionState> {
    const resolvedTenantId = authorizeUserPermissionAdministration({ actor, tenantId, adminRoles: this.adminRoles });
    return this.stateFor(resolvedTenantId, normalizeUserPermissionRequiredText(userId, "User id"));
  }

  private async changePermission(options: {
    readonly command: AllowUserPermissionCommand | RevokeUserPermissionCommand;
    readonly eventKind: UserPermissionEventPayload["kind"];
    readonly alreadyDone: (state: UserPermissionState, grant: UserPermissionGrant) => boolean;
  }): Promise<UserPermissionState> {
    const tenantId = authorizeUserPermissionAdministration({
      actor: options.command.actor,
      tenantId: options.command.tenantId,
      adminRoles: this.adminRoles
    });
    const userId = normalizeUserPermissionRequiredText(options.command.userId, "User id");
    const grant = normalizeValidUserPermissionGrant(options.command);
    const state = await this.stateFor(tenantId, userId);
    ensureUserPermissionExpectedVersion(state, options.command.expectedVersion);
    if (options.alreadyDone(state, grant)) {
      return state;
    }
    if (options.eventKind === "UserPermissionAllowed") {
      await this.validator?.validateGrant({ tenantId, grant });
    }
    const event = userPermissionEvent({
      id: this.ids.next(),
      tenantId,
      stream: userPermissionsStream(tenantId, userId),
      actor: options.command.actor,
      occurredAt: this.clock.now(),
      payload: userPermissionPayload({ kind: options.eventKind, userId, grant }),
      ...(options.command.metadata === undefined ? {} : { metadata: options.command.metadata })
    });
    const saved = await this.events.append(event.stream, state.version, [event]);
    return replayUserPermissionAppend(
      state,
      await this.events.readStream(event.stream, { maxSequence: state.version }),
      saved
    );
  }

  private async stateFor(tenantId: TenantId, userId: string): Promise<UserPermissionState> {
    return foldUserPermissions(
      tenantId,
      userId,
      await this.events.readStream(userPermissionsStream(tenantId, userId), { payloadKinds: USER_PERMISSION_PAYLOAD_KINDS })
    );
  }

}
