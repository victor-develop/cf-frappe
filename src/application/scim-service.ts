import { conflict, notFound } from "../core/errors.js";
import type { RoleRecord } from "../core/roles.js";
import type { Actor, DocumentData } from "../core/types.js";
import type { UserAccount } from "../core/user-accounts.js";
import type { UserAccountService } from "./user-account-service.js";
import type { RoleService } from "./role-service.js";
import {
  applyScimUserPatch,
  parseScimGroup,
  parseScimGroupPatch,
  parseScimUser,
  parseScimPatch,
  scimExternalId,
  scimUserFilterMatches,
  scimGroupResource,
  scimUserResource,
  type ScimUserResource,
  type ScimGroupResource,
  type ScimUserWrite,
  type ScimListOptions
} from "./scim-policy.js";
import { normalizeRequiredScimText } from "./scim-token-service.js";

export const SCIM_PROVIDER = "scim";

export interface ScimServiceOptions {
  readonly users: UserAccountService;
  readonly roles?: RoleService;
}

export interface ScimUserList {
  readonly tenantId: string;
  readonly users: readonly ScimUserResource[];
}

export class ScimService {
  private readonly users: UserAccountService;
  private readonly roles: RoleService | undefined;

  constructor(options: ScimServiceOptions) {
    this.users = options.users;
    this.roles = options.roles;
  }

  async createUser(options: {
    readonly actor: Actor;
    readonly resource: unknown;
    readonly tenantId?: string;
    readonly location: string;
    readonly metadata?: DocumentData;
  }): Promise<ScimUserResource> {
    const write = parseScimUser(options.resource);
    const externalId = externalIdForWrite(write);
    const userId = write.userId ?? (externalId === undefined ? undefined : `scim:${externalId}`);
    if (userId === undefined) {
      throw conflict("SCIM user requires userName or externalId");
    }
    await this.ensureExternalIdAvailable(options.actor, externalId, userId, options.tenantId);
    const syncedAccount = await this.syncAccount(options.actor, {
      userId,
      roles: write.roles ?? ["User"],
      ...(write.email === undefined ? {} : { email: write.email }),
      ...(externalId === undefined ? {} : { externalId }),
      active: write.active ?? true
    }, options.tenantId, options.metadata);
    return scimUserResource(syncedAccount, scimExternalId(syncedAccount, externalId), options.location);
  }

  async getUser(options: {
    readonly actor: Actor;
    readonly userId: string;
    readonly tenantId?: string;
    readonly location: string;
  }): Promise<ScimUserResource> {
    const account = await this.existingAccount(options.actor, options.userId, options.tenantId);
    return scimUserResource(account, scimExternalId(account), options.location);
  }

  async listUsers(options: {
    readonly actor: Actor;
    readonly tenantId?: string;
    readonly filter?: string;
    readonly page: ScimListOptions;
    readonly location: (userId: string) => string;
  }): Promise<ScimUserList> {
    const list = await this.users.list(options.actor, options.tenantId);
    const resources = list.accounts
      .map((account) => scimUserResource(account, scimExternalId(account), options.location(account.userId)))
      .filter((resource) => scimUserFilterMatches(resource, options.filter));
    const offset = Math.min(options.page.startIndex - 1, resources.length);
    const users = resources.slice(offset, offset + options.page.count);
    return { tenantId: list.tenantId, users };
  }

