import { requestRemoteAdmin, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type FieldPropertyRemoteAction = "clear" | "list" | "save";

export type FieldPropertyHeaderOption = RemoteHeaderOption;

export interface FieldPropertyRemoteCommand {
  readonly kind: "field-properties";
  readonly action: FieldPropertyRemoteAction;
  readonly url: string;
  readonly headers: readonly FieldPropertyHeaderOption[];
  readonly doctype: string;
  readonly tenant?: string;
  readonly fieldName?: string;
  readonly overrides?: Record<string, unknown>;
  readonly expectedVersion?: number;
}

export type FieldPropertyRemoteIo = RemoteAdminIo;

export class FieldPropertyRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FieldPropertyRemoteError";
  }
}

interface FieldPropertyStateResponse {
  readonly tenantId?: string;
  readonly doctype?: string;
  readonly version?: number;
  readonly fields?: readonly FieldPropertyEntryResponse[];
}

interface FieldPropertyEntryResponse {
  readonly fieldName: string;
  readonly overrides?: Record<string, unknown>;
  readonly createdAt?: string;
  readonly updatedAt?: string;
}

export async function runRemoteFieldPropertyCommand(
  command: FieldPropertyRemoteCommand,
  io: FieldPropertyRemoteIo = {}
): Promise<string> {
  const query = tenantQuery(command);
  if (command.action === "list") {
    const data = await requestRemoteFieldProperty(command, io, {
      method: "GET",
      path: fieldPropertiesPath(command),
      ...(query === undefined ? {} : { query })
    });
    return formatFieldProperties(command.url, data);
  }
  if (command.action === "clear") {
    const data = await requestRemoteFieldProperty(command, io, {
      ...(command.expectedVersion === undefined ? {} : { body: mutationBody(command) }),
      method: "DELETE",
      path: fieldPropertyPath(command),
      ...(query === undefined ? {} : { query })
    });
    return formatFieldProperties(command.url, data, "Cleared field property override");
  }
  const data = await requestRemoteFieldProperty(command, io, {
    body: saveBody(command),
    method: "PUT",
    path: fieldPropertyPath(command),
    ...(query === undefined ? {} : { query })
  });
  return formatFieldProperties(command.url, data, "Saved field property override");
}

function requestRemoteFieldProperty(
  command: FieldPropertyRemoteCommand,
  io: FieldPropertyRemoteIo,
  request: {
    readonly body?: Record<string, unknown>;
    readonly method: "DELETE" | "GET" | "PUT";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<FieldPropertyStateResponse> {
  return requestRemoteAdmin<FieldPropertyStateResponse, FieldPropertyRemoteError>(command, io, request, {
    error: FieldPropertyRemoteError,
    fetchLabel: "remote field-property commands",
    resourceLabel: "Remote field properties",
    urlLabel: "Remote field properties"
  });
}

function fieldPropertiesPath(command: FieldPropertyRemoteCommand): string {
  return `/api/field-properties/${encodeURIComponent(command.doctype)}`;
}

function fieldPropertyPath(command: FieldPropertyRemoteCommand): string {
  return `${fieldPropertiesPath(command)}/${encodeURIComponent(requiredFieldName(command))}`;
}

function tenantQuery(command: FieldPropertyRemoteCommand): URLSearchParams | undefined {
  if (command.tenant === undefined) {
    return undefined;
  }
  const params = new URLSearchParams();
  params.set("tenant", command.tenant);
  return params;
}

function saveBody(command: FieldPropertyRemoteCommand): Record<string, unknown> {
  return {
    overrides: requiredOverrides(command),
    ...mutationBody(command)
  };
}

function mutationBody(command: FieldPropertyRemoteCommand): Record<string, unknown> {
  return {
    ...(command.expectedVersion === undefined ? {} : { expectedVersion: command.expectedVersion })
  };
}

function formatFieldProperties(
  baseUrl: string,
  state: FieldPropertyStateResponse,
  title = "Field property overrides"
): string {
  const fields = state.fields ?? [];
  return [
    `${title} at ${baseUrl}`,
    `DocType: ${state.doctype ?? "(unknown)"} Tenant: ${state.tenantId ?? "(unknown)"} Version: ${String(state.version ?? 0)} Total: ${String(fields.length)}`,
    ...fieldLines(fields),
    ""
  ].join("\n");
}

function fieldLines(fields: readonly FieldPropertyEntryResponse[]): readonly string[] {
  if (fields.length === 0) {
    return ["- (none)"];
  }
  return fields.flatMap((entry) => [fieldLine(entry), JSON.stringify(entry.overrides ?? {})]);
}

function fieldLine(entry: FieldPropertyEntryResponse): string {
  const keys = Object.keys(entry.overrides ?? {});
  const summary = keys.length === 0 ? "(none)" : keys.join(", ");
  return `- ${entry.fieldName} overrides ${summary}`;
}

function requiredOverrides(command: FieldPropertyRemoteCommand): Record<string, unknown> {
  if (command.overrides === undefined) {
    throw new FieldPropertyRemoteError("Field property save requires --overrides-json");
  }
  return command.overrides;
}

function requiredFieldName(command: FieldPropertyRemoteCommand): string {
  if (command.fieldName === undefined) {
    throw new FieldPropertyRemoteError(`Field property ${command.action} requires --field`);
  }
  return command.fieldName;
}
