/** Fetch machinery, URL/query helpers and API/desk path builders ported from the legacy client. */

import {
  calendarParams,
  deskNotificationInboxParams,
  fileListParams,
  notificationCommandParams,
  reportRunParams,
  searchParams,
  tenantParams,
  webViewParams,
  type ParamOptions,
  type TenantOptions
} from "./bodies.js";
import {
  deskPath,
  encodePart,
  encodePath,
  filePath,
  resourcePath,
  setParam,
  withQuery,
  type MutableQueryParams,
  type QueryParams,
  type QueryPrimitive
} from "./url.js";

export { deskPath, encodePart, encodePath, filePath, resourcePath, withQuery };
export type { QueryParams };

export interface RequestOptions {
  method?: string;
  headers?: HeadersInit;
  body?: unknown;
  credentials?: RequestCredentials;
  signal?: AbortSignal;
}

export class HttpRequestError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

export function isJsonBody(value: unknown): boolean {
  return (
    value !== undefined &&
    typeof value !== "string" &&
    !(value instanceof FormData) &&
    !(value instanceof URLSearchParams) &&
    !(value instanceof Blob)
  );
}

export function unwrapData(payload: unknown): unknown {
  return payload && Object.prototype.hasOwnProperty.call(payload, "data")
    ? (payload as { data: unknown }).data
    : payload;
}

export function requestInit(options?: RequestOptions): RequestInit {
  const init = options ?? {};
  const headers = new Headers(init.headers ?? {});
  let body = init.body;
  if (isJsonBody(body)) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(body);
  }
  return Object.assign({}, init, {
    body: (body ?? null) as BodyInit | null,
    credentials: init.credentials ?? "same-origin",
    headers
  });
}

export async function readResponsePayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.indexOf("application/json") >= 0 ? await response.json() : await response.text();
}

export function throwResponseError(response: Response, payload: unknown): never {
  const message =
    (payload as { error?: { message?: string } } | undefined)?.error?.message || response.statusText;
  throw new HttpRequestError(message, response.status, payload);
}

export async function request(path: string, options?: RequestOptions): Promise<unknown> {
  const response = await fetch(path, requestInit(options));
  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throwResponseError(response, payload);
  }
  return payload;
}

export async function requestBinary(path: string, options?: RequestOptions): Promise<ArrayBuffer> {
  const response = await fetch(path, requestInit(options));
  if (!response.ok) {
    throwResponseError(response, await readResponsePayload(response));
  }
  return response.arrayBuffer();
}

/* ------------------------------ desk page paths ---------------------------- */

export function deskDashboardPath(dashboard: string): string {
  return `/desk/dashboards/${encodePart(dashboard)}`;
}

export function deskKanbanPath(kanban: string): string {
  return `/desk/kanbans/${encodePart(kanban)}`;
}

export function deskCalendarPath(calendar: string, options?: ParamOptions): string {
  return withQuery(`/desk/calendars/${encodePart(calendar)}`, calendarParams(options ?? {}));
}

export type WebFormUrlInput =
  | string
  | { name?: unknown; route?: unknown; form?: { name?: unknown; route?: unknown } };

export function webFormPublicPath(input: WebFormUrlInput): string {
  if (input && typeof input === "object") {
    const form = input.form && typeof input.form === "object" ? input.form : input;
    if (form.route !== undefined && form.route !== null && String(form.route).trim()) {
      return encodePath(form.route);
    }
    if (form.name !== undefined && form.name !== null) {
      return encodePart(form.name);
    }
  }
  return encodePart(input);
}

export function webFormPagePath(webForm: WebFormUrlInput): string {
  return `/web-forms/${webFormPublicPath(webForm)}`;
}

export function webViewPagePath(webView: string): string {
  return `/web/${encodePart(webView)}`;
}

export function webViewItemPagePath(webView: string, route: string): string {
  return `${webViewPagePath(webView)}/${encodePath(route)}`;
}

