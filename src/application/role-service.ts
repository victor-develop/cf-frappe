import {
  foldRoleCatalog,
  normalizeRoleDescription,
  type RoleCatalogState,
  type RoleRecord
} from "../core/roles.js";
import { roleCatalogStream } from "../core/streams.js";
import {
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocumentData,
  type NewDomainEvent,
  type TenantId
} from "../core/types.js";
import {
  roleCreatedPayload,
  roleDescriptionChangedPayload,
  roleEventType,
  roleStatusChangedPayload,
  ROLE_PAYLOAD_KINDS,
  type RoleEventPayload
} from "./role-events.js";
import {
  authorizeRoleAdministration,
  ensureRoleDoesNotExist,
  ensureRoleExpectedVersion,
  existingRole,
  normalizeRequiredRoleName
} from "./role-policy.js";
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
    return this.stateFor(this.authorizeAdministration(actor, tenantId));
  }

  async get(actor: Actor, role: string, tenantId?: TenantId): Promise<RoleRecord> {
    const resolvedTenantId = this.authorizeAdministration(actor, tenantId);
    const state = await this.stateFor(resolvedTenantId);
    return existingRole(state, normalizeRequiredRoleName(role));
  }

  authorizeAdministration(actor: Actor, tenantId?: TenantId): TenantId {
    return authorizeRoleAdministration({ actor, tenantId, adminRoles: this.adminRoles });
  }

  async create(command: CreateRoleCommand): Promise<RoleCatalogState> {
    const tenantId = this.authorizeAdministration(command.actor, command.tenantId);
    const role = normalizeRequiredRoleName(command.role);
    const description = normalizeRoleDescription(command.description);
    const state = await this.stateFor(tenantId);
    ensureRoleExpectedVersion(state, command.expectedVersion);
    ensureRoleDoesNotExist(state, role);
    return this.appendAndFold(state, {
      actor: command.actor,
      metadata: command.metadata,
      payload: roleCreatedPayload({
        role,
        enabled: command.enabled ?? true,
        ...(description === undefined ? {} : { description })
      })
    });
  }

  async changeDescription(command: ChangeRoleDescriptionCommand): Promise<RoleCatalogState> {
    const tenantId = this.authorizeAdministration(command.actor, command.tenantId);
    const role = normalizeRequiredRoleName(command.role);
    const description = normalizeRoleDescription(command.description);
    const state = await this.stateFor(tenantId);
    ensureRoleExpectedVersion(state, command.expectedVersion);
    const existing = existingRole(state, role);
    if (existing.description === description) {
      return state;
    }
    return this.appendAndFold(state, {
      actor: command.actor,
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
    const tenantId = this.authorizeAdministration(command.actor, command.tenantId);
    const role = normalizeRequiredRoleName(command.role);
    const state = await this.stateFor(tenantId);
    ensureRoleExpectedVersion(state, command.expectedVersion);
    const existing = existingRole(state, role);
    if (existing.enabled === enabled) {
      return state;
    }
    return this.appendAndFold(state, {
      actor: command.actor,
      metadata: command.metadata,
      payload: roleStatusChangedPayload({ role, enabled })
    });
  }

  private async stateFor(tenantId: TenantId): Promise<RoleCatalogState> {
    return foldRoleCatalog(tenantId, await this.events.readStream(roleCatalogStream(tenantId), {
      payloadKinds: ROLE_PAYLOAD_KINDS
    }));
  }

  private async appendAndFold<TPayload extends RoleEventPayload>(
    state: RoleCatalogState,
    options: {
      readonly actor: Actor;
      readonly metadata: DocumentData | undefined;
      readonly payload: TPayload;
    }
  ): Promise<RoleCatalogState> {
    const stream = roleCatalogStream(state.tenantId);
    const event: NewDomainEvent<TPayload> = {
      id: this.ids.next("evt_"),
      tenantId: state.tenantId,
      stream,
      type: roleEventType(options.payload),
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
      [...(await this.events.readStream(stream, {
        maxSequence: state.version,
        payloadKinds: ROLE_PAYLOAD_KINDS
      })), ...saved]
    );
  }

}
