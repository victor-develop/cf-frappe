/** Body / version / command / query-param builders ported from the legacy desk client string. */

import {
  appendParam,
  deskPath,
  isPlainObject,
  setFormParam,
  setParam,
  type MutableQueryParams,
  type QueryParams,
  type QueryPrimitive
} from "./url.js";

export interface VersionOptions {
  expectedVersion?: number;
}

export interface TenantOptions {
  tenant?: string;
}

export type CommandOptions = VersionOptions & TenantOptions & Record<string, unknown>;

export type UnknownRecord = Record<string, unknown>;

export function versionBody(options?: VersionOptions): UnknownRecord {
  return options && options.expectedVersion !== undefined ? { expectedVersion: options.expectedVersion } : {};
}

export function withoutKeys(input: UnknownRecord | undefined, keys: readonly string[]): UnknownRecord {
  const excluded = new Set(keys);
  const body: UnknownRecord = {};
  Object.entries(input ?? {}).forEach(([key, value]) => {
    if (!excluded.has(key)) {
      body[key] = value;
    }
  });
  return body;
}

export function commandBody(input: UnknownRecord | undefined, options?: VersionOptions): UnknownRecord {
  return Object.assign(withoutKeys(input, ["expectedVersion"]), versionBody(options));
}

export function commentBody(input: string | UnknownRecord, options?: VersionOptions): UnknownRecord {
  return commandBody(typeof input === "string" ? { text: input } : input, options);
}

export function descriptionBody(input: string | UnknownRecord, options?: VersionOptions): UnknownRecord {
  return commandBody(typeof input === "string" ? { description: input } : input, options);
}

export function passwordBody(input: string | UnknownRecord, options?: VersionOptions): UnknownRecord {
  return commandBody(typeof input === "string" ? { password: input } : input, options);
}

export function rolesBody(input: readonly string[] | UnknownRecord, options?: VersionOptions): UnknownRecord {
  return commandBody(Array.isArray(input) ? { roles: input } : (input as UnknownRecord), options);
}

export function customFieldBody(field: unknown, options?: VersionOptions): UnknownRecord {
  const bodyField = isPlainObject(field) ? withoutKeys(field, ["expectedVersion"]) : field;
  return Object.assign({ field: bodyField }, versionBody(options));
}

export function notificationRuleBody(rule: unknown, options?: VersionOptions): UnknownRecord {
  const bodyRule = isPlainObject(rule) ? withoutKeys(rule, ["name", "expectedVersion"]) : rule;
  return Object.assign({ rule: bodyRule }, versionBody(options));
}

export function assignmentRuleBody(rule: unknown, options?: VersionOptions): UnknownRecord {
  const bodyRule = isPlainObject(rule) ? withoutKeys(rule, ["name", "expectedVersion"]) : rule;
  return Object.assign({ rule: bodyRule }, versionBody(options));
}

export interface NotificationRuleSnapshot {
  name?: string;
  events?: unknown;
  recipients?: unknown;
  channels?: unknown;
  condition?: unknown;
  enabled?: boolean;
  subject?: unknown;
  excludeActor?: unknown;
}

export interface RuleStateEntry {
  rule?: NotificationRuleSnapshot;
  [key: string]: unknown;
}

export interface RuleState {
  version?: number;
  rules?: readonly (RuleStateEntry | undefined)[];
}

function requiredNotificationRuleEvents(rule: NotificationRuleSnapshot, ruleName: string): readonly unknown[] {
  if (!Array.isArray(rule.events) || rule.events.length === 0) {
    throw new Error(`Notification rule '${ruleName}' cannot be toggled because it has no events`);
  }
  return rule.events;
}

function requiredNotificationRuleRecipients(rule: NotificationRuleSnapshot, ruleName: string): readonly unknown[] {
  if (!Array.isArray(rule.recipients) || rule.recipients.length === 0) {
    throw new Error(`Notification rule '${ruleName}' cannot be toggled because it has no recipients`);
  }
  return rule.recipients;
}

