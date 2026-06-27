import { requestRemoteAdminPayload, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type DocTypeRemoteAction = "get" | "list" | "list-view";

export type DocTypeHeaderOption = RemoteHeaderOption;

export interface DocTypeRemoteCommand {
  readonly kind: "doctypes";
  readonly action: DocTypeRemoteAction;
  readonly url: string;
  readonly headers: readonly DocTypeHeaderOption[];
  readonly doctype?: string;
}

export type DocTypeRemoteIo = RemoteAdminIo;

export class DocTypeRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocTypeRemoteError";
  }
}

interface DocTypeResponse {
  readonly name?: string;
  readonly label?: string;
  readonly module?: string;
  readonly version?: number;
  readonly description?: string;
  readonly fields?: unknown;
  readonly permissions?: unknown;
  readonly commands?: unknown;
  readonly indexes?: unknown;
  readonly workflow?: unknown;
}

interface FieldResponse {
  readonly name?: string;
  readonly label?: string;
  readonly description?: string;
  readonly type?: string;
  readonly required?: boolean;
  readonly mandatoryDependsOn?: unknown;
  readonly readOnly?: boolean;
  readonly readOnlyDependsOn?: unknown;
  readonly hidden?: boolean;
  readonly hiddenDependsOn?: unknown;
  readonly printHide?: boolean;
  readonly printHideIfNoValue?: boolean;
  readonly unique?: boolean;
  readonly noCopy?: boolean;
  readonly allowOnSubmit?: boolean;
  readonly fetchFrom?: string;
  readonly fetchIfEmpty?: boolean;
  readonly inListView?: boolean;
  readonly inListFilter?: boolean;
  readonly inGlobalSearch?: boolean;
  readonly linkTo?: string;
  readonly tableOf?: string;
}

interface ListViewResponse {
  readonly columns?: unknown;
  readonly filterFields?: unknown;
  readonly filterBuilderFields?: unknown;
  readonly filterControls?: unknown;
  readonly filters?: unknown;
  readonly orderBy?: string;
  readonly order?: string;
  readonly orderOptions?: unknown;
  readonly pageSize?: number;
}

interface RemoteDataPayload {
  readonly data?: unknown;
}

export async function runRemoteDocTypeCommand(
  command: DocTypeRemoteCommand,
  io: DocTypeRemoteIo = {}
): Promise<string> {
  if (command.action === "list") {
    const data = await requestRemoteDocTypes(command, io, {
      method: "GET",
      path: "/api/meta/doctypes"
    });
    return formatDocTypeList(command.url, arrayData<DocTypeResponse>(data.data, "doctypes"));
  }
  if (command.action === "list-view") {
    const data = await requestRemoteDocTypes(command, io, {
      method: "GET",
      path: `/api/meta/doctypes/${encodeURIComponent(requiredDocType(command))}/list-view`
    });
    return formatListView(command.url, requiredDocType(command), objectData<ListViewResponse>(data.data, "doctype list view"));
  }
  const data = await requestRemoteDocTypes(command, io, {
    method: "GET",
    path: `/api/meta/doctypes/${encodeURIComponent(requiredDocType(command))}`
  });
  return formatDocType(command.url, objectData<DocTypeResponse>(data.data, "doctype"));
}

function requestRemoteDocTypes(
  command: DocTypeRemoteCommand,
  io: DocTypeRemoteIo,
  request: {
    readonly method: "GET";
    readonly path: string;
  }
): Promise<RemoteDataPayload> {
  return requestRemoteAdminPayload<RemoteDataPayload, DocTypeRemoteError>(command, io, request, {
    error: DocTypeRemoteError,
    fetchLabel: "remote doctype commands",
    resourceLabel: "Remote doctypes",
    urlLabel: "Remote doctypes"
  });
}

function formatDocTypeList(baseUrl: string, doctypes: readonly DocTypeResponse[]): string {
  return [
    `DocTypes at ${baseUrl}`,
    `Total: ${String(doctypes.length)}`,
    ...doctypeLines(doctypes),
    ""
  ].join("\n");
}

function formatDocType(baseUrl: string, doctype: DocTypeResponse): string {
  const fields = fieldArray(doctype.fields, "doctype fields");
  return [
    `DocType at ${baseUrl}`,
    doctypeLine(doctype),
    ...(doctype.module === undefined ? [] : [`Module: ${doctype.module}`]),
    ...(doctype.description === undefined ? [] : [`Description: ${doctype.description}`]),
    `Fields: ${String(fields.length)}`,
    ...fieldLines(fields),
    `Permissions: ${String(countArray(doctype.permissions, "doctype permissions"))}`,
    `Commands: ${String(countArray(doctype.commands, "doctype commands"))}`,
    `Indexes: ${String(countArray(doctype.indexes, "doctype indexes"))}`,
    `Workflow: ${doctype.workflow === undefined ? "no" : "yes"}`,
    ""
  ].join("\n");
}

