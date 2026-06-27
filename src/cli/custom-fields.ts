import { requestRemoteAdmin, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type CustomFieldRemoteAction = "disable" | "list" | "save";

export type CustomFieldHeaderOption = RemoteHeaderOption;

export interface CustomFieldRemoteCommand {
  readonly kind: "custom-fields";
  readonly action: CustomFieldRemoteAction;
  readonly url: string;
  readonly headers: readonly CustomFieldHeaderOption[];
  readonly doctype: string;
  readonly tenant?: string;
  readonly fieldName?: string;
  readonly field?: Record<string, unknown>;
  readonly expectedVersion?: number;
}

export type CustomFieldRemoteIo = RemoteAdminIo;

export class CustomFieldRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomFieldRemoteError";
  }
}

interface CustomFieldStateResponse {
  readonly tenantId?: string;
  readonly doctype?: string;
  readonly version?: number;
  readonly fields?: readonly CustomFieldEntryResponse[];
}

interface CustomFieldEntryResponse {
  readonly enabled?: boolean;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly field: CustomFieldResponse;
}

interface CustomFieldResponse {
  readonly name: string;
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
  readonly inFormView?: boolean;
  readonly inListView?: boolean;
  readonly inListFilter?: boolean;
  readonly options?: readonly string[];
  readonly linkTo?: string;
  readonly tableOf?: string;
  readonly min?: number;
  readonly max?: number;
  readonly defaultValue?: unknown;
}

export async function runRemoteCustomFieldCommand(
  command: CustomFieldRemoteCommand,
  io: CustomFieldRemoteIo = {}
): Promise<string> {
  const query = tenantQuery(command);
  if (command.action === "list") {
    const data = await requestRemoteCustomField(command, io, {
      method: "GET",
      path: customFieldsPath(command),
      ...(query === undefined ? {} : { query })
    });
    return formatCustomFields(command.url, data);
  }
  if (command.action === "disable") {
    const data = await requestRemoteCustomField(command, io, {
      ...(command.expectedVersion === undefined ? {} : { body: mutationBody(command) }),
      method: "DELETE",
      path: customFieldPath(command),
      ...(query === undefined ? {} : { query })
    });
    return formatCustomFields(command.url, data, "Disabled custom field");
  }
  const data = await requestRemoteCustomField(command, io, {
    body: saveBody(command),
    method: "POST",
    path: customFieldsPath(command),
    ...(query === undefined ? {} : { query })
  });
  return formatCustomFields(command.url, data, "Saved custom field");
}

function requestRemoteCustomField(
  command: CustomFieldRemoteCommand,
  io: CustomFieldRemoteIo,
  request: {
    readonly body?: Record<string, unknown>;
    readonly method: "DELETE" | "GET" | "POST";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<CustomFieldStateResponse> {
  return requestRemoteAdmin<CustomFieldStateResponse, CustomFieldRemoteError>(command, io, request, {
    error: CustomFieldRemoteError,
    fetchLabel: "remote custom-field commands",
    resourceLabel: "Remote custom fields",
    urlLabel: "Remote custom fields"
  });
}

function customFieldsPath(command: CustomFieldRemoteCommand): string {
  return `/api/custom-fields/${encodeURIComponent(command.doctype)}`;
}

function customFieldPath(command: CustomFieldRemoteCommand): string {
  return `${customFieldsPath(command)}/${encodeURIComponent(requiredFieldName(command))}`;
}

function tenantQuery(command: CustomFieldRemoteCommand): URLSearchParams | undefined {
  if (command.tenant === undefined) {
    return undefined;
  }
  const params = new URLSearchParams();
  params.set("tenant", command.tenant);
  return params;
}

function saveBody(command: CustomFieldRemoteCommand): Record<string, unknown> {
  return {
    field: requiredField(command),
    ...mutationBody(command)
  };
}

function mutationBody(command: CustomFieldRemoteCommand): Record<string, unknown> {
  return {
    ...(command.expectedVersion === undefined ? {} : { expectedVersion: command.expectedVersion })
  };
}

function formatCustomFields(
  baseUrl: string,
  state: CustomFieldStateResponse,
  title = "Custom fields"
): string {
  const fields = state.fields ?? [];
  return [
    `${title} at ${baseUrl}`,
    `DocType: ${state.doctype ?? "(unknown)"} Tenant: ${state.tenantId ?? "(unknown)"} Version: ${String(state.version ?? 0)} Total: ${String(fields.length)}`,
    ...fieldLines(fields),
    ""
  ].join("\n");
}

function fieldLines(fields: readonly CustomFieldEntryResponse[]): readonly string[] {
  if (fields.length === 0) {
    return ["- (none)"];
  }
  return fields.flatMap((entry) => [fieldLine(entry), JSON.stringify(entry.field)]);
}

function fieldLine(entry: CustomFieldEntryResponse): string {
  const field = entry.field;
  const label = field.label === undefined ? "" : ` label "${field.label}"`;
  const description = field.description === undefined ? "" : ` help "${field.description}"`;
  const target = field.linkTo === undefined && field.tableOf === undefined
    ? ""
    : ` target ${field.linkTo ?? field.tableOf ?? ""}`;
  const flags = fieldFlags(field);
  const flagText = flags.length === 0 ? "" : ` [${flags.join(",")}]`;
  return `- ${field.name} ${entry.enabled ?? true ? "enabled" : "disabled"} type ${field.type ?? "(unknown)"}${label}${description}${target}${flagText}`;
}

function fieldFlags(field: CustomFieldResponse): readonly string[] {
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
    ...(field.inFormView ? ["form"] : []),
    ...(field.inListView ? ["list"] : []),
    ...(field.inListFilter ? ["filter"] : [])
  ];
}

function requiredField(command: CustomFieldRemoteCommand): Record<string, unknown> {
  if (command.field === undefined) {
    throw new CustomFieldRemoteError("Custom field save requires --field-json");
  }
  return command.field;
}

function requiredFieldName(command: CustomFieldRemoteCommand): string {
  if (command.fieldName === undefined) {
    throw new CustomFieldRemoteError(`Custom field ${command.action} requires --field`);
  }
  return command.fieldName;
}