export function webPagePath(route: string): string {
  return `/page/${encodePath(route)}`;
}

export function deskAdminUsersPath(options?: ParamOptions): string {
  const params: MutableQueryParams = {};
  setParam(params, "user", (options && (options.userId !== undefined ? options.userId : options.user)) as QueryPrimitive | undefined);
  return withQuery("/desk/admin/users", params);
}

export function deskAdminCustomFieldsPath(doctype?: string): string {
  const params: MutableQueryParams = {};
  setParam(params, "doctype", doctype);
  return withQuery("/desk/admin/custom-fields", params);
}

export function deskAdminFieldPropertiesPath(doctype?: string, field?: string): string {
  const params: MutableQueryParams = {};
  setParam(params, "doctype", doctype);
  setParam(params, "field", field);
  return withQuery("/desk/admin/field-properties", params);
}

export function deskAdminUserPermissionsPath(options?: ParamOptions): string {
  const params: MutableQueryParams = {};
  setParam(params, "user", (options && (options.userId !== undefined ? options.userId : options.user)) as QueryPrimitive | undefined);
  return withQuery("/desk/admin/user-permissions", params);
}

export function deskAdminWorkflowsPath(doctype?: string): string {
  const params: MutableQueryParams = {};
  setParam(params, "doctype", doctype);
  return withQuery("/desk/admin/workflows", params);
}

export function deskAdminAssignmentRulesPath(doctype?: string, rule?: string): string {
  const params: MutableQueryParams = {};
  setParam(params, "doctype", doctype);
  setParam(params, "rule", rule);
  return withQuery("/desk/admin/assignment-rules", params);
}

export function deskFilesPath(options?: ParamOptions): string {
  return withQuery("/desk/files", fileListParams(options ?? {}));
}

export function deskFilePath(name: string, action?: string): string {
  return `/desk/files/${encodePart(name)}${action === undefined ? "" : `/${action}`}`;
}

export function deskNotificationsPath(options?: ParamOptions): string {
  return withQuery("/desk/notifications", deskNotificationInboxParams(options ?? {}));
}

export function deskSearchPath(q: unknown, options?: ParamOptions): string {
  return withQuery("/desk/search", searchParams(q, options ?? {}));
}

export function deskPrintPath(format: string, name: string): string {
  return `/desk/print/${encodePart(format)}/${encodePart(name)}`;
}

export function deskPrintPdfPath(format: string, name: string): string {
  return `${deskPrintPath(format, name)}/pdf`;
}

export function deskReportBuilderPath(doctype: string, id?: string, options?: ParamOptions): string {
  const path = `/desk/report-builder/${encodePart(doctype)}${id === undefined ? "" : `/${encodePart(id)}`}`;
  return withQuery(path, reportRunParams(options ?? {}));
}

export function deskReportBuilderPdfPath(doctype: string, id: string, options?: ParamOptions): string {
  return withQuery(`/desk/report-builder/${encodePart(doctype)}/${encodePart(id)}/pdf`, reportRunParams(options ?? {}));
}

export function deskReportPath(report: string, options?: ParamOptions): string {
  return withQuery(`/desk/reports/${encodePart(report)}`, reportRunParams(options ?? {}));
}

export function deskReportPdfPath(report: string, options?: ParamOptions): string {
  return withQuery(`/desk/reports/${encodePart(report)}/pdf`, reportRunParams(options ?? {}));
}

export function deskWorkspacePath(workspace: string): string {
  return `/desk/workspaces/${encodePart(workspace)}`;
}

/* -------------------------------- API paths -------------------------------- */

export function resourceActionPath(doctype: string, name: string, action: string): string {
  return `${resourcePath(doctype, name)}/${action}`;
}

export function resourceMemberPath(doctype: string, name: string, action: string, member: string): string {
  return `${resourceActionPath(doctype, name, action)}/${encodePart(member)}`;
}

export function profilePath(userId: string, options?: TenantOptions): string {
  return withQuery(`/api/users/${encodePart(userId)}/profile`, tenantParams(options ?? {}));
}

