/**
 * `window.cfFrappe` frozen namespace skeleton.
 *
 * Assembles the CORE API groups (everything that only depends on context/http/bodies/topics)
 * and merges in the behavior-module contributions (uploads/form/realtime/collaboration seams)
 * before freezing, preserving the legacy single-freeze behavior.
 */

import {
  assignmentRuleBody,
  assignmentRuleEntry,
  auditEventParams,
  bulkDocumentsBody,
  bulkFilesBody,
  commandBody,
  commentBody,
  customFieldBody,
  dataPatchBody,
  descriptionBody,
  deskBulkDocumentsBody,
  deskImportBody,
  fieldPropertyBody,
  fileAttachmentParams,
  fileListParams,
  fileTransformParams,
  jobDashboardParams,
  jobScheduleParams,
  notificationInboxParams,
  notificationRuleBody,
  notificationRuleEntry,
  notificationRuleToggleBody,
  passwordBody,
  printFormatParams,
  reportExportParams,
  reportRunParams,
  resourceExportParams,
  resourceListParams,
  rolesBody,
  savedFilterBody,
  searchParams,
  timelineParams,
  userPermissionBody,
  versionBody,
  workflowBody,
  type BulkDocumentInput,
  type CommandOptions,
  type FilterableOptions,
  type ParamOptions,
  type RuleState,
  type TenantOptions,
  type UnknownRecord,
  type VersionOptions
} from "./bodies.js";
import { setParam, type MutableQueryParams, type QueryParams } from "./url.js";
import {
  CHILD_TABLE_ROW_INDEX_FIELD,
  FIELD_EDIT_MESSAGE_TYPE,
  LOCKED_VALUE_PROPERTY,
  MAX_MULTIPART_FILE_PARTS,
  MIN_MULTIPART_FILE_PART_BYTES,
  READ_ONLY_PROPERTY,
  REALTIME_COLLABORATION_MESSAGE_TYPE,
  SHARED_DRAFT_MESSAGE_TYPE,
  SOFT_DISABLED_PROPERTY
} from "./constants.js";
import { pageContext, ready, runtimeScript } from "./context.js";
import {
  accountPath,
  assignmentRuleActionPath,
  assignmentRulePath,
  auditDeletedPath,
  calendarMetaPath,
  calendarPath,
  customFieldPath,
  dashboardMetaPath,
  dashboardPath,
  dataPatchPath,
  deskAdminAssignmentRulesPath,
  deskAdminCustomFieldsPath,
  deskAdminFieldPropertiesPath,
  deskAdminUserPermissionsPath,
  deskAdminUsersPath,
  deskAdminWorkflowsPath,
  deskCalendarPath,
  deskDashboardPath,
  deskFilePath,
  deskFilesPath,
  deskKanbanPath,
  deskNotificationsPath,
  deskPath,
  deskPrintPath,
  deskPrintPdfPath,
  deskReportBuilderPath,
  deskReportBuilderPdfPath,
  deskReportPath,
  deskReportPdfPath,
  deskSearchPath,
  deskWorkspacePath,
  encodePart,
  encodePath,
  fieldPropertyPath,
  filePath,
  jobExecutionPath,
  jobSchedulePath,
  kanbanMetaPath,
  kanbanPath,
  linkOptionsPath,
  notificationActionPath,
  notificationRulePath,
  printDocumentPath,
  printFormatPath,
  printLetterheadPath,
  printPdfDocumentPath,
  printSettingsPath,
  profilePath,
  readResponsePayload,
  reportBuilderPath,
  reportBuilderPdfPath,
  reportPath,
  reportPdfPath,
  request,
  requestBinary,
  resourceActionPath,
  resourceMemberPath,
  resourcePath,
  rolePath,
  roleActionPath,
  rolesPath,
  throwResponseError,
  unwrapData,
  userPermissionPath,
  webFormMetaPath,
  webFormPagePath,
  webFormPath,
  webPageMetaPath,
  webPagePath,
  webViewItemPagePath,
  webViewMetaPath,
  webViewPagePath,
  webViewPath,
  websiteThemeMetaPath,
  withQuery,
  workflowPath,
  type RequestOptions,
  type WebFormUrlInput
} from "./http.js";
import type { CoreClientSeam, NamespaceExtensions } from "./seams.js";
import {
  doctypeTopic,
  doctypeTopicFromOptions,
  documentTopic,
  documentTopicFromOptions,
  tenantTopic,
  tenantTopicFromOptions,
  userTopic,
  userTopicFromOptions
} from "./topics.js";

export function msgprint(message: unknown): string {
  const text = message == null ? "" : String(message);
  if (typeof window.alert === "function") {
    window.alert(text);
  }
  return text;
}

export function throwMessage(message: unknown): never {
  const text = msgprint(message);
  throw new Error(text);
}

async function getNotificationRule(doctype: string, rule: string, options?: TenantOptions): Promise<unknown> {
  const state = unwrapData(await request(notificationRulePath(doctype, rule, options ?? {}))) as RuleState;
  return notificationRuleEntry(rule, state);
}

async function getAssignmentRule(doctype: string, rule: string, options?: TenantOptions): Promise<unknown> {
  const state = unwrapData(await request(assignmentRulePath(doctype, rule, options ?? {}))) as RuleState;
  return assignmentRuleEntry(rule, state);
}

async function toggleNotificationRule(
  doctype: string,
  rule: string,
  enabled: boolean,
  options?: CommandOptions
): Promise<unknown> {
  const commandOptions = options ?? {};
  const state = unwrapData(await request(notificationRulePath(doctype, undefined, commandOptions))) as RuleState;
  return request(notificationRulePath(doctype, rule, commandOptions), {
    method: "PUT",
    body: notificationRuleToggleBody(rule, state, enabled, commandOptions)
  }).then(unwrapData);
}

