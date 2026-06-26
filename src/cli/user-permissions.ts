import { requestRemoteAdmin, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type UserPermissionRemoteAction = "allow" | "list" | "revoke";

export type UserPermissionHeaderOption = RemoteHeaderOption;

export interface UserPermissionRemoteCommand {
  readonly kind: "user-permissions";
  readonly action: UserPermissionRemoteAction;
  readonly url: string;
  readonly headers: readonly UserPermissionHeaderOption[];
  readonly userId: string;
  readonly tenant?: string;
  readonly targetDoctype?: string;
  readonly targetName?: string;
  readonly applicableDoctypes?: readonly string[];
  readonly expectedVersion?: number;
}

export type UserPermissionRemoteIo = RemoteAdminIo;

export class UserPermissionRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserPermissionRemoteError";
  }
}

interface UserPermissionStateResponse {
  readonly tenantId?: string;
  readonly userId?: string;
  readonly version?: number;
  readonly grants?: readonly UserPermissionGrantResponse[];
}

interface UserPermissionGrantResponse {
  readonly targetDoctype: string;
  readonly targetName: string;
  readonly applicableDoctypes?: readonly string[];
}

export async function runRemoteUserPermissionCommand(
  command: UserPermissionRemoteCommand,
  io: UserPermissionRemoteIo = {}
): Promise<string> {
  const query = tenantQuery(command);
  if (command.action === "list") {
    const data = await requestRemoteUserPermission(command, io, {
      method: "GET",
      path: userPermissionPath(command),
      ...(query === undefined ? {} : { query })
    });
    return formatUserPermissions(command.url, data);
  }
  const data = await requestRemoteUserPermission(command, io, {
    body: grantBody(command),
    method: command.action === "allow" ? "POST" : "DELETE",
    path: userPermissionPath(command),
    ...(query === undefined ? {} : { query })
  });
  return formatUserPermissions(command.url, data, command.action === "allow" ? "Allowed user permission" : "Revoked user permission");
}

function requestRemoteUserPermission(
  command: UserPermissionRemoteCommand,
  io: UserPermissionRemoteIo,
  request: {
    readonly body?: Record<string, unknown>;
    readonly method: "DELETE" | "GET" | "POST";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<UserPermissionStateResponse> {
  return requestRemoteAdmin<UserPermissionStateResponse, UserPermissionRemoteError>(command, io, request, {
    error: UserPermissionRemoteError,
    fetchLabel: "remote user-permission commands",
    resourceLabel: "Remote user permissions",
    urlLabel: "Remote user permissions"
  });
}

function userPermissionPath(command: UserPermissionRemoteCommand): string {
  return `/api/user-permissions/${encodeURIComponent(command.userId)}`;
}

function tenantQuery(command: UserPermissionRemoteCommand): URLSearchParams | undefined {
  if (command.tenant === undefined) {
    return undefined;
  }
  const params = new URLSearchParams();
  params.set("tenant", command.tenant);
  return params;
}

function grantBody(command: UserPermissionRemoteCommand): Record<string, unknown> {
  return {
    targetDoctype: requiredTargetDoctype(command),
    targetName: requiredTargetName(command),
    ...(command.applicableDoctypes === undefined ? {} : { applicableDoctypes: command.applicableDoctypes }),
    ...(command.expectedVersion === undefined ? {} : { expectedVersion: command.expectedVersion })
  };
}

function formatUserPermissions(
  baseUrl: string,
  state: UserPermissionStateResponse,
  title = "User permissions"
): string {
  const grants = state.grants ?? [];
  return [
    `${title} at ${baseUrl}`,
    `User: ${state.userId ?? "(unknown)"} Tenant: ${state.tenantId ?? "(unknown)"} Version: ${String(state.version ?? 0)} Total: ${String(grants.length)}`,
    ...grantLines(grants),
    ""
  ].join("\n");
}

function grantLines(grants: readonly UserPermissionGrantResponse[]): readonly string[] {
  if (grants.length === 0) {
    return ["- (none)"];
  }
  return grants.flatMap((grant) => [grantLine(grant), JSON.stringify(grant)]);
}

function grantLine(grant: UserPermissionGrantResponse): string {
  const applicable = grant.applicableDoctypes === undefined || grant.applicableDoctypes.length === 0
    ? ""
    : ` applies ${grant.applicableDoctypes.join(", ")}`;
  return `- ${grant.targetDoctype}/${grant.targetName}${applicable}`;
}

function requiredTargetDoctype(command: UserPermissionRemoteCommand): string {
  if (command.targetDoctype === undefined) {
    throw new UserPermissionRemoteError(`User permission ${command.action} requires --target-doctype`);
  }
  return command.targetDoctype;
}

function requiredTargetName(command: UserPermissionRemoteCommand): string {
  if (command.targetName === undefined) {
    throw new UserPermissionRemoteError(`User permission ${command.action} requires --target-name`);
  }
  return command.targetName;
}
