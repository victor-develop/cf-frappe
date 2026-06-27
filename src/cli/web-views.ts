import { requestRemoteAdminPayload, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type WebViewRemoteAction = "get" | "item" | "items" | "list";

export type WebViewHeaderOption = RemoteHeaderOption;

export interface WebViewRemoteCommand {
  readonly kind: "web-views";
  readonly action: WebViewRemoteAction;
  readonly url: string;
  readonly headers: readonly WebViewHeaderOption[];
  readonly webView?: string;
  readonly route?: string;
  readonly limit?: number;
  readonly offset?: number;
}

export type WebViewRemoteIo = RemoteAdminIo;

export class WebViewRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebViewRemoteError";
  }
}

interface WebViewResponse {
  readonly name?: string;
  readonly label?: string;
  readonly doctype?: string;
  readonly filters?: readonly unknown[];
  readonly filterExpression?: unknown;
  readonly orderBy?: string;
  readonly order?: string;
  readonly fields?: readonly { readonly field?: string; readonly label?: string; readonly type?: string }[];
}

interface WebViewMetadataResponse {
  readonly view?: WebViewResponse;
  readonly doctype?: string;
  readonly routeField?: { readonly field?: string };
  readonly titleField?: { readonly field?: string };
  readonly fields?: readonly { readonly field?: string; readonly label?: string; readonly type?: string }[];
}

interface WebViewItemResponse {
  readonly route?: string;
  readonly title?: string;
  readonly doctype?: string;
  readonly name?: string;
}

interface WebViewItemsResponse {
  readonly view?: WebViewResponse;
  readonly items?: readonly WebViewItemResponse[];
  readonly total?: number;
  readonly totalIsExact?: boolean;
  readonly limit?: number;
  readonly offset?: number;
  readonly hasMore?: boolean;
  readonly nextOffset?: number;
}

interface WebViewItemEnvelope {
  readonly view?: WebViewResponse;
  readonly item?: WebViewItemResponse;
}

interface RemoteDataPayload {
  readonly data?: unknown;
}

export async function runRemoteWebViewCommand(
  command: WebViewRemoteCommand,
  io: WebViewRemoteIo = {}
): Promise<string> {
  if (command.action === "list") {
    const data = await requestRemoteWebView(command, io, {
      method: "GET",
      path: "/api/meta/web-views"
    });
    return formatWebViewList(command.url, arrayData<WebViewResponse>(data.data, "web views"));
  }
  if (command.action === "get") {
    const data = await requestRemoteWebView(command, io, {
      method: "GET",
      path: `/api/meta/web-views/${encodeURIComponent(requiredWebView(command))}`
    });
    return formatWebViewMetadata(command.url, objectData<WebViewMetadataResponse>(data.data, "web view"));
  }
  if (command.action === "items") {
    const query = webViewItemsQuery(command);
    const data = await requestRemoteWebView(command, io, {
      method: "GET",
      path: `/api/web-view/${encodeURIComponent(requiredWebView(command))}`,
      ...(query === undefined ? {} : { query })
    });
    return formatWebViewItems(command.url, objectData<WebViewItemsResponse>(data.data, "web view items"));
  }
  const data = await requestRemoteWebView(command, io, {
    method: "GET",
    path: `/api/web-view/${encodeURIComponent(requiredWebView(command))}/${encodePath(requiredRoute(command))}`
  });
  return formatWebViewItem(command.url, objectData<WebViewItemEnvelope>(data.data, "web view item"));
}

function requestRemoteWebView(
  command: WebViewRemoteCommand,
  io: WebViewRemoteIo,
  request: { readonly method: "GET"; readonly path: string; readonly query?: URLSearchParams }
): Promise<RemoteDataPayload> {
  return requestRemoteAdminPayload<RemoteDataPayload, WebViewRemoteError>(command, io, request, {
    error: WebViewRemoteError,
    fetchLabel: "remote web view commands",
    resourceLabel: "Remote web views",
    urlLabel: "Remote web views"
  });
}

