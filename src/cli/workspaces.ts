import { requestRemoteAdminPayload, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type WorkspaceRemoteAction = "get" | "list";

export type WorkspaceHeaderOption = RemoteHeaderOption;

export interface WorkspaceRemoteCommand {
  readonly kind: "workspaces";
  readonly action: WorkspaceRemoteAction;
  readonly url: string;
  readonly headers: readonly WorkspaceHeaderOption[];
  readonly workspace?: string;
}

export type WorkspaceRemoteIo = RemoteAdminIo;

export class WorkspaceRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceRemoteError";
  }
}

interface WorkspaceResponse {
  readonly name?: string;
  readonly label?: string;
  readonly module?: string;
  readonly description?: string;
  readonly roles?: readonly string[];
  readonly sections?: readonly WorkspaceSectionResponse[];
}

interface WorkspaceSectionResponse {
  readonly name?: string;
  readonly label?: string;
  readonly shortcuts?: readonly WorkspaceShortcutResponse[];
}

interface WorkspaceShortcutResponse {
  readonly name?: string;
  readonly label?: string;
  readonly kind?: string;
  readonly target?: string;
  readonly href?: string;
}

interface RemoteDataPayload {
  readonly data?: unknown;
}

export async function runRemoteWorkspaceCommand(
  command: WorkspaceRemoteCommand,
  io: WorkspaceRemoteIo = {}
): Promise<string> {
  if (command.action === "list") {
    const data = await requestRemoteWorkspace(command, io, {
      method: "GET",
      path: "/api/meta/workspaces"
    });
    return formatWorkspaceList(command.url, arrayData<WorkspaceResponse>(data.data, "workspaces"));
  }
  const data = await requestRemoteWorkspace(command, io, {
    method: "GET",
    path: `/api/meta/workspaces/${encodeURIComponent(requiredWorkspace(command))}`
  });
  return formatWorkspace(command.url, objectData<WorkspaceResponse>(data.data, "workspace"));
}

function requestRemoteWorkspace(
  command: WorkspaceRemoteCommand,
  io: WorkspaceRemoteIo,
  request: {
    readonly method: "GET";
    readonly path: string;
  }
): Promise<RemoteDataPayload> {
  return requestRemoteAdminPayload<RemoteDataPayload, WorkspaceRemoteError>(command, io, request, {
    error: WorkspaceRemoteError,
    fetchLabel: "remote workspace commands",
    resourceLabel: "Remote workspaces",
    urlLabel: "Remote workspaces"
  });
}

function formatWorkspaceList(baseUrl: string, workspaces: readonly WorkspaceResponse[]): string {
  return [
    `Workspaces at ${baseUrl}`,
    `Total: ${String(workspaces.length)}`,
    ...workspaceLines(workspaces),
    ""
  ].join("\n");
}

function formatWorkspace(baseUrl: string, workspace: WorkspaceResponse): string {
  return [
    `Workspace at ${baseUrl}`,
    workspaceLine(workspace),
    ...(workspace.module === undefined ? [] : [`Module: ${workspace.module}`]),
    ...(workspace.description === undefined ? [] : [`Description: ${workspace.description}`]),
    ...(workspace.roles === undefined || workspace.roles.length === 0 ? [] : [`Roles: ${workspace.roles.join(", ")}`]),
    ...workspaceSectionLines(workspace.sections ?? []),
    ""
  ].join("\n");
}

function workspaceLines(workspaces: readonly WorkspaceResponse[]): readonly string[] {
  if (workspaces.length === 0) {
    return ["- (none)"];
  }
  return workspaces.map(workspaceLine);
}

function workspaceLine(workspace: WorkspaceResponse): string {
  const label = workspace.label === undefined ? "" : ` - ${workspace.label}`;
  return `- ${workspace.name ?? "(unknown)"} sections=${String(workspace.sections?.length ?? 0)}${label}`;
}

function workspaceSectionLines(sections: readonly WorkspaceSectionResponse[]): readonly string[] {
  if (sections.length === 0) {
    return ["Sections: 0"];
  }
  return [
    `Sections: ${String(sections.length)}`,
    ...sections.flatMap((section) => [
      `- ${section.name ?? "(unknown)"} shortcuts=${String(section.shortcuts?.length ?? 0)}${section.label === undefined ? "" : ` - ${section.label}`}`,
      ...shortcutLines(section.shortcuts ?? [])
    ])
  ];
}

function shortcutLines(shortcuts: readonly WorkspaceShortcutResponse[]): readonly string[] {
  return shortcuts.map((shortcut) => {
    const target = shortcut.target ?? shortcut.href ?? "";
    const targetText = target === "" ? "" : ` -> ${target}`;
    const label = shortcut.label === undefined ? "" : ` - ${shortcut.label}`;
    return `  - ${shortcut.name ?? "(unknown)"} [${shortcut.kind ?? "unknown"}]${targetText}${label}`;
  });
}

function arrayData<T>(data: unknown, label: string): readonly T[] {
  if (Array.isArray(data)) {
    return data as readonly T[];
  }
  throw new WorkspaceRemoteError(`Remote ${label} response did not include a data array`);
}

function objectData<T>(data: unknown, label: string): T {
  if (isRecord(data)) {
    return data as T;
  }
  throw new WorkspaceRemoteError(`Remote ${label} response did not include a data object`);
}

function requiredWorkspace(command: WorkspaceRemoteCommand): string {
  if (command.workspace === undefined) {
    throw new WorkspaceRemoteError(`Workspace ${command.action} requires --workspace`);
  }
  return command.workspace;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