export function notificationRuleToggleBody(
  ruleName: string,
  state: RuleState | undefined,
  enabled: boolean,
  options?: VersionOptions
): UnknownRecord {
  const expectedVersion = options?.expectedVersion;
  if (expectedVersion !== undefined && state && state.version !== undefined && state.version !== expectedVersion) {
    throw new Error(`Expected notification rules at version ${String(expectedVersion)}, found ${String(state.version)}`);
  }
  const entry = notificationRuleEntry(ruleName, state);
  const rule = entry.rule as NotificationRuleSnapshot;
  const bodyRule: UnknownRecord = {
    events: requiredNotificationRuleEvents(rule, ruleName).slice(),
    recipients: requiredNotificationRuleRecipients(rule, ruleName).slice()
  };
  if (Array.isArray(rule.channels) && rule.channels.length > 0) {
    bodyRule.channels = rule.channels.slice();
  }
  if (rule.condition !== undefined) {
    bodyRule.condition = rule.condition;
  }
  bodyRule.enabled = enabled;
  if (rule.subject !== undefined) {
    bodyRule.subject = rule.subject;
  }
  if (rule.excludeActor !== undefined) {
    bodyRule.excludeActor = rule.excludeActor;
  }
  return {
    rule: bodyRule,
    expectedVersion:
      expectedVersion !== undefined ? expectedVersion : state && state.version !== undefined ? state.version : 0
  };
}

export function notificationRuleEntry(ruleName: string, state: RuleState | undefined): RuleStateEntry {
  const entry = (state?.rules ?? []).find((item) => item && item.rule && item.rule.name === ruleName);
  if (entry === undefined) {
    throw new Error(`Notification rule '${ruleName}' was not found in remote state`);
  }
  return entry;
}

export function assignmentRuleEntry(ruleName: string, state: RuleState | undefined): RuleStateEntry {
  const entry = (state?.rules ?? []).find((item) => item && item.rule && item.rule.name === ruleName);
  if (entry === undefined) {
    throw new Error(`Assignment rule '${ruleName}' was not found in remote state`);
  }
  return entry;
}

export function fieldPropertyBody(overrides: unknown, options?: VersionOptions): UnknownRecord {
  const bodyOverrides = isPlainObject(overrides) ? withoutKeys(overrides, ["expectedVersion"]) : overrides;
  return Object.assign({ overrides: bodyOverrides }, versionBody(options));
}

export function workflowBody(workflow: unknown, options?: VersionOptions): UnknownRecord {
  const bodyWorkflow = isPlainObject(workflow) ? withoutKeys(workflow, ["expectedVersion"]) : workflow;
  return Object.assign({ workflow: bodyWorkflow }, versionBody(options));
}

export function userPermissionBody(grant: UnknownRecord | undefined, options?: VersionOptions): UnknownRecord {
  return commandBody(grant ?? {}, options);
}

export function dataPatchBody(options?: UnknownRecord, includePatchIds?: boolean): UnknownRecord {
  return includePatchIds === false ? withoutKeys(options ?? {}, ["patchIds"]) : Object.assign({}, options ?? {});
}

export function savedFilterBody(input: UnknownRecord): UnknownRecord {
  return withoutKeys(input, ["id"]);
}

export function bulkDocumentsBody(documents: unknown): UnknownRecord {
  return { documents };
}

export function bulkFilesBody(files: unknown, input?: UnknownRecord): UnknownRecord {
  return Object.assign({}, input ?? {}, { files });
}

/* ------------------------------- query params ------------------------------ */

export type ParamOptions = Record<string, unknown>;

function opt(options: ParamOptions | undefined, camel: string, snake?: string): unknown {
  if (!options) {
    return undefined;
  }
  const camelValue = options[camel];
  if (camelValue !== undefined || snake === undefined) {
    return camelValue;
  }
  return options[snake];
}

export function tenantParams(options?: TenantOptions): QueryParams {
  const params: MutableQueryParams = {};
  setParam(params, "tenant", options?.tenant as QueryPrimitive | undefined);
  return params;
}

export function notificationInboxParams(options?: ParamOptions): QueryParams {
  const params: MutableQueryParams = {};
  setParam(params, "user", options?.user as QueryPrimitive | undefined);
  setParam(params, "limit", options?.limit as QueryPrimitive | undefined);
  setParam(params, "unread", options?.unread as QueryPrimitive | undefined);
  setParam(params, "include_dismissed", opt(options, "includeDismissed", "include_dismissed") as QueryPrimitive | undefined);
  return params;
}