export function accountPath(userId: string, action?: string, options?: TenantOptions): string {
  return withQuery(`/api/users/${encodePart(userId)}${action === undefined ? "" : `/${action}`}`, tenantParams(options ?? {}));
}

export function notificationActionPath(notificationId: string, action: string, options?: ParamOptions): string {
  return withQuery(`/api/notifications/${encodePart(notificationId)}/${action}`, notificationCommandParams(options ?? {}));
}

export function notificationRulePath(doctype: string, rule?: string, options?: TenantOptions): string {
  return withQuery(
    `/api/notification-rules/${encodePart(doctype)}${rule === undefined ? "" : `/${encodePart(rule)}`}`,
    tenantParams(options ?? {})
  );
}

export function assignmentRulePath(doctype: string, rule?: string, options?: TenantOptions): string {
  return withQuery(
    `/api/assignment-rules/${encodePart(doctype)}${rule === undefined ? "" : `/${encodePart(rule)}`}`,
    tenantParams(options ?? {})
  );
}

export function assignmentRuleActionPath(doctype: string, rule: string, action: string, options?: TenantOptions): string {
  return withQuery(`/api/assignment-rules/${encodePart(doctype)}/${encodePart(rule)}/${action}`, tenantParams(options ?? {}));
}

export function rolesPath(options?: TenantOptions): string {
  return withQuery("/api/roles", tenantParams(options ?? {}));
}

export function rolePath(role: string, options?: TenantOptions): string {
  return withQuery(`/api/roles/${encodePart(role)}`, tenantParams(options ?? {}));
}

export function roleActionPath(role: string, action: string, options?: TenantOptions): string {
  return withQuery(`/api/roles/${encodePart(role)}/${action}`, tenantParams(options ?? {}));
}

export function customFieldPath(doctype: string, field?: string, options?: TenantOptions): string {
  return withQuery(
    `/api/custom-fields/${encodePart(doctype)}${field === undefined ? "" : `/${encodePart(field)}`}`,
    tenantParams(options ?? {})
  );
}

export function fieldPropertyPath(doctype: string, field?: string, options?: TenantOptions): string {
  return withQuery(
    `/api/field-properties/${encodePart(doctype)}${field === undefined ? "" : `/${encodePart(field)}`}`,
    tenantParams(options ?? {})
  );
}

export function workflowPath(doctype: string, workflow?: string, options?: TenantOptions): string {
  return withQuery(
    `/api/workflows/${encodePart(doctype)}${workflow === undefined ? "" : `/${encodePart(workflow)}`}`,
    tenantParams(options ?? {})
  );
}

export function userPermissionPath(userId: string, options?: TenantOptions): string {
  return withQuery(`/api/user-permissions/${encodePart(userId)}`, tenantParams(options ?? {}));
}

export function dataPatchPath(patchId?: string, action?: string): string {
  return `/api/data-patches${patchId === undefined ? "" : `/${encodePart(patchId)}`}${action === undefined ? "" : `/${action}`}`;
}

export function dashboardPath(dashboard?: string, action?: string): string {
  return `${dashboard === undefined ? "/api/meta/dashboards" : `/api/dashboard/${encodePart(dashboard)}`}${action === undefined ? "" : `/${action}`}`;
}

export function dashboardMetaPath(dashboard?: string): string {
  return `/api/meta/dashboards${dashboard === undefined ? "" : `/${encodePart(dashboard)}`}`;
}

export function kanbanPath(kanban?: string, action?: string): string {
  return `${kanban === undefined ? "/api/meta/kanbans" : `/api/kanban/${encodePart(kanban)}`}${action === undefined ? "" : `/${action}`}`;
}

export function kanbanMetaPath(kanban?: string): string {
  return `/api/meta/kanbans${kanban === undefined ? "" : `/${encodePart(kanban)}`}`;
}