async function toggleAssignmentRule(
  doctype: string,
  rule: string,
  enabled: boolean,
  options?: CommandOptions
): Promise<unknown> {
  const commandOptions = options ?? {};
  return request(assignmentRuleActionPath(doctype, rule, enabled ? "enable" : "disable", commandOptions), {
    method: "POST",
    body: versionBody(commandOptions)
  }).then(unwrapData);
}

const FORM_URLENCODED_HEADERS = { "content-type": "application/x-www-form-urlencoded; charset=utf-8" };

function coreFilesApi(): UnknownRecord {
  return {
    bulkDelete: (files: unknown) =>
      request("/api/files/delete", { method: "POST", body: bulkFilesBody(files) }).then(unwrapData),
    bulkUpdateMetadata: (files: unknown, input?: UnknownRecord) =>
      request("/api/files/bulk-metadata", { method: "POST", body: bulkFilesBody(files, input) }).then(unwrapData),
    contentUrl: (name: string) => filePath(name, "content"),
    delete: (name: string, options?: VersionOptions) =>
      request(withQuery(filePath(name), versionBody(options) as QueryParams), { method: "DELETE" }).then(unwrapData),
    generateRendition: (name: string, options?: UnknownRecord) =>
      request(filePath(name, "renditions"), { method: "POST", body: options ?? {} }),
    list: (options?: ParamOptions) => request(withQuery("/api/files", fileListParams(options ?? {}))).then(unwrapData),
    previewUrl: (name: string) => filePath(name, "preview"),
    renditionContentUrl: (name: string, renditionId: string) =>
      filePath(name, `renditions/${encodePart(renditionId)}/content`),
    transformUrl: (name: string, options?: ParamOptions) =>
      withQuery(filePath(name, "transform"), fileTransformParams(options ?? {})),
    updateMetadata: (name: string, input: UnknownRecord, options?: VersionOptions) =>
      request(filePath(name), { method: "PATCH", body: commandBody(input, options) }).then(unwrapData)
  };
}

