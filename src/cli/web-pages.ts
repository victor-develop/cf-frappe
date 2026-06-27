import { requestRemoteAdminPayload, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type WebPageRemoteAction = "get" | "list";

export type WebPageHeaderOption = RemoteHeaderOption;

export interface WebPageRemoteCommand {
  readonly kind: "web-pages";
  readonly action: WebPageRemoteAction;
  readonly url: string;
  readonly headers: readonly WebPageHeaderOption[];
  readonly webPage?: string;
}

export type WebPageRemoteIo = RemoteAdminIo;

export class WebPageRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebPageRemoteError";
  }
}

interface WebPageResponse {
  readonly name?: string;
  readonly route?: string;
  readonly title?: string;
  readonly module?: string;
  readonly description?: string;
}

interface RemoteDataPayload {
  readonly data?: unknown;
}

export async function runRemoteWebPageCommand(
  command: WebPageRemoteCommand,
  io: WebPageRemoteIo = {}
): Promise<string> {
  if (command.action === "list") {
    const data = await requestRemoteWebPage(command, io, {
      method: "GET",
      path: "/api/meta/web-pages"
    });
    return formatWebPageList(command.url, arrayData<WebPageResponse>(data.data, "web pages"));
  }
  const data = await requestRemoteWebPage(command, io, {
    method: "GET",
    path: `/api/meta/web-pages/${encodeURIComponent(requiredWebPage(command))}`
  });
  return formatWebPage(command.url, objectData<WebPageResponse>(data.data, "web page"));
}

function requestRemoteWebPage(
  command: WebPageRemoteCommand,
  io: WebPageRemoteIo,
  request: { readonly method: "GET"; readonly path: string }
): Promise<RemoteDataPayload> {
  return requestRemoteAdminPayload<RemoteDataPayload, WebPageRemoteError>(command, io, request, {
    error: WebPageRemoteError,
    fetchLabel: "remote web page commands",
    resourceLabel: "Remote web pages",
    urlLabel: "Remote web pages"
  });
}

function formatWebPageList(baseUrl: string, pages: readonly WebPageResponse[]): string {
  return [
    `Web pages at ${baseUrl}`,
    `Total: ${String(pages.length)}`,
    ...(pages.length === 0 ? ["- (none)"] : pages.map(webPageLine)),
    ""
  ].join("\n");
}

function formatWebPage(baseUrl: string, page: WebPageResponse): string {
  return [
    `Web page at ${baseUrl}`,
    webPageLine(page),
    ...(page.description === undefined ? [] : [`Description: ${page.description}`]),
    ""
  ].join("\n");
}

function webPageLine(page: WebPageResponse): string {
  return `- ${page.name ?? "(unknown)"} /page/${page.route ?? "(unknown)"} - ${page.title ?? "(untitled)"}`;
}

function arrayData<T>(data: unknown, label: string): readonly T[] {
  if (Array.isArray(data)) {
    return data as readonly T[];
  }
  throw new WebPageRemoteError(`Remote ${label} response did not include a data array`);
}

function objectData<T>(data: unknown, label: string): T {
  if (isRecord(data)) {
    return data as T;
  }
  throw new WebPageRemoteError(`Remote ${label} response did not include a data object`);
}

function requiredWebPage(command: WebPageRemoteCommand): string {
  if (command.webPage) {
    return command.webPage;
  }
  throw new WebPageRemoteError(`Web page ${command.action} requires --web-page`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