export function calendarPath(calendar?: string, action?: string, options?: ParamOptions): string {
  return withQuery(
    `${calendar === undefined ? "/api/meta/calendars" : `/api/calendar/${encodePart(calendar)}`}${action === undefined ? "" : `/${action}`}`,
    calendarParams(options ?? {})
  );
}

export function calendarMetaPath(calendar?: string): string {
  return `/api/meta/calendars${calendar === undefined ? "" : `/${encodePart(calendar)}`}`;
}

export function webFormPath(webForm?: string, action?: string): string {
  return `${webForm === undefined ? "/api/meta/web-forms" : `/api/web-form/${encodePart(webForm)}`}${action === undefined ? "" : `/${action}`}`;
}

export function webFormMetaPath(webForm?: string): string {
  return `/api/meta/web-forms${webForm === undefined ? "" : `/${encodePart(webForm)}`}`;
}

export function webViewMetaPath(webView?: string): string {
  return `/api/meta/web-views${webView === undefined ? "" : `/${encodePart(webView)}`}`;
}

export function webViewPath(webView: string, route?: string, options?: ParamOptions): string {
  const path = `/api/web-view/${encodePart(webView)}${route === undefined ? "" : `/${encodePath(route)}`}`;
  return withQuery(path, webViewParams(options ?? {}));
}

export function webPageMetaPath(webPage?: string): string {
  return `/api/meta/web-pages${webPage === undefined ? "" : `/${encodePart(webPage)}`}`;
}

export function websiteThemeMetaPath(theme?: string): string {
  return `/api/meta/website-themes${theme === undefined ? "" : `/${encodePart(theme)}`}`;
}

export function reportBuilderPath(doctype: string, id?: string, action?: string): string {
  return `/api/report-builder/${encodePart(doctype)}${id === undefined ? "" : `/${encodePart(id)}`}${action === undefined ? "" : `/${action}`}`;
}

export function reportPath(report: string, action?: string): string {
  return `/api/report/${encodePart(report)}${action === undefined ? "" : `/${action}`}`;
}

export function reportPdfPath(report: string, options?: ParamOptions): string {
  return withQuery(reportPath(report, "pdf"), reportRunParams(options ?? {}));
}

export function reportBuilderPdfPath(doctype: string, id: string, options?: ParamOptions): string {
  return withQuery(reportBuilderPath(doctype, id, "pdf"), reportRunParams(options ?? {}));
}

export function auditDeletedPath(doctype: string, name: string, options?: TenantOptions): string {
  return withQuery(`/api/audit/deleted/${encodePart(doctype)}/${encodePart(name)}`, tenantParams(options ?? {}));
}

export function linkOptionsPath(doctype: string, field: string, params?: QueryParams): string {
  return withQuery(`/api/link-options/${encodePart(doctype)}/${encodePart(field)}`, params ?? {});
}

export function printDocumentPath(format: string, name: string): string {
  return `/api/print/${encodePart(format)}/${encodePart(name)}`;
}

export function printPdfDocumentPath(format: string, name: string): string {
  return `${printDocumentPath(format, name)}/pdf`;
}

export function printFormatPath(format?: string): string {
  return `/api/meta/print-formats${format === undefined ? "" : `/${encodePart(format)}`}`;
}

export function printLetterheadPath(letterhead?: string): string {
  return `/api/meta/print-letterheads${letterhead === undefined ? "" : `/${encodePart(letterhead)}`}`;
}

export function printSettingsPath(options?: TenantOptions): string {
  return withQuery("/api/print-settings", tenantParams(options ?? {}));
}

export function jobExecutionPath(idempotencyKey: string, action?: string): string {
  return `/api/jobs/executions/${encodePart(idempotencyKey)}${action === undefined ? "" : `/${action}`}`;
}

export function jobSchedulePath(scheduleId?: string, action?: string): string {
  return `/api/jobs/schedules${scheduleId === undefined ? "" : `/${encodePart(scheduleId)}`}${action === undefined ? "" : `/${action}`}`;
}
