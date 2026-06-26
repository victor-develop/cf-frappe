import { requestRemoteAdmin, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type RoleRemoteAction = "create" | "describe" | "disable" | "enable" | "get" | "list";

export type RoleHeaderOption = RemoteHeaderOption;

export interface RoleRemoteCommand {
  readonly kind: "roles";
  readonly action: RoleRemoteAction;
  readonly url: string;
  readonly headers: readonly RoleHeaderOption[];
  readonly role?: string;
  readonly tenant?: string;
  readonly description?: string;
  readonly enabled?: boolean;
  readonly expectedVersion?: number;
}

export type RoleRemoteIo = RemoteAdminIo;

export class RoleRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoleRemoteError";
  }
}

interface RoleCatalogResponse {
  readonly tenantId?: string;
  readonly version?: number;
  readonly roles?: readonly RoleResponse[];
}

interface RoleResponse {
  readonly name?: string;
  readonly version?: number;
  readonly enabled?: boolean;
  readonly description?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export async function runRemoteRoleCommand(command: RoleRemoteCommand, io: RoleRemoteIo = {}): Promise<string> {
  const query = tenantQuery(command);
  if (command.action === "list") {
    const data = await requestRemoteRoleCatalog(command, io, {
      method: "GET",
      path: "/api/roles",
      ...(query === undefined ? {} : { query })
    });
    return formatRoleCatalog(command.url, data);
  }
  if (command.action === "get") {
    const data = await requestRemoteRole(command, io, {
      method: "GET",
      path: rolePath(command),
      ...(query === undefined ? {} : { query })
    });
    return formatRole(command.url, data);
  }
  if (command.action === "create") {
    const data = await requestRemoteRoleCatalog(command, io, {
      body: createBody(command),
      method: "POST",
      path: rolePath(command),
      ...(query === undefined ? {} : { query })
    });
    return formatRoleCatalog(command.url, data, "Created role");
  }
  if (command.action === "describe") {
    const data = await requestRemoteRoleCatalog(command, io, {
      body: descriptionBody(command),
      method: "PUT",
      path: `${rolePath(command)}/description`,
      ...(query === undefined ? {} : { query })
    });
    return formatRoleCatalog(command.url, data, "Changed role description");
  }
  const data = await requestRemoteRoleCatalog(command, io, {
    body: mutationBody(command),
    method: "POST",
    path: `${rolePath(command)}/${command.action}`,
    ...(query === undefined ? {} : { query })
  });
  return formatRoleCatalog(command.url, data, command.action === "enable" ? "Enabled role" : "Disabled role");
}

function requestRemoteRoleCatalog(
  command: RoleRemoteCommand,
  io: RoleRemoteIo,
  request: {
    readonly body?: Record<string, unknown>;
    readonly method: "GET" | "POST" | "PUT";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<RoleCatalogResponse> {
  return requestRemoteAdmin<RoleCatalogResponse, RoleRemoteError>(command, io, request, {
    error: RoleRemoteError,
    fetchLabel: "remote role commands",
    resourceLabel: "Remote roles",
    urlLabel: "Remote roles"
  });
}

function requestRemoteRole(
  command: RoleRemoteCommand,
  io: RoleRemoteIo,
  request: {
    readonly method: "GET";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<RoleResponse> {
  return requestRemoteAdmin<RoleResponse, RoleRemoteError>(command, io, request, {
    error: RoleRemoteError,
    fetchLabel: "remote role commands",
    resourceLabel: "Remote role",
    urlLabel: "Remote roles"
  });
}

function rolePath(command: RoleRemoteCommand): string {
  return `/api/roles/${encodeURIComponent(requiredRole(command))}`;
}

function tenantQuery(command: RoleRemoteCommand): URLSearchParams | undefined {
  if (command.tenant === undefined) {
    return undefined;
  }
  const params = new URLSearchParams();
  params.set("tenant", command.tenant);
  return params;
}

function createBody(command: RoleRemoteCommand): Record<string, unknown> {
  return {
    ...(command.description === undefined ? {} : { description: command.description }),
    ...(command.enabled === undefined ? {} : { enabled: command.enabled }),
    ...mutationBody(command)
  };
}

function descriptionBody(command: RoleRemoteCommand): Record<string, unknown> {
  return {
    description: requiredDescription(command),
    ...mutationBody(command)
  };
}

function mutationBody(command: RoleRemoteCommand): Record<string, unknown> {
  return {
    ...(command.expectedVersion === undefined ? {} : { expectedVersion: command.expectedVersion })
  };
}

function formatRoleCatalog(
  baseUrl: string,
  state: RoleCatalogResponse,
  title = "Role catalog"
): string {
  const roles = state.roles ?? [];
  return [
    `${title} at ${baseUrl}`,
    `Tenant: ${state.tenantId ?? "(unknown)"} Version: ${String(state.version ?? 0)} Total: ${String(roles.length)}`,
    ...roleLines(roles),
    ""
  ].join("\n");
}

function formatRole(baseUrl: string, role: RoleResponse): string {
  return [
    `Role at ${baseUrl}`,
    roleLine(role),
    ...(role.description === undefined ? [] : [`Description: ${role.description}`]),
    ""
  ].join("\n");
}

function roleLines(roles: readonly RoleResponse[]): readonly string[] {
  if (roles.length === 0) {
    return ["- (none)"];
  }
  return roles.map(roleLine);
}

function roleLine(role: RoleResponse): string {
  const enabled = role.enabled === false ? "disabled" : "enabled";
  const version = role.version === undefined ? "?" : String(role.version);
  const description = role.description === undefined ? "" : ` - ${role.description}`;
  return `- ${role.name ?? "(unknown)"} ${enabled} v${version}${description}`;
}

function requiredDescription(command: RoleRemoteCommand): string {
  if (command.description === undefined) {
    throw new RoleRemoteError("Role describe requires --description");
  }
  return command.description;
}

function requiredRole(command: RoleRemoteCommand): string {
  if (command.role === undefined) {
    throw new RoleRemoteError(`Role ${command.action} requires --role`);
  }
  return command.role;
}