export function buildNamespace(extensions?: NamespaceExtensions): UnknownRecord {
  const ext = extensions ?? {};
  const namespace: UnknownRecord = {
    context: pageContext,
    audit: Object.freeze({
      deleted: (doctype: string, name: string, options?: TenantOptions) =>
        request(auditDeletedPath(doctype, name, options ?? {})).then(unwrapData),
      events: (options?: ParamOptions) =>
        request(withQuery("/api/audit/events", auditEventParams(options ?? {}))).then(unwrapData)
    }),
    auth: Object.freeze({
      completeEmailVerification: (input?: UnknownRecord) =>
        request("/api/auth/email-verification/complete", { method: "POST", body: input ?? {} }).then(unwrapData),
      completePasswordReset: (input?: UnknownRecord) =>
        request("/api/auth/password-reset/complete", { method: "POST", body: input ?? {} }).then(unwrapData),
      login: (input?: UnknownRecord) =>
        request("/api/auth/login", { method: "POST", body: input ?? {} }).then(unwrapData),
      logout: () => request("/api/auth/logout", { method: "POST" }).then(unwrapData),
      me: () => request("/api/auth/me").then(unwrapData),
      requestEmailVerification: (input?: UnknownRecord) =>
        request("/api/auth/email-verification/request", { method: "POST", body: input ?? {} }).then(unwrapData),
      requestPasswordReset: (input?: UnknownRecord) =>
        request("/api/auth/password-reset/request", { method: "POST", body: input ?? {} }).then(unwrapData)
    }),
    accounts: Object.freeze({
      changePassword: (userId: string, input: string | UnknownRecord, options?: CommandOptions) =>
        request(accountPath(userId, "password", options ?? {}), { method: "PUT", body: passwordBody(input, options) }).then(unwrapData),
      changeRoles: (userId: string, input: readonly string[] | UnknownRecord, options?: CommandOptions) =>
        request(accountPath(userId, "roles", options ?? {}), { method: "PUT", body: rolesBody(input, options) }).then(unwrapData),
      create: (userId: string, input?: UnknownRecord, options?: CommandOptions) =>
        request(accountPath(userId, undefined, options ?? {}), { method: "POST", body: commandBody(input ?? {}, options) }).then(unwrapData),
      disable: (userId: string, options?: CommandOptions) =>
        request(accountPath(userId, "disable", options ?? {}), { method: "POST", body: versionBody(options) }).then(unwrapData),
      enable: (userId: string, options?: CommandOptions) =>
        request(accountPath(userId, "enable", options ?? {}), { method: "POST", body: versionBody(options) }).then(unwrapData),
      get: (userId: string, options?: TenantOptions) =>
        request(accountPath(userId, undefined, options ?? {})).then(unwrapData),
      syncProvider: (userId: string, input: UnknownRecord, options?: CommandOptions) =>
        request(accountPath(userId, "provider-sync", options ?? {}), { method: "POST", body: commandBody(input, options) }).then(unwrapData)
    }),
    linkOptions: (doctype: string, field: string, params?: Record<string, string>) =>
      request(linkOptionsPath(doctype, field, params)).then(unwrapData),
    search: (q: unknown, options?: ParamOptions) =>
      request(withQuery("/api/search", searchParams(q, options ?? {}))).then(unwrapData),
    customFields: Object.freeze({
      disable: (doctype: string, field: string, options?: CommandOptions) =>
        request(customFieldPath(doctype, field, options ?? {}), { method: "DELETE", body: versionBody(options) }).then(unwrapData),
      list: (doctype: string, options?: TenantOptions) =>
        request(customFieldPath(doctype, undefined, options ?? {})).then(unwrapData),
      save: (doctype: string, field: unknown, options?: CommandOptions) =>
        request(customFieldPath(doctype, undefined, options ?? {}), { method: "POST", body: customFieldBody(field, options) }).then(unwrapData)
    }),
    fieldProperties: Object.freeze({
      clear: (doctype: string, field: string, options?: CommandOptions) =>
        request(fieldPropertyPath(doctype, field, options ?? {}), { method: "DELETE", body: versionBody(options) }).then(unwrapData),
      list: (doctype: string, options?: TenantOptions) =>
        request(fieldPropertyPath(doctype, undefined, options ?? {})).then(unwrapData),
      save: (doctype: string, field: string, overrides: unknown, options?: CommandOptions) =>
        request(fieldPropertyPath(doctype, field, options ?? {}), { method: "PUT", body: fieldPropertyBody(overrides, options) }).then(unwrapData)
    }),
    workflows: Object.freeze({
      clear: (doctype: string, workflow: string, options?: CommandOptions) =>
        request(workflowPath(doctype, workflow, options ?? {}), { method: "DELETE", body: versionBody(options) }).then(unwrapData),
      get: (doctype: string, workflow: string, options?: TenantOptions) =>
        request(workflowPath(doctype, workflow, options ?? {})).then(unwrapData),
      list: (doctype: string, options?: TenantOptions) =>
        request(workflowPath(doctype, undefined, options ?? {})).then(unwrapData),
      save: (doctype: string, workflow: UnknownRecord, options?: CommandOptions) =>
        request(workflowPath(doctype, workflow && (workflow.name as string | undefined), options ?? {}), {
          method: "PUT",
          body: workflowBody(workflow, options)
        }).then(unwrapData)
    }),
    userPermissions: Object.freeze({
      allow: (userId: string, grant?: UnknownRecord, options?: CommandOptions) =>
        request(userPermissionPath(userId, options ?? {}), { method: "POST", body: userPermissionBody(grant, options) }).then(unwrapData),
      get: (userId: string, options?: TenantOptions) =>
        request(userPermissionPath(userId, options ?? {})).then(unwrapData),
      revoke: (userId: string, grant?: UnknownRecord, options?: CommandOptions) =>
        request(userPermissionPath(userId, options ?? {}), { method: "DELETE", body: userPermissionBody(grant, options) }).then(unwrapData)
    }),
    dataPatches: Object.freeze({
      apply: (options?: UnknownRecord) =>
        request(dataPatchPath(undefined, "apply"), { method: "POST", body: dataPatchBody(options) }).then(unwrapData),
      applyOne: (patchId: string) =>
        request(dataPatchPath(patchId, "apply"), { method: "POST" }).then(unwrapData),
      enqueue: (options?: UnknownRecord) =>
        request(dataPatchPath(undefined, "enqueue"), { method: "POST", body: dataPatchBody(options) }).then(unwrapData),
      enqueueOne: (patchId: string, options?: UnknownRecord) =>
        request(dataPatchPath(patchId, "enqueue"), { method: "POST", body: dataPatchBody(options, false) }).then(unwrapData),
      plan: (options?: UnknownRecord) =>
        request(dataPatchPath(undefined, "plan"), { method: "POST", body: dataPatchBody(options) }).then(unwrapData),
      planOne: (patchId: string) =>
        request(dataPatchPath(patchId, "plan"), { method: "POST" }).then(unwrapData),
      rollbackPlan: (options?: UnknownRecord) =>
        request(dataPatchPath(undefined, "rollback-plan"), { method: "POST", body: dataPatchBody(options) }).then(unwrapData),
      rollbackPlanOne: (patchId: string) =>
        request(dataPatchPath(patchId, "rollback-plan"), { method: "POST" }).then(unwrapData),
      rollback: (options?: UnknownRecord) =>
        request(dataPatchPath(undefined, "rollback"), { method: "POST", body: dataPatchBody(options) }).then(unwrapData),
      rollbackOne: (patchId: string) =>
        request(dataPatchPath(patchId, "rollback"), { method: "POST" }).then(unwrapData),
      rollbackEnqueue: (options?: UnknownRecord) =>
        request(dataPatchPath(undefined, "rollback-enqueue"), { method: "POST", body: dataPatchBody(options) }).then(unwrapData),
      rollbackEnqueueOne: (patchId: string, options?: UnknownRecord) =>
        request(dataPatchPath(patchId, "rollback-enqueue"), { method: "POST", body: dataPatchBody(options, false) }).then(unwrapData),
      rollbackRetry: (patchId: string) =>
        request(dataPatchPath(patchId, "rollback-retry"), { method: "POST" }).then(unwrapData),
      rollbackRetryEnqueue: (patchId: string, options?: UnknownRecord) =>
        request(dataPatchPath(patchId, "rollback-retry-enqueue"), { method: "POST", body: dataPatchBody(options, false) }).then(unwrapData),
      retry: (patchId: string) =>
        request(dataPatchPath(patchId, "retry"), { method: "POST" }).then(unwrapData),
      status: () => request(dataPatchPath()).then(unwrapData)
    }),
    dashboard: Object.freeze({
      get: (dashboard: string) => request(dashboardMetaPath(dashboard)).then(unwrapData),
      list: () => request(dashboardMetaPath()).then(unwrapData),
      run: (dashboard: string) => request(dashboardPath(dashboard, "run")).then(unwrapData)
    }),
    kanban: Object.freeze({
      get: (kanban: string) => request(kanbanMetaPath(kanban)).then(unwrapData),
      list: () => request(kanbanMetaPath()).then(unwrapData),
      run: (kanban: string) => request(kanbanPath(kanban, "run")).then(unwrapData)
    }),
    calendar: Object.freeze({
      get: (calendar: string) => request(calendarMetaPath(calendar)).then(unwrapData),
      list: () => request(calendarMetaPath()).then(unwrapData),
      run: (calendar: string, options?: ParamOptions) =>
        request(calendarPath(calendar, "run", options ?? {})).then(unwrapData)
    }),
    webForm: Object.freeze({
      get: (webForm: string) => request(webFormMetaPath(webForm)).then(unwrapData),
      list: () => request(webFormMetaPath()).then(unwrapData),
      submit: (webForm: string, data?: UnknownRecord) =>
        request(webFormPath(webForm, "submit"), { method: "POST", body: { data: data ?? {} } }).then(unwrapData),
      url: webFormPagePath
    }),
    webView: Object.freeze({
      get: (webView: string) => request(webViewMetaPath(webView)).then(unwrapData),
      item: (webView: string, route: string) => request(webViewPath(webView, route)).then(unwrapData),
      itemUrl: webViewItemPagePath,
      items: (webView: string, options?: ParamOptions) =>
        request(webViewPath(webView, undefined, options ?? {})).then(unwrapData),
      list: () => request(webViewMetaPath()).then(unwrapData),
      url: webViewPagePath
    }),
    webPage: Object.freeze({
      get: (webPage: string) => request(webPageMetaPath(webPage)).then(unwrapData),
      list: () => request(webPageMetaPath()).then(unwrapData),
      url: webPagePath
    }),
    websiteSettings: Object.freeze({
      get: () => request("/api/meta/website-settings").then(unwrapData)
    }),
    websiteTheme: Object.freeze({
      get: (theme: string) => request(websiteThemeMetaPath(theme)).then(unwrapData),
      list: () => request(websiteThemeMetaPath()).then(unwrapData)
    }),
    jobs: Object.freeze({
      createSchedule: (input?: UnknownRecord) =>
        request(jobSchedulePath(), { method: "POST", body: input ?? {} }).then(unwrapData),
      dashboard: (options?: ParamOptions) =>
        request(withQuery("/api/jobs", jobDashboardParams(options ?? {}))).then(unwrapData),
      deleteSchedule: (scheduleId: string) =>
        request(jobSchedulePath(scheduleId), { method: "DELETE" }).then(unwrapData),
      disableSchedule: (scheduleId: string) =>
        request(jobSchedulePath(scheduleId, "disable"), { method: "POST" }).then(unwrapData),
      enableSchedule: (scheduleId: string) =>
        request(jobSchedulePath(scheduleId, "enable"), { method: "POST" }).then(unwrapData),
      execution: (idempotencyKey: string) => request(jobExecutionPath(idempotencyKey)).then(unwrapData),
      pauseSchedule: (scheduleId: string, pausedUntil?: unknown) =>
        request(jobSchedulePath(scheduleId, "pause"), { method: "POST", body: { pauseUntil: pausedUntil } }).then(unwrapData),
      resetSchedule: (scheduleId: string) =>
        request(jobSchedulePath(scheduleId, "reset"), { method: "POST" }).then(unwrapData),
      retry: (idempotencyKey: string) =>
        request(jobExecutionPath(idempotencyKey, "retry"), { method: "POST" }).then(unwrapData),
      runSchedule: (scheduleId: string) =>
        request(jobSchedulePath(scheduleId, "run"), { method: "POST" }).then(unwrapData),
      schedules: (options?: ParamOptions) =>
        request(withQuery(jobSchedulePath(), jobScheduleParams(options ?? {}))).then(unwrapData),
      updateSchedule: (scheduleId: string, input?: UnknownRecord) =>
        request(jobSchedulePath(scheduleId), { method: "PUT", body: input ?? {} }).then(unwrapData)
    }),
    history: Object.freeze({
      assignments: (doctype: string, name: string) =>
        request(resourceActionPath(doctype, name, "assignments")).then(unwrapData),
      followers: (doctype: string, name: string) =>
        request(resourceActionPath(doctype, name, "followers")).then(unwrapData),
      shares: (doctype: string, name: string) =>
        request(resourceActionPath(doctype, name, "shares")).then(unwrapData),
      tags: (doctype: string, name: string) =>
        request(resourceActionPath(doctype, name, "tags")).then(unwrapData),
      timeline: (doctype: string, name: string, options?: ParamOptions) =>
        request(withQuery(resourceActionPath(doctype, name, "timeline"), timelineParams(options ?? {}))).then(unwrapData)
    }),
    files: Object.freeze(Object.assign(coreFilesApi(), ext.files ?? {})),
    meta: Object.freeze({
      customFields: (doctype: string, options?: TenantOptions) =>
        request(customFieldPath(doctype, undefined, options ?? {})).then(unwrapData),
      dashboard: (dashboard: string) => request(dashboardMetaPath(dashboard)).then(unwrapData),
      dashboards: () => request(dashboardMetaPath()).then(unwrapData),
      kanban: (kanban: string) => request(kanbanMetaPath(kanban)).then(unwrapData),
      kanbans: () => request(kanbanMetaPath()).then(unwrapData),
      calendar: (calendar: string) => request(calendarMetaPath(calendar)).then(unwrapData),
      calendars: () => request(calendarMetaPath()).then(unwrapData),
      webForm: (webForm: string) => request(webFormMetaPath(webForm)).then(unwrapData),
      webForms: () => request(webFormMetaPath()).then(unwrapData),
      webView: (webView: string) => request(webViewMetaPath(webView)).then(unwrapData),
      webViews: () => request(webViewMetaPath()).then(unwrapData),
      webPage: (webPage: string) => request(webPageMetaPath(webPage)).then(unwrapData),
      webPages: () => request(webPageMetaPath()).then(unwrapData),
      websiteSettings: () => request("/api/meta/website-settings").then(unwrapData),
      websiteTheme: (theme: string) => request(websiteThemeMetaPath(theme)).then(unwrapData),
      websiteThemes: () => request(websiteThemeMetaPath()).then(unwrapData),
      doctype: (doctype: string) => request(`/api/meta/doctypes/${encodePart(doctype)}`).then(unwrapData),
      doctypes: () => request("/api/meta/doctypes").then(unwrapData),
      fieldProperties: (doctype: string, options?: TenantOptions) =>
        request(fieldPropertyPath(doctype, undefined, options ?? {})).then(unwrapData),
      listView: (doctype: string) =>
        request(`/api/meta/doctypes/${encodePart(doctype)}/list-view`).then(unwrapData),
      linkOptions: (doctype: string, field: string, params?: Record<string, string>) =>
        request(linkOptionsPath(doctype, field, params)).then(unwrapData),
      notificationRules: (doctype: string, options?: TenantOptions) =>
        request(notificationRulePath(doctype, undefined, options ?? {})).then(unwrapData),
      assignmentRules: (doctype: string, options?: TenantOptions) =>
        request(assignmentRulePath(doctype, undefined, options ?? {})).then(unwrapData),
      profile: (userId: string, options?: TenantOptions) =>
        request(profilePath(userId, options ?? {})).then(unwrapData),
      printFormat: (format: string) => request(printFormatPath(format)).then(unwrapData),
      printFormats: (options?: ParamOptions) =>
        request(withQuery(printFormatPath(), printFormatParams(options ?? {}))).then(unwrapData),
      printLetterhead: (letterhead: string) => request(printLetterheadPath(letterhead)).then(unwrapData),
      printLetterheads: () => request(printLetterheadPath()).then(unwrapData),
      report: (report: string) => request(`/api/meta/reports/${encodePart(report)}`).then(unwrapData),
      reports: () => request("/api/meta/reports").then(unwrapData),
      role: (role: string, options?: TenantOptions) => request(rolePath(role, options ?? {})).then(unwrapData),
      roles: (options?: TenantOptions) => request(rolesPath(options ?? {})).then(unwrapData),
      userPermissions: (userId: string, options?: TenantOptions) =>
        request(userPermissionPath(userId, options ?? {})).then(unwrapData),
      workflow: (doctype: string, workflow: string, options?: TenantOptions) =>
        request(workflowPath(doctype, workflow, options ?? {})).then(unwrapData),
      workflows: (doctype: string, options?: TenantOptions) =>
        request(workflowPath(doctype, undefined, options ?? {})).then(unwrapData),
      workspace: (workspace: string) =>
        request(`/api/meta/workspaces/${encodePart(workspace)}`).then(unwrapData),
      workspaces: () => request("/api/meta/workspaces").then(unwrapData)
    }),
    notifications: Object.freeze({
      dismiss: (notificationId: string, options?: ParamOptions) =>
        request(notificationActionPath(notificationId, "dismiss", options ?? {}), { method: "POST" }).then(unwrapData),
      inbox: (options?: ParamOptions) =>
        request(withQuery("/api/notifications", notificationInboxParams(options ?? {}))).then(unwrapData),
      markRead: (notificationId: string, options?: ParamOptions) =>
        request(notificationActionPath(notificationId, "read", options ?? {}), { method: "POST" }).then(unwrapData)
    }),
    notificationRules: Object.freeze({
      clear: (doctype: string, rule: string, options?: CommandOptions) =>
        request(notificationRulePath(doctype, rule, options ?? {}), { method: "DELETE", body: versionBody(options) }).then(unwrapData),
      disable: (doctype: string, rule: string, options?: CommandOptions) =>
        toggleNotificationRule(doctype, rule, false, options),
      enable: (doctype: string, rule: string, options?: CommandOptions) =>
        toggleNotificationRule(doctype, rule, true, options),
      get: (doctype: string, rule: string, options?: TenantOptions) => getNotificationRule(doctype, rule, options),
      list: (doctype: string, options?: TenantOptions) =>
        request(notificationRulePath(doctype, undefined, options ?? {})).then(unwrapData),
      save: (doctype: string, rule: UnknownRecord, options?: CommandOptions) =>
        request(notificationRulePath(doctype, rule.name as string, options ?? {}), {
          method: "PUT",
          body: notificationRuleBody(rule, options)
        }).then(unwrapData)
    }),
    assignmentRules: Object.freeze({
      clear: (doctype: string, rule: string, options?: CommandOptions) =>
        request(assignmentRulePath(doctype, rule, options ?? {}), { method: "DELETE", body: versionBody(options) }).then(unwrapData),
      disable: (doctype: string, rule: string, options?: CommandOptions) =>
        toggleAssignmentRule(doctype, rule, false, options),
      enable: (doctype: string, rule: string, options?: CommandOptions) =>
        toggleAssignmentRule(doctype, rule, true, options),
      get: (doctype: string, rule: string, options?: TenantOptions) => getAssignmentRule(doctype, rule, options),
      list: (doctype: string, options?: TenantOptions) =>
        request(assignmentRulePath(doctype, undefined, options ?? {})).then(unwrapData),
      save: (doctype: string, rule: UnknownRecord, options?: CommandOptions) =>
        request(assignmentRulePath(doctype, rule.name as string, options ?? {}), {
          method: "PUT",
          body: assignmentRuleBody(rule, options)
        }).then(unwrapData)
    }),
    profiles: Object.freeze({
      get: (userId: string, options?: TenantOptions) =>
        request(profilePath(userId, options ?? {})).then(unwrapData),
      update: (userId: string, input: UnknownRecord, options?: CommandOptions) =>
        request(profilePath(userId, options ?? {}), { method: "PUT", body: commandBody(input, options) }).then(unwrapData)
    }),
    print: Object.freeze({
      format: (format: string) => request(printFormatPath(format)).then(unwrapData),
      formats: (options?: ParamOptions) =>
        request(withQuery(printFormatPath(), printFormatParams(options ?? {}))).then(unwrapData),
      letterhead: (letterhead: string) => request(printLetterheadPath(letterhead)).then(unwrapData),
      letterheads: () => request(printLetterheadPath()).then(unwrapData),
      html: (format: string, name: string) => request(printDocumentPath(format, name)),
      pdf: (format: string, name: string) => requestBinary(printPdfDocumentPath(format, name)),
      pdfUrl: printPdfDocumentPath,
      settings: (options?: TenantOptions) => request(printSettingsPath(options ?? {})).then(unwrapData),
      updateSettings: (input?: UnknownRecord, options?: CommandOptions) =>
        request(printSettingsPath(options ?? {}), {
          method: "PUT",
          body: Object.assign({}, input ?? {}, versionBody(options ?? {}))
        }).then(unwrapData),
      url: printDocumentPath
    }),
    report: Object.freeze({
      csvUrl: (report: string, options?: FilterableOptions) =>
        withQuery(reportPath(report, "export.csv"), reportExportParams(options ?? {})),
      get: (report: string) => request(`/api/meta/reports/${encodePart(report)}`).then(unwrapData),
      list: () => request("/api/meta/reports").then(unwrapData),
      pdf: (report: string, options?: FilterableOptions) => requestBinary(reportPdfPath(report, options ?? {})),
      pdfUrl: reportPdfPath,
      run: (report: string, options?: FilterableOptions) =>
        request(withQuery(reportPath(report, "run"), reportRunParams(options ?? {})))
    }),
    reportBuilder: Object.freeze({
      create: (doctype: string, input?: UnknownRecord) =>
        request(reportBuilderPath(doctype), { method: "POST", body: input ?? {} }).then(unwrapData),
      csvUrl: (doctype: string, id: string, options?: FilterableOptions) =>
        withQuery(reportBuilderPath(doctype, id, "export.csv"), reportExportParams(options ?? {})),
      delete: (doctype: string, id: string) =>
        request(reportBuilderPath(doctype, id), { method: "DELETE" }).then(unwrapData),
      get: (doctype: string, id: string) => request(reportBuilderPath(doctype, id)).then(unwrapData),
      list: (doctype: string) => request(reportBuilderPath(doctype)).then(unwrapData),
      pdf: (doctype: string, id: string, options?: FilterableOptions) =>
        requestBinary(reportBuilderPdfPath(doctype, id, options ?? {})),
      pdfUrl: reportBuilderPdfPath,
      run: (doctype: string, id: string, options?: FilterableOptions) =>
        request(withQuery(reportBuilderPath(doctype, id, "run"), reportRunParams(options ?? {}))),
      update: (doctype: string, id: string, input?: UnknownRecord) =>
        request(reportBuilderPath(doctype, id), { method: "PUT", body: input ?? {} }).then(unwrapData)
    }),
    roles: Object.freeze({
      changeDescription: (role: string, input: string | UnknownRecord, options?: CommandOptions) =>
        request(roleActionPath(role, "description", options ?? {}), { method: "PUT", body: descriptionBody(input, options) }).then(unwrapData),
      create: (role: string, input?: UnknownRecord, options?: CommandOptions) =>
        request(rolePath(role, options ?? {}), { method: "POST", body: commandBody(input ?? {}, options) }).then(unwrapData),
      disable: (role: string, options?: CommandOptions) =>
        request(roleActionPath(role, "disable", options ?? {}), { method: "POST", body: versionBody(options) }).then(unwrapData),
      enable: (role: string, options?: CommandOptions) =>
        request(roleActionPath(role, "enable", options ?? {}), { method: "POST", body: versionBody(options) }).then(unwrapData),
      get: (role: string, options?: TenantOptions) => request(rolePath(role, options ?? {})).then(unwrapData),
      list: (options?: TenantOptions) => request(rolesPath(options ?? {})).then(unwrapData)
    }),
    request,
    msgprint,
    throw: throwMessage,
    ui: Object.freeze({
      msgprint
    }),
    desk: Object.freeze({
      adminAssignmentRulesUrl: deskAdminAssignmentRulesPath,
      adminCustomFieldsUrl: deskAdminCustomFieldsPath,
      adminDataPatchesUrl: () => "/desk/admin/data-patches",
      adminFieldPropertiesUrl: deskAdminFieldPropertiesPath,
      adminJobsUrl: (options?: ParamOptions) => withQuery("/desk/admin/jobs", jobDashboardParams(options ?? {})),
      adminJobSchedulesUrl: (options?: ParamOptions) =>
        withQuery("/desk/admin/jobs/schedules", jobScheduleParams(options ?? {})),
      adminPrintSettingsUrl: () => "/desk/admin/print-settings",
      adminRolesUrl: () => "/desk/admin/roles",
      adminUserPermissionsUrl: deskAdminUserPermissionsPath,
      adminUsersUrl: deskAdminUsersPath,
      adminWorkflowsUrl: deskAdminWorkflowsPath,
      dashboardUrl: deskDashboardPath,
      kanbanUrl: deskKanbanPath,
      calendarUrl: deskCalendarPath,
      webFormUrl: webFormPagePath,
      webViewItemUrl: webViewItemPagePath,
      webViewUrl: webViewPagePath,
      webPageUrl: webPagePath,
      fileContentUrl: (name: string) => deskFilePath(name, "content"),
      filesUrl: deskFilesPath,
      filePreviewUrl: (name: string) => deskFilePath(name, "preview"),
      listUrl: (doctype: string, options?: FilterableOptions) =>
        withQuery(deskPath(doctype), resourceListParams(options ?? {})),
      csvUrl: (doctype: string, options?: FilterableOptions) =>
        withQuery(`${deskPath(doctype)}/export.csv`, resourceExportParams(options ?? {})),
      formUrl: (doctype: string, name: string) => `${deskPath(doctype)}/${encodePart(name)}`,
      importTemplateCsvUrl: (doctype: string) => `${deskPath(doctype)}/import-template.csv`,
      notificationsUrl: deskNotificationsPath,
      printingUrl: () => "/desk/printing",
      printingFormatUrl: (format: string) => `/desk/printing/formats/${encodePart(format)}`,
      printingLetterheadUrl: (letterhead: string) => `/desk/printing/letterheads/${encodePart(letterhead)}`,
      printPdfUrl: deskPrintPdfPath,
      printUrl: deskPrintPath,
      reportBuilderUrl: deskReportBuilderPath,
      reportBuilderPdfUrl: deskReportBuilderPdfPath,
      reportPdfUrl: deskReportPdfPath,
      reportUrl: deskReportPath,
      searchUrl: deskSearchPath,
      workspaceUrl: deskWorkspacePath,
      importCsv: (doctype: string, csv?: string, options?: ParamOptions) =>
        request(`${deskPath(doctype)}/import.csv`, {
          method: "POST",
          headers: FORM_URLENCODED_HEADERS,
          body: deskImportBody(doctype, csv, options ?? {})
        }),
      bulkDelete: (doctype: string, documents?: readonly BulkDocumentInput[], options?: ParamOptions) =>
        request(`${deskPath(doctype)}/bulk-delete`, {
          method: "POST",
          headers: FORM_URLENCODED_HEADERS,
          body: deskBulkDocumentsBody(doctype, documents, options ?? {})
        }),
      bulkSubmit: (doctype: string, documents?: readonly BulkDocumentInput[], options?: ParamOptions) =>
        request(`${deskPath(doctype)}/bulk-submit`, {
          method: "POST",
          headers: FORM_URLENCODED_HEADERS,
          body: deskBulkDocumentsBody(doctype, documents, options ?? {})
        }),
      bulkCancel: (doctype: string, documents?: readonly BulkDocumentInput[], options?: ParamOptions) =>
        request(`${deskPath(doctype)}/bulk-cancel`, {
          method: "POST",
          headers: FORM_URLENCODED_HEADERS,
          body: deskBulkDocumentsBody(doctype, documents, options ?? {})
        }),
      bulkTransition: (
        doctype: string,
        workflow: string,
        action: string,
        documents?: readonly BulkDocumentInput[],
        options?: ParamOptions
      ) =>
        request(`${deskPath(doctype)}/workflows/${encodePart(workflow)}/bulk-transition/${encodePart(action)}`, {
          method: "POST",
          headers: FORM_URLENCODED_HEADERS,
          body: deskBulkDocumentsBody(doctype, documents, options ?? {})
        }),
      newUrl: (doctype: string) => `${deskPath(doctype)}/new`
    }),
    resource: Object.freeze({
      activity: (doctype: string, name: string, input: UnknownRecord, options?: CommandOptions) =>
        request(resourceActionPath(doctype, name, "activities"), { method: "POST", body: commandBody(input, options) }).then(unwrapData),
      assign: (doctype: string, name: string, assignee: unknown, options?: CommandOptions) =>
        request(resourceActionPath(doctype, name, "assignments"), {
          method: "POST",
          body: Object.assign({ assignee }, versionBody(options))
        }).then(unwrapData),
      assignments: (doctype: string, name: string) =>
        request(resourceActionPath(doctype, name, "assignments")).then(unwrapData),
      bulkCancel: (doctype: string, documents: unknown) =>
        request(`${resourcePath(doctype)}/bulk-cancel`, { method: "POST", body: bulkDocumentsBody(documents) }).then(unwrapData),
      bulkDelete: (doctype: string, documents: unknown) =>
        request(`${resourcePath(doctype)}/delete`, { method: "POST", body: bulkDocumentsBody(documents) }).then(unwrapData),
      bulkSubmit: (doctype: string, documents: unknown) =>
        request(`${resourcePath(doctype)}/bulk-submit`, { method: "POST", body: bulkDocumentsBody(documents) }).then(unwrapData),
      bulkTransition: (doctype: string, workflow: string, action: string, documents: unknown) =>
        request(`${resourcePath(doctype)}/workflows/${encodePart(workflow)}/bulk-transition/${encodePart(action)}`, {
          method: "POST",
          body: bulkDocumentsBody(documents)
        }).then(unwrapData),
      amend: (doctype: string, name: string, input?: UnknownRecord, options?: CommandOptions) =>
        request(`${resourcePath(doctype, name)}/amend`, { method: "POST", body: commandBody(input ?? {}, options) }).then(unwrapData),
      cancel: (doctype: string, name: string, options?: CommandOptions) =>
        request(`${resourcePath(doctype, name)}/cancel`, { method: "POST", body: versionBody(options) }).then(unwrapData),
      command: (doctype: string, name: string, command: string, input?: UnknownRecord, options?: CommandOptions) =>
        request(`${resourcePath(doctype, name)}/command/${encodePart(command)}`, {
          method: "POST",
          body: commandBody(input, options)
        }).then(unwrapData),
      comment: (doctype: string, name: string, input: string | UnknownRecord, options?: CommandOptions) =>
        request(resourceActionPath(doctype, name, "comments"), { method: "POST", body: commentBody(input, options) }).then(unwrapData),
      create: (doctype: string, data?: UnknownRecord) =>
        request(resourcePath(doctype), { method: "POST", body: data ?? {} }).then(unwrapData),
      csvUrl: (doctype: string, options?: FilterableOptions) =>
        withQuery(`${resourcePath(doctype)}/export.csv`, resourceExportParams(options ?? {})),
      importTemplateCsvUrl: (doctype: string) => `${resourcePath(doctype)}/import-template.csv`,
      importCsv: (doctype: string, csv?: string, options?: ParamOptions) => {
        const params: MutableQueryParams = {};
        setParam(params, "mode", options?.mode as string | undefined);
        setParam(
          params,
          "max_rows",
          (options && (options.maxRows !== undefined ? options.maxRows : options.max_rows)) as string | undefined
        );
        return request(withQuery(`${resourcePath(doctype)}/import.csv`, params), {
          method: "POST",
          headers: { "content-type": "text/csv; charset=utf-8" },
          body: csv ?? ""
        }).then(unwrapData);
      },
      delete: (doctype: string, name: string, options?: CommandOptions) =>
        request(resourcePath(doctype, name), { method: "DELETE", body: versionBody(options) }).then(unwrapData),
      deleteSavedFilter: (doctype: string, filterId: string) =>
        request(`${resourcePath(doctype)}/saved-filters/${encodePart(filterId)}`, { method: "DELETE" }).then(unwrapData),
      duplicate: (doctype: string, name: string, input?: UnknownRecord, options?: CommandOptions) =>
        request(`${resourcePath(doctype, name)}/duplicate`, { method: "POST", body: commandBody(input ?? {}, options) }).then(unwrapData),
      follow: (doctype: string, name: string, options?: CommandOptions) =>
        request(resourceActionPath(doctype, name, "followers"), { method: "POST", body: commandBody(options ?? {}, options) }).then(unwrapData),
      followers: (doctype: string, name: string) =>
        request(resourceActionPath(doctype, name, "followers")).then(unwrapData),
      get: (doctype: string, name: string) => request(resourcePath(doctype, name)).then(unwrapData),
      list: (doctype: string, options?: FilterableOptions) =>
        request(withQuery(resourcePath(doctype), resourceListParams(options ?? {}))),
      listSavedFilters: (doctype: string) =>
        request(`${resourcePath(doctype)}/saved-filters`).then(unwrapData),
      saveFilter: (doctype: string, input?: UnknownRecord) =>
        request(`${resourcePath(doctype)}/saved-filters`, { method: "POST", body: savedFilterBody(input ?? {}) }).then(unwrapData),
      share: (doctype: string, name: string, userId: unknown, permissions?: readonly string[], options?: CommandOptions) =>
        request(resourceActionPath(doctype, name, "shares"), {
          method: "POST",
          body: Object.assign({ userId, permissions: permissions ?? ["read"] }, versionBody(options))
        }).then(unwrapData),
      shares: (doctype: string, name: string) =>
        request(resourceActionPath(doctype, name, "shares")).then(unwrapData),
      submit: (doctype: string, name: string, options?: CommandOptions) =>
        request(`${resourcePath(doctype, name)}/submit`, { method: "POST", body: versionBody(options) }).then(unwrapData),
      tag: (doctype: string, name: string, tag: unknown, options?: CommandOptions) =>
        request(resourceActionPath(doctype, name, "tags"), {
          method: "POST",
          body: Object.assign({ tag }, versionBody(options))
        }).then(unwrapData),
      tags: (doctype: string, name: string) =>
        request(resourceActionPath(doctype, name, "tags")).then(unwrapData),
      timeline: (doctype: string, name: string, options?: ParamOptions) =>
        request(withQuery(resourceActionPath(doctype, name, "timeline"), timelineParams(options ?? {}))).then(unwrapData),
      merge: (doctype: string, name: string, input?: UnknownRecord) =>
        request(`${resourcePath(doctype, name)}/merge`, { method: "POST", body: input ?? {} }).then(unwrapData),
      transition: (doctype: string, name: string, workflow: string, action: string, options?: CommandOptions) =>
        request(`${resourcePath(doctype, name)}/workflows/${encodePart(workflow)}/transition/${encodePart(action)}`, {
          method: "POST",
          body: versionBody(options)
        }).then(unwrapData),
      unassign: (doctype: string, name: string, assignee: string, options?: CommandOptions) =>
        request(resourceMemberPath(doctype, name, "assignments", assignee), { method: "DELETE", body: versionBody(options) }).then(unwrapData),
      unfollow: (doctype: string, name: string, follower: string, options?: CommandOptions) =>
        request(resourceMemberPath(doctype, name, "followers", follower), { method: "DELETE", body: versionBody(options) }).then(unwrapData),
      unshare: (doctype: string, name: string, userId: string, options?: CommandOptions) =>
        request(resourceMemberPath(doctype, name, "shares", userId), { method: "DELETE", body: versionBody(options) }).then(unwrapData),
      untag: (doctype: string, name: string, tag: string, options?: CommandOptions) =>
        request(resourceMemberPath(doctype, name, "tags", tag), { method: "DELETE", body: versionBody(options) }).then(unwrapData),
      update: (doctype: string, name: string, data: UnknownRecord, options?: CommandOptions) =>
        request(resourcePath(doctype, name), { method: "PUT", body: commandBody(data, options) }).then(unwrapData)
    })
  };
  if (ext.form !== undefined) {
    namespace.form = Object.freeze(ext.form);
  }
  if (ext.realtime !== undefined) {
    namespace.realtime = Object.freeze(ext.realtime);
  }
  if (ext.collaboration !== undefined) {
    namespace.collaboration = Object.freeze(ext.collaboration);
  }
  return namespace;
}