  async replaceUser(options: {
    readonly actor: Actor;
    readonly userId: string;
    readonly resource: unknown;
    readonly tenantId?: string;
    readonly location: string;
    readonly metadata?: DocumentData;
  }): Promise<ScimUserResource> {
    const write = parseScimUser(options.resource);
    const currentState = await this.optionalAccount(options.actor, options.userId, options.tenantId);
    const externalId = externalIdForWrite(
      write,
      currentState === undefined ? undefined : scimExternalId(currentState)
    );
    if (currentState === undefined) {
      const userId = write.userId ?? `scim:${externalId ?? options.userId}`;
      await this.ensureExternalIdAvailable(options.actor, externalId, userId, options.tenantId);
      const account = await this.syncAccount(options.actor, {
        userId,
        roles: write.roles ?? ["User"],
        ...(write.email === undefined ? {} : { email: write.email }),
        ...(externalId === undefined ? {} : { externalId }),
        active: write.active ?? true
      }, options.tenantId, options.metadata);
      return scimUserResource(account, scimExternalId(account, externalId), options.location);
    }
    await this.ensureExternalIdAvailable(options.actor, externalId, currentState.userId, options.tenantId);
    const syncedAccount = await this.syncAccount(options.actor, {
      userId: currentState.userId,
      roles: write.roles ?? currentState.roles,
      ...(write.email === undefined ? {} : { email: write.email }),
      ...(externalId === undefined ? {} : { externalId })
    }, options.tenantId, options.metadata);
    const account = await this.changeAccountEnabled(
      options.actor,
      syncedAccount,
      currentState.enabled,
      write.active ?? currentState.enabled,
      options.tenantId,
      options.metadata
    );
    return scimUserResource(account, scimExternalId(account, externalId), options.location);
  }

  async patchUser(options: {
    readonly actor: Actor;
    readonly userId: string;
    readonly patch: unknown;
    readonly tenantId?: string;
    readonly location: string;
    readonly metadata?: DocumentData;
  }): Promise<ScimUserResource> {
    const patches = parseScimPatch(options.patch);
    const current = await this.existingAccount(options.actor, options.userId, options.tenantId);
    const currentResource = scimUserResource(current, scimExternalId(current), options.location);
    const write = applyScimUserPatch(currentResource, patches);
    const syncedAccount = await this.syncAccount(options.actor, {
      userId: write.userId ?? current.userId,
      ...(write.roles === undefined ? {} : { roles: write.roles }),
      ...(write.email === undefined ? {} : { email: write.email }),
      ...(write.externalId === undefined ? {} : { externalId: write.externalId })
    }, options.tenantId, options.metadata);
    const account = await this.changeAccountEnabled(
      options.actor,
      syncedAccount,
      current.enabled,
      write.active ?? current.enabled,
      options.tenantId,
      options.metadata
    );
    return scimUserResource(account, scimExternalId(account, write.externalId), options.location);
  }

  async deleteUser(options: {
    readonly actor: Actor;
    readonly userId: string;
    readonly tenantId?: string;
    readonly metadata?: DocumentData;
  }): Promise<void> {
    await this.existingAccount(options.actor, options.userId, options.tenantId);
    await this.users.disable({
      actor: options.actor,
      userId: options.userId,
      ...(options.tenantId === undefined ? {} : { tenantId: options.tenantId }),
      ...(options.metadata === undefined ? {} : { metadata: options.metadata })
    });
  }

  async createGroup(options: {
    readonly actor: Actor;
    readonly resource: unknown;
    readonly tenantId?: string;
    readonly location: string;
    readonly metadata?: DocumentData;
  }): Promise<ScimGroupResource> {
    const roleService = this.requiredRoleService();
    const write = parseScimGroup(options.resource);
    const displayName = normalizeRequiredScimText(write.displayName, "SCIM group displayName");
    await roleService.create({
      actor: options.actor,
      role: displayName,
      ...(write.description === undefined ? {} : { description: write.description }),
      ...(write.enabled === undefined ? {} : { enabled: write.enabled }),
      ...(options.tenantId === undefined ? {} : { tenantId: options.tenantId }),
      ...(options.metadata === undefined ? {} : { metadata: options.metadata })
    });
    const role = await this.getRole(displayName, options.actor, options.tenantId);
    return scimGroupResource(role, options.location);
  }

