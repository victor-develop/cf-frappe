import { requestRemoteAdminPayload, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type WebsiteSettingsRemoteAction = "get";

export type WebsiteSettingsHeaderOption = RemoteHeaderOption;

export interface WebsiteSettingsRemoteCommand {
  readonly kind: "website-settings";
  readonly action: WebsiteSettingsRemoteAction;
  readonly url: string;
  readonly headers: readonly WebsiteSettingsHeaderOption[];
}

export type WebsiteSettingsRemoteIo = RemoteAdminIo;

export class WebsiteSettingsRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebsiteSettingsRemoteError";
  }
}

interface WebsiteSettingsResponse {
  readonly title?: string;
  readonly description?: string;
  readonly homePageRoute?: string;
  readonly navItems?: readonly {
    readonly name?: string;
    readonly label?: string;
    readonly href?: string;
  }[];
}

interface RemoteDataPayload {
  readonly data?: unknown;
}

export async function runRemoteWebsiteSettingsCommand(
  command: WebsiteSettingsRemoteCommand,
  io: WebsiteSettingsRemoteIo = {}
): Promise<string> {
  const data = await requestRemoteAdminPayload<RemoteDataPayload, WebsiteSettingsRemoteError>(command, io, {
    method: "GET",
    path: "/api/meta/website-settings"
  }, {
    error: WebsiteSettingsRemoteError,
    fetchLabel: "remote website settings commands",
    resourceLabel: "Remote website settings",
    urlLabel: "Remote website settings"
  });
  return formatWebsiteSettings(command.url, objectData<WebsiteSettingsResponse>(data.data, "website settings"));
}

function formatWebsiteSettings(baseUrl: string, settings: WebsiteSettingsResponse): string {
  const navItems = settings.navItems ?? [];
  return [
    `Website settings at ${baseUrl}`,
    `Title: ${settings.title ?? "(untitled)"}`,
    ...(settings.description === undefined ? [] : [`Description: ${settings.description}`]),
    ...(settings.homePageRoute === undefined ? [] : [`Home: /page/${settings.homePageRoute}`]),
    `Navigation: ${String(navItems.length)}`,
    ...(navItems.length === 0 ? ["- (none)"] : navItems.map(navItemLine)),
    ""
  ].join("\n");
}

function navItemLine(item: NonNullable<WebsiteSettingsResponse["navItems"]>[number]): string {
  return `- ${item.label ?? item.name ?? "(untitled)"} ${item.href ?? ""}`;
}

function objectData<T>(data: unknown, label: string): T {
  if (isRecord(data)) {
    return data as T;
  }
  throw new WebsiteSettingsRemoteError(`Remote ${label} response did not include a data object`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
