import {
  requestRemoteAdmin,
  requestRemoteAdminPayload,
  type RemoteAdminIo,
  type RemoteHeaderOption
} from "./remote-admin.js";

export type ResourceRemoteAction = "create" | "delete" | "get" | "list" | "update";

export type ResourceHeaderOption = RemoteHeaderOption;

export interface ResourceRemoteCommand {
  readonly kind: "resources";
  readonly action: ResourceRemoteAction;
  readonly url: string;
  readonly headers: readonly ResourceHeaderOption[];
  readonly doctype: string;
  readonly name?: string;
  readonly data?: Record<string, unknown>;
  readonly expectedVersion?: number;
  readonly filters?: readonly ResourceRemoteFilter[];
  readonly filterExpression?: Record<string, unknown>;
  readonly limit?: number;
  readonly offset?: number;
  readonly orderBy?: string;
  readonly order?: "asc" | "desc";
  readonly useDefaultFilters?: boolean;
}

export interface ResourceRemoteFilter {
  readonly key: string;
  readonly value: string;
}

export class ResourceRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResourceRemoteError";
  }
}

interface DocumentSnapshotResponse {
  readonly name?: string;
  readonly version?: number;
  readonly docstatus?: string;
  readonly data?: Record<string, unknown>;
}

interface ResourceListResponse {
  readonly data: readonly DocumentSnapshotResponse[];
  readonly limit?: number;
  readonly offset?: number;
  readonly total?: number;
}

export async function runRemoteResourceCommand(
  command: ResourceRemoteCommand,
  io: RemoteAdminIo = {}
): Promise<string> {
  if (command.action === "list") {
    const query = listQuery(command);
    const payload = await requestRemoteResourcePayload<ResourceListResponse>(command, io, {
      method: "GET",
      path: `/api/resource/${encodeURIComponent(command.doctype)}`,
      ...(query === undefined ? {} : { query })
    });
    return formatResourceList(command.url, command.doctype, payload);
  }
  if (command.action === "get") {
    const data = await requestRemoteResource<DocumentSnapshotResponse>(command, io, {
      method: "GET",
      path: `/api/resource/${encodeURIComponent(command.doctype)}/${encodeURIComponent(requiredResourceName(command, "get"))}`
    });
    return formatResourceDetail(command.url, command.doctype, "Resource", data);
  }
  if (command.action === "create") {
    const data = await requestRemoteResource<DocumentSnapshotResponse>(command, io, {
      body: requiredResourceData(command, "create"),
      method: "POST",
      path: `/api/resource/${encodeURIComponent(command.doctype)}`
    });
    return formatResourceDetail(command.url, command.doctype, "Created resource", data);
  }
  if (command.action === "update") {
    const data = await requestRemoteResource<DocumentSnapshotResponse>(command, io, {
      body: mutationBody(command),
      method: "PUT",
      path: `/api/resource/${encodeURIComponent(command.doctype)}/${encodeURIComponent(requiredResourceName(command, "update"))}`
    });
    return formatResourceDetail(command.url, command.doctype, "Updated resource", data);
  }
  const data = await requestRemoteResource<DocumentSnapshotResponse>(command, io, {
    body: command.expectedVersion === undefined ? {} : { expectedVersion: command.expectedVersion },
    method: "DELETE",
    path: `/api/resource/${encodeURIComponent(command.doctype)}/${encodeURIComponent(requiredResourceName(command, "delete"))}`
  });
  return formatResourceDetail(command.url, command.doctype, "Deleted resource", data);
}

function requestRemoteResource<TData>(
  command: ResourceRemoteCommand,
  io: RemoteAdminIo,
  request: {
    readonly body?: Record<string, unknown>;
    readonly method: "DELETE" | "GET" | "POST" | "PUT";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<TData> {
  return requestRemoteAdmin<TData, ResourceRemoteError>(command, io, request, {
    error: ResourceRemoteError,
    fetchLabel: "remote resource commands",
    resourceLabel: "Remote resource",
    urlLabel: "Remote resource"
  });
}

function requestRemoteResourcePayload<TPayload>(
  command: ResourceRemoteCommand,
  io: RemoteAdminIo,
  request: {
    readonly method: "GET";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<TPayload> {
  return requestRemoteAdminPayload<TPayload, ResourceRemoteError>(command, io, request, {
    error: ResourceRemoteError,
    fetchLabel: "remote resource commands",
    resourceLabel: "Remote resource",
    urlLabel: "Remote resource"
  });
}

function listQuery(command: ResourceRemoteCommand): URLSearchParams | undefined {
  const params = new URLSearchParams();
  for (const filter of command.filters ?? []) {
    appendFilterParam(params, filter);
  }
  if (command.filterExpression !== undefined) {
    params.set("filter_expression", JSON.stringify(command.filterExpression));
  }
  if (command.limit !== undefined) {
    params.set("limit", String(command.limit));
  }
  if (command.offset !== undefined) {
    params.set("offset", String(command.offset));
  }
  if (command.orderBy !== undefined) {
    params.set("order_by", command.orderBy);
  }
  if (command.order !== undefined) {
    params.set("order", command.order);
  }
  if (command.useDefaultFilters === false) {
    params.set("default_filters", "0");
  }
  return params.toString().length === 0 ? undefined : params;
}

function appendFilterParam(params: URLSearchParams, filter: ResourceRemoteFilter): void {
  const key = `filter_${filter.key}`;
  params.append(key, filter.value);
  if (filter.value === "") {
    params.append("empty_filter", key);
  }
}

function requiredResourceName(command: ResourceRemoteCommand, action: string): string {
  if (command.name === undefined) {
    throw new ResourceRemoteError(`Resource ${action} requires --name`);
  }
  return command.name;
}

function requiredResourceData(command: ResourceRemoteCommand, action: string): Record<string, unknown> {
  if (command.data === undefined) {
    throw new ResourceRemoteError(`Resource ${action} requires --data-json`);
  }
  return command.data;
}

function mutationBody(command: ResourceRemoteCommand): Record<string, unknown> {
  const body = { ...requiredResourceData(command, "update") };
  if (command.expectedVersion !== undefined) {
    body.expectedVersion = command.expectedVersion;
  }
  return body;
}

function formatResourceList(baseUrl: string, doctype: string, result: ResourceListResponse): string {
  return [
    `Resources ${doctype} at ${baseUrl}`,
    `Total: ${String(result.total ?? result.data.length)} Offset: ${String(result.offset ?? 0)} Limit: ${String(result.limit ?? result.data.length)}`,
    ...resourceLines(result.data),
    ""
  ].join("\n");
}

function formatResourceDetail(
  baseUrl: string,
  doctype: string,
  title: string,
  snapshot: DocumentSnapshotResponse
): string {
  return [
    `${title} ${doctype} at ${baseUrl}`,
    resourceLine(snapshot),
    JSON.stringify(snapshot),
    ""
  ].join("\n");
}

function resourceLines(documents: readonly DocumentSnapshotResponse[]): readonly string[] {
  if (documents.length === 0) {
    return ["- (none)"];
  }
  return documents.flatMap((document) => [resourceLine(document), JSON.stringify(document)]);
}

function resourceLine(snapshot: DocumentSnapshotResponse): string {
  const name = snapshot.name ?? "(unknown)";
  const version = snapshot.version === undefined ? "" : ` version ${String(snapshot.version)}`;
  const status = snapshot.docstatus === undefined ? "" : ` status ${snapshot.docstatus}`;
  return `- ${name}${version}${status}`;
}