function formatListView(baseUrl: string, doctype: string, listView: ListViewResponse): string {
  const columns = fieldArray(listView.columns, "list-view columns");
  const filterFields = fieldArray(listView.filterFields, "list-view filter fields");
  return [
    `DocType list view at ${baseUrl}`,
    `${doctype} order=${listView.orderBy ?? ""} ${listView.order ?? ""} pageSize=${String(listView.pageSize ?? "")}`,
    `Columns: ${String(columns.length)}`,
    ...fieldLines(columns),
    `Filters: ${String(filterFields.length)}`,
    `Filter controls: ${String(countArray(listView.filterControls, "list-view filter controls"))}`,
    `Filter builder fields: ${String(countArray(listView.filterBuilderFields, "list-view filter builder fields"))}`,
    `Default filters: ${String(countArray(listView.filters, "list-view default filters"))}`,
    `Order options: ${String(countArray(listView.orderOptions, "list-view order options"))}`,
    ""
  ].join("\n");
}

function doctypeLines(doctypes: readonly DocTypeResponse[]): readonly string[] {
  if (doctypes.length === 0) {
    return ["- (none)"];
  }
  return doctypes.map(doctypeLine);
}

function doctypeLine(doctype: DocTypeResponse): string {
  const label = doctype.label === undefined ? "" : ` - ${doctype.label}`;
  const version = doctype.version === undefined ? "" : ` v${String(doctype.version)}`;
  return `- ${doctype.name ?? "(unknown)"} fields=${String(fieldArray(doctype.fields, "doctype fields").length)}${version}${label}`;
}

function fieldLines(fields: readonly FieldResponse[]): readonly string[] {
  if (fields.length === 0) {
    return ["- (none)"];
  }
  return fields.map(fieldLine);
}

function fieldLine(field: FieldResponse): string {
  const target = field.linkTo ?? field.tableOf;
  const targetText = target === undefined ? "" : ` -> ${target}`;
  const flags = fieldFlags(field);
  const flagText = flags.length === 0 ? "" : ` [${flags.join(",")}]`;
  const label = field.label === undefined ? "" : ` - ${field.label}`;
  const description = field.description === undefined ? "" : ` help "${field.description}"`;
  return `- ${field.name ?? "(unknown)"} ${field.type ?? "unknown"}${targetText}${flagText}${label}${description}`;
}

function fieldFlags(field: FieldResponse): readonly string[] {
  return [
    ...(field.required ? ["required"] : []),
    ...(field.mandatoryDependsOn ? ["mandatoryDependsOn"] : []),
    ...(field.readOnly ? ["readOnly"] : []),
    ...(field.readOnlyDependsOn ? ["readOnlyDependsOn"] : []),
    ...(field.hidden ? ["hidden"] : []),
    ...(field.hiddenDependsOn ? ["hiddenDependsOn"] : []),
    ...(field.printHide ? ["printHide"] : []),
    ...(field.printHideIfNoValue ? ["printHideIfNoValue"] : []),
    ...(field.unique ? ["unique"] : []),
    ...(field.noCopy ? ["noCopy"] : []),
    ...(field.allowOnSubmit ? ["allowOnSubmit"] : []),
    ...(field.fetchFrom ? [`fetchFrom=${field.fetchFrom}`] : []),
    ...(field.fetchIfEmpty ? ["fetchIfEmpty"] : []),
    ...(field.inListView ? ["list"] : []),
    ...(field.inListFilter ? ["filter"] : []),
    ...(field.inGlobalSearch ? ["search"] : [])
  ];
}

function fieldArray(data: unknown, label: string): readonly FieldResponse[] {
  if (data === undefined) {
    return [];
  }
  if (!Array.isArray(data)) {
    throw new DocTypeRemoteError(`Remote ${label} response did not include an array`);
  }
  if (!data.every(isRecord)) {
    throw new DocTypeRemoteError(`Remote ${label} response included a malformed field`);
  }
  return data as readonly FieldResponse[];
}

function countArray(data: unknown, label: string): number {
  if (data === undefined) {
    return 0;
  }
  if (!Array.isArray(data)) {
    throw new DocTypeRemoteError(`Remote ${label} response did not include an array`);
  }
  return data.length;
}

function arrayData<T>(data: unknown, label: string): readonly T[] {
  if (Array.isArray(data)) {
    return data as readonly T[];
  }
  throw new DocTypeRemoteError(`Remote ${label} response did not include a data array`);
}

function objectData<T>(data: unknown, label: string): T {
  if (isRecord(data)) {
    return data as T;
  }
  throw new DocTypeRemoteError(`Remote ${label} response did not include a data object`);
}

function requiredDocType(command: DocTypeRemoteCommand): string {
  if (command.doctype === undefined) {
    throw new DocTypeRemoteError(`DocType ${command.action} requires --doctype`);
  }
  return command.doctype;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
