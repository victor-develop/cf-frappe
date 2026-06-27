import { requestRemoteAdminPayload, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type WebFormRemoteAction = "get" | "list" | "submit";

export type WebFormHeaderOption = RemoteHeaderOption;

export interface WebFormRemoteCommand {
  readonly kind: "web-forms";
  readonly action: WebFormRemoteAction;
  readonly url: string;
  readonly headers: readonly WebFormHeaderOption[];
  readonly webForm?: string;
  readonly data?: Record<string, unknown>;
}

export type WebFormRemoteIo = RemoteAdminIo;

export class WebFormRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebFormRemoteError";
  }
}

interface WebFormResponse {
  readonly name?: string;
  readonly label?: string;
  readonly module?: string;
  readonly description?: string;
  readonly route?: string;
  readonly doctype?: string;
  readonly fields?: readonly WebFormFieldResponse[];
  readonly successUrl?: string;
}

interface WebFormMetadataResponse {
  readonly form?: WebFormResponse;
  readonly doctype?: string;
  readonly fields?: readonly WebFormFieldResponse[];
}

interface WebFormFieldResponse {
  readonly field?: string;
  readonly label?: string;
  readonly type?: string;
  readonly required?: boolean;
}

interface WebFormSubmitResponse {
  readonly form?: WebFormResponse;
  readonly document?: {
    readonly doctype?: string;
    readonly name?: string;
    readonly version?: number;
  };
}

interface RemoteDataPayload {
  readonly data?: unknown;
}

export async function runRemoteWebFormCommand(
  command: WebFormRemoteCommand,
  io: WebFormRemoteIo = {}
): Promise<string> {
  if (command.action === "list") {
    const data = await requestRemoteWebForm(command, io, {
      method: "GET",
      path: "/api/meta/web-forms"
    });
    return formatWebFormList(command.url, arrayData<WebFormResponse>(data.data, "web forms"));
  }
  if (command.action === "get") {
    const data = await requestRemoteWebForm(command, io, {
      method: "GET",
      path: `/api/meta/web-forms/${encodeURIComponent(requiredWebForm(command))}`
    });
    return formatWebFormMetadata(command.url, objectData<WebFormMetadataResponse>(data.data, "web form"));
  }
  const data = await requestRemoteWebForm(command, io, {
    method: "POST",
    path: `/api/web-form/${encodeURIComponent(requiredWebForm(command))}/submit`,
    body: { data: command.data ?? {} }
  });
  return formatWebFormSubmit(command.url, objectData<WebFormSubmitResponse>(data.data, "web form submit"));
}

function requestRemoteWebForm(
  command: WebFormRemoteCommand,
  io: WebFormRemoteIo,
  request: {
    readonly method: "GET" | "POST";
    readonly path: string;
    readonly body?: Record<string, unknown>;
  }
): Promise<RemoteDataPayload> {
  return requestRemoteAdminPayload<RemoteDataPayload, WebFormRemoteError>(command, io, request, {
    error: WebFormRemoteError,
    fetchLabel: "remote web form commands",
    resourceLabel: "Remote web forms",
    urlLabel: "Remote web forms"
  });
}

function formatWebFormList(baseUrl: string, forms: readonly WebFormResponse[]): string {
  return [
    `Web forms at ${baseUrl}`,
    `Total: ${String(forms.length)}`,
    ...(forms.length === 0 ? ["- (none)"] : forms.map(webFormLine)),
    ""
  ].join("\n");
}

function formatWebFormMetadata(baseUrl: string, metadata: WebFormMetadataResponse): string {
  const form = metadata.form ?? {};
  const fields = metadata.fields ?? form.fields ?? [];
  const doctype = metadata.doctype ?? form.doctype;
  return [
    `Web form at ${baseUrl}`,
    webFormLine({ ...form, ...(doctype === undefined ? {} : { doctype }) }),
    ...(form.description === undefined ? [] : [`Description: ${form.description}`]),
    ...fields.map(webFormFieldLine),
    ""
  ].join("\n");
}

function formatWebFormSubmit(baseUrl: string, result: WebFormSubmitResponse): string {
  const form = result.form ?? {};
  const document = result.document ?? {};
  return [
    `Web form submit at ${baseUrl}`,
    webFormLine(form),
    `Created: ${document.doctype ?? "(unknown)"}/${document.name ?? "(unknown)"} v${String(document.version ?? "?")}`,
    ""
  ].join("\n");
}

function webFormLine(form: WebFormResponse): string {
  const label = form.label === undefined ? "" : ` - ${form.label}`;
  const route = form.route === undefined ? "" : ` route:${form.route}`;
  const successUrl = form.successUrl === undefined ? "" : ` success:${form.successUrl}`;
  return `- ${form.name ?? "(unknown)"} ${form.doctype ?? "(unknown)"}${label}${route}${successUrl}`;
}

function webFormFieldLine(field: WebFormFieldResponse): string {
  return `  - ${field.field ?? "(unknown)"} ${field.type ?? "(unknown)"}${field.required ? " required" : ""}${field.label === undefined ? "" : ` - ${field.label}`}`;
}

function arrayData<T>(data: unknown, label: string): readonly T[] {
  if (Array.isArray(data)) {
    return data as readonly T[];
  }
  throw new WebFormRemoteError(`Remote ${label} response did not include a data array`);
}

function objectData<T>(data: unknown, label: string): T {
  if (isRecord(data)) {
    return data as T;
  }
  throw new WebFormRemoteError(`Remote ${label} response did not include a data object`);
}

function requiredWebForm(command: WebFormRemoteCommand): string {
  if (command.webForm) {
    return command.webForm;
  }
  throw new WebFormRemoteError(`Web form ${command.action} requires --web-form`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