declare global {
  interface Window {
    cfFrappe?: Readonly<UnknownRecord>;
  }
}

/** Installs the frozen namespace, merging over any pre-existing `window.cfFrappe` (legacy behavior). */
export function installNamespace(extensions?: NamespaceExtensions): Readonly<UnknownRecord> {
  const namespace = Object.freeze(
    Object.assign({}, window.cfFrappe ?? {}, buildNamespace(extensions))
  ) as Readonly<UnknownRecord>;
  window.cfFrappe = namespace;
  return namespace;
}

/**
 * Single stable object the parallel behavior agents code against.
 * Type-checked against `CoreClientSeam` so accidental signature drift fails `lint`.
 */
export const coreSeam: CoreClientSeam = {
  childRowIndexField: CHILD_TABLE_ROW_INDEX_FIELD,
  minMultipartChunkBytes: MIN_MULTIPART_FILE_PART_BYTES,
  maxMultipartFileParts: MAX_MULTIPART_FILE_PARTS,
  lockedValueProperty: LOCKED_VALUE_PROPERTY,
  readOnlyProperty: READ_ONLY_PROPERTY,
  softDisabledProperty: SOFT_DISABLED_PROPERTY,
  realtimeCollaborationMessageType: REALTIME_COLLABORATION_MESSAGE_TYPE,
  fieldEditMessageType: FIELD_EDIT_MESSAGE_TYPE,
  sharedDraftMessageType: SHARED_DRAFT_MESSAGE_TYPE,
  pageContext,
  runtimeScript,
  ready,
  request,
  requestBinary,
  readResponsePayload,
  throwResponseError,
  unwrapData,
  withQuery,
  encodePart,
  encodePath,
  resourcePath,
  resourceActionPath,
  deskPath,
  filePath,
  versionBody,
  commandBody,
  fileAttachmentParams,
  fileListParams,
  resourceListParams,
  reportRunParams,
  documentTopic,
  doctypeTopic,
  tenantTopic,
  userTopic,
  doctypeTopicFromOptions,
  documentTopicFromOptions,
  tenantTopicFromOptions,
  userTopicFromOptions,
  msgprint
};

export type { NamespaceExtensions, RequestOptions, WebFormUrlInput };
