import { requestRemoteAdminPayload, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type LinkOptionHeaderOption = RemoteHeaderOption;

export interface LinkOptionRemoteCommand {
  readonly kind: "link-options";
  readonly url: string;
  readonly headers: readonly LinkOptionHeaderOption[];
  readonly doctype: string;
  readonly field: string;
  readonly query?: string;
  readonly limit?: number;
}

export type LinkOptionRemoteIo = RemoteAdminIo;

export class LinkOptionRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkOptionRemoteError";
  }
}

interface LinkOptionsResult {
  readonly doctype?: string;
  readonly field?: string;
  readonly target?: string;
  readonly options?: unknown;
}

interface LinkOptionResponse {
  readonly value?: string;
  readonly label?: string;
}

interface RemoteDataPayload {
  readonly data?: unknown;
}

export async function runRemoteLinkOptionCommand(
  command: LinkOptionRemoteCommand,
  io: LinkOptionRemoteIo = {}
): Promise<string> {
  const query = linkOptionsQuery(command);
  const data = await requestRemoteLinkOptions(command, io, {
    method: "GET",
    path: `/api/link-options/${encodeURIComponent(command.doctype)}/${encodeURIComponent(command.field)}`,
    ...(query === undefined ? {} : { query })
  });
  return formatLinkOptions(command.url, objectData<LinkOptionsResult>(data.data, "link options"));
}

function requestRemoteLinkOptions(
  command: LinkOptionRemoteCommand,
  io: LinkOptionRemoteIo,
  request: {
    readonly method: "GET";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<RemoteDataPayload> {
  return requestRemoteAdminPayload<RemoteDataPayload, LinkOptionRemoteError>(command, io, request, {
    error: LinkOptionRemoteError,
    fetchLabel: "remote link option commands",
    resourceLabel: "Remote link options",
    urlLabel: "Remote link options"
  });
}

function linkOptionsQuery(command: LinkOptionRemoteCommand): URLSearchParams | undefined {
  const query = new URLSearchParams();
  if (command.query !== undefined) {
    query.set("q", command.query);
  }
  if (command.limit !== undefined) {
    query.set("limit", String(command.limit));
  }
  return query.size === 0 ? undefined : query;
}

function formatLinkOptions(baseUrl: string, result: LinkOptionsResult): string {
  const options = linkOptionsData(result.options);
  return [
    `Link options at ${baseUrl}`,
    `${result.doctype ?? "(unknown doctype)"}.${result.field ?? "(unknown field)"} -> ${result.target ?? "(unknown target)"}`,
    `Total: ${String(options.length)}`,
    ...linkOptionLines(options),
    ""
  ].join("\n");
}

function linkOptionsData(options: unknown): readonly LinkOptionResponse[] {
  if (!Array.isArray(options)) {
    throw new LinkOptionRemoteError("Remote link options response did not include an options array");
  }
  if (!options.every(isRecord)) {
    throw new LinkOptionRemoteError("Remote link options response included a malformed option");
  }
  return options as readonly LinkOptionResponse[];
}

function linkOptionLines(options: readonly LinkOptionResponse[]): readonly string[] {
  if (options.length === 0) {
    return ["- (none)"];
  }
  return options.map((option) => `- ${option.value ?? "(unknown)"}${option.label === undefined ? "" : ` - ${option.label}`}`);
}

function objectData<T>(data: unknown, label: string): T {
  if (isRecord(data)) {
    return data as T;
  }
  throw new LinkOptionRemoteError(`Remote ${label} response did not include a data object`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