export function notificationCommandParams(options?: ParamOptions): QueryParams {
  const params: MutableQueryParams = {};
  setParam(params, "user", options?.user as QueryPrimitive | undefined);
  return params;
}

export function deskNotificationInboxParams(options?: ParamOptions): QueryParams {
  const params: MutableQueryParams = {};
  setParam(params, "limit", options?.limit as QueryPrimitive | undefined);
  setParam(params, "unread", options?.unread as QueryPrimitive | undefined);
  setParam(params, "include_dismissed", opt(options, "includeDismissed", "include_dismissed") as QueryPrimitive | undefined);
  return params;
}

export interface AttachedToOptions extends ParamOptions {
  attachedTo?: { doctype?: unknown; name?: unknown };
}

export function fileAttachmentParams(params: MutableQueryParams | UnknownRecord, options?: AttachedToOptions): void {
  const attachedTo = options?.attachedTo;
  if (attachedTo) {
    setParam(params as MutableQueryParams, "attached_to_doctype", attachedTo.doctype as QueryPrimitive | undefined);
    setParam(params as MutableQueryParams, "attached_to_name", attachedTo.name as QueryPrimitive | undefined);
    return;
  }
  if (options && (options.attached_to_doctype !== undefined || options.attached_to_name !== undefined)) {
    setParam(params as MutableQueryParams, "attached_to_doctype", options.attached_to_doctype as QueryPrimitive | undefined);
    setParam(params as MutableQueryParams, "attached_to_name", options.attached_to_name as QueryPrimitive | undefined);
  }
}

export function fileListParams(options?: AttachedToOptions): QueryParams {
  const params: MutableQueryParams = {};
  fileAttachmentParams(params, options ?? {});
  setParam(params, "content_type", opt(options, "contentType", "content_type") as QueryPrimitive | undefined);
  setParam(params, "filename", options?.filename as QueryPrimitive | undefined);
  setParam(params, "is_private", opt(options, "isPrivate", "is_private") as QueryPrimitive | undefined);
  setParam(params, "limit", options?.limit as QueryPrimitive | undefined);
  setParam(params, "scan_status", opt(options, "scanStatus", "scan_status") as QueryPrimitive | undefined);
  setParam(params, "storage_state", opt(options, "storageState", "storage_state") as QueryPrimitive | undefined);
  setParam(params, "uploaded_by", opt(options, "uploadedBy", "uploaded_by") as QueryPrimitive | undefined);
  return params;
}

function fileWatermarkText(value: unknown): unknown {
  if (value && typeof value === "object") {
    return (value as UnknownRecord).text;
  }
  return value;
}

function fileWatermarkField(value: unknown, field: string): unknown {
  if (value && typeof value === "object") {
    return (value as UnknownRecord)[field];
  }
  return undefined;
}

function fileOverlayFile(value: unknown): unknown {
  if (value && typeof value === "object") {
    return (value as UnknownRecord).file;
  }
  return value;
}

function fileOverlayField(value: unknown, field: string): unknown {
  if (value && typeof value === "object") {
    return (value as UnknownRecord)[field];
  }
  return undefined;
}

export function fileTransformParams(options?: ParamOptions): QueryParams {
  const params: MutableQueryParams = {};
  setParam(params, "width", options?.width as QueryPrimitive | undefined);
  setParam(params, "height", options?.height as QueryPrimitive | undefined);
  setParam(params, "fit", options?.fit as QueryPrimitive | undefined);
  setParam(params, "format", options?.format as QueryPrimitive | undefined);
  setParam(params, "quality", options?.quality as QueryPrimitive | undefined);
  setParam(params, "watermark", fileWatermarkText(options?.watermark) as QueryPrimitive | undefined);
  setParam(params, "watermarkPlacement", fileWatermarkField(options?.watermark, "placement") as QueryPrimitive | undefined);
  setParam(params, "watermarkOpacity", fileWatermarkField(options?.watermark, "opacity") as QueryPrimitive | undefined);
  setParam(params, "watermarkColor", fileWatermarkField(options?.watermark, "color") as QueryPrimitive | undefined);
  setParam(params, "watermarkFontSize", fileWatermarkField(options?.watermark, "fontSize") as QueryPrimitive | undefined);
  setParam(params, "overlay", fileOverlayFile(options?.overlay) as QueryPrimitive | undefined);
  setParam(params, "overlayPlacement", fileOverlayField(options?.overlay, "placement") as QueryPrimitive | undefined);
  setParam(params, "overlayOpacity", fileOverlayField(options?.overlay, "opacity") as QueryPrimitive | undefined);
  setParam(params, "overlayWidth", fileOverlayField(options?.overlay, "width") as QueryPrimitive | undefined);
  setParam(params, "overlayHeight", fileOverlayField(options?.overlay, "height") as QueryPrimitive | undefined);
  return params;
}

