import { requestRemoteAdmin, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type PrintSettingsRemoteAction = "get" | "update";

export type PrintSettingsHeaderOption = RemoteHeaderOption;

export interface PrintSettingsRemoteCommand {
  readonly kind: "print-settings";
  readonly action: PrintSettingsRemoteAction;
  readonly url: string;
  readonly headers: readonly PrintSettingsHeaderOption[];
  readonly tenant?: string;
  readonly settings?: Record<string, unknown>;
  readonly expectedVersion?: number;
}

export type PrintSettingsRemoteIo = RemoteAdminIo;

export class PrintSettingsRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PrintSettingsRemoteError";
  }
}

interface PrintSettingsResponse {
  readonly tenantId?: string;
  readonly version?: number;
  readonly settings?: Record<string, unknown>;
  readonly updatedAt?: string;
}

export async function runRemotePrintSettingsCommand(
  command: PrintSettingsRemoteCommand,
  io: PrintSettingsRemoteIo = {}
): Promise<string> {
  const query = tenantQuery(command);
  if (command.action === "get") {
    const data = await requestRemotePrintSettings(command, io, {
      method: "GET",
      path: "/api/print-settings",
      ...(query === undefined ? {} : { query })
    });
    return formatPrintSettings(command.url, data);
  }
  const data = await requestRemotePrintSettings(command, io, {
    body: updateBody(command),
    method: "PUT",
    path: "/api/print-settings",
    ...(query === undefined ? {} : { query })
  });
  return formatPrintSettings(command.url, data, "Updated print settings");
}

function requestRemotePrintSettings(
  command: PrintSettingsRemoteCommand,
  io: PrintSettingsRemoteIo,
  request: {
    readonly body?: Record<string, unknown>;
    readonly method: "GET" | "PUT";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<PrintSettingsResponse> {
  return requestRemoteAdmin<PrintSettingsResponse, PrintSettingsRemoteError>(command, io, request, {
    error: PrintSettingsRemoteError,
    fetchLabel: "remote print settings commands",
    resourceLabel: "Remote print settings",
    urlLabel: "Remote print settings"
  });
}

function tenantQuery(command: PrintSettingsRemoteCommand): URLSearchParams | undefined {
  if (command.tenant === undefined) {
    return undefined;
  }
  const params = new URLSearchParams();
  params.set("tenant", command.tenant);
  return params;
}

function updateBody(command: PrintSettingsRemoteCommand): Record<string, unknown> {
  return {
    ...requiredSettings(command),
    ...(command.expectedVersion === undefined ? {} : { expectedVersion: command.expectedVersion })
  };
}

function requiredSettings(command: PrintSettingsRemoteCommand): Record<string, unknown> {
  if (command.settings === undefined) {
    throw new PrintSettingsRemoteError("Print settings update requires --settings-json");
  }
  return command.settings;
}

function formatPrintSettings(
  baseUrl: string,
  state: PrintSettingsResponse,
  title = "Print settings"
): string {
  return [
    `${title} at ${baseUrl}`,
    `Tenant: ${state.tenantId ?? "(unknown)"} Version: ${String(state.version ?? 0)}`,
    ...(state.updatedAt === undefined ? [] : [`Updated: ${state.updatedAt}`]),
    `Settings: ${JSON.stringify(state.settings ?? {})}`,
    ""
  ].join("\n");
}