  async getGroup(options: {
    readonly actor: Actor;
    readonly groupId: string;
    readonly tenantId?: string;
    readonly location: string;
  }): Promise<ScimGroupResource> {
    const role = await this.getRole(options.groupId, options.actor, options.tenantId);
    return scimGroupResource(role, options.location);
  }

  async listGroups(options: {
    readonly actor: Actor;
    readonly tenantId?: string;
    readonly page: ScimListOptions;
    readonly location: (groupId: string) => string;
  }): Promise<readonly ScimGroupResource[]> {
    const roles = this.requiredRoleService();
    const state = await roles.list(options.actor, options.tenantId);
    const offset = Math.min(options.page.startIndex - 1, state.roles.length);
    return state.roles
      .slice(offset, offset + options.page.count)
      .map((role) => scimGroupResource(role, options.location(role.name)));
  }

  async replaceGroup(options: {
    readonly actor: Actor;
    readonly groupId: string;
    readonly resource: unknown;
    readonly tenantId?: string;
    readonly location: string;
    readonly metadata?: DocumentData;
  }): Promise<ScimGroupResource> {
    const write = parseScimGroup(options.resource);
    const roleService = this.requiredRoleService();
    if (write.description !== undefined) {
      await roleService.changeDescription({
        actor: options.actor,
        role: options.groupId,
        description: write.description,
        ...(options.tenantId === undefined ? {} : { tenantId: options.tenantId }),
        ...(options.metadata === undefined ? {} : { metadata: options.metadata })
      });
    }
    if (write.enabled !== undefined) {
      await (write.enabled ? roleService.enable.bind(roleService) : roleService.disable.bind(roleService))({
        actor: options.actor,
        role: options.groupId,
        ...(options.tenantId === undefined ? {} : { tenantId: options.tenantId }),
        ...(options.metadata === undefined ? {} : { metadata: options.metadata })
      });
    }
    const role = await this.getRole(options.groupId, options.actor, options.tenantId);
    return scimGroupResource(role, options.location);
  }

  async patchGroup(options: {
    readonly actor: Actor;
    readonly groupId: string;
    readonly patch: unknown;
    readonly tenantId?: string;
    readonly location: string;
    readonly metadata?: DocumentData;
  }): Promise<ScimGroupResource> {
    const role = await this.getRole(options.groupId, options.actor, options.tenantId);
    const current = scimGroupResource(role, options.location);
    const patch = parseScimGroupPatch(current, options.patch);
    const roleService = this.requiredRoleService();
    if (patch.description !== undefined) {
      await roleService.changeDescription({
        actor: options.actor,
        role: options.groupId,
        description: patch.description,
        ...(options.tenantId === undefined ? {} : { tenantId: options.tenantId }),
        ...(options.metadata === undefined ? {} : { metadata: options.metadata })
      });
    }
    if (patch.enabled !== undefined) {
      await (patch.enabled ? roleService.enable.bind(roleService) : roleService.disable.bind(roleService))({
        actor: options.actor,
        role: options.groupId,
        ...(options.tenantId === undefined ? {} : { tenantId: options.tenantId }),
        ...(options.metadata === undefined ? {} : { metadata: options.metadata })
      });
    }
    for (const userId of patch.addMembers) {
      const account = await this.existingAccount(options.actor, userId, options.tenantId);
      await this.users.changeRoles({
        actor: options.actor,
        userId: account.userId,
        roles: [...new Set([...account.roles, options.groupId])],
        ...(options.tenantId === undefined ? {} : { tenantId: options.tenantId }),
        ...(options.metadata === undefined ? {} : { metadata: options.metadata })
      });
    }
    for (const userId of patch.removeMembers) {
      const account = await this.existingAccount(options.actor, userId, options.tenantId);
      await this.users.changeRoles({
        actor: options.actor,
        userId: account.userId,
        roles: account.roles.filter((roleName) => roleName !== options.groupId),
        ...(options.tenantId === undefined ? {} : { tenantId: options.tenantId }),
        ...(options.metadata === undefined ? {} : { metadata: options.metadata })
      });
    }
    const updated = await this.getRole(options.groupId, options.actor, options.tenantId);
    return scimGroupResource(updated, options.location);
  }

