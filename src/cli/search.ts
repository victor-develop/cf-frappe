import { requestRemoteAdminPayload, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type SearchHeaderOption = RemoteHeaderOption;

export interface SearchRemoteCommand {
  readonly kind: "search";
  readonly url: string;
  readonly headers: readonly SearchHeaderOption[];
  readonly query: string;
  readonly limit?: number;
  readonly tenant?: string;
}

export type SearchRemoteIo = RemoteAdminIo;

export class SearchRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SearchRemoteError";
  }
}

interface GlobalSearchResult {
  readonly query?: string;
  readonly limit?: number;
  readonly total?: number;
  readonly data?: readonly GlobalSearchItem[];
}

interface GlobalSearchItem {
  readonly doctype?: string;
  readonly name?: string;
  readonly label?: string;
  readonly matchedField?: string;
  readonly matchedText?: string;
  readonly route?: string;
  readonly updatedAt?: string;
}

interface RemoteDataPayload {
  readonly data?: unknown;
}

export async function runRemoteSearchCommand(
  command: SearchRemoteCommand,
  io: SearchRemoteIo = {}
): Promise<string> {
  const data = await requestRemoteSearch(command, io, {
    method: "GET",
    path: "/api/search",
    query: searchQuery(command)
  });
  return formatSearchResult(command.url, objectData<GlobalSearchResult>(data.data, "search result"));
}

function requestRemoteSearch(
  command: SearchRemoteCommand,
  io: SearchRemoteIo,
  request: {
    readonly method: "GET";
    readonly path: string;
    readonly query: URLSearchParams;
  }
): Promise<RemoteDataPayload> {
  return requestRemoteAdminPayload<RemoteDataPayload, SearchRemoteError>(command, io, request, {
    error: SearchRemoteError,
    fetchLabel: "remote search commands",
    resourceLabel: "Remote search",
    urlLabel: "Remote search"
  });
}

function searchQuery(command: SearchRemoteCommand): URLSearchParams {
  const query = new URLSearchParams();
  query.set("q", command.query);
  if (command.limit !== undefined) {
    query.set("limit", String(command.limit));
  }
  if (command.tenant !== undefined) {
    query.set("tenant", command.tenant);
  }
  return query;
}

function formatSearchResult(baseUrl: string, result: GlobalSearchResult): string {
  const items = result.data ?? [];
  return [
    `Search at ${baseUrl}`,
    `Query: ${result.query ?? ""}`,
    `Total: ${String(result.total ?? items.length)} limit=${String(result.limit ?? items.length)}`,
    ...searchLines(items),
    ""
  ].join("\n");
}

function searchLines(items: readonly GlobalSearchItem[]): readonly string[] {
  if (items.length === 0) {
    return ["- (none)"];
  }
  return items.map(searchLine);
}

function searchLine(item: GlobalSearchItem): string {
  const label = item.label === undefined ? "" : ` - ${item.label}`;
  const match = item.matchedField === undefined ? "" : ` match=${item.matchedField}${item.matchedText === undefined ? "" : `:${item.matchedText}`}`;
  const route = item.route === undefined ? "" : ` route=${item.route}`;
  const updatedAt = item.updatedAt === undefined ? "" : ` updated=${item.updatedAt}`;
  return `- ${item.doctype ?? "(unknown doctype)"}/${item.name ?? "(unknown)"}${label}${match}${route}${updatedAt}`;
}

function objectData<T>(data: unknown, label: string): T {
  if (isRecord(data)) {
    return data as T;
  }
  throw new SearchRemoteError(`Remote ${label} response did not include a data object`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
