import { badRequest, conflict, notFound, permissionDenied } from "../core/errors.js";
import {
  foldRoleCatalog,
  normalizeRoleDescription,
  normalizeRoleName,
  type RoleCatalogState,
  type RoleRecord
} from "../core/roles.js";
import { roleCatalogStream } from "../core/streams.js";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocumentData,
  type NewDomainEvent,
  type TenantId
} from "../core/types.js";
import {
  roleCreatedPayload,
  roleDescriptionChangedPayload,
  roleDisabledPayload,
  roleEnabledPayload,
  type RoleEventPayload
} from "./role-events.js";
import { systemClock, type Clock } from "../ports/clock.js";
import type { EventStore } from "../ports/event-store.js";
import { cryptoIdGenerator, type IdGenerator } from "../ports/id-generator.js";

export type { RoleEventPayload } from "./role-events.js";

export interface RoleServiceOptions {
  readonly events: EventStore;
  readonly ids?: IdGenerator;
  readonly clock?: Clock;
  readonly adminRoles?: readonly string[];
}

export interface CreateRoleCommand {
  readonly actor: Actor;
  readonly role: string;
  readonly description?: string;
  readonly enabled?: boolean;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface ChangeRoleDescriptionCommand {
  readonly actor: Actor;
  readonly role: string;
  readonly description?: string;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface SetRoleEnabledCommand {
  readonly actor: Actor;
  readonly role: string;
  readonly tenantId?: TenantId;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export class RoleService {
  private readonly events: EventStore;
  private readonly ids: IdGenerator;
  private readonly clock: Clock;
  private readonly adminRoles: readonly string[];

  constructor(options: RoleServiceOptions) {
    this.events = options.events;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.clock = options.clock ?? systemClock;
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
  }

  async list(actor: Actor, tenantId?: TenantId): Promise<RoleCatalogState> {
    this.authorizeAdministration(actor, tenantId);
    return this.stateFor(resolveActorTenant(actor, tenantId));
  }

  async get(actor: Actor, role: string, tenantId?: TenantId): Promise<RoleRecord> {
    this.authorizeAdministration(actor, tenantId);
    const state = await this.stateFor(resolveActorTenant(actor, tenantId));
    return existingRole(state, normalizeRequiredRoleName(role));
  }

  authorizeAdministration(actor: Actor, tenantId?: TenantId): void {
    this.ensureAdmin(actor);
    resolveActorTenant(actor, tenantId);
  }

  async create(command: CreateRoleCommand): Promise<RoleCatalogState> {
    this.ensureAdmin(command.actor);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const role = normalizeRequiredRoleName(command.role);
    const description = normalizeRoleDescription(command.description);
    const state = await this.stateFor(tenantId);
    ensureExpectedVersion(state, command.expectedVersion);
    if (state.roles.some((existing) => existing.name === role)) {
      throw conflict(`Role '${role}' already exists`);
    }
    return this.appendAndFold(state, {
      actor: command.actor,
      type: "RoleCreated",
      metadata: command.metadata,
      payload: roleCreatedPayload({
        role,
        enabled: command.enabled ?? true,
        ...(description === undefined ? {} : { description })
      })
    });
  }

  async changeDescription(command: ChangeRoleDescriptionCommand): Promise<RoleCatalogState> {
    this.ensureAdmin(command.actor);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const role = normalizeRequiredRoleName(command.role);
    const description = normalizeRoleDescription(command.description);
    const state = await this.stateFor(tenantId);
    ensureExpectedVersion(state, command.expectedVersion);
    const existing = existingRole(state, role);
    if (existing.description === description) {
      return state;
    }
    return this.appendAndFold(state, {
      actor: command.actor,
      type: "RoleDescriptionChanged",
      metadata: command.metadata,
      payload: roleDescriptionChangedPayload({
        role,
        ...(description === undefined ? {} : { description })
      })
    });
  }

  async enable(command: SetRoleEnabledCommand): Promise<RoleCatalogState> {
    return this.changeEnabled(command, true);
  }

  async disable(command: SetRoleEnabledCommand): Promise<RoleCatalogState> {
    return this.changeEnabled(command, false);
  }

  private async changeEnabled(command: SetRoleEnabledCommand, enabled: boolean): Promise<RoleCatalogState> {
    this.ensureAdmin(command.actor);
    const tenantId = resolveActorTenant(command.actor, command.tenantId);
    const role = normalizeRequiredRoleName(command.role);
    const state = await this.stateFor(tenantId);
    ensureExpectedVersion(state, command.expectedVersion);
    const existing = existingRole(state, role);
    if (existing.enabled === enabled) {
      return state;
    }
    return this.appendAndFold(state, {
      actor: command.actor,
      type: enabled ? "RoleEnabled" : "RoleDisabled",
      metadata: command.metadata,
      payload: enabled ? roleEnabledPayload({ role }) : roleDisabledPayload({ role })
    });
  }

  private async stateFor(tenantId: TenantId): Promise<RoleCatalogState> {
    return foldRoleCatalog(tenantId, await this.events.readStream(roleCatalogStream(tenantId)));
  }

  private async appendAndFold<TPayload extends RoleEventPayload>(
    state: RoleCatalogState,
    options: {
      readonly actor: Actor;
      readonly type: string;
      readonly metadata: DocumentData | undefined;
      readonly payload: TPayload;
    }
  ): Promise<RoleCatalogState> {
    const stream = roleCatalogStream(state.tenantId);
    const event: NewDomainEvent<TPayload> = {
      id: this.ids.next("evt_"),
      tenantId: state.tenantId,
      stream,
      type: options.type,
      doctype: "__Roles",
      documentName: "catalog",
      actorId: options.actor.id,
      occurredAt: this.clock.now(),
      payload: options.payload,
      metadata: options.metadata ?? {}
    };
    const saved = await this.events.append(stream, state.version, [event]);
    return foldRoleCatalog(
      state.tenantId,
      [...(await this.events.readStream(stream, { maxSequence: state.version })), ...saved]
    );
  }

  private ensureAdmin(actor: Actor): void {
    if (!this.adminRoles.some((role) => actor.roles.includes(role))) {
      throw permissionDenied(`Actor '${actor.id}' cannot manage roles`);
    }
  }
}

function resolveActorTenant(actor: Actor, explicitTenantId: TenantId | undefined): TenantId {
  const actorTenantId = actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = explicitTenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    throw permissionDenied(`Actor '${actor.id}' cannot manage roles for tenant '${tenantId}'`);
  }
  return tenantId;
}

function existingRole(state: RoleCatalogState, role: string): RoleRecord {
  const existing = state.roles.find((item) => item.name === role);
  if (!existing) {
    throw notFound(`Role '${role}' was not found`);
  }
  return existing;
}

function normalizeRequiredRoleName(role: string): string {
  const normalized = normalizeRoleName(role);
  if (normalized.length === 0) {
    throw badRequest("Role name is required");
  }
  if (normalized.includes("/")) {
    throw badRequest("Role name cannot contain '/'");
  }
  return normalized;
}

function ensureExpectedVersion(state: RoleCatalogState, expectedVersion: number | undefined): void {
  if (expectedVersion !== undefined && state.version !== expectedVersion) {
    throw conflict(`Expected role catalog at version ${expectedVersion}, found ${state.version}`);
  }
}
