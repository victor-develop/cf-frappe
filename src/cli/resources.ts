import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  requestRemoteAdmin,
  requestRemoteAdminPayload,
  requestRemoteAdminResponse,
  type RemoteAdminIo,
  type RemoteHeaderOption
} from "./remote-admin.js";

export type ResourceRemoteAction =
  | "amend"
  | "bulk-cancel"
  | "bulk-delete"
  | "bulk-submit"
  | "bulk-transition"
  | "cancel"
  | "command"
  | "create"
  | "delete"
  | "duplicate"
  | "export"
  | "get"
  | "import"
  | "import-template"
  | "list"
  | "delete-filter"
  | "save-filter"
  | "saved-filters"
  | "share"
  | "shares"
  | "submit"
  | "transition"
  | "unshare"
  | "update";

export type ResourceHeaderOption = RemoteHeaderOption;

export interface ResourceRemoteCommand {
  readonly kind: "resources";
  readonly action: ResourceRemoteAction;
  readonly url: string;
  readonly headers: readonly ResourceHeaderOption[];
  readonly doctype: string;
  readonly name?: string;
  readonly filterId?: string;
  readonly userId?: string;
  readonly permissions?: readonly string[];
  readonly label?: string;
  readonly transition?: string;
  readonly command?: string;
  readonly data?: Record<string, unknown>;
  readonly newName?: string;
  readonly outputPath?: string;
  readonly path?: string;
  readonly importMode?: "create" | "update";
  readonly expectedVersion?: number;
  readonly maxRows?: number;
  readonly documents?: readonly ResourceRemoteSelection[];
  readonly filters?: readonly ResourceRemoteFilter[];
  readonly filterExpression?: Record<string, unknown>;
  readonly savedFilter?: string;
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

export interface ResourceRemoteSelection {
  readonly name: string;
  readonly expectedVersion?: number;
}

export interface ResourceRemoteIo extends RemoteAdminIo {
  readonly cwd?: string;
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

interface DocTypeMetadataResponse {
  readonly fields?: readonly { readonly name?: string }[];
}

interface ResourceListResponse {
  readonly data: readonly DocumentSnapshotResponse[];
  readonly limit?: number;
  readonly offset?: number;
  readonly total?: number;
}

interface BulkResourceCommandResponse {
  readonly succeeded?: readonly BulkResourceSuccessResponse[];
  readonly deleted?: readonly BulkResourceSuccessResponse[];
  readonly failed: readonly BulkResourceFailureResponse[];
}

interface BulkResourceSuccessResponse {
  readonly name: string;
  readonly snapshot: DocumentSnapshotResponse;
}

interface BulkResourceFailureResponse {
  readonly name: string;
  readonly code?: string;
  readonly message?: string;
  readonly status?: number;
}

interface DocumentImportResponse {
  readonly doctype?: string;
  readonly mode?: "create" | "update";
  readonly total?: number;
  readonly succeeded?: readonly DocumentImportSuccessResponse[];
  readonly failed?: readonly DocumentImportFailureResponse[];
}

interface DocumentImportSuccessResponse {
  readonly row: number;
  readonly action: "create" | "update";
  readonly name: string;
}

interface DocumentImportFailureResponse {
  readonly row: number;
  readonly action: "create" | "update";
  readonly name?: string;
  readonly code?: string;
  readonly message?: string;
  readonly status?: number;
}

interface SavedFilterListResponse {
  readonly data: readonly SavedFilterResponse[];
}

interface SavedFilterResponse {
  readonly tenantId?: string;
  readonly doctype?: string;
  readonly id: string;
  readonly label: string;
  readonly ownerId?: string;
  readonly filters?: readonly Record<string, unknown>[];
  readonly filterExpression?: Record<string, unknown>;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

interface DocumentShareStateResponse {
  readonly version?: number;
  readonly grants?: readonly DocumentShareGrantResponse[];
}

interface DocumentShareGrantResponse {
  readonly userId: string;
  readonly permissions: readonly string[];
}

export async function runRemoteResourceCommand(
  command: ResourceRemoteCommand,
  io: ResourceRemoteIo = {}
): Promise<string> {
  if (command.action === "shares") {
    const data = await requestRemoteResource<DocumentShareStateResponse>(command, io, {
      method: "GET",
      path: `/api/resource/${encodeURIComponent(command.doctype)}/${encodeURIComponent(requiredResourceName(command, "shares"))}/shares`
    });
    return formatDocumentShares(command.url, command.doctype, requiredResourceName(command, "shares"), data);
  }
  if (command.action === "share") {
    const data = await requestRemoteResource<DocumentSnapshotResponse>(command, io, {
      body: shareBody(command),
      method: "POST",
      path: `/api/resource/${encodeURIComponent(command.doctype)}/${encodeURIComponent(requiredResourceName(command, "share"))}/shares`
    });
    return formatResourceDetail(command.url, command.doctype, "Shared resource", data);
  }
  if (command.action === "unshare") {
    const data = await requestRemoteResource<DocumentSnapshotResponse>(command, io, {
      body: versionBody(command),
      method: "DELETE",
      path: `/api/resource/${encodeURIComponent(command.doctype)}/${encodeURIComponent(requiredResourceName(command, "unshare"))}/shares/${encodeURIComponent(requiredResourceShareUserId(command))}`
    });
    return formatResourceDetail(command.url, command.doctype, "Revoked resource share", data);
  }
  if (command.action === "saved-filters") {
    const payload = await requestRemoteResourcePayload<SavedFilterListResponse>(command, io, {
      method: "GET",
      path: `/api/resource/${encodeURIComponent(command.doctype)}/saved-filters`
    });
    return formatSavedFilters(command.url, command.doctype, payload.data);
  }
  if (command.action === "save-filter") {
    const metadata = await requestRemoteResource<DocTypeMetadataResponse>(command, io, {
      method: "GET",
      path: `/api/meta/doctypes/${encodeURIComponent(command.doctype)}`
    });
    const data = await requestRemoteResource<SavedFilterResponse>(command, io, {
      body: savedFilterBody(command, metadata),
      method: "POST",
      path: `/api/resource/${encodeURIComponent(command.doctype)}/saved-filters`
    });
    return formatSavedFilter(command.url, command.doctype, "Saved resource filter", data);
  }
  if (command.action === "delete-filter") {
    const filterId = requiredResourceFilterId(command);
    await requestRemoteResourceResponse(command, io, {
      method: "DELETE",
      path: `/api/resource/${encodeURIComponent(command.doctype)}/saved-filters/${encodeURIComponent(filterId)}`
    });
    return formatDeletedSavedFilter(command.url, command.doctype, filterId);
  }
  if (command.action === "export") {
    const query = listQuery(command);
    const downloaded = await downloadRemoteResourceCsv(command, io, "export", {
      method: "GET",
      path: `/api/resource/${encodeURIComponent(command.doctype)}/export.csv`,
      ...(query === undefined ? {} : { query })
    });
    return formatResourceCsvDownload(
      command.url,
      "Downloaded resource CSV export",
      command.doctype,
      downloaded.output,
      downloaded.bytes,
      downloaded.response
    );
  }
  if (command.action === "import-template") {
    const downloaded = await downloadRemoteResourceCsv(command, io, "import template", {
      method: "GET",
      path: `/api/resource/${encodeURIComponent(command.doctype)}/import-template.csv`
    });
    return formatResourceCsvDownload(
      command.url,
      "Downloaded resource CSV import template",
      command.doctype,
      downloaded.output,
      downloaded.bytes,
      downloaded.response
    );
  }
  if (command.action === "import") {
    const csv = await uploadCsvBody(command, io.cwd);
    const query = queryParams({
      ...(command.importMode === undefined ? {} : { mode: command.importMode }),
      ...(command.maxRows === undefined ? {} : { max_rows: String(command.maxRows) })
    });
    const data = await requestRemoteResource<DocumentImportResponse>(command, io, {
      contentType: "text/csv",
      method: "POST",
      path: `/api/resource/${encodeURIComponent(command.doctype)}/import.csv`,
      rawBody: csv,
      ...(query === undefined ? {} : { query })
    });
    return formatResourceImport(command.url, data);
  }
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
  if (command.action === "duplicate" || command.action === "amend") {
    const data = await requestRemoteResource<DocumentSnapshotResponse>(command, io, {
      body: cloneBody(command),
      method: "POST",
      path: `/api/resource/${encodeURIComponent(command.doctype)}/${encodeURIComponent(requiredResourceName(command, command.action))}/${command.action}`
    });
    return formatResourceDetail(
      command.url,
      command.doctype,
      command.action === "duplicate" ? "Duplicated resource" : "Amended resource",
      data
    );
  }
  if (command.action === "submit" || command.action === "cancel") {
    const data = await requestRemoteResource<DocumentSnapshotResponse>(command, io, {
      body: versionBody(command),
      method: "POST",
      path: `/api/resource/${encodeURIComponent(command.doctype)}/${encodeURIComponent(requiredResourceName(command, command.action))}/${command.action}`
    });
    return formatResourceDetail(
      command.url,
      command.doctype,
      command.action === "submit" ? "Submitted resource" : "Cancelled resource",
      data
    );
  }
  if (command.action === "transition") {
    const transition = requiredResourceTransition(command);
    const data = await requestRemoteResource<DocumentSnapshotResponse>(command, io, {
      body: versionBody(command),
      method: "POST",
      path: `/api/resource/${encodeURIComponent(command.doctype)}/${encodeURIComponent(requiredResourceName(command, "transition"))}/transition/${encodeURIComponent(transition)}`
    });
    return formatResourceDetail(command.url, command.doctype, "Transitioned resource", data);
  }
  if (command.action === "command") {
    const commandName = requiredResourceCommand(command);
    const data = await requestRemoteResource<DocumentSnapshotResponse>(command, io, {
      body: commandBody(command),
      method: "POST",
      path: `/api/resource/${encodeURIComponent(command.doctype)}/${encodeURIComponent(requiredResourceName(command, "command"))}/command/${encodeURIComponent(commandName)}`
    });
    return formatResourceDetail(command.url, command.doctype, "Executed resource command", data);
  }
  if (command.action === "bulk-delete" || command.action === "bulk-submit" || command.action === "bulk-cancel") {
    const data = await requestRemoteResource<BulkResourceCommandResponse>(command, io, {
      body: bulkBody(command),
      method: "POST",
      path: bulkResourcePath(command)
    });
    return formatBulkResourceCommand(command.url, bulkResourceTitle(command.action), data);
  }
  if (command.action === "bulk-transition") {
    const data = await requestRemoteResource<BulkResourceCommandResponse>(command, io, {
      body: bulkBody(command),
      method: "POST",
      path: `/api/resource/${encodeURIComponent(command.doctype)}/bulk-transition/${encodeURIComponent(requiredResourceTransition(command))}`
    });
    return formatBulkResourceCommand(command.url, "Transitioned resources", data);
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
  io: ResourceRemoteIo,
  request: {
    readonly body?: Record<string, unknown>;
    readonly rawBody?: BodyInit;
    readonly contentType?: string;
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
  io: ResourceRemoteIo,
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

function requestRemoteResourceResponse(
  command: ResourceRemoteCommand,
  io: ResourceRemoteIo,
  request: {
    readonly method: "DELETE" | "GET";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<Response> {
  return requestRemoteAdminResponse<ResourceRemoteError>(command, io, request, {
    accept: "*/*",
    error: ResourceRemoteError,
    fetchLabel: "remote resource commands",
    resourceLabel: "Remote resource",
    urlLabel: "Remote resource"
  });
}

async function downloadRemoteResourceCsv(
  command: ResourceRemoteCommand,
  io: ResourceRemoteIo,
  action: string,
  request: {
    readonly method: "GET";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<{ readonly output: string; readonly bytes: number; readonly response: Response }> {
  const output = downloadOutputPath(command, io.cwd, action);
  const response = await requestRemoteResourceResponse(command, io, request);
  const bytes = new Uint8Array(await response.arrayBuffer());
  try {
    await writeFile(output, bytes);
  } catch (error) {
    throw new ResourceRemoteError(`Could not write resource ${action} CSV '${command.outputPath}': ${errorMessage(error)}`);
  }
  return { output, bytes: bytes.byteLength, response };
}

function listQuery(command: ResourceRemoteCommand): URLSearchParams | undefined {
  const params = new URLSearchParams();
  for (const filter of command.filters ?? []) {
    appendFilterParam(params, filter);
  }
  if (command.filterExpression !== undefined) {
    params.set("filter_expression", JSON.stringify(command.filterExpression));
  }
  if (command.savedFilter !== undefined) {
    params.set("saved_filter", command.savedFilter);
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

function queryParams(values: Record<string, string>): URLSearchParams | undefined {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    params.set(key, value);
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

async function uploadCsvBody(command: ResourceRemoteCommand, cwd = process.cwd()): Promise<string> {
  if (command.path === undefined) {
    throw new ResourceRemoteError("Resource import requires --path");
  }
  try {
    return await readFile(resolve(cwd, command.path), "utf8");
  } catch (error) {
    throw new ResourceRemoteError(`Could not read resource import CSV '${command.path}': ${errorMessage(error)}`);
  }
}

function downloadOutputPath(command: ResourceRemoteCommand, cwd = process.cwd(), action = "download"): string {
  if (command.outputPath === undefined) {
    throw new ResourceRemoteError(`Resource ${action} requires --output`);
  }
  return resolve(cwd, command.outputPath);
}

function mutationBody(command: ResourceRemoteCommand): Record<string, unknown> {
  const body = { ...requiredResourceData(command, "update") };
  if (command.expectedVersion !== undefined) {
    body.expectedVersion = command.expectedVersion;
  }
  return body;
}

function versionBody(command: ResourceRemoteCommand): Record<string, unknown> {
  return command.expectedVersion === undefined ? {} : { expectedVersion: command.expectedVersion };
}

function commandBody(command: ResourceRemoteCommand): Record<string, unknown> {
  return {
    ...(command.data ?? {}),
    ...versionBody(command)
  };
}

function shareBody(command: ResourceRemoteCommand): Record<string, unknown> {
  return {
    userId: requiredResourceShareUserId(command),
    ...(command.permissions === undefined ? {} : { permissions: command.permissions }),
    ...versionBody(command)
  };
}

function cloneBody(command: ResourceRemoteCommand): Record<string, unknown> {
  return {
    ...(command.data === undefined ? {} : { data: command.data }),
    ...(command.newName === undefined ? {} : { newName: command.newName }),
    ...versionBody(command)
  };
}

function savedFilterBody(command: ResourceRemoteCommand, metadata: DocTypeMetadataResponse): Record<string, unknown> {
  return {
    label: requiredResourceFilterLabel(command),
    filters: savedFilterInputFilters(command.filters ?? [], metadataFields(metadata)),
    ...(command.filterExpression === undefined ? {} : { filterExpression: command.filterExpression })
  };
}

function savedFilterInputFilters(
  filters: readonly ResourceRemoteFilter[],
  fields: ReadonlySet<string>
): readonly Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  const arrayFilters = new Map<string, { readonly field: string; readonly operator: ListFilterArrayOperator; readonly values: string[] }>();
  for (const filter of filters) {
    const parsed = parseSavedFilterKey(filter.key, fields);
    if (isListFilterArrayOperator(parsed.operator)) {
      const existing = arrayFilters.get(filter.key);
      if (existing !== undefined) {
        existing.values.push(filter.value);
        continue;
      }
      const pending = { field: parsed.field, operator: parsed.operator, values: [filter.value] };
      arrayFilters.set(filter.key, pending);
      result.push({ field: pending.field, operator: pending.operator, value: pending.values });
      continue;
    }
    result.push({
      field: parsed.field,
      ...(parsed.operator === "eq" ? {} : { operator: parsed.operator }),
      value: filter.value
    });
  }
  return result;
}

type ListFilterOperator =
  | "eq"
  | "ne"
  | "contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is"
  | "like"
  | "not_like"
  | "in"
  | "not_in"
  | "between"
  | "not_between";

type ListFilterArrayOperator = "in" | "not_in" | "between" | "not_between";

const LIST_FILTER_OPERATORS: readonly ListFilterOperator[] = [
  "eq",
  "ne",
  "contains",
  "gt",
  "gte",
  "lt",
  "lte",
  "is",
  "like",
  "not_like",
  "in",
  "not_in",
  "between",
  "not_between"
];

function metadataFields(metadata: DocTypeMetadataResponse): ReadonlySet<string> {
  return new Set((metadata.fields ?? []).flatMap((field) => typeof field.name === "string" ? [field.name] : []));
}

function parseSavedFilterKey(
  key: string,
  fields: ReadonlySet<string>
): { readonly field: string; readonly operator: ListFilterOperator } {
  if (fields.has(key)) {
    return { field: key, operator: "eq" };
  }
  if (key.endsWith("__eq")) {
    return { field: key.slice(0, -"__eq".length), operator: "eq" };
  }
  for (const operator of LIST_FILTER_OPERATORS.filter((item) => item !== "eq")) {
    const suffix = `__${operator}`;
    if (key.endsWith(suffix)) {
      return { field: key.slice(0, -suffix.length), operator };
    }
  }
  return { field: key, operator: "eq" };
}

function isListFilterArrayOperator(operator: ListFilterOperator): operator is ListFilterArrayOperator {
  return operator === "in" || operator === "not_in" || operator === "between" || operator === "not_between";
}

function bulkBody(command: ResourceRemoteCommand): Record<string, unknown> {
  return { documents: command.documents ?? [] };
}

function bulkResourcePath(command: ResourceRemoteCommand): string {
  const base = `/api/resource/${encodeURIComponent(command.doctype)}`;
  if (command.action === "bulk-delete") {
    return `${base}/delete`;
  }
  if (command.action === "bulk-submit") {
    return `${base}/bulk-submit`;
  }
  return `${base}/bulk-cancel`;
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

function formatBulkResourceCommand(
  baseUrl: string,
  title: string,
  result: BulkResourceCommandResponse
): string {
  const succeeded = result.succeeded ?? result.deleted ?? [];
  return [
    `${title} at ${baseUrl}`,
    `Succeeded: ${String(succeeded.length)}`,
    ...succeeded.map((item) => resourceLine(item.snapshot)),
    `Failed: ${String(result.failed.length)}`,
    ...result.failed.map(failureLine),
    ""
  ].join("\n");
}

function formatDocumentShares(
  baseUrl: string,
  doctype: string,
  name: string,
  state: DocumentShareStateResponse
): string {
  const grants = state.grants ?? [];
  return [
    `Resource shares ${doctype}/${name} at ${baseUrl}`,
    `Version: ${String(state.version ?? 0)} Total: ${String(grants.length)}`,
    ...documentShareGrantLines(grants),
    ""
  ].join("\n");
}

function formatSavedFilters(
  baseUrl: string,
  doctype: string,
  filters: readonly SavedFilterResponse[]
): string {
  return [
    `Saved resource filters ${doctype} at ${baseUrl}`,
    `Total: ${String(filters.length)}`,
    ...savedFilterLines(filters),
    ""
  ].join("\n");
}

function formatSavedFilter(
  baseUrl: string,
  doctype: string,
  title: string,
  filter: SavedFilterResponse
): string {
  return [
    `${title} ${doctype} at ${baseUrl}`,
    savedFilterLine(filter),
    JSON.stringify(filter),
    ""
  ].join("\n");
}

function formatDeletedSavedFilter(baseUrl: string, doctype: string, filterId: string): string {
  return [
    `Deleted resource filter ${doctype} at ${baseUrl}`,
    `- ${filterId}`,
    ""
  ].join("\n");
}

function formatResourceCsvDownload(
  baseUrl: string,
  title: string,
  doctype: string,
  outputPath: string,
  bytes: number,
  response: Response
): string {
  const contentType = response.headers.get("content-type");
  return [
    `${title} from ${baseUrl}`,
    `- ${doctype} -> ${outputPath} bytes ${String(bytes)}${contentType === null ? "" : ` type ${contentType}`}`,
    ""
  ].join("\n");
}

function formatResourceImport(baseUrl: string, result: DocumentImportResponse): string {
  const succeeded = result.succeeded ?? [];
  const failed = result.failed ?? [];
  return [
    `Imported resource CSV at ${baseUrl}`,
    `DocType: ${result.doctype ?? "(unknown)"} Mode: ${result.mode ?? "create"} Total: ${String(result.total ?? succeeded.length + failed.length)}`,
    `Succeeded: ${String(succeeded.length)}`,
    ...succeeded.map(importSuccessLine),
    `Failed: ${String(failed.length)}`,
    ...failed.map(importFailureLine),
    ""
  ].join("\n");
}

function importSuccessLine(success: DocumentImportSuccessResponse): string {
  return `- row ${String(success.row)} ${success.action} ${success.name}`;
}

function importFailureLine(failure: DocumentImportFailureResponse): string {
  const name = failure.name === undefined ? "" : ` ${failure.name}`;
  const code = failure.code === undefined ? "UNKNOWN" : failure.code;
  const status = failure.status === undefined ? "" : ` status ${String(failure.status)}`;
  const message = failure.message === undefined ? "Resource import failed" : failure.message;
  return `- row ${String(failure.row)} ${failure.action}${name} failed ${code}${status}: ${message}`;
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

function failureLine(failure: BulkResourceFailureResponse): string {
  const status = failure.status === undefined ? "" : ` status ${String(failure.status)}`;
  const code = failure.code === undefined ? "UNKNOWN" : failure.code;
  const message = failure.message === undefined ? "Resource operation failed" : failure.message;
  return `- ${failure.name} failed ${code}${status}: ${message}`;
}

function documentShareGrantLines(grants: readonly DocumentShareGrantResponse[]): readonly string[] {
  if (grants.length === 0) {
    return ["- (none)"];
  }
  return grants.map((grant) => `- ${grant.userId}: ${grant.permissions.join(", ")}`);
}

function savedFilterLines(filters: readonly SavedFilterResponse[]): readonly string[] {
  if (filters.length === 0) {
    return ["- (none)"];
  }
  return filters.flatMap((filter) => [savedFilterLine(filter), JSON.stringify(filter)]);
}

function savedFilterLine(filter: SavedFilterResponse): string {
  const owner = filter.ownerId === undefined ? "" : ` owner ${filter.ownerId}`;
  const updated = filter.updatedAt === undefined ? "" : ` updated ${filter.updatedAt}`;
  return `- ${filter.id} ${filter.label}${owner}${updated}`;
}

function requiredResourceTransition(command: ResourceRemoteCommand): string {
  if (command.transition === undefined) {
    throw new ResourceRemoteError(`Resource ${command.action} requires --transition`);
  }
  return command.transition;
}

function requiredResourceCommand(command: ResourceRemoteCommand): string {
  if (command.command === undefined) {
    throw new ResourceRemoteError("Resource command requires --command");
  }
  return command.command;
}

function requiredResourceShareUserId(command: ResourceRemoteCommand): string {
  if (command.userId === undefined) {
    throw new ResourceRemoteError(`Resource ${command.action} requires --user-id`);
  }
  return command.userId;
}

function requiredResourceFilterId(command: ResourceRemoteCommand): string {
  if (command.filterId === undefined) {
    throw new ResourceRemoteError(`Resource ${command.action} requires --filter-id`);
  }
  return command.filterId;
}

function requiredResourceFilterLabel(command: ResourceRemoteCommand): string {
  if (command.label === undefined) {
    throw new ResourceRemoteError("Resource save-filter requires --label");
  }
  return command.label;
}

function bulkResourceTitle(action: ResourceRemoteAction): string {
  if (action === "bulk-delete") {
    return "Deleted resources";
  }
  if (action === "bulk-submit") {
    return "Submitted resources";
  }
  return "Cancelled resources";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
