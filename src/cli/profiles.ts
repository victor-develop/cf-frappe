import { requestRemoteAdmin, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type ProfileRemoteAction = "get" | "update";

export type ProfileHeaderOption = RemoteHeaderOption;

export interface ProfileRemoteCommand {
  readonly kind: "profiles";
  readonly action: ProfileRemoteAction;
  readonly url: string;
  readonly headers: readonly ProfileHeaderOption[];
  readonly userId: string;
  readonly tenant?: string;
  readonly profile?: Record<string, unknown>;
  readonly expectedVersion?: number;
}

export type ProfileRemoteIo = RemoteAdminIo;

export class ProfileRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileRemoteError";
  }
}

interface UserProfileResponse {
  readonly tenantId?: string;
  readonly userId?: string;
  readonly version?: number;
  readonly profile?: Record<string, string>;
  readonly updatedAt?: string;
}

export async function runRemoteProfileCommand(command: ProfileRemoteCommand, io: ProfileRemoteIo = {}): Promise<string> {
  const query = tenantQuery(command);
  if (command.action === "get") {
    const data = await requestRemoteProfile(command, io, {
      method: "GET",
      path: profilePath(command),
      ...(query === undefined ? {} : { query })
    });
    return formatProfile(command.url, data);
  }
  const data = await requestRemoteProfile(command, io, {
    body: updateBody(command),
    method: "PUT",
    path: profilePath(command),
    ...(query === undefined ? {} : { query })
  });
  return formatProfile(command.url, data, "Updated user profile");
}

function requestRemoteProfile(
  command: ProfileRemoteCommand,
  io: ProfileRemoteIo,
  request: {
    readonly body?: Record<string, unknown>;
    readonly method: "GET" | "PUT";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<UserProfileResponse> {
  return requestRemoteAdmin<UserProfileResponse, ProfileRemoteError>(command, io, request, {
    error: ProfileRemoteError,
    fetchLabel: "remote profile commands",
    resourceLabel: "Remote profiles",
    urlLabel: "Remote profiles"
  });
}

function profilePath(command: ProfileRemoteCommand): string {
  return `/api/users/${encodeURIComponent(command.userId)}/profile`;
}

function tenantQuery(command: ProfileRemoteCommand): URLSearchParams | undefined {
  if (command.tenant === undefined) {
    return undefined;
  }
  const params = new URLSearchParams();
  params.set("tenant", command.tenant);
  return params;
}

function updateBody(command: ProfileRemoteCommand): Record<string, unknown> {
  return {
    ...requiredProfile(command),
    ...(command.expectedVersion === undefined ? {} : { expectedVersion: command.expectedVersion })
  };
}

function requiredProfile(command: ProfileRemoteCommand): Record<string, unknown> {
  if (command.profile === undefined) {
    throw new ProfileRemoteError("Profile update requires --profile-json");
  }
  return command.profile;
}

function formatProfile(baseUrl: string, state: UserProfileResponse, title = "User profile"): string {
  const profile = state.profile ?? {};
  const fields = Object.keys(profile).sort();
  return [
    `${title} at ${baseUrl}`,
    `User: ${state.userId ?? "(unknown)"} Tenant: ${state.tenantId ?? "(unknown)"} Version: ${String(state.version ?? 0)}`,
    ...(state.updatedAt === undefined ? [] : [`Updated: ${state.updatedAt}`]),
    ...(fields.length === 0 ? ["- (empty)"] : fields.map((field) => `- ${field}: ${profile[field] ?? ""}`)),
    ""
  ].join("\n");
}
