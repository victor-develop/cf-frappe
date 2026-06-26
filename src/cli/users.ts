import { requestRemoteAdmin, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type UserRemoteAction = "create" | "disable" | "enable" | "get" | "password" | "provider-sync" | "roles";

export type UserHeaderOption = RemoteHeaderOption;

export interface UserRemoteCommand {
  readonly kind: "users";
  readonly action: UserRemoteAction;
  readonly url: string;
  readonly headers: readonly UserHeaderOption[];
  readonly userId: string;
  readonly tenant?: string;
  readonly email?: string;
  readonly passwordEnv?: string;
  readonly roles?: readonly string[];
  readonly enabled?: boolean;
  readonly provider?: string;
  readonly subject?: string;
  readonly emailVerified?: boolean;
  readonly expectedVersion?: number;
}

export type UserRemoteIo = RemoteAdminIo;

export class UserRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserRemoteError";
  }
}

interface UserAccountResponse {
  readonly tenantId?: string;
  readonly userId?: string;
  readonly version?: number;
  readonly email?: string;
  readonly emailVerifiedAt?: string;
  readonly roles?: readonly string[];
  readonly providers?: readonly UserProviderResponse[];
  readonly enabled?: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

interface UserProviderResponse {
  readonly provider?: string;
  readonly subject?: string;
  readonly email?: string;
  readonly roles?: readonly string[];
  readonly enabled?: boolean;
  readonly emailVerifiedAt?: string;
  readonly linkedAt?: string;
  readonly lastSyncedAt?: string;
}

export async function runRemoteUserCommand(command: UserRemoteCommand, io: UserRemoteIo = {}): Promise<string> {
  const query = tenantQuery(command);
  if (command.action === "get") {
    const data = await requestRemoteUser(command, io, {
      method: "GET",
      path: userPath(command),
      ...(query === undefined ? {} : { query })
    });
    return formatUser(command.url, data);
  }
  if (command.action === "create") {
    const data = await requestRemoteUser(command, io, {
      body: createBody(command, io),
      method: "POST",
      path: userPath(command),
      ...(query === undefined ? {} : { query })
    });
    return formatUser(command.url, data, "Created user account");
  }
  if (command.action === "password") {
    const data = await requestRemoteUser(command, io, {
      body: passwordBody(command, io),
      method: "PUT",
      path: `${userPath(command)}/password`,
      ...(query === undefined ? {} : { query })
    });
    return formatUser(command.url, data, "Changed user password");
  }
  if (command.action === "roles") {
    const data = await requestRemoteUser(command, io, {
      body: rolesBody(command),
      method: "PUT",
      path: `${userPath(command)}/roles`,
      ...(query === undefined ? {} : { query })
    });
    return formatUser(command.url, data, "Changed user roles");
  }
  if (command.action === "provider-sync") {
    const data = await requestRemoteUser(command, io, {
      body: providerSyncBody(command),
      method: "POST",
      path: `${userPath(command)}/provider-sync`,
      ...(query === undefined ? {} : { query })
    });
    return formatUser(command.url, data, "Synced user provider");
  }
  const data = await requestRemoteUser(command, io, {
    body: mutationBody(command),
    method: "POST",
    path: `${userPath(command)}/${command.action}`,
    ...(query === undefined ? {} : { query })
  });
  return formatUser(command.url, data, command.action === "enable" ? "Enabled user account" : "Disabled user account");
}

function requestRemoteUser(
  command: UserRemoteCommand,
  io: UserRemoteIo,
  request: {
    readonly body?: Record<string, unknown>;
    readonly method: "GET" | "POST" | "PUT";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<UserAccountResponse> {
  return requestRemoteAdmin<UserAccountResponse, UserRemoteError>(command, io, request, {
    error: UserRemoteError,
    fetchLabel: "remote user commands",
    resourceLabel: "Remote users",
    urlLabel: "Remote users"
  });
}

function userPath(command: UserRemoteCommand): string {
  return `/api/users/${encodeURIComponent(command.userId)}`;
}

function tenantQuery(command: UserRemoteCommand): URLSearchParams | undefined {
  if (command.tenant === undefined) {
    return undefined;
  }
  const params = new URLSearchParams();
  params.set("tenant", command.tenant);
  return params;
}

function createBody(command: UserRemoteCommand, io: UserRemoteIo): Record<string, unknown> {
  return {
    password: passwordFromEnv(command, io),
    roles: requiredRoles(command),
    ...(command.email === undefined ? {} : { email: command.email }),
    ...(command.enabled === undefined ? {} : { enabled: command.enabled }),
    ...mutationBody(command)
  };
}

function passwordBody(command: UserRemoteCommand, io: UserRemoteIo): Record<string, unknown> {
  return {
    password: passwordFromEnv(command, io),
    ...mutationBody(command)
  };
}

function rolesBody(command: UserRemoteCommand): Record<string, unknown> {
  return {
    roles: requiredRoles(command),
    ...mutationBody(command)
  };
}

function providerSyncBody(command: UserRemoteCommand): Record<string, unknown> {
  return {
    provider: requiredProvider(command),
    subject: requiredSubject(command),
    ...(command.email === undefined ? {} : { email: command.email }),
    ...(command.roles === undefined ? {} : { roles: command.roles }),
    ...(command.enabled === undefined ? {} : { enabled: command.enabled }),
    ...(command.emailVerified === undefined ? {} : { emailVerified: command.emailVerified }),
    ...mutationBody(command)
  };
}

function mutationBody(command: UserRemoteCommand): Record<string, unknown> {
  return {
    ...(command.expectedVersion === undefined ? {} : { expectedVersion: command.expectedVersion })
  };
}

function formatUser(baseUrl: string, account: UserAccountResponse, title = "User account"): string {
  const roles = account.roles ?? [];
  const providers = account.providers ?? [];
  return [
    `${title} at ${baseUrl}`,
    `User: ${account.userId ?? "(unknown)"} Tenant: ${account.tenantId ?? "(unknown)"} Version: ${String(account.version ?? 0)} ${account.enabled === false ? "disabled" : "enabled"}`,
    `Roles: ${roles.length === 0 ? "(none)" : roles.join(", ")}`,
    ...(account.email === undefined ? [] : [`Email: ${account.email}${account.emailVerifiedAt === undefined ? "" : " verified"}`]),
    `Providers: ${String(providers.length)}`,
    ...providerLines(providers),
    ""
  ].join("\n");
}

function providerLines(providers: readonly UserProviderResponse[]): readonly string[] {
  return providers.map((provider) => {
    const name = provider.provider ?? "(unknown)";
    const subject = provider.subject ?? "(unknown)";
    const enabled = provider.enabled === false ? "disabled" : "enabled";
    const roles = provider.roles === undefined || provider.roles.length === 0 ? "" : ` roles ${provider.roles.join(", ")}`;
    return `- ${name}:${subject} ${enabled}${roles}`;
  });
}

function passwordFromEnv(command: UserRemoteCommand, io: UserRemoteIo): string {
  const envName = command.passwordEnv;
  if (envName === undefined) {
    throw new UserRemoteError(`User ${command.action} requires --password-env`);
  }
  const value = io.env?.(envName);
  if (value === undefined || value === "") {
    throw new UserRemoteError(`Environment variable '${envName}' is not set for user password`);
  }
  return value;
}

function requiredRoles(command: UserRemoteCommand): readonly string[] {
  if (command.roles === undefined || command.roles.length === 0) {
    throw new UserRemoteError(`User ${command.action} requires at least one --role`);
  }
  return command.roles;
}

function requiredProvider(command: UserRemoteCommand): string {
  if (command.provider === undefined) {
    throw new UserRemoteError("User provider-sync requires --provider");
  }
  return command.provider;
}

function requiredSubject(command: UserRemoteCommand): string {
  if (command.subject === undefined) {
    throw new UserRemoteError("User provider-sync requires --subject");
  }
  return command.subject;
}
