import { badRequest, conflict, permissionDenied } from "../core/errors";
import { userPermissionsStream } from "../core/streams";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocTypeName,
  type DocumentData,
  type DocumentName,
  type NewDomainEvent,
  type TenantId
} from "../core/types";
import {
  foldUserPermissions,
  normalizeUserPermissionGrant,
  userPermissionGrantKey,
  type UserPermissionGrant,
  type UserPermissionProvider,
  type UserPermissionState
} from "../core/user-permissions";
import { systemClock, type Clock } from "../ports/clock";
import type { EventStore } from "../ports/event-store";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator";

export interface UserPermissionServiceOptions {
  readonly events: EventStore;
  readonly ids?: IdGenerator;
  readonly clock?: Clock;
  readonly adminRoles?: readonly string[];
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

  constructor(options: UserPermissionServiceOptions) {
    this.events = options.events;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.clock = options.clock ?? systemClock;
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
  }

  async allow(command: AllowUserPermissionCommand): Promise<UserPermissionState> {
    return this.changePermission({
      command,
      eventType: "UserPermissionAllowed",
      eventKind: "UserPermissionAllowed",
      alreadyDone: (state, grant) => state.grants.some((existing) => userPermissionGrantKey(existing) === userPermissionGrantKey(grant))
    });
  }

  async revoke(command: RevokeUserPermissionCommand): Promise<UserPermissionState> {
    return this.changePermission({
      command,
      eventType: "UserPermissionRevoked",
      eventKind: "UserPermissionRevoked",
      alreadyDone: (state, grant) => state.grants.every((existing) => userPermissionGrantKey(existing) !== userPermissionGrantKey(grant))
    });
  }

  async permissionsFor(actor: Actor, tenantId: TenantId = actor.tenantId ?? DEFAULT_TENANT_ID): Promise<readonly UserPermissionGrant[]> {
    return (await this.stateFor(tenantId, actor.id)).grants;
  }

  private async changePermission(options: {
    readonly command: AllowUserPermissionCommand | RevokeUserPermissionCommand;
    readonly eventType: "UserPermissionAllowed" | "UserPermissionRevoked";
    readonly eventKind: "UserPermissionAllowed" | "UserPermissionRevoked";
    readonly alreadyDone: (state: UserPermissionState, grant: UserPermissionGrant) => boolean;
  }): Promise<UserPermissionState> {
    this.ensureAdmin(options.command.actor);
    const tenantId = resolveActorTenant(options.command.actor, options.command.tenantId);
    const userId = normalizeRequired(options.command.userId, "User id");
    const grant = normalizeValidGrant(options.command);
    const state = await this.stateFor(tenantId, userId);
    ensureExpectedVersion(state, options.command.expectedVersion);
    if (options.alreadyDone(state, grant)) {
      return state;
    }
    const event: NewDomainEvent = {
      id: this.ids.next(),
      tenantId,
      stream: userPermissionsStream(tenantId, userId),
      type: options.eventType,
      doctype: "__UserPermissions",
      documentName: userId,
      actorId: options.command.actor.id,
      occurredAt: this.clock.now(),
      payload: {
        kind: options.eventKind,
        userId,
        targetDoctype: grant.targetDoctype,
        targetName: grant.targetName,
        ...(grant.applicableDoctypes !== undefined ? { applicableDoctypes: grant.applicableDoctypes } : {})
      },
      metadata: options.command.metadata ?? {}
    };
    const saved = await this.events.append(event.stream, state.version, [event]);
    return foldUserPermissions(tenantId, userId, [...(await this.events.readStream(event.stream, { maxSequence: state.version })), ...saved]);
  }

  private async stateFor(tenantId: TenantId, userId: string): Promise<UserPermissionState> {
    return foldUserPermissions(tenantId, userId, await this.events.readStream(userPermissionsStream(tenantId, userId)));
  }

  private ensureAdmin(actor: Actor): void {
    if (!this.adminRoles.some((role) => actor.roles.includes(role))) {
      throw permissionDenied(`Actor '${actor.id}' cannot manage user permissions`);
    }
  }
}

function resolveActorTenant(actor: Actor, explicitTenantId: TenantId | undefined): TenantId {
  const actorTenantId = actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = explicitTenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    throw permissionDenied(`Actor '${actor.id}' cannot manage user permissions for tenant '${tenantId}'`);
  }
  return tenantId;
}

function normalizeValidGrant(grant: UserPermissionGrant): UserPermissionGrant {
  const normalized = normalizeUserPermissionGrant(grant);
  if (normalized.targetDoctype.length === 0) {
    throw badRequest("Target DocType is required");
  }
  if (normalized.targetName.length === 0) {
    throw badRequest("Target name is required");
  }
  return normalized;
}

function normalizeRequired(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw badRequest(`${label} is required`);
  }
  return normalized;
}

function ensureExpectedVersion(state: UserPermissionState, expectedVersion: number | undefined): void {
  if (expectedVersion !== undefined && state.version !== expectedVersion) {
    throw conflict(`Expected user permissions for '${state.userId}' at version ${expectedVersion}, found ${state.version}`);
  }
}