function formatWebViewList(baseUrl: string, views: readonly WebViewResponse[]): string {
  return [
    `Web views at ${baseUrl}`,
    `Total: ${String(views.length)}`,
    ...(views.length === 0 ? ["- (none)"] : views.map(webViewLine)),
    ""
  ].join("\n");
}

function formatWebViewMetadata(baseUrl: string, metadata: WebViewMetadataResponse): string {
  const view = metadata.view ?? {};
  const doctype = metadata.doctype ?? view.doctype;
  const fields = metadata.fields ?? view.fields ?? [];
  return [
    `Web view at ${baseUrl}`,
    webViewLine({ ...view, ...(doctype === undefined ? {} : { doctype }) }),
    `Route field: ${metadata.routeField?.field ?? "(unknown)"}`,
    `Title field: ${metadata.titleField?.field ?? "(unknown)"}`,
    `Order: ${webViewOrderLine(view)}`,
    `Filters: ${String(Array.isArray(view.filters) ? view.filters.length : 0)}`,
    `Filter expression: ${view.filterExpression === undefined ? "no" : "yes"}`,
    ...fields.map((field) => `  - ${field.field ?? "(unknown)"} ${field.type ?? "(unknown)"}${field.label === undefined ? "" : ` - ${field.label}`}`),
    ""
  ].join("\n");
}

function webViewOrderLine(view: WebViewResponse): string {
  if (view.orderBy === undefined && view.order === undefined) {
    return "(default)";
  }
  return `${view.orderBy ?? "updatedAt"} ${view.order ?? "desc"}`;
}

function formatWebViewItems(baseUrl: string, result: WebViewItemsResponse): string {
  const items = result.items ?? [];
  const total = result.total ?? items.length;
  return [
    `Web view items at ${baseUrl}`,
    `Total: ${String(total)}${result.totalIsExact === false ? "+" : ""}`,
    `Limit: ${String(result.limit ?? items.length)}`,
    `Offset: ${String(result.offset ?? 0)}`,
    ...(result.nextOffset === undefined ? [] : [`Next offset: ${String(result.nextOffset)}`]),
    ...(items.length === 0 ? ["- (none)"] : items.map(webViewItemLine)),
    ""
  ].join("\n");
}

function formatWebViewItem(baseUrl: string, result: WebViewItemEnvelope): string {
  return [
    `Web view item at ${baseUrl}`,
    webViewLine(result.view ?? {}),
    webViewItemLine(result.item ?? {}),
    ""
  ].join("\n");
}

function webViewLine(view: WebViewResponse): string {
  const label = view.label === undefined ? "" : ` - ${view.label}`;
  return `- ${view.name ?? "(unknown)"} ${view.doctype ?? "(unknown)"}${label}`;
}

function webViewItemLine(item: WebViewItemResponse): string {
  return `- ${item.route ?? "(unknown)"} ${item.doctype ?? "(unknown)"}/${item.name ?? "(unknown)"} - ${item.title ?? "(untitled)"}`;
}

function arrayData<T>(data: unknown, label: string): readonly T[] {
  if (Array.isArray(data)) {
    return data as readonly T[];
  }
  throw new WebViewRemoteError(`Remote ${label} response did not include a data array`);
}

function objectData<T>(data: unknown, label: string): T {
  if (isRecord(data)) {
    return data as T;
  }
  throw new WebViewRemoteError(`Remote ${label} response did not include a data object`);
}

function requiredWebView(command: WebViewRemoteCommand): string {
  if (command.webView) {
    return command.webView;
  }
  throw new WebViewRemoteError(`Web view ${command.action} requires --web-view`);
}

function requiredRoute(command: WebViewRemoteCommand): string {
  if (command.route) {
    return command.route;
  }
  throw new WebViewRemoteError("Web view item requires --route");
}

function encodePath(value: string): string {
  return value.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function webViewItemsQuery(command: WebViewRemoteCommand): URLSearchParams | undefined {
  if (command.limit === undefined && command.offset === undefined) {
    return undefined;
  }
  const query = new URLSearchParams();
  if (command.limit !== undefined) {
    query.set("limit", String(command.limit));
  }
  if (command.offset !== undefined) {
    query.set("offset", String(command.offset));
  }
  return query;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