export function auditEventParams(options?: ParamOptions): QueryParams {
  const params: MutableQueryParams = {};
  setParam(params, "tenant", options?.tenant as QueryPrimitive | undefined);
  setParam(params, "doctype", options?.doctype as QueryPrimitive | undefined);
  setParam(params, "name", options?.name as QueryPrimitive | undefined);
  setParam(params, "actor_id", opt(options, "actorId", "actor_id") as QueryPrimitive | undefined);
  setParam(params, "kind", options?.kind as QueryPrimitive | undefined);
  setParam(params, "since", options?.since as QueryPrimitive | undefined);
  setParam(params, "until", options?.until as QueryPrimitive | undefined);
  setParam(params, "limit", options?.limit as QueryPrimitive | undefined);
  return params;
}

export function printFormatParams(options?: ParamOptions): QueryParams {
  const params: MutableQueryParams = {};
  setParam(params, "doctype", options?.doctype as QueryPrimitive | undefined);
  return params;
}

function setFilterParam(params: MutableQueryParams, key: string, value: unknown): void {
  params[key] = value as QueryPrimitive;
  if (value === "" || (Array.isArray(value) && value.some((item) => item === ""))) {
    appendParam(params, "empty_filter", key);
  }
}

function setFilterExpressionParam(params: MutableQueryParams, value: unknown): void {
  if (value === undefined || value === null || value === "") {
    return;
  }
  params.filter_expression = typeof value === "string" ? value : JSON.stringify(value);
}

export function appendFilterParams(params: MutableQueryParams, field: string, value: unknown): void {
  if (value === undefined || value === null) {
    return;
  }
  if (isPlainObject(value)) {
    Object.entries(value).forEach(([operator, operand]) => {
      if (operand !== undefined && operand !== null) {
        setFilterParam(params, `filter_${field}${operator === "eq" ? "" : `__${operator}`}`, operand);
      }
    });
    return;
  }
  setFilterParam(params, `filter_${field}`, value);
}

export interface FilterableOptions extends ParamOptions {
  filters?: Record<string, unknown>;
}

export function resourceListParams(options?: FilterableOptions): QueryParams {
  const params: MutableQueryParams = {};
  Object.entries(options ?? {}).forEach(([key, value]) => {
    if (
      key !== "filters" &&
      key !== "filterExpression" &&
      key !== "filter_expression" &&
      key !== "orderBy" &&
      key !== "order_by" &&
      value !== undefined &&
      value !== null
    ) {
      params[key] = value as QueryPrimitive;
    }
  });
  setParam(params, "order_by", opt(options, "orderBy", "order_by") as QueryPrimitive | undefined);
  setParam(params, "order", options?.order as QueryPrimitive | undefined);
  setFilterExpressionParam(params, opt(options, "filterExpression", "filter_expression"));
  Object.entries(options?.filters ?? {}).forEach(([field, value]) => {
    appendFilterParams(params, field, value);
  });
  return params;
}

export function resourceExportParams(options?: FilterableOptions): QueryParams {
  const params = resourceListParams(options ?? {}) as MutableQueryParams;
  delete params.offset;
  return params;
}

export function reportRunParams(options?: FilterableOptions): QueryParams {
  const params: MutableQueryParams = {};
  Object.entries(options?.filters ?? {}).forEach(([field, value]) => {
    appendFilterParams(params, field, value);
  });
  setFilterExpressionParam(params, opt(options, "filterExpression", "filter_expression"));
  setParam(params, "order_by", opt(options, "orderBy", "order_by") as QueryPrimitive | undefined);
  setParam(params, "order", options?.order as QueryPrimitive | undefined);
  setParam(params, "limit", options?.limit as QueryPrimitive | undefined);
  setParam(params, "offset", options?.offset as QueryPrimitive | undefined);
  return params;
}