  async deleteGroup(options: {
    readonly actor: Actor;
    readonly groupId: string;
    readonly tenantId?: string;
    readonly metadata?: DocumentData;
  }): Promise<void> {
    await this.getRole(options.groupId, options.actor, options.tenantId);
    await this.requiredRoleService().disable({
      actor: options.actor,
      role: options.groupId,
      ...(options.tenantId === undefined ? {} : { tenantId: options.tenantId }),
      ...(options.metadata === undefined ? {} : { metadata: options.metadata })
    });
  }

  private requiredRoleService(): RoleService {
    if (this.roles === undefined) {
      throw notFound("Role catalog is not enabled");
    }
    return this.roles;
  }

  private async existingAccount(
    actor: Actor,
    userId: string,
    tenantId?: string
  ): Promise<UserAccount> {
    return this.users.get(actor, userId, tenantId);
  }

  private async optionalAccount(
    actor: Actor,
    userId: string,
    tenantId?: string
  ): Promise<UserAccount | undefined> {
    try {
      return await this.users.get(actor, userId, tenantId);
    } catch (error) {
      if (isNotFound(error)) {
        return undefined;
      }
      throw error;
    }
  }

  private async ensureExternalIdAvailable(
    actor: Actor,
    externalId: string | undefined,
    userId: string,
    tenantId?: string
  ): Promise<void> {
    if (externalId === undefined) {
      return;
    }
    const list = await this.users.list(actor, tenantId);
    const existing = list.accounts
      .map((account) => ({ account, externalId: scimExternalId(account) }))
      .find((item) => item.externalId === externalId);
    if (existing !== undefined && existing.account.userId !== userId) {
      throw conflict(`SCIM externalId '${externalId}' is already mapped to another user`);
    }
  }

  private async syncAccount(
    actor: Actor,
    write: {
      readonly userId: string;
      readonly externalId?: string;
      readonly email?: string;
      readonly roles?: readonly string[];
      readonly active?: boolean;
    },
    tenantId?: string,
    metadata?: DocumentData
  ) {
    return this.users.syncProvider({
      actor,
      provider: SCIM_PROVIDER,
      subject: externalIdForSync(write.userId, write.externalId),
      userId: write.userId,
      ...(write.email === undefined ? {} : { email: write.email }),
      ...(write.roles === undefined ? {} : { roles: write.roles }),
      ...(write.active === undefined ? {} : { enabled: write.active }),
      ...(tenantId === undefined ? {} : { tenantId }),
      ...(metadata === undefined ? {} : { metadata })
    });
  }

  private async changeAccountEnabled(
    actor: Actor,
    account: UserAccount,
    wasEnabled: boolean,
    enabled: boolean,
    tenantId?: string,
    metadata?: DocumentData
  ): Promise<UserAccount> {
    if (wasEnabled === enabled) {
      return account;
    }
    const command = {
      actor,
      userId: account.userId,
      ...(tenantId === undefined ? {} : { tenantId }),
      expectedVersion: account.version,
      ...(metadata === undefined ? {} : { metadata })
    };
    return enabled ? this.users.enable(command) : this.users.disable(command);
  }

  private async getRole(
    role: string,
    actor: Actor,
    tenantId?: string
  ): Promise<RoleRecord> {
    return this.requiredRoleService().get(actor, role, tenantId);
  }
}

function externalIdForWrite(
  write: ScimUserWrite,
  existingExternalId?: string | undefined
): string | undefined {
  return write.externalId ?? existingExternalId;
}

function externalIdForSync(userId: string, externalId: string | undefined): string {
  return externalId ?? `cf-frappe:${userId}`;
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && (error as { status?: unknown }).status === 404;
}
