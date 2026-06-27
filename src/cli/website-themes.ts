import { requestRemoteAdminPayload, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type WebsiteThemeRemoteAction = "get" | "list";

export type WebsiteThemeHeaderOption = RemoteHeaderOption;

export interface WebsiteThemeRemoteCommand {
  readonly kind: "website-themes";
  readonly action: WebsiteThemeRemoteAction;
  readonly url: string;
  readonly headers: readonly WebsiteThemeHeaderOption[];
  readonly theme?: string;
}

export type WebsiteThemeRemoteIo = RemoteAdminIo;

export class WebsiteThemeRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebsiteThemeRemoteError";
  }
}

interface WebsiteThemeResponse {
  readonly name?: string;
  readonly label?: string;
  readonly description?: string;
  readonly fontFamily?: string;
  readonly tokens?: Record<string, string>;
}

interface RemoteDataPayload {
  readonly data?: unknown;
}

export async function runRemoteWebsiteThemeCommand(
  command: WebsiteThemeRemoteCommand,
  io: WebsiteThemeRemoteIo = {}
): Promise<string> {
  if (command.action === "list") {
    const data = await requestRemoteWebsiteTheme(command, io, {
      method: "GET",
      path: "/api/meta/website-themes"
    });
    return formatWebsiteThemeList(command.url, arrayData<WebsiteThemeResponse>(data.data, "website themes"));
  }
  const data = await requestRemoteWebsiteTheme(command, io, {
    method: "GET",
    path: `/api/meta/website-themes/${encodeURIComponent(requiredTheme(command))}`
  });
  return formatWebsiteTheme(command.url, objectData<WebsiteThemeResponse>(data.data, "website theme"));
}

function requestRemoteWebsiteTheme(
  command: WebsiteThemeRemoteCommand,
  io: WebsiteThemeRemoteIo,
  request: { readonly method: "GET"; readonly path: string }
): Promise<RemoteDataPayload> {
  return requestRemoteAdminPayload<RemoteDataPayload, WebsiteThemeRemoteError>(command, io, request, {
    error: WebsiteThemeRemoteError,
    fetchLabel: "remote website theme commands",
    resourceLabel: "Remote website themes",
    urlLabel: "Remote website themes"
  });
}

function formatWebsiteThemeList(baseUrl: string, themes: readonly WebsiteThemeResponse[]): string {
  return [
    `Website themes at ${baseUrl}`,
    `Total: ${String(themes.length)}`,
    ...(themes.length === 0 ? ["- (none)"] : themes.map(themeLine)),
    ""
  ].join("\n");
}

function formatWebsiteTheme(baseUrl: string, theme: WebsiteThemeResponse): string {
  return [
    `Website theme at ${baseUrl}`,
    themeLine(theme),
    ...(theme.description === undefined ? [] : [`Description: ${theme.description}`]),
    ...(theme.fontFamily === undefined ? [] : [`Font: ${theme.fontFamily}`]),
    ...Object.entries(theme.tokens ?? {}).map(([token, value]) => `${token}: ${value}`),
    ""
  ].join("\n");
}

function themeLine(theme: WebsiteThemeResponse): string {
  return `- ${theme.name ?? "(unknown)"} - ${theme.label ?? theme.name ?? "(untitled)"}`;
}

function arrayData<T>(data: unknown, label: string): readonly T[] {
  if (Array.isArray(data)) {
    return data as readonly T[];
  }
  throw new WebsiteThemeRemoteError(`Remote ${label} response did not include a data array`);
}

function objectData<T>(data: unknown, label: string): T {
  if (isRecord(data)) {
    return data as T;
  }
  throw new WebsiteThemeRemoteError(`Remote ${label} response did not include a data object`);
}

function requiredTheme(command: WebsiteThemeRemoteCommand): string {
  if (command.theme) {
    return command.theme;
  }
  throw new WebsiteThemeRemoteError(`Website theme ${command.action} requires --theme`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