export function reportExportParams(options?: FilterableOptions): QueryParams {
  const params = reportRunParams(options) as MutableQueryParams;
  delete params.offset;
  return params;
}

export function calendarParams(options?: ParamOptions): QueryParams {
  const params: MutableQueryParams = {};
  setParam(params, "from", options?.from as QueryPrimitive | undefined);
  setParam(params, "to", options?.to as QueryPrimitive | undefined);
  setParam(params, "limit", options?.limit as QueryPrimitive | undefined);
  return params;
}

export function webViewParams(options?: ParamOptions): QueryParams {
  const params: MutableQueryParams = {};
  setParam(params, "limit", options?.limit as QueryPrimitive | undefined);
  setParam(params, "offset", options?.offset as QueryPrimitive | undefined);
  return params;
}

export function searchParams(q: unknown, options?: ParamOptions): QueryParams {
  const params: MutableQueryParams = {};
  setParam(params, "q", q as QueryPrimitive | undefined);
  setParam(params, "limit", options?.limit as QueryPrimitive | undefined);
  setParam(params, "tenant", options?.tenant as QueryPrimitive | undefined);
  return params;
}

export function jobDashboardParams(options?: ParamOptions): QueryParams {
  const params: MutableQueryParams = {};
  setParam(params, "job", opt(options, "jobName", "job") as QueryPrimitive | undefined);
  setParam(params, "run_id", opt(options, "runId", "run_id") as QueryPrimitive | undefined);
  setParam(params, "status", options?.status as QueryPrimitive | undefined);
  setParam(params, "limit", options?.limit as QueryPrimitive | undefined);
  return params;
}

export function jobScheduleParams(options?: ParamOptions): QueryParams {
  const params: MutableQueryParams = {};
  setParam(params, "cron", options?.cron as QueryPrimitive | undefined);
  setParam(params, "job", opt(options, "jobName", "job") as QueryPrimitive | undefined);
  return params;
}

export function timelineParams(options?: ParamOptions): QueryParams {
  const params: MutableQueryParams = {};
  if (options && options.limit !== undefined && options.limit !== null) {
    params.limit = options.limit as QueryPrimitive;
  }
  if (options && options.beforeSequence !== undefined && options.beforeSequence !== null) {
    params.before_sequence = options.beforeSequence as QueryPrimitive;
  } else if (options && options.before_sequence !== undefined && options.before_sequence !== null) {
    params.before_sequence = options.before_sequence as QueryPrimitive;
  }
  return params;
}

/* ------------------------- desk form-encoded bodies ------------------------ */

export function currentDeskListReturnTo(doctype: string): string | undefined {
  try {
    const current = new URL(window.location.href);
    return current.pathname === deskPath(doctype) ? current.pathname + current.search : undefined;
  } catch {
    return undefined;
  }
}

export interface DeskImportOptions extends ParamOptions {
  mode?: string;
  returnTo?: string;
}

export function deskImportBody(doctype: string, csv: string | undefined, options?: DeskImportOptions): URLSearchParams {
  const body = new URLSearchParams();
  const returnTo = options && options.returnTo !== undefined ? options.returnTo : currentDeskListReturnTo(doctype);
  setFormParam(body, "mode", options?.mode);
  setFormParam(body, "returnTo", returnTo);
  body.set("csv", csv ?? "");
  return body;
}

export type BulkDocumentInput = string | { name?: unknown; expectedVersion?: unknown };

export interface DeskBulkOptions extends ParamOptions {
  returnTo?: string;
}

export function deskBulkDocumentsBody(
  doctype: string,
  documents: readonly BulkDocumentInput[] | undefined,
  options?: DeskBulkOptions
): URLSearchParams {
  const body = new URLSearchParams();
  const returnTo = options && options.returnTo !== undefined ? options.returnTo : currentDeskListReturnTo(doctype);
  setFormParam(body, "returnTo", returnTo);
  (documents ?? []).forEach((document) => {
    const name = typeof document === "string" ? document : document?.name;
    if (name === undefined || name === null) {
      return;
    }
    body.append("document", String(name));
    const expectedVersion = typeof document === "string" ? undefined : document.expectedVersion;
    setFormParam(body, `expectedVersion:${String(name)}`, expectedVersion);
  });
  return body;
}
