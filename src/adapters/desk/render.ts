import {
  CHILD_TABLE_ROW_INDEX_FIELD,
  FIELD_TYPES,
  type DocTypeDefinition,
  type DocumentData,
  type DocumentSnapshot,
  type FieldDefinition,
  type FieldType,
  type ListFilterControlDefinition,
  type JsonValue,
  type LinkOption,
  type ListDocumentsFilter,
  type ListFilterBuilderField,
  type ListFilterExpression,
  type ListFilterGroup,
  type ListFilterGroupMatch,
  type ListFilterInputType,
  type ListFilterOperator,
  type ResolvedFormSection,
  type ResolvedFormView,
  type ResolvedListView
} from "../../core/types.js";
import { isListFilterGroup } from "../../core/list-view.js";
import {
  isReportChartColor,
  isReportFilterGroup,
  REPORT_FORMULA_MAX_DEPTH,
  type ReportDefinition,
  type ReportFilterExpression,
  type ReportFilterOperator
} from "../../core/reports.js";
import type { DashboardDefinition } from "../../core/dashboard.js";
import type { ClientScriptDefinition, ClientScriptScope } from "../../core/client-script.js";
import type { WorkspaceDefinition, WorkspaceShortcutKind } from "../../core/workspace.js";
import type {
  DocumentAssignments,
  DocumentFollowers,
  DocumentTags,
  DocumentTimeline
} from "../../application/document-history-service.js";
import type { DocumentImportMode, DocumentImportResult } from "../../application/document-import-service.js";
import type { CustomFieldState } from "../../core/custom-fields.js";
import type { FieldPropertyOverrideState } from "../../core/field-property-overrides.js";
import type { WorkflowDefinitionState } from "../../core/workflow.js";
import type { DocumentSharePermission, DocumentShareState } from "../../core/document-shares.js";
import type { FileDashboard } from "../../application/file-service.js";
import type {
  DataPatchApplyPlan,
  DataPatchDashboard,
  DataPatchDashboardEntry,
  DataPatchRollbackPlan
} from "../../application/data-patch-service.js";
import type { JobExecutionDashboard } from "../../application/job-history-service.js";
import type { JobScheduleDashboard } from "../../application/job-schedule-service.js";
import type { ReportRunResult } from "../../application/report-service.js";
import type { DashboardRunResult } from "../../application/dashboard-service.js";
import type { RoleCatalogState } from "../../core/roles.js";
import type { SavedListFilter } from "../../application/saved-list-filter-service.js";
import type { SavedReport } from "../../application/saved-report-service.js";
import {
  PRINT_PAGE_ORIENTATIONS,
  PRINT_PAGE_SIZE_NAMES,
  type PrintFormatDefinition,
  type PrintLayoutDefinition
} from "../../core/print-format.js";
import type { PrintSettingsState } from "../../core/print-settings.js";
import type { UserAccount } from "../../core/user-accounts.js";
import type { UserNotificationInbox } from "../../application/user-notification-service.js";
import { USER_PROFILE_FIELDS, type UserProfileState } from "../../core/user-profiles.js";
import type { UserPermissionState } from "../../core/user-permissions.js";
import { MAX_JOB_QUEUE_DELAY_SECONDS, MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH } from "../../ports/job-queue.js";
import { DESK_CLIENT_SCRIPT_PATH } from "./client.js";
import {
  deskReportFieldLabel,
  deskReportSumSummaryLabel,
  deskReportSumSummaryName,
  isDeskGroupableReportField,
  isDeskNumericReportField
} from "./report-builder.js";

type ReportChartPointResult = ReportRunResult["charts"][number]["points"][number];

export type FormLinkOptions = Readonly<Record<string, readonly LinkOption[]>>;
export type FormTableDefinitions = Readonly<Record<string, DocTypeDefinition>>;
export type FormLifecycleAction = "submit" | "cancel";
export interface FormWorkflowAction {
  readonly action: string;
  readonly label: string;
  readonly to: string;
}

export interface ListBulkAction {
  readonly id: string;
  readonly label: string;
  readonly action: string;
  readonly names: readonly string[];
  readonly variant?: "danger";
}

export interface DeskLayoutOptions {
  readonly title: string;
  readonly body: string;
  readonly active?: string;
  readonly activeReport?: string;
  readonly activeDashboard?: string;
  readonly activeAdmin?: string;
  readonly activeWorkspace?: string;
  readonly showFiles?: boolean;
  readonly showNotifications?: boolean;
  readonly adminLinks?: readonly DeskNavLink[];
  readonly doctypes: readonly DocTypeDefinition[];
  readonly reports?: readonly ReportDefinition[];
  readonly dashboards?: readonly DashboardDefinition[];
  readonly workspaces?: readonly WorkspaceDefinition[];
  readonly message?: string;
}

export interface DeskNavLink {
  readonly href: string;
  readonly label: string;
  readonly id?: string;
}

export interface DocumentSharePanelState extends DocumentShareState {
  readonly delegablePermissions: readonly DocumentSharePermission[];
}

export interface WorkspaceShortcutView {
  readonly name: string;
  readonly label: string;
  readonly description?: string;
  readonly kind: WorkspaceShortcutKind;
  readonly href: string;
}

export interface WorkspaceSectionView {
  readonly name: string;
  readonly label: string;
  readonly shortcuts: readonly WorkspaceShortcutView[];
}

export interface WorkspacePageView {
  readonly workspace: WorkspaceDefinition;
  readonly sections: readonly WorkspaceSectionView[];
}

type DataPatchQueueControls = {
  readonly apply: boolean;
  readonly rollback: boolean;
  readonly rollbackRetry: boolean;
};

export function renderDeskLayout(options: DeskLayoutOptions): string {
  const workspaceNav = (options.workspaces ?? [])
    .map(
      (workspace) =>
        `<a class="nav-link${workspace.name === options.activeWorkspace ? " is-active" : ""}" href="/desk/workspaces/${encodeURIComponent(workspace.name)}">${escapeHtml(workspace.label ?? workspace.name)}</a>`
    )
    .join("");
  const nav = options.doctypes
    .map(
      (doctype) =>
        `<a class="nav-link${doctype.name === options.active ? " is-active" : ""}" href="/desk/${encodeURIComponent(doctype.name)}">${escapeHtml(labelFor(doctype))}</a>`
    )
    .join("");
  const reportNav = (options.reports ?? [])
    .map(
      (report) =>
        `<a class="nav-link${report.name === options.activeReport ? " is-active" : ""}" href="/desk/reports/${encodeURIComponent(report.name)}">${escapeHtml(report.label ?? report.name)}</a>`
    )
    .join("");
  const dashboardNav = (options.dashboards ?? [])
    .map(
      (dashboard) =>
        `<a class="nav-link${dashboard.name === options.activeDashboard ? " is-active" : ""}" href="/desk/dashboards/${encodeURIComponent(dashboard.name)}">${escapeHtml(dashboard.label ?? dashboard.name)}</a>`
    )
    .join("");
  const adminNav = (options.adminLinks ?? [])
    .map(
      (link) =>
        `<a class="nav-link${link.id !== undefined && link.id === options.activeAdmin ? " is-active" : ""}" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title)} - cf-frappe Desk</title>
  <style>${deskCss()}</style>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <aside class="sidebar" aria-label="Desk navigation">
    <a class="brand" href="/desk">cf-frappe</a>
    <nav>
      ${workspaceNav ? `<p class="nav-heading">Workspaces</p>${workspaceNav}` : ""}
      ${nav ? `<p class="nav-heading">DocTypes</p>${nav}` : ""}
      ${reportNav ? `<p class="nav-heading">Reports</p>${reportNav}` : ""}
      ${dashboardNav ? `<p class="nav-heading">Dashboards</p>${dashboardNav}` : ""}
      ${options.showNotifications ? `<p class="nav-heading">Notifications</p><a class="nav-link" href="/desk/notifications">Inbox</a>` : ""}
      ${options.showFiles ? `<p class="nav-heading">Files</p><a class="nav-link" href="/desk/files">Files</a>` : ""}
      ${adminNav ? `<p class="nav-heading">Admin</p>${adminNav}` : ""}
    </nav>
  </aside>
  <main id="main" class="main">
    <header class="topbar">
      <div>
        <p class="kicker">Desk</p>
        <h1>${escapeHtml(options.title)}</h1>
      </div>
    </header>
    ${options.message ? `<p class="notice" role="status">${escapeHtml(options.message)}</p>` : ""}
    ${options.body}
  </main>
</body>
</html>`;
}

export function renderDeskHome(
  doctypes: readonly DocTypeDefinition[],
  reports: readonly ReportDefinition[] = [],
  workspaces: readonly WorkspaceDefinition[] = [],
  dashboards: readonly DashboardDefinition[] = []
): string {
  const workspaceCards = workspaces
    .map(
      (workspace) => `<a class="workspace-card" href="/desk/workspaces/${encodeURIComponent(workspace.name)}">
        <strong>${escapeHtml(workspace.label ?? workspace.name)}</strong>
        <span>${escapeHtml(workspace.description ?? workspace.module ?? "")}</span>
      </a>`
    )
    .join("");
  const rows = doctypes
    .map(
      (doctype) => `<tr>
        <td><a href="/desk/${encodeURIComponent(doctype.name)}">${escapeHtml(labelFor(doctype))}</a></td>
        <td>${escapeHtml(doctype.module ?? "")}</td>
        <td>${String(doctype.fields.length)}</td>
        <td>${escapeHtml(doctype.description ?? "")}</td>
      </tr>`
    )
    .join("");
  return `${workspaceCards ? `<section class="workspace-grid">${workspaceCards}</section>` : ""}
  ${dashboards.length > 0 ? renderDashboardList(dashboards) : ""}
  <section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>DocType</th><th>Module</th><th>Fields</th><th>Description</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="empty">No readable DocTypes.</td></tr>`}</tbody>
      </table>
    </div>
  </section>
  ${renderReportList(reports)}`;
}

export function renderWorkspacePage(view: WorkspacePageView): string {
  const sections = view.sections
    .map((section) => {
      const shortcuts = section.shortcuts
        .map(
          (shortcut) => `<a class="workspace-card" href="${escapeHtml(shortcut.href)}">
            <strong>${escapeHtml(shortcut.label)}</strong>
            <span>${escapeHtml(shortcut.description ?? workspaceShortcutKindLabel(shortcut.kind))}</span>
          </a>`
        )
        .join("");
      return `<section class="workspace-section">
        <h2>${escapeHtml(section.label)}</h2>
        <div class="workspace-grid">${shortcuts || `<p class="empty">No shortcuts available.</p>`}</div>
      </section>`;
    })
    .join("");
  const description = view.workspace.description
    ? `<p class="muted">${escapeHtml(view.workspace.description)}</p>`
    : "";
  return `${description}${sections || `<section class="panel form"><p class="empty">No shortcuts available.</p></section>`}`;
}

function workspaceShortcutKindLabel(kind: WorkspaceShortcutKind): string {
  if (kind === "doctype") {
    return "DocType";
  }
  if (kind === "report") {
    return "Report";
  }
  if (kind === "dashboard") {
    return "Dashboard";
  }
  if (kind === "file") {
    return "Files";
  }
  if (kind === "notifications") {
    return "Notifications";
  }
  if (kind === "admin") {
    return "Admin";
  }
  return "Link";
}

export function renderUserNotificationInbox(inbox: UserNotificationInbox): string {
  const rows = inbox.notifications
    .map((notification) => `<tr>
        <td>${notification.read ? "read" : "unread"}</td>
        <td>${escapeHtml(notification.subject)}</td>
        <td>${escapeHtml(notification.doctype)}</td>
        <td>${escapeHtml(notification.documentName)}</td>
        <td>${escapeHtml(notification.actorId)}</td>
        <td>${escapeHtml(notification.createdAt)}</td>
        <td>${notification.dismissed ? "yes" : "no"}</td>
        <td>${renderNotificationActions(notification)}</td>
      </tr>`)
    .join("");
  return `<form class="panel form list-filters" method="get" action="/desk/notifications">
    <div class="fields">
      <label class="field checkbox"><input name="unread" value="1" type="checkbox"${inbox.filters.unreadOnly ? " checked" : ""}><span>Unread</span></label>
      <label class="field checkbox"><input name="include_dismissed" value="1" type="checkbox"${inbox.filters.includeDismissed ? " checked" : ""}><span>Dismissed</span></label>
      <label class="field"><span>Limit</span><input name="limit" type="number" min="1" max="200" value="${String(inbox.limit)}"></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Filter</button></div>
  </form>
  <section class="toolbar">
    <span class="muted">${String(inbox.unreadCount)} unread</span>
  </section>
  <section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Status</th><th>Subject</th><th>DocType</th><th>Name</th><th>Actor</th><th>Created</th><th>Dismissed</th><th>Action</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8" class="empty">No notifications.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

function renderNotificationActions(notification: UserNotificationInbox["notifications"][number]): string {
  const read = notification.read
    ? ""
    : `<button class="button" type="submit" formaction="/desk/notifications/${encodeURIComponent(notification.id)}/read">Read</button>`;
  const dismiss = notification.dismissed
    ? ""
    : `<button class="button" type="submit" formaction="/desk/notifications/${encodeURIComponent(notification.id)}/dismiss">Dismiss</button>`;
  if (!read && !dismiss) {
    return "";
  }
  return `<form class="inline-action" method="post">${read}${dismiss}</form>`;
}

export function renderFileManager(
  dashboard: FileDashboard,
  options: { readonly error?: string } = {}
): string {
  const bulkFileActionFormId = "bulk-file-action";
  const hasBulkDelete = dashboard.files.some((file) => file.deletable);
  const hasBulkMetadata = dashboard.files.some((file) => file.editable);
  const hasBulkActions = hasBulkDelete || hasBulkMetadata;
  const rows = dashboard.files
    .map((file) => {
      const attachedTo = attachmentLabel(file);
      return `<tr>
        <td>${file.deletable || file.editable ? renderFileBulkSelection(file, bulkFileActionFormId) : ""}</td>
        <td>${renderFileContentLinks(file)}</td>
        <td>${escapeHtml(file.name)}</td>
        <td>${escapeHtml(file.contentType)}</td>
        <td>${escapeHtml(formatBytes(file.size))}</td>
        <td>${file.isPrivate ? "yes" : "no"}</td>
        <td>${escapeHtml(attachedTo)}</td>
        <td>${escapeHtml(file.uploadedBy)}</td>
        <td>${escapeHtml(file.uploadedAt)}</td>
        <td>${file.editable ? renderFileMetadataAction(file) : ""}${file.deletable ? renderFileDeleteAction(file) : ""}</td>
      </tr>`;
    })
    .join("");
  return `<form class="panel form file-upload" method="post" action="/desk/files" enctype="multipart/form-data">
    <div class="form-head">
      <h2>Upload File</h2>
    </div>
    ${options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : ""}
    <div class="fields">
      <label class="field"><span>File</span><input name="file" type="file" required></label>
      <label class="field"><span>Attached To DocType</span><input name="attached_to_doctype" value="${escapeHtml(dashboard.filters.attachedToDoctype ?? "")}"></label>
      <label class="field"><span>Attached To Name</span><input name="attached_to_name" value="${escapeHtml(dashboard.filters.attachedToName ?? "")}"></label>
      <label class="field checkbox-field"><span>Private</span><input name="is_private" type="checkbox" value="1" checked></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Upload</button></div>
  </form>
  <form class="panel form list-filters" method="get" action="/desk/files">
    <div class="fields">
      <label class="field"><span>Attached To DocType</span><input name="attached_to_doctype" value="${escapeHtml(dashboard.filters.attachedToDoctype ?? "")}"></label>
      <label class="field"><span>Attached To Name</span><input name="attached_to_name" value="${escapeHtml(dashboard.filters.attachedToName ?? "")}"></label>
      <label class="field"><span>Filename</span><input name="filename" value="${escapeHtml(dashboard.filters.filename ?? "")}"></label>
      <label class="field"><span>Content Type</span><input name="content_type" value="${escapeHtml(dashboard.filters.contentType ?? "")}"></label>
      <label class="field"><span>Uploaded By</span><input name="uploaded_by" value="${escapeHtml(dashboard.filters.uploadedBy ?? "")}"></label>
      <label class="field"><span>Storage State</span><select name="storage_state">${renderFileFilterOptions(FILE_STORAGE_STATE_FILTER_OPTIONS, dashboard.filters.storageState, "Any state")}</select></label>
      <label class="field"><span>Scan Status</span><select name="scan_status">${renderFileFilterOptions(FILE_SCAN_STATUS_FILTER_OPTIONS, dashboard.filters.scanStatus, "Any status")}</select></label>
      <label class="field"><span>Private</span><select name="is_private">${renderFilePrivacyFilterOptions(dashboard.filters.isPrivate)}</select></label>
      <label class="field"><span>Limit</span><input name="limit" type="number" min="1" max="200" value="${String(dashboard.limit)}"></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Filter</button><a class="button" href="/desk/files">Clear</a></div>
  </form>
  <section class="toolbar">
    ${hasBulkActions ? `<form id="${bulkFileActionFormId}" method="post" action="/desk/files/bulk-delete"></form>` : ""}
    ${hasBulkMetadata ? renderBulkFileMetadataControls(bulkFileActionFormId) : ""}
    ${hasBulkDelete ? `<button class="button danger" type="submit" form="${bulkFileActionFormId}" formaction="/desk/files/bulk-delete">Delete selected</button>` : ""}
    ${hasBulkMetadata ? `<button class="button" type="submit" form="${bulkFileActionFormId}" formaction="/desk/files/bulk-metadata">Update selected metadata</button>` : ""}
  </section>
  <section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Select</th><th>Filename</th><th>ID</th><th>Content Type</th><th>Size</th><th>Private</th><th>Attached To</th><th>Uploaded By</th><th>Uploaded At</th><th>Action</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="10" class="empty">No files found.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

export function renderFileAttachmentPanel(
  doctype: string,
  documentName: string,
  dashboard: FileDashboard,
  options: { readonly error?: string } = {}
): string {
  const rows = dashboard.files
    .map(
      (file) => `<tr>
        <td>${renderFileContentLinks(file)}</td>
        <td>${escapeHtml(file.contentType)}</td>
        <td>${escapeHtml(formatBytes(file.size))}</td>
        <td>${file.isPrivate ? "yes" : "no"}</td>
        <td>${escapeHtml(file.uploadedBy)}</td>
        <td>${escapeHtml(file.uploadedAt)}</td>
        <td>${file.deletable ? renderAttachedFileDeleteAction(doctype, documentName, file) : ""}</td>
      </tr>`
    )
    .join("");
  const documentHref = `/desk/${encodeURIComponent(doctype)}/${encodeURIComponent(documentName)}`;
  const managerHref = `/desk/files?attached_to_doctype=${encodeURIComponent(doctype)}&attached_to_name=${encodeURIComponent(documentName)}`;
  return `<section class="panel attachments" aria-labelledby="document-attachments">
    <div class="attachment-head">
      <h2 id="document-attachments">Attachments</h2>
      <a class="button" href="${escapeHtml(managerHref)}">Open file manager</a>
    </div>
    <form class="form attachment-upload" method="post" action="${escapeHtml(documentHref)}/files" enctype="multipart/form-data">
      ${options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : ""}
      <div class="fields">
        <label class="field"><span>File</span><input name="file" type="file" required></label>
        <label class="field checkbox-field"><span>Private</span><input name="is_private" type="checkbox" value="1" checked></label>
      </div>
      <div class="actions"><button class="button primary" type="submit">Upload</button></div>
    </form>
    <div class="table-wrap">
      <table>
        <thead><tr><th>Filename</th><th>Content Type</th><th>Size</th><th>Private</th><th>Uploaded By</th><th>Uploaded At</th><th>Action</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="empty">No files attached.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

function renderFileContentLinks(file: FileDashboard["files"][number]): string {
  const downloadHref = `/desk/files/${encodeURIComponent(file.name)}/content`;
  const previewHref = `/desk/files/${encodeURIComponent(file.name)}/preview`;
  const preview = file.previewable ? ` <a href="${previewHref}">Preview</a>` : "";
  return `<a href="${downloadHref}">${escapeHtml(file.filename)}</a>${preview}`;
}

export function renderDocumentPresencePanel(
  document: DocumentSnapshot,
  options: { readonly realtimeRoute?: string } = {}
): string {
  const realtimeAttribute = options.realtimeRoute === undefined
    ? ""
    : ` data-realtime-route="${escapeHtml(options.realtimeRoute)}"`;
  return `<section class="panel presence" aria-labelledby="document-presence" data-cf-frappe-presence="document" data-doctype="${escapeHtml(document.doctype)}" data-document-name="${escapeHtml(document.name)}" data-document-version="${String(document.version)}" data-tenant-id="${escapeHtml(document.tenantId)}"${realtimeAttribute}>
    <div class="presence-head">
      <h2 id="document-presence">Presence</h2>
      <p data-cf-frappe-presence-count>Checking active collaborators.</p>
    </div>
    <p class="presence-list" data-cf-frappe-presence-list>Checking active collaborators.</p>
    <p class="presence-list" data-cf-frappe-field-edits>No live field edits.</p>
    <p class="presence-list" data-cf-frappe-shared-draft>No shared draft proposals.</p>
    <p class="presence-list" data-cf-frappe-document-update>Viewing latest saved version.</p>
    <button type="button" data-cf-frappe-merge-save hidden>Merge saved changes</button>
    <button type="button" data-cf-frappe-apply-shared-draft hidden>Apply shared draft</button>
  </section>`;
}

function renderFileMetadataAction(file: FileDashboard["files"][number]): string {
  return `<form class="inline-action file-metadata-action" method="post" action="/desk/files/${encodeURIComponent(file.name)}/metadata">
    <input type="hidden" name="expectedVersion" value="${String(file.expectedVersion)}">
    <input aria-label="Filename" name="filename" value="${escapeHtml(file.filename)}">
    <input aria-label="Attached To DocType" name="attached_to_doctype" value="${escapeHtml(file.attachedTo?.doctype ?? "")}">
    <input aria-label="Attached To Name" name="attached_to_name" value="${escapeHtml(file.attachedTo?.name ?? "")}">
    <label class="inline-checkbox"><span>Private</span><input name="is_private" type="checkbox" value="1"${file.isPrivate ? " checked" : ""}></label>
    <button class="button" type="submit">Save</button>
  </form>`;
}

function renderFileBulkSelection(file: FileDashboard["files"][number], formId: string): string {
  return `<input class="bulk-select" form="${formId}" aria-label="Select ${escapeHtml(file.filename)}" name="file" value="${escapeHtml(file.name)}" type="checkbox">
    <input form="${formId}" name="expectedVersion:${escapeHtml(file.name)}" value="${String(file.expectedVersion)}" type="hidden">`;
}

function renderBulkFileMetadataControls(formId: string): string {
  return `<label class="field compact-field"><span>Privacy</span><select form="${formId}" name="bulk_is_private">
      <option value="">Keep privacy</option>
      <option value="1">Private</option>
      <option value="0">Public</option>
    </select></label>
    <label class="field compact-field"><span>Attach To DocType</span><input form="${formId}" name="bulk_attached_to_doctype"></label>
    <label class="field compact-field"><span>Attach To Name</span><input form="${formId}" name="bulk_attached_to_name"></label>
    <label class="inline-checkbox"><span>Clear attachment</span><input form="${formId}" name="bulk_clear_attachment" type="checkbox" value="1"></label>`;
}

function renderFileDeleteAction(file: FileDashboard["files"][number]): string {
  return `<form class="inline-action" method="post">
    <input type="hidden" name="expectedVersion" value="${String(file.expectedVersion)}">
    <button class="button danger" type="submit" formaction="/desk/files/${encodeURIComponent(file.name)}/delete">Delete</button>
  </form>`;
}

function renderAttachedFileDeleteAction(
  doctype: string,
  documentName: string,
  file: FileDashboard["files"][number]
): string {
  return `<form class="inline-action" method="post">
    <input type="hidden" name="expectedVersion" value="${String(file.expectedVersion)}">
    <button class="button danger" type="submit" formaction="/desk/${encodeURIComponent(doctype)}/${encodeURIComponent(documentName)}/files/${encodeURIComponent(file.name)}/delete">Delete</button>
  </form>`;
}

function attachmentLabel(file: FileDashboard["files"][number]): string {
  if (!file.attachedTo) {
    return "";
  }
  return `${file.attachedTo.doctype}/${file.attachedTo.name}`;
}

const FILE_STORAGE_STATE_FILTER_OPTIONS = [
  { value: "upload_pending", label: "Upload Pending" },
  { value: "available", label: "Available" },
  { value: "scan_failed", label: "Scan Failed" },
  { value: "delete_requested", label: "Delete Requested" }
] as const;

const FILE_SCAN_STATUS_FILTER_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "clean", label: "Clean" },
  { value: "infected", label: "Infected" }
] as const;

function renderFileFilterOptions(
  options: readonly { readonly value: string; readonly label: string }[],
  selectedValue: string | undefined,
  emptyLabel: string
): string {
  const selected = selectedValue ?? "";
  const rendered = [`<option value=""${selected === "" ? " selected" : ""}>${escapeHtml(emptyLabel)}</option>`];
  if (selected && !options.some((option) => option.value === selected)) {
    rendered.push(`<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}</option>`);
  }
  rendered.push(
    ...options.map((option) => {
      const selectedAttribute = option.value === selected ? " selected" : "";
      return `<option value="${escapeHtml(option.value)}"${selectedAttribute}>${escapeHtml(option.label)}</option>`;
    })
  );
  return rendered.join("");
}

function renderFilePrivacyFilterOptions(value: boolean | undefined): string {
  const selected = value === undefined ? "" : value ? "1" : "0";
  return [
    `<option value=""${selected === "" ? " selected" : ""}>Any privacy</option>`,
    `<option value="1"${selected === "1" ? " selected" : ""}>Private</option>`,
    `<option value="0"${selected === "0" ? " selected" : ""}>Public</option>`
  ].join("");
}

export function renderReportList(
  reports: readonly ReportDefinition[],
  options: { readonly builderDoctypes?: readonly DocTypeDefinition[] } = {}
): string {
  const rows = reports
    .map(
      (report) => `<tr>
        <td><a href="/desk/reports/${encodeURIComponent(report.name)}">${escapeHtml(report.label ?? report.name)}</a></td>
        <td>${escapeHtml(report.doctype)}</td>
        <td>${escapeHtml(report.module ?? "")}</td>
        <td>${escapeHtml(report.description ?? "")}</td>
      </tr>`
    )
    .join("");
  const builderRows = (options.builderDoctypes ?? [])
    .map(
      (doctype) => `<tr>
        <td><a href="/desk/report-builder/${encodeURIComponent(doctype.name)}">${escapeHtml(labelFor(doctype))}</a></td>
        <td>${escapeHtml(doctype.name)}</td>
        <td>${String(doctype.fields.filter((field) => !field.hidden).length)}</td>
      </tr>`
    )
    .join("");
  const builder = options.builderDoctypes
    ? `<section class="panel report-builder-list">
      <div class="table-wrap">
        <table>
          <thead><tr><th>Build Report</th><th>DocType</th><th>Fields</th></tr></thead>
          <tbody>${builderRows || `<tr><td colspan="3" class="empty">No readable DocTypes.</td></tr>`}</tbody>
        </table>
      </div>
    </section>`
    : "";
  return `<section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Report</th><th>DocType</th><th>Module</th><th>Description</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="empty">No readable reports.</td></tr>`}</tbody>
      </table>
    </div>
  </section>${builder}`;
}

export function renderDashboardList(dashboards: readonly DashboardDefinition[]): string {
  const rows = dashboards
    .map(
      (dashboard) => `<tr>
        <td><a href="/desk/dashboards/${encodeURIComponent(dashboard.name)}">${escapeHtml(dashboard.label ?? dashboard.name)}</a></td>
        <td>${escapeHtml(dashboard.module ?? "")}</td>
        <td>${String(dashboard.cards.length)}</td>
        <td>${escapeHtml(dashboard.description ?? "")}</td>
      </tr>`
    )
    .join("");
  return `<section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Dashboard</th><th>Module</th><th>Cards</th><th>Description</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="empty">No readable dashboards.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

export function renderDashboardView(result: DashboardRunResult): string {
  const description = result.dashboard.description
    ? `<p class="muted">${escapeHtml(result.dashboard.description)}</p>`
    : "";
  const cards = result.cards.map(renderDashboardCard).join("");
  return `${description}<section class="dashboard-grid">${cards || `<p class="empty">No dashboard cards.</p>`}</section>`;
}

function renderDashboardCard(card: DashboardRunResult["cards"][number]): string {
  if (card.source.kind === "reportChart") {
    const chart = dashboardChartValue(card.value);
    return `<section class="dashboard-card dashboard-chart-card">
      ${card.description === undefined ? "" : `<p>${escapeHtml(card.description)}</p>`}
      ${chart === undefined
        ? `<h2>${escapeHtml(card.label)}</h2><p class="empty">No chart data.</p>`
        : renderReportChartBody(chart, dashboardReportChartHref(card.source), card.label)}
      <small>${escapeHtml(dashboardCardSourceLabel(card.source))}</small>
    </section>`;
  }
  const href = dashboardMetricHref(card.source);
  const content = `<span>${escapeHtml(card.label)}</span>
    <strong>${escapeHtml(formatValue(dashboardMetricValue(card.value)))}</strong>
    ${card.indicator === undefined ? "" : `<em>${escapeHtml(card.indicator)}</em>`}
    ${card.description === undefined ? "" : `<p>${escapeHtml(card.description)}</p>`}
    <small>${escapeHtml(dashboardCardSourceLabel(card.source))}</small>`;
  return `<section class="dashboard-card">
    ${href === undefined ? content : `<a class="dashboard-card-link" href="${escapeHtml(href)}">${content}</a>`}
  </section>`;
}

function dashboardMetricValue(value: DashboardRunResult["cards"][number]["value"]): JsonValue | undefined {
  return dashboardChartValue(value) === undefined ? value as JsonValue : undefined;
}

function dashboardChartValue(
  value: DashboardRunResult["cards"][number]["value"]
): ReportRunResult["charts"][number] | undefined {
  if (typeof value === "object" && value !== null && "points" in value) {
    return value as ReportRunResult["charts"][number];
  }
  return undefined;
}

function dashboardReportChartHref(source: Extract<DashboardRunResult["cards"][number]["source"], { readonly kind: "reportChart" }>): string {
  return dashboardReportHref(source.report, source.filters ?? {});
}

function dashboardReportHref(report: string, filters: Readonly<Record<string, JsonValue | undefined>>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null) {
      params.set(`filter_${name}`, String(value));
    }
  }
  const query = params.toString();
  return `/desk/reports/${encodeURIComponent(report)}${query ? `?${query}` : ""}`;
}

function dashboardMetricHref(source: DashboardRunResult["cards"][number]["source"]): string | undefined {
  if (source.kind === "documentCount" || source.kind === "documentAggregate") {
    const params = new URLSearchParams();
    params.set("default_filters", "0");
    for (const filter of source.filters ?? []) {
      appendDashboardListFilter(params, filter);
    }
    return `/desk/${encodeURIComponent(source.doctype)}?${params.toString()}`;
  }
  if (source.kind === "reportSummary") {
    return dashboardReportHref(source.report, source.filters ?? {});
  }
  return undefined;
}

function appendDashboardListFilter(params: URLSearchParams, filter: ListDocumentsFilter): void {
  const key = dashboardListFilterQueryKey(filter.field, filter.operator);
  const values = Array.isArray(filter.value) ? filter.value : [filter.value];
  for (const value of values) {
    if (value === null) {
      continue;
    }
    params.append(key, String(value));
    if (value === "") {
      params.append("empty_filter", key);
    }
  }
}

function dashboardListFilterQueryKey(field: string, operator: ListFilterOperator | undefined): string {
  return `filter_${field}${operator === undefined || operator === "eq" ? "" : `__${operator}`}`;
}

function dashboardCardSourceLabel(source: DashboardRunResult["cards"][number]["source"]): string {
  if (source.kind === "documentCount") {
    return `${source.doctype} count`;
  }
  if (source.kind === "documentAggregate") {
    return source.aggregate === "count"
      ? `${source.doctype} count`
      : `${source.doctype} ${source.aggregate}(${source.field ?? ""})`;
  }
  if (source.kind === "reportChart") {
    return `${source.report} / ${source.chart}`;
  }
  return `${source.report} / ${source.summary}`;
}

export function renderSavedReportBuilder(
  doctype: DocTypeDefinition,
  savedReports: readonly SavedReport[],
  options: { readonly error?: string } = {}
): string {
  const rows = savedReports
    .map((saved) => {
      const href = `/desk/report-builder/${encodeURIComponent(doctype.name)}/${encodeURIComponent(saved.id)}`;
      const exportHref = `${href}/export.csv`;
      return `<tr>
        <td><a href="${href}">${escapeHtml(saved.label)}</a></td>
        <td>${escapeHtml(saved.definition.columns.map((column) => column.label ?? column.name).join(", "))}</td>
        <td>${escapeHtml(saved.updatedAt)}</td>
        <td>
          <a class="button" href="${exportHref}">Export CSV</a>
          <form class="inline-action" method="post" action="${href}/delete">
            <button class="button danger" type="submit">Delete</button>
          </form>
        </td>
      </tr>`;
    })
    .join("");
  const visibleFields = doctype.fields.filter((field) => !field.hidden);
  const defaultColumns = new Set(doctype.listView?.columns ?? visibleFields.slice(0, 3).map((field) => field.name));
  const columnOptions = visibleFields
    .map((field) => renderReportBuilderCheckbox("column", field, defaultColumns.has(field.name)))
    .join("");
  const filterOptions = visibleFields
    .filter(isDeskGroupableReportField)
    .map(renderReportBuilderFilterControls)
    .join("");
  const reportFilterExpressionBuilder = renderReportFilterExpressionBuilder(
    visibleFields.filter(isDeskGroupableReportField)
  );
  const numericFields = visibleFields.filter(isDeskNumericReportField);
  const summaryOptions = [
    renderReportBuilderValueCheckbox("summaryCount", "1", "Records", false),
    ...numericFields.map((field) => renderReportBuilderCheckbox("summary", field, false))
  ].join("");
  const formulaFieldOptions = renderReportBuilderFieldOptions(numericFields);
  const formulaFieldMetadata = numericFields.map((field) => ({
    name: field.name,
    label: deskReportFieldLabel(field)
  }));
  const formulaControls = `<div class="report-formula-builder" data-cf-frappe-report-formula-builder data-formula-max-depth="${REPORT_FORMULA_MAX_DEPTH}" data-formula-fields="${escapeHtml(JSON.stringify(formulaFieldMetadata))}">${[
    `<label class="field"><span>Formula Label</span><input name="formulaLabel"></label>`,
    renderReportBuilderFormulaOperandControls("formulaLeft", "Formula Left", formulaFieldOptions, 2),
    renderReportBuilderFormulaOperatorControl("formula", "Formula"),
    renderReportBuilderFormulaOperandControls("formulaRight", "Formula Right", formulaFieldOptions, 2)
  ].join("")}</div>`;
  const groupOptions = renderReportBuilderFieldOptions(
    visibleFields.filter(isDeskGroupableReportField)
  );
  const chartSummaryOptions = [
    `<option value="record_count">Records</option>`,
    ...numericFields.map(
      (field) =>
        `<option value="${escapeHtml(deskReportSumSummaryName(field))}">${escapeHtml(deskReportSumSummaryLabel(field))}</option>`
    )
  ].join("");
  const orderOptions = [
    `<option value=""></option>`,
    ...visibleFields
      .filter(isDeskGroupableReportField)
      .map((field) => `<option value="${escapeHtml(field.name)}">${escapeHtml(deskReportFieldLabel(field))}</option>`)
  ].join("");
  return `${options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : ""}
  <form class="panel form report-builder-form" method="post" action="/desk/report-builder/${encodeURIComponent(doctype.name)}">
    <div class="fields cols-1">
      <label class="field"><span>Label</span><input name="label" required></label>
    </div>
    <fieldset class="choice-grid">
      <legend>Columns</legend>
      ${columnOptions}
    </fieldset>
    <fieldset class="choice-grid">
      <legend>Filters</legend>
      ${filterOptions}
    </fieldset>
    ${reportFilterExpressionBuilder}
    <fieldset class="choice-grid">
      <legend>Summaries</legend>
      ${summaryOptions}
    </fieldset>
    <div class="fields">
      ${formulaControls}
    </div>
    <div class="fields">
      <label class="field"><span>Group By</span><select name="groupBy">${groupOptions}</select></label>
      <label class="field"><span>Chart Type</span><select name="chartType">
        <option value=""></option>
        <option value="bar">Bar</option>
        <option value="line">Line</option>
        <option value="pie">Pie</option>
      </select></label>
      <label class="field"><span>Chart Value</span><select name="chartSummary">${chartSummaryOptions}</select></label>
    </div>
    <div class="fields">
      <label class="field"><span>Chart Sort</span><select name="chartOrderBy">
        <option value="key">Group Key</option>
        <option value="label">Group Label</option>
        <option value="value">Value</option>
      </select></label>
      <label class="field"><span>Chart Order</span><select name="chartOrder">
        <option value="asc">Ascending</option>
        <option value="desc">Descending</option>
      </select></label>
      <label class="field"><span>Chart Points</span><input name="chartMaxPoints" type="number" min="1" max="50"></label>
    </div>
    <div class="fields">
      <label class="field"><span>Chart Palette</span><input name="chartPalette" placeholder="#1f6feb, #2e7d32"></label>
      <label class="field"><span>Chart Values</span><select name="chartShowValues">
        <option value="true" selected>Show</option>
        <option value="false">Hide</option>
      </select></label>
    </div>
    <div class="fields">
      <label class="field"><span>X Axis Label</span><input name="chartXAxisLabel"></label>
      <label class="field"><span>Y Axis Label</span><input name="chartYAxisLabel"></label>
    </div>
    <div class="fields">
      <label class="field"><span>Order By</span><select name="orderBy">${orderOptions}</select></label>
      <label class="field"><span>Order</span><select name="order">
        <option value="asc">Ascending</option>
        <option value="desc">Descending</option>
      </select></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Save Report</button></div>
  </form>
  <section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Saved Report</th><th>Columns</th><th>Updated</th><th>Actions</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="empty">No saved reports.</td></tr>`}</tbody>
      </table>
    </div>
  </section>
  ${renderClientScripts(doctype.name, "report-builder", [])}`;
}

export function renderSavedReportView(
  saved: SavedReport,
  result: ReportRunResult,
  options: {
    readonly listHref: string;
    readonly exportHref: string;
    readonly printHref?: string;
    readonly pdfHref?: string;
    readonly deleteAction: string;
    readonly drilldownBaseHref?: string;
  }
): string {
  return `<section class="toolbar saved-report-toolbar">
    <a class="button" href="${escapeHtml(options.listHref)}">Back</a>
    <a class="button" href="${escapeHtml(options.exportHref)}">Export CSV</a>
    ${options.printHref ? `<a class="button" href="${escapeHtml(options.printHref)}">Print</a>` : ""}
    ${options.pdfHref ? `<a class="button" href="${escapeHtml(options.pdfHref)}">PDF</a>` : ""}
    <form class="inline-action" method="post" action="${escapeHtml(options.deleteAction)}">
      <button class="button danger" type="submit">Delete</button>
    </form>
  </section>
  <section class="panel saved-report-meta">
    <dl>
      <div><dt>DocType</dt><dd>${escapeHtml(saved.doctype)}</dd></div>
      <div><dt>Columns</dt><dd>${escapeHtml(saved.definition.columns.map((column) => column.label ?? column.name).join(", "))}</dd></div>
      ${renderSavedReportDefinitionMeta(saved.definition)}
      <div><dt>Updated</dt><dd>${escapeHtml(saved.updatedAt)}</dd></div>
    </dl>
  </section>
  ${renderReportView(result, {
    exportHref: options.exportHref,
    ...(options.printHref === undefined ? {} : { printHref: options.printHref }),
    ...(options.pdfHref === undefined ? {} : { pdfHref: options.pdfHref }),
    ...(options.drilldownBaseHref === undefined ? {} : { drilldownBaseHref: options.drilldownBaseHref })
  })}`;
}

function renderSavedReportDefinitionMeta(definition: SavedReport["definition"]): string {
  return [
    renderSavedReportMetaItem("Summaries", definition.summaries?.map((summary) => summary.label ?? summary.name)),
    renderSavedReportMetaItem("Groups", definition.groups?.map((group) => group.label ?? group.name)),
    renderSavedReportMetaItem("Charts", definition.charts?.map((chart) => chart.label ?? chart.name))
  ].join("");
}

function renderSavedReportMetaItem(label: string, values: readonly string[] | undefined): string {
  const text = values?.filter(Boolean).join(", ");
  return text ? `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(text)}</dd></div>` : "";
}

function renderReportBuilderCheckbox(name: string, field: FieldDefinition, checked: boolean): string {
  return renderReportBuilderValueCheckbox(name, field.name, deskReportFieldLabel(field), checked);
}

function renderReportBuilderValueCheckbox(name: string, value: string, label: string, checked: boolean): string {
  return `<label class="choice">
    <input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(value)}"${checked ? " checked" : ""}>
    <span>${escapeHtml(label)}</span>
  </label>`;
}

function renderReportBuilderFilterControls(field: FieldDefinition): string {
  const name = escapeHtml(field.name);
  const rangeControls = isReportBuilderRangeFilterField(field) ? renderReportBuilderRangeFilterControls(field) : "";
  return `<div class="report-builder-filter">
    ${renderReportBuilderCheckbox("filter", field, false)}
    <label class="field"><span>Operator</span><select name="filterOperator:${name}">
      ${reportBuilderFilterOperatorOptions(field)}
    </select></label>
    ${renderReportBuilderFilterDefaultControl(field)}
    <label class="choice">
      <input type="checkbox" name="filterRequired:${name}" value="1">
      <span>Required</span>
    </label>
    ${rangeControls}
  </div>`;
}

function isReportBuilderRangeFilterField(field: FieldDefinition): boolean {
  return field.type === "integer" || field.type === "number" || field.type === "date" || field.type === "datetime";
}

function renderReportBuilderRangeFilterControls(field: FieldDefinition): string {
  const name = escapeHtml(field.name);
  const label = deskReportFieldLabel(field);
  const inputType = inputTypeForFieldType(field.type);
  return `<div class="report-builder-range-filter">
    ${renderReportBuilderValueCheckbox("filterRangeMin", field.name, `${label} from`, false)}
    <label class="field"><span>From Default</span><input name="filterRangeMinDefault:${name}" type="${inputType}"></label>
    ${renderReportBuilderValueCheckbox("filterRangeMax", field.name, `${label} to`, false)}
    <label class="field"><span>To Default</span><input name="filterRangeMaxDefault:${name}" type="${inputType}"></label>
  </div>`;
}

function reportBuilderFilterOperatorOptions(field: FieldDefinition): string {
  return reportBuilderFilterOperatorsFor(field)
    .map(
      (operator) =>
        `<option value="${operator.value}"${operator.selected ? " selected" : ""}>${escapeHtml(operator.label)}</option>`
    )
    .join("");
}

function reportBuilderFilterOperatorsFor(
  field: FieldDefinition
): readonly { readonly value: ReportFilterOperator; readonly label: string; readonly selected?: boolean }[] {
  if (field.type === "text" || field.type === "longText") {
    return [
      { value: "contains", label: "Contains", selected: true },
      { value: "eq", label: "Equals" },
      { value: "ne", label: "Not equals" }
    ];
  }
  if (field.type === "link") {
    return [
      { value: "eq", label: "Equals", selected: true },
      { value: "ne", label: "Not equals" },
      { value: "contains", label: "Contains" }
    ];
  }
  if (field.type === "integer" || field.type === "number" || field.type === "date" || field.type === "datetime") {
    return [
      { value: "eq", label: "Equals", selected: true },
      { value: "ne", label: "Not equals" },
      { value: "gte", label: "At least" },
      { value: "lte", label: "At most" }
    ];
  }
  return [
    { value: "eq", label: "Equals", selected: true },
    { value: "ne", label: "Not equals" }
  ];
}

function renderReportBuilderFilterDefaultControl(field: FieldDefinition): string {
  const name = `filterDefault:${escapeHtml(field.name)}`;
  if (field.type === "select") {
    return `<label class="field"><span>Default</span><select name="${name}">${renderReportSelectOptions(field.options ?? [], "")}</select></label>`;
  }
  if (field.type === "boolean") {
    return `<label class="field"><span>Default</span><select name="${name}">
      <option value=""></option>
      <option value="true">True</option>
      <option value="false">False</option>
    </select></label>`;
  }
  const type = inputTypeForFieldType(field.type);
  return `<label class="field"><span>Default</span><input name="${name}" type="${type}"></label>`;
}

function renderReportFilterExpressionBuilder(fields: readonly FieldDefinition[]): string {
  const builderFields: readonly ReportFilterExpressionBuilderField[] = fields.map((field) => ({
    field: field.name,
    label: deskReportFieldLabel(field),
    inputType: reportFilterExpressionInputType(field),
    operators: []
  }));
  if (builderFields.length === 0) {
    return "";
  }
  return `<fieldset class="compound-filter-builder report-filter-expression-builder" data-cf-frappe-compound-filter-builder data-filter-expression-kind="report" data-filter-fields="${escapeHtml(JSON.stringify(builderFields))}">
    <legend>Filter Expression</legend>
    <div class="compound-filter-visual">
      ${renderReportFilterExpressionGroup(builderFields, { kind: "group", match: "all", filters: [] }, true)}
    </div>
    <template data-cf-frappe-filter-row-template>${renderReportFilterExpressionRow(builderFields, undefined)}</template>
    <template data-cf-frappe-filter-group-template>${renderReportFilterExpressionGroup(builderFields, { kind: "group", match: "all", filters: [] }, false)}</template>
    <label class="field wide" for="report-filter-expression"><span>Advanced JSON</span><textarea id="report-filter-expression" name="filter_expression" rows="5"></textarea></label>
  </fieldset>`;
}

function renderReportFilterExpressionGroup(
  fields: readonly ReportFilterExpressionBuilderField[],
  group: Extract<ReportFilterExpression, { readonly kind: "group" }>,
  root: boolean
): string {
  const items = group.filters.length > 0 ? group.filters : [undefined];
  return `<div class="compound-filter-group${root ? " compound-filter-root" : ""}" data-cf-frappe-filter-group>
    <div class="compound-filter-group-head">
      <label class="field compact"><span>Match</span><select data-cf-frappe-filter-match>${renderCompoundFilterMatchOptions(group.match)}</select></label>
      <div class="compound-filter-group-actions">
        <button class="button" type="button" data-cf-frappe-add-filter>Add condition</button>
        <button class="button" type="button" data-cf-frappe-add-filter-group>Add group</button>
        ${root ? "" : `<button class="button" type="button" data-cf-frappe-remove-filter-group>Remove group</button>`}
      </div>
    </div>
    <div class="compound-filter-items compound-filter-rows" data-cf-frappe-filter-items data-cf-frappe-filter-rows>${items
      .map((item) =>
        item === undefined
          ? renderReportFilterExpressionRow(fields, undefined)
          : isReportFilterGroup(item)
            ? renderReportFilterExpressionGroup(fields, item, false)
            : renderReportFilterExpressionRow(fields, item)
      )
      .join("")}</div>
  </div>`;
}

function renderReportFilterExpressionRow(
  fields: readonly ReportFilterExpressionBuilderField[],
  filter: Exclude<ReportFilterExpression, { readonly kind: "group" }> | undefined
): string {
  const filterName = filter?.filter ?? "";
  const builderField = fields.find((field) => field.field === filterName);
  const inputType = builderField?.inputType ?? "text";
  return `<div class="compound-filter-row" data-cf-frappe-filter-row>
    <label class="field compact"><span>Filter</span><select data-cf-frappe-filter-field>${renderCompoundFilterFieldOptions(fields, filterName)}</select></label>
    <label class="field grow"><span>Value</span><input data-cf-frappe-filter-value type="${escapeHtml(inputType)}" value="${escapeHtml(filter === undefined ? "" : formatCompoundFilterVisualValue(filter.value))}"></label>
    <button class="button" type="button" data-cf-frappe-remove-filter>Remove</button>
  </div>`;
}

interface ReportFilterExpressionBuilderField extends ListFilterBuilderField {
  readonly label: string;
}

function reportFilterExpressionInputType(field: FieldDefinition): ListFilterInputType {
  return field.type === "boolean" ? "boolean" : inputTypeForFieldType(field.type) as ListFilterInputType;
}

function renderReportBuilderFieldOptions(fields: readonly FieldDefinition[]): string {
  return [
    `<option value=""></option>`,
    ...fields.map((field) => `<option value="${escapeHtml(field.name)}">${escapeHtml(deskReportFieldLabel(field))}</option>`)
  ].join("");
}

function renderReportBuilderFormulaOperandControls(
  prefix: string,
  label: string,
  fieldOptions: string,
  depth: number
): string {
  const nestedKindOption = depth <= REPORT_FORMULA_MAX_DEPTH ? `<option value="nested">Nested formula</option>` : "";
  return `<div class="report-formula-operand" data-cf-frappe-formula-operand data-formula-prefix="${escapeHtml(prefix)}" data-formula-label="${escapeHtml(label)}" data-formula-depth="${depth}">
      <label class="field"><span>${escapeHtml(label)} Type</span><select name="${escapeHtml(prefix)}Kind" data-cf-frappe-formula-kind>
        <option value="field">Field</option>
        <option value="literal">Number</option>
        ${nestedKindOption}
      </select></label>
      <label class="field"><span>${escapeHtml(label)}</span><select name="${escapeHtml(prefix)}">${fieldOptions}</select></label>
      <label class="field"><span>${escapeHtml(label)} Number</span><input name="${escapeHtml(prefix)}Literal" type="number" step="any"></label>
      <div class="report-formula-nested" data-cf-frappe-formula-nested></div>
    </div>`;
}

function renderReportBuilderFormulaOperatorControl(prefix: string, label: string): string {
  return `<label class="field"><span>${escapeHtml(label)} Operator</span><select name="${escapeHtml(prefix)}Operator">
        <option value=""></option>
        <option value="add">Add</option>
        <option value="subtract">Subtract</option>
        <option value="multiply">Multiply</option>
        <option value="divide">Divide</option>
      </select></label>`;
}

export function renderUserPermissionAdmin(state: UserPermissionState): string {
  const rows = state.grants
    .map((grant) => {
      const applicable = (grant.applicableDoctypes ?? []).join(", ");
      return `<tr>
        <td>${escapeHtml(grant.targetDoctype)}</td>
        <td>${escapeHtml(grant.targetName)}</td>
        <td>${escapeHtml(applicable)}</td>
        <td>
          <form class="inline-action" method="post" action="/desk/admin/user-permissions/revoke">
            <input type="hidden" name="user" value="${escapeHtml(state.userId)}">
            <input type="hidden" name="targetDoctype" value="${escapeHtml(grant.targetDoctype)}">
            <input type="hidden" name="targetName" value="${escapeHtml(grant.targetName)}">
            <input type="hidden" name="applicableDoctypes" value="${escapeHtml(applicable)}">
            <input type="hidden" name="expectedVersion" value="${String(state.version)}">
            <button class="button danger" type="submit">Revoke</button>
          </form>
        </td>
      </tr>`;
    })
    .join("");
  return `<form class="panel form" method="get" action="/desk/admin/user-permissions">
    <div class="fields cols-1">
      <label class="field"><span>User</span><input name="user" type="email" value="${escapeHtml(state.userId)}"></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Load</button></div>
  </form>
  <form class="panel form" method="post" action="/desk/admin/user-permissions">
    <input type="hidden" name="user" value="${escapeHtml(state.userId)}">
    <input type="hidden" name="expectedVersion" value="${String(state.version)}">
    <div class="fields">
      <label class="field"><span>Target DocType</span><input name="targetDoctype" value=""></label>
      <label class="field"><span>Target Name</span><input name="targetName" value=""></label>
      <label class="field"><span>Applicable DocTypes</span><input name="applicableDoctypes" value=""></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Allow</button></div>
  </form>
  <section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Target DocType</th><th>Target Name</th><th>Applicable DocTypes</th><th>Action</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="empty">No grants configured.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

export interface UserAccountAdminState {
  readonly selectedUserId: string;
  readonly account?: UserAccount;
  readonly profile?: UserProfileState;
  readonly error?: string;
}

export function renderUserAccountAdmin(state: UserAccountAdminState): string {
  const account = state.account;
  const selectedUserId = account?.userId ?? state.selectedUserId;
  const createUserId = account ? "" : selectedUserId;
  const providerSyncForm = renderUserAuthProviderSyncForm(account, selectedUserId);
  const rows = account
    ? `<tr>
        <td>${escapeHtml(account.userId)}</td>
        <td>${escapeHtml(account.email ?? "")}</td>
        <td>${escapeHtml(state.profile?.profile.fullName ?? "")}</td>
        <td>${escapeHtml(account.roles.join(", "))}</td>
        <td>${account.enabled ? "enabled" : "disabled"}</td>
        <td>${String(account.version)}</td>
        <td>${escapeHtml(account.updatedAt ?? account.createdAt ?? "")}</td>
      </tr>`
    : "";
  const accountTools = account
    ? `${state.profile ? renderUserProfileForm(account, state.profile) : ""}
    <form class="panel form" method="post" action="/desk/admin/users/password">
      <input type="hidden" name="user" value="${escapeHtml(account.userId)}">
      <input type="hidden" name="expectedVersion" value="${String(account.version)}">
      <div class="form-head"><h2>Password</h2></div>
      <div class="fields cols-1">
        <label class="field"><span>New Password</span><input name="password" type="password" autocomplete="new-password"></label>
      </div>
      <div class="actions"><button class="button primary" type="submit">Change Password</button></div>
    </form>
    <form class="panel form" method="post" action="/desk/admin/users/roles">
      <input type="hidden" name="user" value="${escapeHtml(account.userId)}">
      <input type="hidden" name="expectedVersion" value="${String(account.version)}">
      <div class="form-head"><h2>Roles</h2></div>
      <div class="fields cols-1">
        <label class="field"><span>Roles</span><input name="roles" value="${escapeHtml(account.roles.join(", "))}"></label>
      </div>
      <div class="actions"><button class="button primary" type="submit">Save Roles</button></div>
    </form>
    <form class="panel form" method="post" action="/desk/admin/users/${account.enabled ? "disable" : "enable"}">
      <input type="hidden" name="user" value="${escapeHtml(account.userId)}">
      <input type="hidden" name="expectedVersion" value="${String(account.version)}">
      <div class="form-head"><h2>Status</h2><p>v${String(account.version)} · ${account.enabled ? "enabled" : "disabled"}</p></div>
      <div class="actions"><button class="button ${account.enabled ? "danger" : "primary"}" type="submit">${account.enabled ? "Disable" : "Enable"}</button></div>
    </form>`
    : "";
  return `<form class="panel form" method="get" action="/desk/admin/users">
    <div class="fields cols-1">
      <label class="field"><span>User</span><input name="user" type="email" value="${escapeHtml(selectedUserId)}"></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Load</button></div>
  </form>
  ${state.error ? `<p class="error" role="alert">${escapeHtml(state.error)}</p>` : ""}
  <form class="panel form" method="post" action="/desk/admin/users">
    <input type="hidden" name="expectedVersion" value="0">
    <div class="form-head"><h2>Create User</h2></div>
    <div class="fields">
      <label class="field"><span>User</span><input name="user" type="email" value="${escapeHtml(createUserId)}"></label>
      <label class="field"><span>Email</span><input name="email" type="email"></label>
      <label class="field"><span>Password</span><input name="password" type="password" autocomplete="new-password"></label>
      <label class="field"><span>Roles</span><input name="roles" value=""></label>
      <label class="field"><span>Status</span><select name="enabled"><option value="true" selected>Enabled</option><option value="false">Disabled</option></select></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Create</button></div>
  </form>
  ${providerSyncForm}
  <section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>User</th><th>Email</th><th>Full Name</th><th>Roles</th><th>Status</th><th>Version</th><th>Updated</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="empty">No account loaded.</td></tr>`}</tbody>
      </table>
    </div>
  </section>
  ${accountTools}`;
}

function renderUserAuthProviderSyncForm(account: UserAccount | undefined, selectedUserId: string): string {
  const userId = account?.userId ?? selectedUserId;
  const expectedVersion = account?.version ?? 0;
  const roles = account?.roles.join(", ") ?? "";
  const email = account?.email ?? "";
  return `<form class="panel form" method="post" action="/desk/admin/users/provider-sync">
    <input type="hidden" name="expectedVersion" value="${String(expectedVersion)}">
    <div class="form-head"><h2>Sync Auth Provider</h2><p>v${String(expectedVersion)}</p></div>
    <div class="fields">
      <label class="field"><span>User</span><input name="user" value="${escapeHtml(userId)}"></label>
      <label class="field"><span>Provider</span><input name="provider" value=""></label>
      <label class="field"><span>Subject</span><input name="subject" value=""></label>
      <label class="field"><span>Email</span><input name="email" type="email" value="${escapeHtml(email)}"></label>
      <label class="field"><span>Roles</span><input name="roles" value="${escapeHtml(roles)}"></label>
      <label class="field"><span>Status</span><select name="enabled"><option value="" selected>Keep</option><option value="true">Enabled</option><option value="false">Disabled</option></select></label>
      <label class="field"><span>Email Verified</span><select name="emailVerified"><option value="" selected>Keep</option><option value="true">Verified</option><option value="false">Unverified</option></select></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Sync Provider</button></div>
  </form>`;
}

function renderUserProfileForm(account: UserAccount, profile: UserProfileState): string {
  const fields = USER_PROFILE_FIELDS.map((field) => {
    const label = userProfileFieldLabel(field);
    return `<label class="field"><span>${escapeHtml(label)}</span><input name="${field}" value="${escapeHtml(profile.profile[field] ?? "")}"></label>`;
  }).join("");
  return `<form class="panel form" method="post" action="/desk/admin/users/profile">
    <input type="hidden" name="user" value="${escapeHtml(account.userId)}">
    <input type="hidden" name="expectedVersion" value="${String(profile.version)}">
    <div class="form-head"><h2>Profile</h2><p>v${String(profile.version)}</p></div>
    <div class="fields">${fields}</div>
    <div class="actions"><button class="button primary" type="submit">Save Profile</button></div>
  </form>`;
}

function userProfileFieldLabel(field: (typeof USER_PROFILE_FIELDS)[number]): string {
  switch (field) {
    case "firstName":
      return "First Name";
    case "middleName":
      return "Middle Name";
    case "lastName":
      return "Last Name";
    case "fullName":
      return "Full Name";
    case "userImage":
      return "User Image";
    case "mobileNo":
      return "Mobile No";
    case "timeZone":
      return "Time Zone";
    case "deskTheme":
      return "Desk Theme";
    case "dateFormat":
      return "Date Format";
    case "timeFormat":
      return "Time Format";
    case "numberFormat":
      return "Number Format";
    case "weekStart":
      return "Week Start";
    case "defaultWorkspace":
      return "Default Workspace";
    default:
      return `${field.slice(0, 1).toUpperCase()}${field.slice(1)}`;
  }
}

export function renderRoleAdmin(
  state: RoleCatalogState,
  options: { readonly error?: string } = {}
): string {
  const rows = state.roles
    .map((role) => {
      const action = role.enabled ? "disable" : "enable";
      return `<tr>
        <td>${escapeHtml(role.name)}</td>
        <td>${escapeHtml(role.description ?? "")}</td>
        <td>${role.enabled ? "enabled" : "disabled"}</td>
        <td>${String(role.version)}</td>
        <td>
          <form class="inline-action" method="post" action="/desk/admin/roles/${encodeURIComponent(role.name)}/description">
            <input type="hidden" name="expectedVersion" value="${String(state.version)}">
            <input name="description" value="${escapeHtml(role.description ?? "")}">
            <button class="button" type="submit">Save</button>
          </form>
          <form class="inline-action" method="post" action="/desk/admin/roles/${encodeURIComponent(role.name)}/${action}">
            <input type="hidden" name="expectedVersion" value="${String(state.version)}">
            <button class="button ${role.enabled ? "danger" : "primary"}" type="submit">${role.enabled ? "Disable" : "Enable"}</button>
          </form>
        </td>
      </tr>`;
    })
    .join("");
  return `${options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : ""}
  <form class="panel form" method="post" action="/desk/admin/roles">
    <input type="hidden" name="expectedVersion" value="${String(state.version)}">
    <div class="form-head"><h2>Create Role</h2><p>v${String(state.version)}</p></div>
    <div class="fields">
      <label class="field"><span>Role</span><input name="role"></label>
      <label class="field"><span>Description</span><input name="description"></label>
      <label class="field"><span>Status</span><select name="enabled"><option value="true" selected>Enabled</option><option value="false">Disabled</option></select></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Create</button></div>
  </form>
  <section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Role</th><th>Description</th><th>Status</th><th>Role Version</th><th>Actions</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5" class="empty">No roles configured.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

export interface CustomFieldAdminState {
  readonly doctypes: readonly DocTypeDefinition[];
  readonly selectedDoctype: string;
  readonly state?: CustomFieldState;
  readonly error?: string;
}

export function renderCustomFieldAdmin(state: CustomFieldAdminState): string {
  const version = state.state?.version ?? 0;
  const rows = state.state?.fields
    .map((entry) => {
      const field = entry.field;
      const action = entry.enabled
        ? `<form class="inline-action" method="post" action="/desk/admin/custom-fields/${encodeURIComponent(state.selectedDoctype)}/${encodeURIComponent(field.name)}/disable">
            <input type="hidden" name="expectedVersion" value="${String(version)}">
            <button class="button danger" type="submit">Disable</button>
          </form>`
        : "";
      return `<tr>
        <td>${escapeHtml(field.name)}</td>
        <td>${escapeHtml(field.label ?? "")}</td>
        <td>${escapeHtml(field.type)}</td>
        <td>${renderCustomFieldDetails(field)}</td>
        <td>${escapeHtml(renderCustomFieldFlags(field))}</td>
        <td>${entry.enabled ? "enabled" : "disabled"}</td>
        <td>${escapeHtml(entry.updatedAt)}</td>
        <td>${action}</td>
      </tr>`;
    })
    .join("");
  return `<form class="panel form" method="get" action="/desk/admin/custom-fields">
    <div class="fields cols-1">
      <label class="field"><span>DocType</span><select name="doctype">${renderCustomFieldDoctypeOptions(state.doctypes, state.selectedDoctype)}</select></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Load</button></div>
  </form>
  ${state.error ? `<p class="error" role="alert">${escapeHtml(state.error)}</p>` : ""}
  <form class="panel form" method="post" action="/desk/admin/custom-fields">
    <input type="hidden" name="doctype" value="${escapeHtml(state.selectedDoctype)}">
    <input type="hidden" name="expectedVersion" value="${String(version)}">
    <div class="form-head"><h2>Add Custom Field</h2><p>v${String(version)}</p></div>
    <div class="fields">
      <label class="field"><span>Field Name</span><input name="name"></label>
      <label class="field"><span>Label</span><input name="label"></label>
      <label class="field"><span>Type</span><select name="type">${renderCustomFieldTypeOptions()}</select></label>
      <label class="field"><span>Options</span><input name="options"></label>
      <label class="field"><span>Link To</span><input name="linkTo"></label>
      <label class="field"><span>Table Of</span><input name="tableOf"></label>
      <label class="field"><span>Minimum</span><input name="min" type="number" step="any"></label>
      <label class="field"><span>Maximum</span><input name="max" type="number" step="any"></label>
      <label class="field"><span>Default JSON</span><textarea name="defaultValue"></textarea></label>
    </div>
    <div class="choices">
      ${renderCustomFieldCheckbox("required", "Required")}
      ${renderCustomFieldCheckbox("readOnly", "Read Only")}
      ${renderCustomFieldCheckbox("hidden", "Hidden")}
      ${renderCustomFieldCheckbox("inFormView", "Form View")}
      ${renderCustomFieldCheckbox("inListView", "List View")}
      ${renderCustomFieldCheckbox("inListFilter", "List Filter")}
    </div>
    <div class="actions"><button class="button primary" type="submit">Save Field</button></div>
  </form>
  <section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Field</th><th>Label</th><th>Type</th><th>Details</th><th>Flags</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8" class="empty">No custom fields configured.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

export interface FieldPropertyAdminState {
  readonly doctypes: readonly DocTypeDefinition[];
  readonly selectedDoctype: string;
  readonly selectedField: string;
  readonly doctype?: DocTypeDefinition;
  readonly state?: FieldPropertyOverrideState;
  readonly error?: string;
}

export function renderFieldPropertyAdmin(state: FieldPropertyAdminState): string {
  const doctype = state.doctype ?? state.doctypes.find((item) => item.name === state.selectedDoctype);
  const selectedField = state.selectedField || doctype?.fields[0]?.name || "";
  const version = state.state?.version ?? 0;
  const current = state.state?.fields.find((entry) => entry.fieldName === selectedField);
  const overrides = current?.overrides ?? {};
  const rows = state.state?.fields
    .map((entry) => `<tr>
      <td>${escapeHtml(entry.fieldName)}</td>
      <td>${escapeHtml(renderFieldPropertyOverrides(entry.overrides))}</td>
      <td>${escapeHtml(entry.updatedAt)}</td>
      <td>
        <form class="inline-action" method="post" action="/desk/admin/field-properties/${encodeURIComponent(state.selectedDoctype)}/${encodeURIComponent(entry.fieldName)}/clear">
          <input type="hidden" name="expectedVersion" value="${String(version)}">
          <button class="button danger" type="submit">Clear</button>
        </form>
      </td>
    </tr>`)
    .join("");
  return `<form class="panel form" method="get" action="/desk/admin/field-properties">
    <div class="fields">
      <label class="field"><span>DocType</span><select name="doctype">${renderCustomFieldDoctypeOptions(state.doctypes, state.selectedDoctype)}</select></label>
      <label class="field"><span>Field</span><select name="field">${renderFieldPropertyFieldOptions(doctype, selectedField)}</select></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Load</button></div>
  </form>
  ${state.error ? `<p class="error" role="alert">${escapeHtml(state.error)}</p>` : ""}
  <form class="panel form" method="post" action="/desk/admin/field-properties">
    <input type="hidden" name="doctype" value="${escapeHtml(state.selectedDoctype)}">
    <input type="hidden" name="fieldName" value="${escapeHtml(selectedField)}">
    <input type="hidden" name="expectedVersion" value="${String(version)}">
    <div class="form-head"><h2>Field Properties</h2><p>v${String(version)}</p></div>
    <div class="fields">
      <label class="field"><span>Label</span><input name="label" value="${escapeHtml(overrides.label ?? "")}"></label>
      <label class="field"><span>Required</span><select name="required">${renderBooleanOverrideOptions(overrides.required)}</select></label>
      <label class="field"><span>Read Only</span><select name="readOnly">${renderBooleanOverrideOptions(overrides.readOnly)}</select></label>
      <label class="field"><span>Hidden</span><select name="hidden">${renderBooleanOverrideOptions(overrides.hidden)}</select></label>
      <label class="field"><span>Form View</span><select name="inFormView">${renderBooleanOverrideOptions(overrides.inFormView)}</select></label>
      <label class="field"><span>Global Search</span><select name="inGlobalSearch">${renderBooleanOverrideOptions(overrides.inGlobalSearch)}</select></label>
      <label class="field"><span>List View</span><select name="inListView">${renderBooleanOverrideOptions(overrides.inListView)}</select></label>
      <label class="field"><span>List Filter</span><select name="inListFilter">${renderBooleanOverrideOptions(overrides.inListFilter)}</select></label>
      <label class="field"><span>Options</span><input name="options" value="${escapeHtml((overrides.options ?? []).join(", "))}"></label>
      <label class="field"><span>Minimum</span><input name="min" type="number" step="any" value="${escapeHtml(overrides.min === undefined ? "" : String(overrides.min))}"></label>
      <label class="field"><span>Maximum</span><input name="max" type="number" step="any" value="${escapeHtml(overrides.max === undefined ? "" : String(overrides.max))}"></label>
      <label class="field"><span>Default JSON</span><textarea name="defaultValue">${escapeHtml(overrides.defaultValue === undefined ? "" : JSON.stringify(overrides.defaultValue))}</textarea></label>
    </div>
    <div class="actions">
      <button class="button primary" type="submit">Save Properties</button>
      ${current ? `<button class="button danger" type="submit" formaction="/desk/admin/field-properties/${encodeURIComponent(state.selectedDoctype)}/${encodeURIComponent(selectedField)}/clear">Clear Override</button>` : ""}
    </div>
  </form>
  <section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Field</th><th>Overrides</th><th>Updated</th><th>Actions</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="empty">No field property overrides configured.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

export interface WorkflowAdminState {
  readonly doctypes: readonly DocTypeDefinition[];
  readonly selectedDoctype: string;
  readonly state?: WorkflowDefinitionState;
  readonly error?: string;
}

export function renderWorkflowAdmin(state: WorkflowAdminState): string {
  const version = state.state?.version ?? 0;
  const workflow = state.state?.workflow;
  const states = workflow?.states.join("\n") ?? "";
  const transitions = workflow?.transitions.map(renderWorkflowTransitionLine).join("\n") ?? "";
  const rows = workflow?.transitions
    .map((transition) => `<tr>
      <td>${escapeHtml(transition.action)}</td>
      <td>${escapeHtml(transition.from)}</td>
      <td>${escapeHtml(transition.to)}</td>
      <td>${escapeHtml((transition.roles ?? []).join(", "))}</td>
      <td>${escapeHtml(transition.eventType ?? "")}</td>
    </tr>`)
    .join("");
  return `<form class="panel form" method="get" action="/desk/admin/workflows">
    <div class="fields cols-1">
      <label class="field"><span>DocType</span><select name="doctype">${renderWorkflowDoctypeOptions(state.doctypes, state.selectedDoctype)}</select></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Load</button></div>
  </form>
  ${state.error ? `<p class="error" role="alert">${escapeHtml(state.error)}</p>` : ""}
  <form class="panel form" method="post" action="/desk/admin/workflows">
    <input type="hidden" name="doctype" value="${escapeHtml(state.selectedDoctype)}">
    <input type="hidden" name="expectedVersion" value="${String(version)}">
    <div class="form-head"><h2>Workflow Definition</h2><p>v${String(version)}</p></div>
    <div class="fields">
      <label class="field"><span>State Field</span><input name="stateField" value="${escapeHtml(workflow?.stateField ?? "workflow_state")}"></label>
      <label class="field"><span>Initial State</span><input name="initialState" value="${escapeHtml(workflow?.initialState ?? "")}"></label>
      <label class="field"><span>States</span><textarea name="states">${escapeHtml(states)}</textarea></label>
      <label class="field"><span>Transitions</span><textarea name="transitions">${escapeHtml(transitions)}</textarea></label>
    </div>
    <div class="actions">
      <button class="button primary" type="submit">Save Workflow</button>
      ${workflow ? `<button class="button danger" type="submit" formaction="/desk/admin/workflows/${encodeURIComponent(state.selectedDoctype)}/clear">Clear Override</button>` : ""}
    </div>
  </form>
  <section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Action</th><th>From</th><th>To</th><th>Roles</th><th>Event Type</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5" class="empty">No workflow override configured.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

export function renderPrintSettingsAdmin(
  state: PrintSettingsState,
  options: { readonly error?: string } = {}
): string {
  const layout = state.settings.defaultLayout;
  return `${options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : ""}
  <form class="panel form" method="post" action="/desk/admin/print-settings">
    <input type="hidden" name="expectedVersion" value="${String(state.version)}">
    <div class="form-head"><h2>Default Print Layout</h2><p>v${String(state.version)}</p></div>
    <div class="fields">
      <label class="field"><span>Page Size</span><select name="pageSize">${renderPrintPageSizeOptions(layout)}</select></label>
      <label class="field"><span>Orientation</span><select name="orientation">${renderPrintOrientationOptions(layout)}</select></label>
      <label class="field"><span>Custom Width (mm)</span><input name="customWidthMm" type="number" step="any" min="1" max="2000" value="${printCustomPageSizeValue(layout, "widthMm")}"></label>
      <label class="field"><span>Custom Height (mm)</span><input name="customHeightMm" type="number" step="any" min="1" max="2000" value="${printCustomPageSizeValue(layout, "heightMm")}"></label>
      <label class="field"><span>Top Margin (mm)</span><input name="topMm" type="number" step="any" min="0" max="100" value="${printMarginValue(layout, "topMm")}"></label>
      <label class="field"><span>Right Margin (mm)</span><input name="rightMm" type="number" step="any" min="0" max="100" value="${printMarginValue(layout, "rightMm")}"></label>
      <label class="field"><span>Bottom Margin (mm)</span><input name="bottomMm" type="number" step="any" min="0" max="100" value="${printMarginValue(layout, "bottomMm")}"></label>
      <label class="field"><span>Left Margin (mm)</span><input name="leftMm" type="number" step="any" min="0" max="100" value="${printMarginValue(layout, "leftMm")}"></label>
      <label class="field"><span>Font Family</span><input name="fontFamily" value="${escapeHtml(layout?.font?.family ?? "")}"></label>
      <label class="field"><span>Font Size (pt)</span><input name="fontSizePt" type="number" step="any" min="6" max="72" value="${printNumberValue(layout?.font?.sizePt)}"></label>
    </div>
    <div class="choices">
      <label class="choice"><input type="checkbox" name="clearDefaultLayout" value="1"><span>Clear Default Layout</span></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Save Settings</button></div>
  </form>`;
}

function renderPrintPageSizeOptions(layout: PrintLayoutDefinition | undefined): string {
  const selected = typeof layout?.pageSize === "string" ? layout.pageSize : "";
  return [
    `<option value=""${selected === "" ? " selected" : ""}></option>`,
    ...PRINT_PAGE_SIZE_NAMES.map(
      (pageSize) =>
        `<option value="${escapeHtml(pageSize)}"${pageSize === selected ? " selected" : ""}>${escapeHtml(pageSize)}</option>`
    )
  ].join("");
}

function renderPrintOrientationOptions(layout: PrintLayoutDefinition | undefined): string {
  const selected = layout?.orientation ?? "";
  return [
    `<option value=""${selected === "" ? " selected" : ""}></option>`,
    ...PRINT_PAGE_ORIENTATIONS.map(
      (orientation) =>
        `<option value="${escapeHtml(orientation)}"${orientation === selected ? " selected" : ""}>${escapeHtml(printOrientationLabel(orientation))}</option>`
    )
  ].join("");
}

function printOrientationLabel(orientation: (typeof PRINT_PAGE_ORIENTATIONS)[number]): string {
  return orientation === "landscape" ? "Landscape" : "Portrait";
}

function printMarginValue(
  layout: PrintLayoutDefinition | undefined,
  side: keyof NonNullable<PrintLayoutDefinition["margins"]>
): string {
  return printNumberValue(layout?.margins?.[side]);
}

function printCustomPageSizeValue(
  layout: PrintLayoutDefinition | undefined,
  dimension: "widthMm" | "heightMm"
): string {
  return layout?.pageSize === undefined || typeof layout.pageSize === "string"
    ? ""
    : printNumberValue(layout.pageSize[dimension]);
}

function printNumberValue(value: number | undefined): string {
  return value === undefined ? "" : escapeHtml(String(value));
}

function renderCustomFieldDoctypeOptions(doctypes: readonly DocTypeDefinition[], selectedDoctype: string): string {
  return doctypes
    .map((doctype) => `<option value="${escapeHtml(doctype.name)}"${doctype.name === selectedDoctype ? " selected" : ""}>${escapeHtml(doctype.label ?? doctype.name)}</option>`)
    .join("");
}

function renderFieldPropertyFieldOptions(doctype: DocTypeDefinition | undefined, selectedField: string): string {
  return (doctype?.fields ?? [])
    .map(
      (field) =>
        `<option value="${escapeHtml(field.name)}"${field.name === selectedField ? " selected" : ""}>${escapeHtml(field.label ?? field.name)}</option>`
    )
    .join("");
}

function renderBooleanOverrideOptions(value: boolean | undefined): string {
  return [
    `<option value=""${value === undefined ? " selected" : ""}>Inherit</option>`,
    `<option value="true"${value === true ? " selected" : ""}>True</option>`,
    `<option value="false"${value === false ? " selected" : ""}>False</option>`
  ].join("");
}

function renderFieldPropertyOverrides(overrides: FieldPropertyOverrideState["fields"][number]["overrides"]): string {
  return [
    overrides.label === undefined ? "" : `label: ${overrides.label}`,
    overrides.required === undefined ? "" : `required: ${String(overrides.required)}`,
    overrides.readOnly === undefined ? "" : `read only: ${String(overrides.readOnly)}`,
    overrides.hidden === undefined ? "" : `hidden: ${String(overrides.hidden)}`,
    overrides.inFormView === undefined ? "" : `form: ${String(overrides.inFormView)}`,
    overrides.inGlobalSearch === undefined ? "" : `search: ${String(overrides.inGlobalSearch)}`,
    overrides.inListView === undefined ? "" : `list: ${String(overrides.inListView)}`,
    overrides.inListFilter === undefined ? "" : `filter: ${String(overrides.inListFilter)}`,
    overrides.options === undefined ? "" : `options: ${overrides.options.join(", ")}`,
    overrides.min === undefined ? "" : `min: ${String(overrides.min)}`,
    overrides.max === undefined ? "" : `max: ${String(overrides.max)}`,
    overrides.defaultValue === undefined ? "" : `default: ${JSON.stringify(overrides.defaultValue)}`
  ].filter(Boolean).join("; ");
}

function renderWorkflowDoctypeOptions(doctypes: readonly DocTypeDefinition[], selectedDoctype: string): string {
  return renderCustomFieldDoctypeOptions(doctypes, selectedDoctype);
}

function renderWorkflowTransitionLine(
  transition: NonNullable<WorkflowDefinitionState["workflow"]>["transitions"][number]
): string {
  return [
    transition.action,
    transition.from,
    transition.to,
    (transition.roles ?? []).join(", "),
    transition.eventType ?? ""
  ].join(" | ");
}

function renderCustomFieldTypeOptions(): string {
  return FIELD_TYPES
    .map((type) => `<option value="${escapeHtml(type)}">${escapeHtml(type)}</option>`)
    .join("");
}

function renderCustomFieldCheckbox(name: string, label: string): string {
  return `<label class="choice"><input type="checkbox" name="${escapeHtml(name)}" value="1"><span>${escapeHtml(label)}</span></label>`;
}

function renderCustomFieldDetails(field: FieldDefinition): string {
  return [
    field.options && field.options.length > 0 ? `options: ${field.options.join(", ")}` : "",
    field.linkTo ? `link: ${field.linkTo}` : "",
    field.tableOf ? `table: ${field.tableOf}` : "",
    field.min !== undefined ? `min: ${String(field.min)}` : "",
    field.max !== undefined ? `max: ${String(field.max)}` : "",
    field.defaultValue !== undefined ? `default: ${JSON.stringify(field.defaultValue)}` : ""
  ].filter(Boolean).map(escapeHtml).join("<br>");
}

function renderCustomFieldFlags(field: FieldDefinition): string {
  return [
    field.required ? "required" : "",
    field.readOnly ? "read only" : "",
    field.hidden ? "hidden" : "",
    field.inFormView ? "form" : "",
    field.inListView ? "list" : "",
    field.inListFilter ? "filter" : ""
  ].filter(Boolean).join(", ");
}

export function renderJobAdmin(
  dashboard: JobExecutionDashboard,
  options: { readonly allowRetry?: boolean; readonly showSchedulesLink?: boolean } = {}
): string {
  const jobRows = dashboard.jobs
    .map((job) => {
      const retry = job.retry ? JSON.stringify(job.retry) : "";
      return `<tr>
        <td>${escapeHtml(job.name)}</td>
        <td>${escapeHtml(job.pool ?? "default")}</td>
        <td>${escapeHtml(job.description ?? "")}</td>
        <td>${escapeHtml(retry)}</td>
      </tr>`;
    })
    .join("");
  const executionRows = dashboard.executions
    .map(
      (record) => `<tr>
        <td>${escapeHtml(record.idempotencyKey)}</td>
        <td>${escapeHtml(record.jobName)}</td>
        <td>${escapeHtml(record.runId)}</td>
        <td>${escapeHtml(record.status)}</td>
        <td>${escapeHtml(record.startedAt)}</td>
        <td>${escapeHtml(record.finishedAt ?? "")}</td>
        <td>${escapeHtml(record.result === undefined ? record.error ?? "" : JSON.stringify(record.result))}</td>
        <td>${options.allowRetry ? renderJobRetryAction(record.idempotencyKey, record.status) : ""}</td>
      </tr>`
    )
    .join("");
  return `<form class="panel form list-filters" method="get" action="/desk/admin/jobs">
    <div class="fields">
      <label class="field"><span>Job</span><input name="job" value="${escapeHtml(dashboard.filters.jobName ?? "")}"></label>
      <label class="field"><span>Status</span><select name="status">${renderJobStatusOptions(dashboard.filters.status)}</select></label>
      <label class="field"><span>Run ID</span><input name="run_id" value="${escapeHtml(dashboard.filters.runId ?? "")}"></label>
      <label class="field"><span>Limit</span><input name="limit" type="number" min="1" value="${String(dashboard.limit)}"></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Filter</button></div>
  </form>
  ${options.showSchedulesLink ? `<section class="toolbar"><a class="button" href="/desk/admin/jobs/schedules">Schedules</a></section>` : ""}
  <section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Job</th><th>Pool</th><th>Description</th><th>Retry</th></tr></thead>
        <tbody>${jobRows || `<tr><td colspan="4" class="empty">No jobs registered.</td></tr>`}</tbody>
      </table>
    </div>
  </section>
  <section class="panel job-history">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Idempotency Key</th><th>Job</th><th>Run ID</th><th>Status</th><th>Started</th><th>Finished</th><th>Result / Error</th><th>Action</th></tr></thead>
        <tbody>${executionRows || `<tr><td colspan="8" class="empty">No executions recorded.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

export function renderDataPatchAdmin(
  dashboard: DataPatchDashboard,
  options: {
    readonly error?: string;
    readonly plan?: DataPatchApplyPlan | DataPatchRollbackPlan;
    readonly planKind?: "apply" | "rollback";
    readonly queue?: DataPatchQueueControls;
  } = {}
): string {
  const canPlanRollback = dashboard.patches.some((patch) => patch.rollbackable === true);
  const queue = options.queue ?? { apply: false, rollback: false, rollbackRetry: false };
  const showBatchQueueOptions = queue.apply || (canPlanRollback && queue.rollback);
  const rows = dashboard.patches
    .map((patch) => `<tr>
      <td>${escapeHtml(patch.id)}</td>
      <td>${escapeHtml(patch.label ?? "")}</td>
      <td>${escapeHtml(patch.checksum)}</td>
      <td>${escapeHtml(patch.status)}</td>
      <td>${escapeHtml(dataPatchTimestamp(patch))}</td>
      <td>${escapeHtml(dataPatchDetail(patch))}</td>
      <td>${renderDataPatchAction(patch, queue)}</td>
    </tr>`)
    .join("");
  return `<form class="panel form" method="post" action="/desk/admin/data-patches/apply">
    <div class="form-head"><h2>Apply Pending Patches</h2><p>${String(dashboard.totals.notApplied)} pending</p></div>
    ${options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : ""}
    ${options.plan ? renderDataPatchPlan(options.plan, options.planKind ?? "apply") : ""}
    <div class="fields">
      <label class="field"><span>Limit</span><input name="limit" type="number" min="1" value="1"></label>
      ${showBatchQueueOptions ? renderDataPatchQueueFields() : ""}
    </div>
    <div class="actions">
      <button class="button" type="submit" formaction="/desk/admin/data-patches/plan">Plan Batch</button>
      ${queue.apply ? `<button class="button" type="submit" formaction="/desk/admin/data-patches/enqueue">Enqueue Batch</button>` : ""}
      ${canPlanRollback ? `<button class="button" type="submit" formaction="/desk/admin/data-patches/rollback-plan">Plan Rollback Batch</button>` : ""}
      ${canPlanRollback && queue.rollback ? `<button class="button" type="submit" formaction="/desk/admin/data-patches/rollback-enqueue">Enqueue Rollback Batch</button>` : ""}
      ${canPlanRollback ? `<button class="button" type="submit" formaction="/desk/admin/data-patches/rollback">Rollback Batch</button>` : ""}
      <button class="button primary" type="submit">Apply Batch</button>
    </div>
  </form>
  <section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Patch</th><th>Label</th><th>Checksum</th><th>Status</th><th>Timestamp</th><th>Result / Error</th><th>Action</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="empty">No data patches registered.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

function renderDataPatchQueueFields(): string {
  return `<label class="field"><span>Idempotency Key</span><input name="idempotencyKey" maxlength="${MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH}"></label>
      <label class="field"><span>Delay Seconds</span><input name="delaySeconds" type="number" min="0" max="${MAX_JOB_QUEUE_DELAY_SECONDS}"></label>`;
}

function renderDataPatchAction(
  patch: DataPatchDashboardEntry,
  queue: DataPatchQueueControls
): string {
  const patchId = encodeURIComponent(patch.id);
  if (patch.status === "not_applied") {
    return `<div class="data-patch-actions">
      <form class="inline-action data-patch-command-action" method="post">
        <button class="button" type="submit" formaction="/desk/admin/data-patches/${patchId}/plan">Plan</button>
        <button class="button" type="submit" formaction="/desk/admin/data-patches/${patchId}/apply">Apply</button>
      </form>
      ${queue.apply ? renderDataPatchQueueAction(`/desk/admin/data-patches/${patchId}/enqueue`, "Enqueue") : ""}
    </div>`;
  }
  if (patch.status === "failed") {
    return `<form class="inline-action" method="post">
      <button class="button" type="submit" formaction="/desk/admin/data-patches/${patchId}/retry">Retry</button>
    </form>`;
  }
  if (patch.status === "rollback_failed") {
    return `<div class="data-patch-actions">
      <form class="inline-action data-patch-command-action" method="post">
        <button class="button" type="submit" formaction="/desk/admin/data-patches/${patchId}/rollback-retry">Retry Rollback</button>
      </form>
      ${queue.rollbackRetry ? renderDataPatchQueueAction(`/desk/admin/data-patches/${patchId}/rollback-retry-enqueue`, "Enqueue Retry") : ""}
    </div>`;
  }
  if (patch.status === "applied" && patch.rollbackable === true) {
    const label = patch.rollbackLabel ?? "Plan Rollback";
    return `<div class="data-patch-actions">
      <form class="inline-action data-patch-command-action" method="post">
        <button class="button" type="submit" formaction="/desk/admin/data-patches/${patchId}/rollback-plan">${escapeHtml(label)}</button>
        <button class="button" type="submit" formaction="/desk/admin/data-patches/${patchId}/rollback">Rollback</button>
      </form>
      ${queue.rollback ? renderDataPatchQueueAction(`/desk/admin/data-patches/${patchId}/rollback-enqueue`, "Enqueue Rollback") : ""}
    </div>`;
  }
  return "";
}

function renderDataPatchQueueAction(action: string, label: string): string {
  return `<form class="inline-action data-patch-queue-action" method="post" action="${escapeHtml(action)}">
    <input name="idempotencyKey" maxlength="${MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH}" placeholder="Idempotency Key" aria-label="Idempotency Key">
    <input name="delaySeconds" type="number" min="0" max="${MAX_JOB_QUEUE_DELAY_SECONDS}" placeholder="Delay Seconds" aria-label="Delay Seconds">
    <button class="button" type="submit">${escapeHtml(label)}</button>
  </form>`;
}

function renderDataPatchPlan(plan: DataPatchApplyPlan | DataPatchRollbackPlan, kind: "apply" | "rollback"): string {
  const planned = plan.patchIds.length === 0 ? "(none)" : plan.patchIds.join(", ");
  const requested = plan.requestedPatchIds === undefined ? "" : `<p>Requested: ${escapeHtml(plan.requestedPatchIds.join(", "))}</p>`;
  const limit = plan.limit === undefined ? "" : `<p>Limit: ${String(plan.limit)}</p>`;
  return `<section class="notice">
    <h3>${kind === "rollback" ? "Planned Rollback" : "Planned Patches"}</h3>
    <p>${escapeHtml(planned)}</p>
    ${requested}
    ${limit}
  </section>`;
}

function dataPatchTimestamp(patch: DataPatchDashboardEntry): string {
  return patch.rolledBackAt ??
    patch.rollbackFailedAt ??
    patch.rollbackClaimedAt ??
    patch.appliedAt ??
    patch.failedAt ??
    patch.claimedAt ??
    "";
}

function dataPatchDetail(patch: DataPatchDashboardEntry): string {
  if (patch.status === "failed") {
    return patch.error ?? "";
  }
  if (patch.status === "rollback_failed") {
    return patch.rollbackError ?? "";
  }
  if (patch.status === "rolled_back" && patch.rollbackResult !== undefined) {
    return JSON.stringify(patch.rollbackResult);
  }
  if (patch.status === "applied" && patch.result !== undefined) {
    return JSON.stringify(patch.result);
  }
  return "";
}

function renderJobRetryAction(idempotencyKey: string, status: JobExecutionDashboard["executions"][number]["status"]): string {
  if (status !== "failed") {
    return "";
  }
  return `<form class="inline-action" method="post">
    <button class="button" type="submit" formaction="/desk/admin/jobs/${encodeURIComponent(idempotencyKey)}/retry">Retry</button>
  </form>`;
}

export function renderJobScheduleAdmin(
  dashboard: JobScheduleDashboard,
  options: {
    readonly allowRun?: boolean;
    readonly allowOverride?: boolean;
    readonly allowEdit?: boolean;
    readonly showHistoryLink?: boolean;
  } = {}
): string {
  const rows = dashboard.schedules
    .map((schedule) => `<tr>
        <td>${escapeHtml(schedule.source)}</td>
        <td>${escapeHtml(schedule.id)}</td>
        <td>${escapeHtml(schedule.cron)}</td>
        <td>${escapeHtml(schedule.jobName)}</td>
        <td>${escapeHtml(schedule.tenantId ?? (schedule.dynamic.tenantId ? "dynamic" : ""))}</td>
        <td>${schedule.enabled ? "yes" : "no"}</td>
        <td>${escapeHtml(scheduleOverrideState(schedule))}</td>
        <td>${schedule.registered ? "yes" : "no"}</td>
        <td>${escapeHtml(schedule.delaySeconds === undefined ? "" : String(schedule.delaySeconds))}</td>
        <td>${escapeHtml(dynamicScheduleFields(schedule))}</td>
        <td>${options.allowRun ? renderScheduleRunAction(schedule.id, schedule.dispatchable, dashboard.filters) : ""}${options.allowOverride ? renderScheduleOverrideAction(schedule, dashboard.filters) : ""}${options.allowEdit ? renderScheduleDefinitionAction(schedule, dashboard.filters) : ""}</td>
      </tr>`)
    .join("");
  const editor = options.allowEdit ? renderJobScheduleEditor(dashboard.filters) : "";
  return `${editor}<form class="panel form list-filters" method="get" action="/desk/admin/jobs/schedules">
    <div class="fields">
      <label class="field"><span>Cron</span><input name="cron" value="${escapeHtml(dashboard.filters.cron ?? "")}"></label>
      <label class="field"><span>Job</span><input name="job" value="${escapeHtml(dashboard.filters.jobName ?? "")}"></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Filter</button></div>
  </form>
  ${options.showHistoryLink ? `<section class="toolbar">
    <a class="button" href="/desk/admin/jobs">Execution history</a>
  </section>` : ""}
  <section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Source</th><th>ID</th><th>Cron</th><th>Job</th><th>Tenant</th><th>Enabled</th><th>Override</th><th>Registered</th><th>Delay</th><th>Dynamic</th><th>Action</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="11" class="empty">No schedules configured.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

function renderJobScheduleEditor(filters: JobScheduleDashboard["filters"]): string {
  return `<form class="panel form" method="post" action="/desk/admin/jobs/schedules">
    ${renderJobScheduleReturnFields(filters)}
    <div class="fields">
      <label class="field"><span>ID</span><input name="id"></label>
      <label class="field"><span>Cron</span><input name="cron" required></label>
      <label class="field"><span>Job</span><input name="jobName" required></label>
      <label class="field"><span>Delay</span><input name="delaySeconds" type="number" min="0" max="${MAX_JOB_QUEUE_DELAY_SECONDS}"></label>
      <label class="field checkbox"><input name="enabled" value="true" type="checkbox" checked><span>Enabled</span></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Save runtime schedule</button></div>
  </form>`;
}

function renderScheduleRunAction(
  scheduleId: string,
  dispatchable: boolean,
  filters: JobScheduleDashboard["filters"]
): string {
  if (!dispatchable) {
    return "";
  }
  return `<form class="inline-action" method="post">
    ${renderJobScheduleReturnFields(filters)}
    <button class="button" type="submit" formaction="/desk/admin/jobs/schedules/${encodeURIComponent(scheduleId)}/run">Run</button>
  </form>`;
}

function renderScheduleOverrideAction(
  schedule: JobScheduleDashboard["schedules"][number],
  filters: JobScheduleDashboard["filters"]
): string {
  if (!schedule.overrideable) {
    return "";
  }
  const baseEnabled = schedule.overrideEnabled ?? schedule.configuredEnabled;
  const action = baseEnabled ? "disable" : "enable";
  const label = baseEnabled ? "Disable" : "Enable";
  const reset = schedule.overridden
    ? `<button class="button" type="submit" formaction="/desk/admin/jobs/schedules/${encodeURIComponent(schedule.id)}/reset">Reset</button>`
    : "";
  return `<form class="inline-action" method="post">
    ${renderJobScheduleReturnFields(filters)}
    <button class="button" type="submit" formaction="/desk/admin/jobs/schedules/${encodeURIComponent(schedule.id)}/${action}">${label}</button>
    <input name="pauseUntil" placeholder="Pause until ISO time" value="${escapeHtml(schedule.pausedUntil ?? "")}">
    <button class="button" type="submit" formaction="/desk/admin/jobs/schedules/${encodeURIComponent(schedule.id)}/pause">Pause</button>
    ${reset}
  </form>`;
}

function scheduleOverrideState(schedule: JobScheduleDashboard["schedules"][number]): string {
  const parts = [
    schedule.overrideEnabled === undefined ? "" : schedule.overrideEnabled ? "enabled" : "disabled",
    schedule.pausedUntil === undefined ? "" : `paused until ${schedule.pausedUntil}`
  ].filter(Boolean);
  return parts.join(", ");
}

function renderScheduleDefinitionAction(
  schedule: JobScheduleDashboard["schedules"][number],
  filters: JobScheduleDashboard["filters"]
): string {
  if (!schedule.editable) {
    return "";
  }
  return `<form class="inline-action" method="post">
    ${renderJobScheduleReturnFields(filters)}
    <button class="button" type="submit" formaction="/desk/admin/jobs/schedules/${encodeURIComponent(schedule.id)}/delete">Delete</button>
  </form>`;
}

function renderJobScheduleReturnFields(filters: JobScheduleDashboard["filters"]): string {
  return [
    filters.cron === undefined ? "" : `<input type="hidden" name="returnCron" value="${escapeHtml(filters.cron)}">`,
    filters.jobName === undefined ? "" : `<input type="hidden" name="returnJob" value="${escapeHtml(filters.jobName)}">`
  ].filter(Boolean).join("");
}

function dynamicScheduleFields(schedule: JobScheduleDashboard["schedules"][number]): string {
  return [
    schedule.dynamic.enabled ? "enabled" : "",
    schedule.dynamic.tenantId ? "tenant" : "",
    schedule.dynamic.payload ? "payload" : "",
    schedule.dynamic.metadata ? "metadata" : "",
    schedule.dynamic.idempotencyKey ? "idempotency" : ""
  ].filter((field) => field !== "").join(", ");
}

export function renderReportView(
  result: ReportRunResult,
  options: {
    readonly exportHref?: string;
    readonly printHref?: string;
    readonly pdfHref?: string;
    readonly drilldownBaseHref?: string;
  } = {}
): string {
  const filterForm = result.filters.map(renderReportFilterControl).join("");
  const orderForm = renderReportOrderControls(result.order);
  const controls = `${filterForm}${orderForm}`;
  const headers = result.columns.map((column) => `<th>${escapeHtml(column.label ?? column.name)}</th>`).join("");
  const rows = result.rows
    .map(
      (row) =>
        `<tr>${result.columns
          .map((column) => `<td>${escapeHtml(formatValue(row[column.name]))}</td>`)
          .join("")}</tr>`
    )
    .join("");
  const exportAction = options.exportHref
    ? `<a class="button" href="${escapeHtml(options.exportHref)}">Export CSV</a>`
    : "";
  const printAction = options.printHref
    ? `<a class="button" href="${escapeHtml(options.printHref)}">Print</a>`
    : "";
  const pdfAction = options.pdfHref
    ? `<a class="button" href="${escapeHtml(options.pdfHref)}">PDF</a>`
    : "";
  const actions = `${exportAction}${printAction}${pdfAction}`;
  return `${controls ? `<form class="panel form report-filters" method="get"><div class="fields">${controls}</div><div class="actions"><button class="button primary" type="submit">Run</button>${actions}</div></form>` : actions ? `<section class="toolbar">${actions}</section>` : ""}
  ${renderReportSummary(result.summary)}
  ${renderReportCharts(result.charts, options.drilldownBaseHref)}
  ${renderReportGroups(result.groups)}
  <section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr>${headers}</tr></thead>
        <tbody>${rows || `<tr><td colspan="${result.columns.length}" class="empty">No rows matched.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

function renderReportFilterControl(filter: ReportRunResult["filters"][number]): string {
  const id = `filter-${slug(filter.name)}`;
  const name = `filter_${escapeHtml(filter.name)}`;
  const label = escapeHtml(filter.label);
  const value = formatFormValue(filter.value);
  const required = filter.required ? " required" : "";
  if (filter.operator === "between" || filter.operator === "not_between") {
    const values = Array.isArray(filter.value) ? filter.value : [];
    const type = inputTypeForFieldType(filter.type);
    return [
      `<label class="field" for="${id}-min"><span>${label} from</span><input id="${id}-min" name="${name}" type="${type}" value="${escapeHtml(formatFormValue(values[0]))}"${required}></label>`,
      `<label class="field" for="${id}-max"><span>${label} to</span><input id="${id}-max" name="${name}" type="${type}" value="${escapeHtml(formatFormValue(values[1]))}"${required}></label>`
    ].join("");
  }
  if (filter.type === "select") {
    return `<label class="field" for="${id}"><span>${label}</span><select id="${id}" name="${name}"${required}>${renderReportSelectOptions(filter.options, value)}</select></label>`;
  }
  if (filter.type === "boolean") {
    const options = [
      `<option value=""></option>`,
      `<option value="true"${value === "true" ? " selected" : ""}>True</option>`,
      `<option value="false"${value === "false" ? " selected" : ""}>False</option>`
    ].join("");
    return `<label class="field" for="${id}"><span>${label}</span><select id="${id}" name="${name}"${required}>${options}</select></label>`;
  }
  if (filter.type === "longText" || filter.type === "json") {
    return `<label class="field" for="${id}"><span>${label}</span><textarea id="${id}" name="${name}"${required}>${escapeHtml(value)}</textarea></label>`;
  }
  const type = inputTypeForFieldType(filter.type);
  return `<label class="field" for="${id}"><span>${label}</span><input id="${id}" name="${name}" type="${type}" value="${escapeHtml(value)}"${required}></label>`;
}

function renderReportOrderControls(order: ReportRunResult["order"]): string {
  if (order.options.length === 0) {
    return "";
  }
  const selectedOrderBy = order.orderBy ?? "";
  const orderByOptions = [
    `<option value=""></option>`,
    ...order.options.map((option) =>
      `<option value="${escapeHtml(option.name)}"${option.name === selectedOrderBy ? " selected" : ""}>${escapeHtml(option.label)}</option>`
    )
  ].join("");
  const orderOptions = [
    `<option value="asc"${order.order === "asc" ? " selected" : ""}>Ascending</option>`,
    `<option value="desc"${order.order === "desc" ? " selected" : ""}>Descending</option>`
  ].join("");
  return `<label class="field" for="report-order-by"><span>Order By</span><select id="report-order-by" name="order_by">${orderByOptions}</select></label>
    <label class="field" for="report-order"><span>Order</span><select id="report-order" name="order">${orderOptions}</select></label>`;
}

function renderReportSelectOptions(options: readonly string[], value: string): string {
  const rendered = [`<option value=""></option>`];
  if (value && !options.includes(value)) {
    rendered.push(`<option value="${escapeHtml(value)}" selected>${escapeHtml(value)}</option>`);
  }
  rendered.push(
    ...options.map((option) =>
      `<option value="${escapeHtml(option)}"${option === value ? " selected" : ""}>${escapeHtml(option)}</option>`
    )
  );
  return rendered.join("");
}

function renderJobStatusOptions(status: JobExecutionDashboard["filters"]["status"]): string {
  const options = ["", "running", "succeeded", "failed"];
  return options
    .map((value) => {
      const label = value === "" ? "Any status" : value;
      const selected = value === (status ?? "") ? " selected" : "";
      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function renderReportCharts(charts: ReportRunResult["charts"], drilldownBaseHref: string | undefined): string {
  if (charts.length === 0) {
    return "";
  }
  return `<section class="report-charts">${charts.map((chart) => renderReportChart(chart, drilldownBaseHref)).join("")}</section>`;
}

function renderReportChart(chart: ReportRunResult["charts"][number], drilldownBaseHref: string | undefined): string {
  return `<section class="panel report-chart">${renderReportChartBody(chart, drilldownBaseHref, chart.label)}</section>`;
}

function renderReportChartBody(
  chart: ReportRunResult["charts"][number],
  drilldownBaseHref: string | undefined,
  title: string
): string {
  const points = chart.points.filter((point) => point.value !== null);
  const svg = points.length === 0
    ? `<p class="empty">No chart data.</p>`
    : chart.type === "line"
      ? renderLineChart(chart, points, drilldownBaseHref)
      : chart.type === "pie"
        ? renderPieChart(chart, points, drilldownBaseHref)
        : renderBarChart(chart, points, drilldownBaseHref);
  return `<div class="report-chart-body">
    <h2>${escapeHtml(title)}</h2>
    ${svg}
  </div>`;
}

function renderBarChart(
  chart: ReportRunResult["charts"][number],
  points: readonly ReportChartPointResult[],
  drilldownBaseHref: string | undefined
): string {
  const width = 520;
  const height = 220;
  const chartHeight = 150;
  const scale = chartScale(points);
  const gap = 12;
  const barWidth = Math.max(12, (width - gap * (points.length + 1)) / points.length);
  const baseline = chartY(0, scale, chartHeight);
  const bars = points
    .map((point, index) => {
      const value = point.value ?? 0;
      const x = gap + index * (barWidth + gap);
      const valueY = chartY(value, scale, chartHeight);
      const y = Math.min(valueY, baseline);
      const barHeight = Math.max(1, Math.abs(baseline - valueY));
      const valueLabel = chart.showValues
        ? `<text x="${x + barWidth / 2}" y="${Math.max(14, y - 6)}" text-anchor="middle">${escapeHtml(formatValue(value))}</text>`
        : "";
      return renderChartPointLink(point, drilldownBaseHref, `<g>
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="3" style="fill: ${chartColor(chart, index)}"></rect>
        ${valueLabel}
        <text x="${x + barWidth / 2}" y="202" text-anchor="middle">${escapeHtml(point.label)}</text>
      </g>`);
    })
    .join("");
  return `<svg class="chart-svg chart-bar" role="img" aria-label="${escapeHtml(chartAriaLabel(chart))}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">${bars}${renderChartAxisLabels(chart, width, height)}</svg>`;
}

function renderLineChart(
  chart: ReportRunResult["charts"][number],
  points: readonly ReportChartPointResult[],
  drilldownBaseHref: string | undefined
): string {
  const width = 520;
  const height = 220;
  const scale = chartScale(points);
  const step = points.length <= 1 ? 0 : 440 / (points.length - 1);
  const coords = points.map((point, index) => {
    const x = 40 + index * step;
    const y = chartY(point.value ?? 0, scale, 140);
    return { point, x, y };
  });
  const path = coords.map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x} ${coord.y}`).join(" ");
  const markers = coords
    .map(
      ({ point, x, y }, index) => renderChartPointLink(point, drilldownBaseHref, `<g>
        <circle cx="${x}" cy="${y}" r="4" style="fill: ${chartColor(chart, index)}"></circle>
        ${chart.showValues ? `<text x="${x}" y="${Math.max(14, y - 8)}" text-anchor="middle">${escapeHtml(formatValue(point.value ?? 0))}</text>` : ""}
        <text x="${x}" y="202" text-anchor="middle">${escapeHtml(point.label)}</text>
      </g>`)
    )
    .join("");
  return `<svg class="chart-svg chart-line" role="img" aria-label="${escapeHtml(chartAriaLabel(chart))}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet"><path d="${path}" style="stroke: ${chartColor(chart, 0)}"></path>${markers}${renderChartAxisLabels(chart, width, height)}</svg>`;
}

function renderPieChart(
  chart: ReportRunResult["charts"][number],
  points: readonly ReportChartPointResult[],
  drilldownBaseHref: string | undefined
): string {
  const positivePoints = points.filter((point) => (point.value ?? 0) > 0);
  const total = positivePoints.reduce((sum, point) => sum + (point.value ?? 0), 0);
  if (total <= 0) {
    return `<p class="empty">No chart data.</p>`;
  }
  let offset = 0;
  const rings = positivePoints
    .map((point, index) => {
      const value = point.value ?? 0;
      const dash = (value / total) * 100;
      const circle = `<circle r="70" cx="110" cy="110" stroke-dasharray="${dash} ${100 - dash}" stroke-dashoffset="${-offset}" style="stroke: ${chartColor(chart, index)}"></circle>`;
      offset += dash;
      return renderChartPointLink(point, drilldownBaseHref, circle);
    })
    .join("");
  const legend = positivePoints
    .map((point, index) => {
      const value = chart.showValues ? ` (${escapeHtml(formatValue(point.value ?? 0))})` : "";
      return `<li>${renderChartPointLink(point, drilldownBaseHref, `<span class="chart-swatch chart-swatch-${index % 6}" style="background: ${chartColor(chart, index)}"></span>${escapeHtml(point.label)}${value}`)}</li>`;
    })
    .join("");
  return `<div class="chart-pie-wrap"><svg class="chart-svg chart-pie" role="img" aria-label="${escapeHtml(chart.label)}" viewBox="0 0 220 220">${rings}</svg><ul>${legend}</ul></div>`;
}

function renderChartPointLink(
  point: ReportChartPointResult,
  drilldownBaseHref: string | undefined,
  content: string
): string {
  const href = chartPointDrilldownHref(point, drilldownBaseHref);
  return href === undefined
    ? content
    : `<a class="chart-drilldown" href="${escapeHtml(href)}">${content}</a>`;
}

function chartPointDrilldownHref(
  point: ReportChartPointResult,
  drilldownBaseHref: string | undefined
): string | undefined {
  if (drilldownBaseHref === undefined || point.drilldown === undefined) {
    return undefined;
  }
  const url = new URL(drilldownBaseHref, "https://cf-frappe.local");
  const drilldown = new URLSearchParams(point.drilldown.query);
  drilldown.forEach((value, key) => {
    url.searchParams.set(key, value);
  });
  return `${url.pathname}${url.search}${url.hash}`;
}

const chartPalette = ["#1f6feb", "#2e7d32", "#ad1457", "#ef6c00", "#00695c", "#6a1b9a"];

function renderChartAxisLabels(chart: ReportRunResult["charts"][number], width: number, height: number): string {
  const xAxis = chart.xAxisLabel
    ? `<text class="chart-axis-label chart-axis-x" x="${width / 2}" y="${height - 4}" text-anchor="middle">${escapeHtml(chart.xAxisLabel)}</text>`
    : "";
  const yAxis = chart.yAxisLabel
    ? `<text class="chart-axis-label chart-axis-y" x="14" y="${height / 2}" text-anchor="middle" transform="rotate(-90 14 ${height / 2})">${escapeHtml(chart.yAxisLabel)}</text>`
    : "";
  return `${xAxis}${yAxis}`;
}

function chartAriaLabel(chart: ReportRunResult["charts"][number]): string {
  const labels = [chart.label, chart.xAxisLabel, chart.yAxisLabel].filter(Boolean);
  return labels.join(", ");
}

function chartColor(chart: ReportRunResult["charts"][number], index: number): string {
  const fallback = chartPalette[index % chartPalette.length]!;
  const color = chart.colors.length > 0 ? chart.colors[index % chart.colors.length] : undefined;
  return color && isReportChartColor(color) ? color : fallback;
}

function chartScale(points: readonly ReportRunResult["charts"][number]["points"][number][]): { readonly min: number; readonly max: number } {
  const values = points.map((point) => point.value ?? 0);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  return min === max ? { min: 0, max: 1 } : { min, max };
}

function chartY(value: number, scale: { readonly min: number; readonly max: number }, height: number): number {
  return 170 - ((value - scale.min) / (scale.max - scale.min)) * height;
}

function renderReportSummary(summary: ReportRunResult["summary"]): string {
  if (summary.length === 0) {
    return "";
  }
  const items = summary
    .map(
      (item) =>
        `<li><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(formatValue(item.value))}</strong></li>`
    )
    .join("");
  return `<section class="panel report-summary" aria-label="Report summary"><ul>${items}</ul></section>`;
}

function renderReportGroups(groups: ReportRunResult["groups"]): string {
  if (groups.length === 0) {
    return "";
  }
  return groups
    .map((group) => {
      const summaryHeaders = (group.rows[0]?.summaries ?? [])
        .map((summary) => `<th>${escapeHtml(summary.label)}</th>`)
        .join("");
      const rows = group.rows
        .map(
          (row) =>
            `<tr><td>${escapeHtml(row.label)}</td>${row.summaries
              .map((summary) => `<td>${escapeHtml(formatValue(summary.value))}</td>`)
              .join("")}</tr>`
        )
        .join("");
      return `<section class="panel report-group">
        <h2>${escapeHtml(group.label)}</h2>
        <div class="table-wrap">
          <table>
            <thead><tr><th>${escapeHtml(group.field)}</th>${summaryHeaders}</tr></thead>
            <tbody>${rows || `<tr><td colspan="2" class="empty">No rows matched.</td></tr>`}</tbody>
          </table>
        </div>
      </section>`;
    })
    .join("");
}

export function renderListView(
  doctype: DocTypeDefinition,
  listView: ResolvedListView,
  documents: readonly DocumentSnapshot[],
  filters: readonly ListDocumentsFilter[] = [],
  options: {
    readonly savedFilters?: readonly SavedListFilter[];
    readonly selectedSavedFilterId?: string;
    readonly filterExpression?: ListFilterExpression;
    readonly exportHref?: string;
    readonly clientScripts?: readonly ClientScriptDefinition[];
    readonly realtimeRoute?: string;
    readonly bulkActions?: readonly ListBulkAction[];
    readonly importModes?: readonly DocumentImportMode[];
    readonly importResult?: DocumentImportResult;
  } = {}
): string {
  const fields = listView.columns;
  const filterFields = listView.filterFields;
  const filterFieldMap = new Map(filterFields.map((field) => [field.name, field]));
  const filterForm = listView.filterControls
    .map((control) => {
      const field = filterFieldMap.get(control.field);
      return field ? renderFilterControl(field, filters, control) : "";
    })
    .join("");
  const compoundFilterForm = renderCompoundFilterBuilder(listView, options.filterExpression);
  const orderForm = renderListOrderControls(listView);
  const canSaveFilter = Boolean(filterForm || compoundFilterForm);
  const savedFilterControl = canSaveFilter
    ? `<label class="field" for="saved-filter-label"><span>Saved filter name</span><input id="saved-filter-label" name="saved_filter_label" type="text"></label>`
    : "";
  const saveFilterButton = canSaveFilter
    ? `<button class="button" type="submit" formmethod="post" formaction="/desk/${encodeURIComponent(doctype.name)}/saved-filters">Save filter</button>`
    : "";
  const savedFilterPanel = renderSavedFilters(doctype, options.savedFilters ?? [], options.selectedSavedFilterId);
  const header = fields.map((field) => `<th>${escapeHtml(field.label ?? field.name)}</th>`).join("");
  const bulkActions = options.bulkActions ?? [];
  const importModes = options.importModes ?? [];
  const selectableNames = new Set(bulkActions.flatMap((action) => action.names));
  const hasBulkActions = selectableNames.size > 0;
  const bulkActionFormId = "bulk-document-action";
  const rows = documents
    .map((document) => {
      const cells = fields
        .map((field) => `<td>${escapeHtml(formatValue(document.data[field.name]))}</td>`)
        .join("");
      const selectable = selectableNames.has(document.name);
      return `<tr>
        ${hasBulkActions ? renderBulkDocumentActionCell(document, selectable, bulkActionFormId) : ""}
        <td><a href="/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(document.name)}">${escapeHtml(document.name)}</a></td>
        ${cells}
        <td>${String(document.version)}</td>
        <td>${escapeHtml(document.updatedAt)}</td>
      </tr>`;
    })
    .join("");
  return `<section class="toolbar">
    <a class="button primary" href="/desk/${encodeURIComponent(doctype.name)}/new">New ${escapeHtml(labelFor(doctype))}</a>
    ${options.exportHref ? `<a class="button" href="${escapeHtml(options.exportHref)}">Export CSV</a>` : ""}
    ${hasBulkActions ? `<form id="${bulkActionFormId}" method="post" action="${escapeHtml(bulkActions[0]?.action ?? "")}"></form>${bulkActions.map((action) => renderListBulkActionButton(action, bulkActionFormId)).join("")}` : ""}
  </section>
  ${importModes.length > 0 ? renderListImportPanel(doctype, importModes, options.importResult) : ""}
  ${savedFilterPanel}
  ${filterForm || compoundFilterForm || orderForm ? `<form class="panel form list-filters" method="get"><div class="fields">${filterForm}${compoundFilterForm}${orderForm}${savedFilterControl}</div><div class="actions"><button class="button primary" type="submit">Filter</button>${saveFilterButton}<a class="button" href="/desk/${encodeURIComponent(doctype.name)}?default_filters=0">Clear</a></div></form>` : ""}
  <section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr>${hasBulkActions ? "<th>Select</th>" : ""}<th>Name</th>${header}<th>Version</th><th>Updated</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="${fields.length + (hasBulkActions ? 4 : 3)}" class="empty">No documents yet.</td></tr>`}</tbody>
      </table>
    </div>
  </section>
  ${renderClientScripts(doctype.name, "list", options.clientScripts ?? [], undefined, undefined, options.realtimeRoute)}`;
}

function renderListImportPanel(
  doctype: DocTypeDefinition,
  modes: readonly DocumentImportMode[],
  result: DocumentImportResult | undefined
): string {
  const action = `/desk/${encodeURIComponent(doctype.name)}/import.csv`;
  const selectedMode = result?.mode ?? modes[0];
  const modeOptions = modes
    .map((mode) => `<option value="${mode}"${selectedMode === mode ? " selected" : ""}>${mode === "create" ? "Create" : "Update"}</option>`)
    .join("");
  return `<section class="panel list-import">
    ${result ? renderListImportResult(result) : ""}
    <form class="form" method="post" action="${action}">
      <div class="fields">
        <label class="field" for="import-mode"><span>Import Mode</span><select id="import-mode" name="mode">
          ${modeOptions}
        </select></label>
        <label class="field wide" for="import-csv"><span>CSV</span><textarea id="import-csv" name="csv" rows="6" required></textarea></label>
      </div>
      <div class="actions"><button class="button" type="submit">Import CSV</button></div>
    </form>
  </section>`;
}

function renderListImportResult(result: DocumentImportResult): string {
  const failureRows = result.failed
    .map((failure) => `<li>Row ${String(failure.row)}${failure.name ? ` (${escapeHtml(failure.name)})` : ""}: ${escapeHtml(failure.message)}</li>`)
    .join("");
  return `<div class="${result.failed.length > 0 ? "error" : "notice"}" role="status">
    Imported ${String(result.succeeded.length)} of ${String(result.total)} ${escapeHtml(result.doctype)} rows.
    ${failureRows ? `<ul class="import-failures">${failureRows}</ul>` : ""}
  </div>`;
}

function renderCompoundFilterBuilder(
  listView: ResolvedListView,
  expression: ListFilterExpression | undefined
): string {
  if (listView.filterBuilderFields.length === 0) {
    return "";
  }
  const value = expression === undefined ? "" : JSON.stringify(expression, null, 2);
  const visualGroup = compoundFilterVisualGroup(expression);
  return `<fieldset class="compound-filter-builder" data-cf-frappe-compound-filter-builder data-filter-fields="${escapeHtml(JSON.stringify(listView.filterBuilderFields))}">
    <legend>Compound filters</legend>
    <div class="compound-filter-visual">
      ${renderCompoundFilterGroup(listView.filterBuilderFields, visualGroup, true)}
    </div>
    <template data-cf-frappe-filter-row-template>${renderCompoundFilterRow(listView.filterBuilderFields, undefined)}</template>
    <template data-cf-frappe-filter-group-template>${renderCompoundFilterGroup(listView.filterBuilderFields, { kind: "group", match: "all", filters: [] }, false)}</template>
    <label class="field wide" for="filter-expression"><span>Advanced JSON</span><textarea id="filter-expression" name="filter_expression" rows="5">${escapeHtml(value)}</textarea></label>
    ${expression === undefined ? "" : `<div class="filter-expression-preview">${renderListFilterExpression(expression)}</div>`}
  </fieldset>`;
}

function compoundFilterVisualGroup(expression: ListFilterExpression | undefined): ListFilterGroup {
  if (expression === undefined) {
    return { kind: "group", match: "all", filters: [] };
  }
  if (!isListFilterGroup(expression)) {
    return { kind: "group", match: "all", filters: [expression] };
  }
  return expression;
}

function renderCompoundFilterGroup(
  fields: readonly ListFilterBuilderField[],
  group: ListFilterGroup,
  root: boolean
): string {
  const items = group.filters.length > 0 ? group.filters : [undefined];
  return `<div class="compound-filter-group${root ? " compound-filter-root" : ""}" data-cf-frappe-filter-group>
    <div class="compound-filter-group-head">
      <label class="field compact"><span>Match</span><select data-cf-frappe-filter-match>${renderCompoundFilterMatchOptions(group.match)}</select></label>
      <div class="compound-filter-group-actions">
        <button class="button" type="button" data-cf-frappe-add-filter>Add condition</button>
        <button class="button" type="button" data-cf-frappe-add-filter-group>Add group</button>
        ${root ? "" : `<button class="button" type="button" data-cf-frappe-remove-filter-group>Remove group</button>`}
      </div>
    </div>
    <div class="compound-filter-items compound-filter-rows" data-cf-frappe-filter-items data-cf-frappe-filter-rows>${items
      .map((item) =>
        item === undefined
          ? renderCompoundFilterRow(fields, undefined)
          : isListFilterGroup(item)
            ? renderCompoundFilterGroup(fields, item, false)
            : renderCompoundFilterRow(fields, item)
      )
      .join("")}</div>
  </div>`;
}

function renderCompoundFilterMatchOptions(match: ListFilterGroupMatch): string {
  return [
    { value: "all", label: "All" },
    { value: "any", label: "Any" }
  ]
    .map((option) => `<option value="${option.value}"${option.value === match ? " selected" : ""}>${option.label}</option>`)
    .join("");
}

function renderCompoundFilterRow(
  fields: readonly ListFilterBuilderField[],
  filter: ListDocumentsFilter | undefined
): string {
  const fieldName = filter?.field ?? "";
  const operator = filter?.operator ?? "eq";
  const builderField = fields.find((field) => field.field === fieldName);
  const inputType = compoundFilterValueInputType(builderField?.inputType, operator);
  return `<div class="compound-filter-row" data-cf-frappe-filter-row>
    <label class="field compact"><span>Field</span><select data-cf-frappe-filter-field>${renderCompoundFilterFieldOptions(fields, fieldName)}</select></label>
    <label class="field compact"><span>Operator</span><select data-cf-frappe-filter-operator>${renderCompoundFilterOperatorOptions(fields, builderField, operator)}</select></label>
    <label class="field grow"><span>Value</span><input data-cf-frappe-filter-value type="${escapeHtml(inputType)}" value="${escapeHtml(filter === undefined ? "" : formatCompoundFilterVisualValue(filter.value))}"></label>
    <button class="button" type="button" data-cf-frappe-remove-filter>Remove</button>
  </div>`;
}

function compoundFilterValueInputType(
  inputType: ListFilterBuilderField["inputType"] | undefined,
  operator: ListFilterOperator
): string {
  if (operator === "in" || operator === "not_in" || operator === "between" || operator === "not_between") {
    return "text";
  }
  return inputType === "number" || inputType === "date" || inputType === "datetime-local" ? inputType : "text";
}

function formatCompoundFilterVisualValue(value: ListDocumentsFilter["value"]): string {
  return Array.isArray(value) ? value.map((item) => formatFormValue(item)).join(", ") : formatFormValue(value);
}

function renderCompoundFilterFieldOptions(
  fields: readonly ListFilterBuilderField[],
  selected: string
): string {
  return [`<option value=""></option>`]
    .concat(
      fields.map((field) =>
        `<option value="${escapeHtml(field.field)}"${field.field === selected ? " selected" : ""}>${escapeHtml(field.field)}</option>`
      )
    )
    .join("");
}

function renderCompoundFilterOperatorOptions(
  fields: readonly ListFilterBuilderField[],
  selectedField: ListFilterBuilderField | undefined,
  selected: ListFilterOperator
): string {
  const operators = selectedField?.operators ?? uniqueListFilterOperators(fields);
  return operators
    .map((operator) =>
      `<option value="${escapeHtml(operator.operator)}"${operator.operator === selected ? " selected" : ""}>${escapeHtml(operator.label)}</option>`
    )
    .join("");
}

function uniqueListFilterOperators(fields: readonly ListFilterBuilderField[]): ListFilterBuilderField["operators"] {
  const seen = new Set<ListFilterOperator>();
  return fields.flatMap((field) =>
    field.operators.filter((operator) => {
      if (seen.has(operator.operator)) {
        return false;
      }
      seen.add(operator.operator);
      return true;
    })
  );
}

function renderListFilterExpression(expression: ListFilterExpression): string {
  if (isListFilterGroup(expression)) {
    const label = expression.match === "all" ? "All" : "Any";
    return `<section class="filter-expression-group"><strong>${label}</strong><ul>${expression.filters
      .map((filter) => `<li>${renderListFilterExpression(filter)}</li>`)
      .join("")}</ul></section>`;
  }
  return `<span class="filter-expression-leaf">${escapeHtml(expression.field)} ${escapeHtml(expression.operator ?? "eq")} ${escapeHtml(formatValue(expression.value))}</span>`;
}

function renderListOrderControls(listView: ResolvedListView): string {
  return `<label class="field" for="list-order-by"><span>Order By</span><select id="list-order-by" name="order_by">${renderListOrderOptions(listView)}</select></label>
  <label class="field" for="list-order"><span>Direction</span><select id="list-order" name="order">${renderListOrderDirectionOptions(listView.order)}</select></label>`;
}

function renderListOrderOptions(listView: ResolvedListView): string {
  return listView.orderOptions
    .map(
      (option) =>
        `<option value="${escapeHtml(option.name)}"${option.name === listView.orderBy ? " selected" : ""}>${escapeHtml(option.label)}</option>`
    )
    .join("");
}

function renderListOrderDirectionOptions(order: ResolvedListView["order"]): string {
  return [
    { value: "desc", label: "Descending" },
    { value: "asc", label: "Ascending" }
  ]
    .map((option) => `<option value="${option.value}"${option.value === order ? " selected" : ""}>${option.label}</option>`)
    .join("");
}

function renderBulkDocumentActionCell(document: DocumentSnapshot, selectable: boolean, formId: string): string {
  if (!selectable) {
    return "<td></td>";
  }
  const name = escapeHtml(document.name);
  return `<td><input form="${formId}" name="document" type="checkbox" value="${name}" aria-label="Select ${name}"><input form="${formId}" name="expectedVersion:${name}" type="hidden" value="${String(document.version)}"></td>`;
}

function renderListBulkActionButton(action: ListBulkAction, formId: string): string {
  const classes = action.variant === "danger" ? "button danger" : "button";
  return `<button class="${classes}" type="submit" form="${formId}" formaction="${escapeHtml(action.action)}">${escapeHtml(action.label)}</button>`;
}

function renderSavedFilters(
  doctype: DocTypeDefinition,
  savedFilters: readonly SavedListFilter[],
  selectedId: string | undefined
): string {
  if (savedFilters.length === 0) {
    return "";
  }
  const items = savedFilters
    .map((filter) => {
      const href = `/desk/${encodeURIComponent(doctype.name)}?saved_filter=${encodeURIComponent(filter.id)}`;
      const deleteAction = `/desk/${encodeURIComponent(doctype.name)}/saved-filters/${encodeURIComponent(filter.id)}/delete`;
      return `<li>
        <a class="saved-filter-link${filter.id === selectedId ? " is-active" : ""}" href="${href}">${escapeHtml(filter.label)}</a>
        <form class="inline-action" method="post">
          <button class="button" type="submit" formaction="${deleteAction}">Delete</button>
        </form>
      </li>`;
    })
    .join("");
  return `<section class="panel saved-filters" aria-label="Saved filters">
    <h2>Saved filters</h2>
    <ul>${items}</ul>
  </section>`;
}

export function renderFormView(
  doctype: DocTypeDefinition,
  formView: ResolvedFormView,
  options: {
    readonly mode: "create" | "update";
    readonly document?: DocumentSnapshot;
    readonly error?: string;
    readonly linkOptions?: FormLinkOptions;
    readonly tableDefinitions?: FormTableDefinitions;
    readonly lifecycleActions?: readonly FormLifecycleAction[];
    readonly workflowActions?: readonly FormWorkflowAction[];
    readonly printFormats?: readonly PrintFormatDefinition[];
    readonly printPdfEnabled?: boolean;
    readonly clientScripts?: readonly ClientScriptDefinition[];
    readonly realtimeRoute?: string;
    readonly canDuplicate?: boolean;
    readonly canAmend?: boolean;
  }
): string {
  const action =
    options.mode === "create"
      ? `/desk/${encodeURIComponent(doctype.name)}`
      : `/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(options.document?.name ?? "")}`;
  const title = options.mode === "create" ? `New ${labelFor(doctype)}` : options.document?.name ?? doctype.name;
  const canSave = options.mode === "create" || options.document?.docstatus === "draft";
  const publicCommands = doctype.commands?.filter((command) => !command.internal) ?? [];
  const sections = formView.sections
    .map((section) =>
      renderFormSection(
        section,
        options.document,
        options.mode,
        options.linkOptions ?? {},
        options.tableDefinitions ?? {}
      )
    )
    .join("");
  const commands =
    options.mode === "update" && options.document?.docstatus === "draft" && publicCommands.length
      ? `<section class="command-row" aria-label="Commands">${publicCommands
          .map(
            (command) =>
              `<button class="button" formmethod="post" formaction="/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(options.document?.name ?? "")}/command/${encodeURIComponent(command.name)}">${escapeHtml(command.name)}</button>`
          )
          .join("")}</section>`
      : "";
  const lifecycleActions =
    options.mode === "update" && options.document && options.lifecycleActions?.length
      ? `<section class="command-row" aria-label="Lifecycle actions">${options.lifecycleActions
          .map((action) => {
            const label = action === "submit" ? "Submit" : "Cancel Document";
            return `<button class="button" formmethod="post" formaction="/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(options.document!.name)}/${action}">${escapeHtml(label)}</button>`;
          })
          .join("")}</section>`
      : "";
  const workflowActions =
    options.mode === "update" && options.document && options.workflowActions?.length
      ? `<section class="command-row" aria-label="Workflow actions">${options.workflowActions
          .map(
            (workflow) =>
              `<button class="button" formmethod="post" formaction="/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(options.document!.name)}/transition/${encodeURIComponent(workflow.action)}">${escapeHtml(workflow.label)}</button>`
          )
          .join("")}</section>`
      : "";
  const printLinks =
    options.mode === "update" && options.document && options.printFormats?.length
      ? `<section class="command-row" aria-label="Print formats">${options.printFormats
          .map((format) => renderPrintFormatLinks(format, options.document!, Boolean(options.printPdfEnabled)))
          .join("")}</section>`
      : "";
  const duplicateAction =
    options.mode === "update" && options.document && options.canDuplicate
      ? `<button class="button" type="submit" formmethod="post" formaction="/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(options.document.name)}/duplicate">Duplicate</button>`
      : "";
  const amendAction =
    options.mode === "update" && options.document?.docstatus === "cancelled" && options.canAmend
      ? `<button class="button" type="submit" formmethod="post" formaction="/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(options.document.name)}/amend">Amend</button>`
      : "";
  const versionField = options.document
    ? `<input type="hidden" name="expectedVersion" value="${String(options.document.version)}">`
    : "";
  return `<form class="panel form" method="post" action="${action}">
    <div class="form-head">
      <h2>${escapeHtml(title)}</h2>
      ${options.document ? `<p>v${String(options.document.version)} · ${escapeHtml(options.document.docstatus)}</p>` : ""}
    </div>
    ${versionField}
    ${options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : ""}
    ${sections}
    <div class="actions">
      <a class="button" href="/desk/${encodeURIComponent(doctype.name)}">Cancel</a>
      ${canSave ? `<button class="button primary" type="submit">${options.mode === "create" ? "Create" : "Save"}</button>` : ""}
      ${duplicateAction}
      ${amendAction}
    </div>
    ${commands}
    ${workflowActions}
    ${lifecycleActions}
    ${printLinks}
  </form>
  ${renderClientScripts(
    doctype.name,
    "form",
    options.clientScripts ?? [],
    options.document?.name,
    options.document?.tenantId,
    options.realtimeRoute,
    options.document
  )}`;
}

function renderPrintFormatLinks(format: PrintFormatDefinition, document: DocumentSnapshot, pdfEnabled: boolean): string {
  const baseHref = `/desk/print/${encodeURIComponent(format.name)}/${encodeURIComponent(document.name)}`;
  const label = format.label ?? format.name;
  const pdfLink = pdfEnabled ? `<a class="button" href="${baseHref}/pdf">${escapeHtml(label)} PDF</a>` : "";
  return `<a class="button" href="${baseHref}">${escapeHtml(label)}</a>${pdfLink}`;
}

function renderClientScripts(
  doctype: string,
  scope: Exclude<ClientScriptScope, "both"> | "report-builder",
  scripts: readonly ClientScriptDefinition[],
  documentName?: string,
  documentTenantId?: string,
  realtimeRoute?: string,
  document?: DocumentSnapshot
): string {
  const documentAttribute = documentName === undefined
    ? ""
    : ` data-document-name="${escapeHtml(documentName)}"`;
  const documentVersionAttribute = document === undefined
    ? ""
    : ` data-document-version="${String(document.version)}"`;
  const documentStatusAttribute = document === undefined
    ? ""
    : ` data-document-status="${escapeHtml(document.docstatus)}"`;
  const tenantAttribute = documentTenantId === undefined
    ? ""
    : ` data-tenant-id="${escapeHtml(documentTenantId)}"`;
  const realtimeAttribute = realtimeRoute === undefined
    ? ""
    : ` data-realtime-route="${escapeHtml(realtimeRoute)}"`;
  const runtime = `<script src="${DESK_CLIENT_SCRIPT_PATH}" data-cf-frappe-runtime="desk" data-doctype="${escapeHtml(doctype)}" data-scope="${scope}"${documentAttribute}${documentVersionAttribute}${documentStatusAttribute}${tenantAttribute}${realtimeAttribute}></script>`;
  const declared = scripts
    .map((script) => {
      const type = (script.type ?? "module") === "module" ? ' type="module"' : "";
      return `<script${type} src="${escapeHtml(script.src)}" data-cf-frappe-script="${escapeHtml(script.name)}" data-doctype="${escapeHtml(doctype)}" data-scope="${scope}"${documentAttribute}${documentVersionAttribute}${documentStatusAttribute}${tenantAttribute}${realtimeAttribute}></script>`;
    })
    .join("");
  return `${runtime}${declared}`;
}

export function renderDocumentTimeline(
  timeline: DocumentTimeline,
  options: {
    readonly allowComment?: boolean;
    readonly allowAssign?: boolean;
    readonly allowTag?: boolean;
    readonly allowFollow?: boolean;
    readonly allowShare?: boolean;
    readonly actorId?: string;
    readonly assignments?: DocumentAssignments;
    readonly tags?: DocumentTags;
    readonly followers?: DocumentFollowers;
    readonly shares?: DocumentSharePanelState;
  } = {}
): string {
  const rows = timeline.entries
    .map(
      (entry) => `<tr>
        <td>${String(entry.sequence)}</td>
        <td><strong>${escapeHtml(entry.summary)}</strong><small>${escapeHtml(entry.type)}</small>${renderTimelineChanges(entry.changes)}</td>
        <td>${escapeHtml(entry.actorId)}</td>
        <td>${escapeHtml(entry.occurredAt)}</td>
      </tr>`
    )
    .join("");
  const commentForm = options.allowComment ? renderCommentForm(timeline) : "";
  const assignmentPanel = options.assignments
    ? renderAssignmentPanel(timeline, options.assignments, { allowAssign: options.allowAssign ?? false })
    : "";
  const tagPanel = options.tags ? renderTagPanel(timeline, options.tags, { allowTag: options.allowTag ?? false }) : "";
  const followerPanel = options.followers
    ? renderFollowerPanel(timeline, options.followers, {
        allowFollow: options.allowFollow ?? false,
        ...(options.actorId !== undefined ? { actorId: options.actorId } : {})
      })
    : "";
  const sharePanel = options.shares
    ? renderSharePanel(timeline, options.shares, { allowShare: options.allowShare ?? false })
    : "";
  return `<section class="panel timeline" aria-labelledby="document-timeline">
    <div class="timeline-head">
      <h2 id="document-timeline">Timeline</h2>
      <p>v${String(timeline.version)} · ${escapeHtml(timeline.docstatus)}</p>
    </div>
    ${tagPanel}
    ${followerPanel}
    ${sharePanel}
    ${assignmentPanel}
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Event</th><th>Actor</th><th>Occurred</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="empty">No events yet.</td></tr>`}</tbody>
      </table>
    </div>
    ${commentForm}
  </section>`;
}

function renderTimelineChanges(changes: DocumentTimeline["entries"][number]["changes"]): string {
  if (changes.length === 0) {
    return "";
  }
  return `<ul class="timeline-changes">${changes.map(renderTimelineChange).join("")}</ul>`;
}

function renderTimelineChange(change: DocumentTimeline["entries"][number]["changes"][number]): string {
  return `<li>
    <span>${escapeHtml(change.field)}</span>
    <span>${escapeHtml(formatValue(change.oldValue))}</span>
    <span aria-hidden="true">&rarr;</span>
    <span>${escapeHtml(formatValue(change.newValue))}</span>
  </li>`;
}

function renderSharePanel(
  timeline: DocumentTimeline,
  shares: DocumentSharePanelState,
  options: { readonly allowShare?: boolean }
): string {
  const shareRows = shares.grants
    .map(
      (grant) => `<li>
        <span>${escapeHtml(grant.userId)}</span>
        <small>${grant.permissions.map((permission) => escapeHtml(permission)).join(", ")}</small>
        ${options.allowShare ? renderUnshareForm(timeline, grant.userId) : ""}
      </li>`
    )
    .join("");
  const shareForm = options.allowShare ? renderShareForm(timeline, shares.delegablePermissions) : "";
  return `<div class="timeline-shares">
    <h3 id="document-shares">Shares</h3>
    <ul class="share-list">${shareRows || `<li class="empty">No shares.</li>`}</ul>
    ${shareForm}
  </div>`;
}

function renderShareForm(
  timeline: DocumentTimeline,
  delegablePermissions: readonly DocumentSharePermission[]
): string {
  const action = `/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/shares`;
  const choices = delegablePermissions.map(renderSharePermissionChoice).join("");
  return `<form class="timeline-share-form" method="post">
    <input type="hidden" name="expectedVersion" value="${String(timeline.version)}">
    <label class="field" for="timeline-share-user"><span>User</span><input id="timeline-share-user" name="user" type="text"></label>
    <fieldset class="choice-grid">
      <legend>Permissions</legend>
      ${choices}
    </fieldset>
    <button class="button primary" type="submit" formaction="${action}">Share</button>
  </form>`;
}

function renderSharePermissionChoice(permission: DocumentSharePermission): string {
  const checked = permission === "read" ? " checked" : "";
  return `<label class="choice"><input type="checkbox" name="permission" value="${permission}"${checked}> <span>${sharePermissionLabel(permission)}</span></label>`;
}

function sharePermissionLabel(permission: DocumentSharePermission): string {
  switch (permission) {
    case "read":
      return "Read";
    case "update":
      return "Update";
    case "share":
      return "Share";
  }
}

function renderUnshareForm(timeline: DocumentTimeline, userId: string): string {
  const action = `/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/shares/${encodeURIComponent(userId)}/remove`;
  return `<form class="inline-action" method="post">
    <input type="hidden" name="expectedVersion" value="${String(timeline.version)}">
    <button class="button" type="submit" formaction="${action}">Revoke</button>
  </form>`;
}

function renderAssignmentPanel(
  timeline: DocumentTimeline,
  assignments: DocumentAssignments,
  options: { readonly allowAssign?: boolean }
): string {
  const assigneeRows = assignments.assignees
    .map(
      (assignee) => `<li>
        <span>${escapeHtml(assignee)}</span>
        ${options.allowAssign ? renderUnassignForm(timeline, assignee) : ""}
      </li>`
    )
    .join("");
  const assignmentForm = options.allowAssign ? renderAssignmentForm(timeline) : "";
  return `<div class="timeline-assignments">
    <h3 id="document-assignments">Assignments</h3>
    <ul class="assignment-list">${assigneeRows || `<li class="empty">No assignees.</li>`}</ul>
    ${assignmentForm}
  </div>`;
}

function renderTagPanel(
  timeline: DocumentTimeline,
  tags: DocumentTags,
  options: { readonly allowTag?: boolean }
): string {
  const tagRows = tags.tags
    .map(
      (tag) => `<li>
        <span>${escapeHtml(tag)}</span>
        ${options.allowTag ? renderUntagForm(timeline, tag) : ""}
      </li>`
    )
    .join("");
  const tagForm = options.allowTag ? renderTagForm(timeline) : "";
  return `<div class="timeline-tags">
    <h3 id="document-tags">Tags</h3>
    <ul class="tag-list">${tagRows || `<li class="empty">No tags.</li>`}</ul>
    ${tagForm}
  </div>`;
}

function renderTagForm(timeline: DocumentTimeline): string {
  const action = `/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/tags`;
  return `<form class="timeline-tag-form" method="post">
    <input type="hidden" name="expectedVersion" value="${String(timeline.version)}">
    <label class="field" for="timeline-tag"><span>Tag</span><input id="timeline-tag" name="tag" type="text"></label>
    <button class="button primary" type="submit" formaction="${action}">Add tag</button>
  </form>`;
}

function renderFollowerPanel(
  timeline: DocumentTimeline,
  followers: DocumentFollowers,
  options: { readonly actorId?: string; readonly allowFollow?: boolean }
): string {
  const followerRows = followers.followers
    .map(
      (followerId) => `<li>
        <span>${escapeHtml(followerId)}</span>
        ${options.allowFollow && followerId === options.actorId ? renderUnfollowForm(timeline, followerId) : ""}
      </li>`
    )
    .join("");
  const isFollowing = options.actorId !== undefined && followers.followers.includes(options.actorId);
  const followForm = options.allowFollow && options.actorId && !isFollowing ? renderFollowForm(timeline) : "";
  return `<div class="timeline-followers">
    <h3 id="document-followers">Followers</h3>
    <ul class="follower-list">${followerRows || `<li class="empty">No followers.</li>`}</ul>
    ${followForm}
  </div>`;
}

function renderFollowForm(timeline: DocumentTimeline): string {
  const action = `/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/followers`;
  return `<form class="timeline-follower-form" method="post">
    <input type="hidden" name="expectedVersion" value="${String(timeline.version)}">
    <button class="button primary" type="submit" formaction="${action}">Follow</button>
  </form>`;
}

function renderUnfollowForm(timeline: DocumentTimeline, followerId: string): string {
  const action = `/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/followers/${encodeURIComponent(followerId)}/remove`;
  return `<form class="inline-action" method="post">
    <input type="hidden" name="expectedVersion" value="${String(timeline.version)}">
    <button class="button" type="submit" formaction="${action}">Unfollow</button>
  </form>`;
}

function renderUntagForm(timeline: DocumentTimeline, tag: string): string {
  const action = `/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/tags/${encodeURIComponent(tag)}/remove`;
  return `<form class="inline-action" method="post">
    <input type="hidden" name="expectedVersion" value="${String(timeline.version)}">
    <button class="button" type="submit" formaction="${action}">Remove</button>
  </form>`;
}

function renderAssignmentForm(timeline: DocumentTimeline): string {
  const action = `/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/assignments`;
  return `<form class="timeline-assignment-form" method="post">
    <input type="hidden" name="expectedVersion" value="${String(timeline.version)}">
    <label class="field" for="timeline-assignee"><span>Assign</span><input id="timeline-assignee" name="assignee" type="text"></label>
    <button class="button primary" type="submit" formaction="${action}">Assign</button>
  </form>`;
}

function renderUnassignForm(timeline: DocumentTimeline, assignee: string): string {
  const action = `/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/assignments/${encodeURIComponent(assignee)}/remove`;
  return `<form class="inline-action" method="post">
    <input type="hidden" name="expectedVersion" value="${String(timeline.version)}">
    <button class="button" type="submit" formaction="${action}">Unassign</button>
  </form>`;
}

function renderCommentForm(timeline: DocumentTimeline): string {
  const action = `/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/comments`;
  return `<form class="timeline-comment" method="post">
    <input type="hidden" name="expectedVersion" value="${String(timeline.version)}">
    <label class="field" for="timeline-comment"><span>Comment</span><textarea id="timeline-comment" name="comment_text"></textarea></label>
    <div class="actions">
      <button class="button primary" type="submit" formaction="${action}">Add comment</button>
    </div>
  </form>`;
}

export function renderNotFound(message: string): string {
  return `<section class="panel"><p class="empty">${escapeHtml(message)}</p></section>`;
}

export function renderErrorPanel(message: string): string {
  return `<section class="panel"><p class="error" role="alert">${escapeHtml(message)}</p></section>`;
}

function renderFormSection(
  section: ResolvedFormSection,
  document: DocumentSnapshot | undefined,
  mode: "create" | "update",
  linkOptions: FormLinkOptions,
  tableDefinitions: FormTableDefinitions
): string {
  const fields = section.fields
    .map((field) =>
      renderField(
        field,
        document?.data[field.name],
        mode,
        linkOptions[field.name] ?? [],
        tableDefinitions[field.name],
        linkOptions,
        tableDefinitions
      )
    )
    .join("");
  return `<section class="form-section">
    ${section.heading ? `<h3>${escapeHtml(section.heading)}</h3>` : ""}
    <div class="fields cols-${section.columns}">${fields}</div>
  </section>`;
}

function renderField(
  field: FieldDefinition,
  value: JsonValue | undefined,
  mode: "create" | "update",
  linkOptions: readonly LinkOption[],
  tableDefinition: DocTypeDefinition | undefined,
  allLinkOptions: FormLinkOptions,
  tableDefinitions: FormTableDefinitions
): string {
  const id = `field-${slug(field.name)}`;
  const label = escapeHtml(field.label ?? field.name);
  const required = field.required ? " required" : "";
  const readonly = field.readOnly || (mode === "update" && field.readOnly) ? " readonly" : "";
  const common = `id="${id}" name="${escapeHtml(field.name)}" data-cf-frappe-field-type="${field.type}"${required}${readonly}`;
  const formatted = formatFormValue(value);
  const help = field.readOnly ? `<small>Read only</small>` : "";
  if (field.type === "table") {
    return renderTableField(field, value, tableDefinition, allLinkOptions, tableDefinitions, field.name, field.name);
  }
  if (field.type === "link") {
    const options = renderLinkOptions(linkOptions, formatted);
    return `<label class="field" for="${id}"><span>${label}${field.required ? " *" : ""}</span><select ${common}>${options}</select>${help}</label>`;
  }
  if (field.type === "select") {
    const options = (field.options ?? [])
      .map((option) => `<option value="${escapeHtml(option)}"${option === formatted ? " selected" : ""}>${escapeHtml(option)}</option>`)
      .join("");
    return `<label class="field" for="${id}"><span>${label}${field.required ? " *" : ""}</span><select ${common}>${options}</select>${help}</label>`;
  }
  if (field.type === "longText" || field.type === "json") {
    return `<label class="field" for="${id}"><span>${label}${field.required ? " *" : ""}</span><textarea ${common}>${escapeHtml(formatted)}</textarea>${help}</label>`;
  }
  const type = inputType(field);
  const checked = field.type === "boolean" && value === true ? " checked" : "";
  return `<label class="field" for="${id}"><span>${label}${field.required ? " *" : ""}</span><input type="${type}" ${common} value="${escapeHtml(formatted)}"${checked}>${help}</label>`;
}

function renderTableField(
  field: FieldDefinition,
  value: JsonValue | undefined,
  child: DocTypeDefinition | undefined,
  linkOptions: FormLinkOptions,
  tableDefinitions: FormTableDefinitions,
  definitionPath: string,
  inputPath: string
): string {
  const label = escapeHtml(field.label ?? field.name);
  if (!child) {
    return `<label class="field" for="field-${slug(field.name)}"><span>${label}${field.required ? " *" : ""}</span><textarea id="field-${slug(field.name)}" name="${escapeHtml(field.name)}" data-cf-frappe-field-type="${field.type}">${escapeHtml(formatFormValue(value))}</textarea></label>`;
  }
  const rows = Array.isArray(value) ? value.filter(isJsonObject) : [];
  const renderRows = rows.length > 0 ? rows : [{}];
  const childFields = child.fields.filter((childField) => !childField.hidden && !childField.readOnly);
  const headers = childFields
    .map((childField) => `<th>${escapeHtml(childField.label ?? childField.name)}</th>`)
    .join("");
  const body = renderRows
    .map((row, rowIndex) =>
      renderTableRow({
        definitionPath,
        inputPath,
        rowIndex,
        ...(rows.length > 0 ? { originIndex: rowIndex } : {}),
        row,
        childFields,
        linkOptions,
        tableDefinitions
      })
    )
    .join("");
  const nextRow = rows.length > 0
    ? renderBlankTableRow(definitionPath, inputPath, rows.length, childFields, linkOptions, tableDefinitions)
    : "";
  return `<fieldset class="field table-field">
    <legend>${label}${field.required ? " *" : ""}</legend>
    <div class="table-wrap">
      <table>
        <thead><tr>${headers}</tr></thead>
        <tbody>${body}${nextRow}</tbody>
      </table>
    </div>
  </fieldset>`;
}

function renderTableRow(options: {
  readonly definitionPath: string;
  readonly inputPath: string;
  readonly rowIndex: number;
  readonly originIndex?: number;
  readonly row: Record<string, JsonValue>;
  readonly childFields: readonly FieldDefinition[];
  readonly linkOptions: FormLinkOptions;
  readonly tableDefinitions: FormTableDefinitions;
}): string {
  const marker =
    options.originIndex === undefined ? "" : renderTableRowOrigin(options.inputPath, options.rowIndex, options.originIndex);
  if (options.childFields.length === 0) {
    return `<tr><td>${marker}</td></tr>`;
  }
  return `<tr>${options.childFields
    .map((childField, cellIndex) => {
      const input = renderTableCellInput(
        options.definitionPath,
        options.inputPath,
        options.rowIndex,
        childField,
        options.row[childField.name],
        options.linkOptions[`${options.definitionPath}.${childField.name}`] ?? [],
        options.linkOptions,
        options.tableDefinitions
      );
      return `<td>${cellIndex === 0 ? marker : ""}${input}</td>`;
    })
    .join("")}</tr>`;
}

function renderTableRowOrigin(tableField: string, rowIndex: number, originIndex: number): string {
  const name = `${tableField}[${rowIndex}].${CHILD_TABLE_ROW_INDEX_FIELD}`;
  return `<input type="hidden" name="${escapeHtml(name)}" value="${String(originIndex)}">`;
}

function renderBlankTableRow(
  definitionPath: string,
  inputPath: string,
  rowIndex: number,
  childFields: readonly FieldDefinition[],
  linkOptions: FormLinkOptions,
  tableDefinitions: FormTableDefinitions
): string {
  return `<tr>${childFields
    .map((childField) =>
      `<td>${renderTableCellInput(definitionPath, inputPath, rowIndex, childField, undefined, linkOptions[`${definitionPath}.${childField.name}`] ?? [], linkOptions, tableDefinitions)}</td>`
    )
    .join("")}</tr>`;
}

function renderTableCellInput(
  definitionPath: string,
  inputPath: string,
  rowIndex: number,
  field: FieldDefinition,
  value: JsonValue | undefined,
  linkOptions: readonly LinkOption[],
  allLinkOptions: FormLinkOptions,
  tableDefinitions: FormTableDefinitions
): string {
  const fieldDefinitionPath = `${definitionPath}.${field.name}`;
  const name = `${inputPath}[${rowIndex}].${field.name}`;
  if (field.type === "table") {
    const child = tableDefinitions[fieldDefinitionPath];
    return renderTableField(field, value, child, allLinkOptions, tableDefinitions, fieldDefinitionPath, name);
  }
  const id = `field-${slug(name)}`;
  const common = `id="${id}" name="${escapeHtml(name)}" data-cf-frappe-field-type="${field.type}"`;
  const formatted = formatFormValue(value);
  if (field.type === "link") {
    return `<select ${common}>${renderLinkOptions(linkOptions, formatted)}</select>`;
  }
  if (field.type === "select") {
    const options = (field.options ?? [])
      .map((option) => `<option value="${escapeHtml(option)}"${option === formatted ? " selected" : ""}>${escapeHtml(option)}</option>`)
      .join("");
    return `<select ${common}>${options}</select>`;
  }
  if (field.type === "longText" || field.type === "json") {
    return `<textarea ${common}>${escapeHtml(formatted)}</textarea>`;
  }
  const type = inputType(field);
  const checked = field.type === "boolean" && value === true ? " checked" : "";
  return `<input type="${type}" ${common} value="${escapeHtml(formatted)}"${checked}>`;
}

function renderLinkOptions(options: readonly LinkOption[], currentValue: string): string {
  const rendered = [`<option value=""></option>`];
  const seen = new Set<string>();
  if (currentValue && !options.some((option) => option.value === currentValue)) {
    rendered.push(`<option value="${escapeHtml(currentValue)}" selected>${escapeHtml(currentValue)}</option>`);
    seen.add(currentValue);
  }
  for (const option of options) {
    if (seen.has(option.value)) {
      continue;
    }
    seen.add(option.value);
    rendered.push(
      `<option value="${escapeHtml(option.value)}"${option.value === currentValue ? " selected" : ""}>${escapeHtml(option.label)}</option>`
    );
  }
  return rendered.join("");
}

function inputType(field: FieldDefinition): string {
  return inputTypeForFieldType(field.type);
}

function inputTypeForFieldType(type?: FieldType): string {
  switch (type) {
    case "integer":
    case "number":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime-local";
    case "boolean":
      return "checkbox";
    default:
      return "text";
  }
}

function renderFilterControl(
  field: FieldDefinition,
  filters: readonly ListDocumentsFilter[],
  control: ListFilterControlDefinition
): string {
  const id = `filter-${slug(field.name)}`;
  const label = escapeHtml(`${field.label ?? field.name}${control.labelSuffix ? ` ${control.labelSuffix}` : ""}`);
  const operator = control.operator;
  const value = currentFilterValue(filters, field.name, operator);
  const common = `id="${id}-${operator}" name="${escapeHtml(control.queryKey)}"`;
  if (field.type === "select") {
    const options = [`<option value=""></option>`]
      .concat(
        (field.options ?? []).map(
          (option) =>
            `<option value="${escapeHtml(option)}"${option === value ? " selected" : ""}>${escapeHtml(option)}</option>`
        )
      )
      .join("");
    return `<label class="field" for="${id}-${operator}"><span>${label}</span><select ${common}>${options}</select></label>`;
  }
  if (field.type === "boolean") {
    const options = [
      `<option value=""></option>`,
      `<option value="true"${value === "true" ? " selected" : ""}>True</option>`,
      `<option value="false"${value === "false" ? " selected" : ""}>False</option>`
    ].join("");
    return `<label class="field" for="${id}-${operator}"><span>${label}</span><select ${common}>${options}</select></label>`;
  }
  return `<label class="field" for="${id}-${operator}"><span>${label}</span><input type="${control.inputType}" ${common} value="${escapeHtml(value)}"></label>`;
}

function currentFilterValue(
  filters: readonly ListDocumentsFilter[],
  field: string,
  operator: ListFilterOperator
): string {
  const filter = filters.find((item) => item.field === field && (item.operator ?? "eq") === operator);
  if (!filter) {
    return "";
  }
  return formatFormValue(filter.value);
}

function labelFor(doctype: DocTypeDefinition): string {
  return doctype.label ?? doctype.name;
}

function formatValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${String(value)} B`;
  }
  const kib = value / 1024;
  if (kib < 1024) {
    return `${kib.toFixed(1)} KiB`;
  }
  return `${(kib / 1024).toFixed(1)} MiB`;
}

function formatFormValue(value: JsonValue | undefined): string {
  return formatValue(value);
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slug(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-+|-+$/g, "");
}

function deskCss(): string {
  return `
:root {
  color-scheme: light;
  --bg: #f7f8fa;
  --surface: #ffffff;
  --border: #d9dee7;
  --text: #1f2937;
  --muted: #5b6472;
  --primary: #185abc;
  --primary-dark: #123f83;
  --danger: #b42318;
  --focus: #b45309;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100dvh;
  background: var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 16px;
  line-height: 1.5;
}
a { color: var(--primary); }
a:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}
.skip-link {
  position: absolute;
  left: 12px;
  top: -48px;
  background: var(--surface);
  padding: 8px 12px;
  border: 1px solid var(--border);
  z-index: 2;
}
.skip-link:focus { top: 12px; }
.sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  width: 240px;
  padding: 20px 14px;
  border-right: 1px solid var(--border);
  background: var(--surface);
  overflow-y: auto;
}
.brand {
  display: block;
  margin: 0 8px 20px;
  color: var(--text);
  font-weight: 700;
  text-decoration: none;
}
.nav-link {
  display: block;
  min-height: 44px;
  padding: 10px 12px;
  border-radius: 6px;
  color: var(--text);
  text-decoration: none;
}
.nav-link:hover, .nav-link.is-active { background: #e9eef7; }
.nav-heading {
  margin: 18px 12px 6px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}
.main { margin-left: 240px; padding: 24px; }
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.kicker {
  margin: 0 0 4px;
  color: var(--muted);
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
}
h1, h2 { margin: 0; letter-spacing: 0; }
h1 { font-size: 28px; line-height: 1.2; }
h2 { font-size: 20px; line-height: 1.3; }
h3 { margin: 0 0 12px; font-size: 16px; line-height: 1.35; letter-spacing: 0; }
.toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 12px;
  margin-bottom: 16px;
}
.toolbar .compact-field { min-width: 160px; }
.workspace-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.workspace-section { margin-bottom: 18px; }
.workspace-section h2 { margin-bottom: 10px; }
.workspace-card {
  display: grid;
  gap: 4px;
  min-height: 88px;
  padding: 14px 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
  color: var(--text);
  text-decoration: none;
}
.workspace-card:hover { border-color: var(--primary); }
.workspace-card span { color: var(--muted); }
.dashboard-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}
.dashboard-card {
  display: grid;
  gap: 6px;
  padding: 16px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface);
}
.dashboard-card-link {
  display: grid;
  gap: 6px;
  color: inherit;
  text-decoration: none;
}
.dashboard-card:hover { border-color: var(--primary); }
.dashboard-card span,
.dashboard-card small {
  color: var(--muted);
  font-size: 13px;
}
.dashboard-card strong {
  font-size: 28px;
  line-height: 1.15;
}
.dashboard-card em {
  font-style: normal;
  color: var(--primary);
  font-weight: 700;
}
.dashboard-card p { margin: 0; color: var(--muted); }
.dashboard-chart-card { min-width: 0; }
@media (min-width: 720px) {
  .dashboard-chart-card { grid-column: span 2; }
}
.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.table-wrap { overflow-x: auto; }
table {
  width: 100%;
  border-collapse: collapse;
}
th, td {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}
th {
  color: var(--muted);
  font-size: 13px;
  font-weight: 700;
}
tr:last-child td { border-bottom: 0; }
.empty { color: var(--muted); }
.notice, .error {
  padding: 10px 12px;
  border-radius: 6px;
  background: #fff7ed;
  border: 1px solid #fed7aa;
}
.error {
  color: var(--danger);
  background: #fef3f2;
  border-color: #fecdca;
}
.form { padding: 18px; max-width: 860px; }
.timeline { margin-top: 16px; max-width: 860px; }
.presence { margin-top: 16px; max-width: 860px; padding: 18px; }
.list-filters { max-width: none; margin-bottom: 16px; }
.list-filters .actions { justify-content: flex-start; }
.compound-filter-builder {
  grid-column: 1 / -1;
  display: grid;
  gap: 12px;
  margin: 0;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.compound-filter-builder legend {
  padding: 0 6px;
  color: var(--muted);
  font-weight: 700;
}
.compound-filter-visual,
.compound-filter-items {
  display: grid;
  gap: 10px;
}
.compound-filter-group {
  display: grid;
  gap: 10px;
}
.compound-filter-group:not(.compound-filter-root) {
  border-left: 2px solid var(--border);
  padding-left: 12px;
}
.compound-filter-group-head,
.compound-filter-group-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: end;
}
.compound-filter-group-actions {
  align-self: end;
}
.compound-filter-row {
  display: grid;
  grid-template-columns: minmax(160px, 1fr) minmax(150px, 0.8fr) minmax(180px, 1.2fr) auto;
  gap: 10px;
  align-items: end;
}
.compound-filter-row .button {
  white-space: nowrap;
}
.field.compact span,
.field.grow span,
.filter-expression-preview {
  color: var(--muted);
  font-size: 13px;
}
.field.grow {
  min-width: 0;
}
.filter-expression-group ul {
  margin: 8px 0 0 18px;
  padding: 0;
}
.report-summary {
  padding: 14px 18px;
}
.report-summary ul {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.report-summary li {
  display: grid;
  gap: 4px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.report-summary span { color: var(--muted); font-size: 13px; }
.report-summary strong { font-size: 20px; }
.report-group {
  padding: 14px 18px;
}
.report-group h2 { margin-bottom: 10px; font-size: 16px; }
.report-charts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 16px;
}
.report-chart {
  padding: 14px 18px;
}
.report-chart h2 { margin-bottom: 10px; font-size: 16px; }
.chart-svg {
  width: 100%;
  max-height: 280px;
}
.chart-bar rect { fill: var(--primary); }
.chart-bar text,
.chart-line text {
  fill: var(--muted);
  font-size: 12px;
}
.chart-axis-label {
  fill: var(--text);
  font-size: 10px;
  font-weight: 600;
}
.chart-line path {
  fill: none;
  stroke: var(--primary);
  stroke-width: 3;
}
.chart-line circle {
  fill: var(--surface);
  stroke: var(--primary);
  stroke-width: 3;
}
.chart-pie-wrap {
  display: grid;
  grid-template-columns: minmax(160px, 220px) 1fr;
  gap: 16px;
  align-items: center;
}
.chart-pie {
  transform: rotate(-90deg);
}
.chart-pie circle {
  fill: none;
  stroke-width: 45;
  stroke: var(--primary);
}
.chart-pie circle:nth-child(2),
.chart-swatch-1 { stroke: #2e7d32; background: #2e7d32; }
.chart-pie circle:nth-child(3),
.chart-swatch-2 { stroke: #ad1457; background: #ad1457; }
.chart-pie circle:nth-child(4),
.chart-swatch-3 { stroke: #ef6c00; background: #ef6c00; }
.chart-pie circle:nth-child(5),
.chart-swatch-4 { stroke: #00695c; background: #00695c; }
.chart-pie circle:nth-child(6),
.chart-swatch-5 { stroke: #6a1b9a; background: #6a1b9a; }
.chart-pie-wrap ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.chart-pie-wrap li {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.chart-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  background: var(--primary);
}
.saved-filters {
  max-width: none;
  margin-bottom: 16px;
  padding: 14px 18px;
}
.job-history { margin-top: 16px; }
.saved-filters h2 { margin-bottom: 10px; font-size: 16px; }
.saved-filters ul {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.saved-filters li {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.saved-filter-link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  text-decoration: none;
}
.saved-filter-link.is-active { background: #e9eef7; border-color: var(--primary); }
.form-head, .timeline-head, .attachment-head, .presence-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.timeline-head { padding: 18px 18px 0; }
.attachments { margin-top: 16px; max-width: 860px; }
.attachment-upload {
  padding-bottom: 16px;
  border-bottom: 1px solid var(--border);
}
.form-head p, .timeline-head p, .presence-head p, .presence-list { margin: 0; color: var(--muted); }
.timeline strong { display: block; }
.timeline small { color: var(--muted); }
.timeline-changes {
  display: grid;
  gap: 4px;
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}
.timeline-changes li {
  display: grid;
  grid-template-columns: minmax(64px, 0.7fr) minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 8px;
  color: var(--muted);
}
.timeline-changes li span {
  overflow-wrap: anywhere;
}
.timeline-changes li span:first-child {
  color: var(--text);
  font-weight: 600;
}
.timeline-tags,
.timeline-followers,
.timeline-shares,
.timeline-assignments {
  padding: 0 18px 18px;
  border-bottom: 1px solid var(--border);
}
.timeline-tags + .timeline-followers,
.timeline-followers + .timeline-shares,
.timeline-shares + .timeline-assignments {
  padding-top: 18px;
}
.tag-list,
.follower-list,
.share-list,
.assignment-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.tag-list li,
.follower-list li,
.share-list li,
.assignment-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
}
.inline-action { margin: 0; }
.data-patch-actions,
.data-patch-command-action {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.data-patch-actions {
  align-items: flex-start;
  min-width: min(100%, 440px);
}
.data-patch-queue-action {
  display: grid;
  grid-template-columns: minmax(140px, 1fr) minmax(92px, 120px) auto;
  gap: 8px;
  align-items: center;
  width: 100%;
}
.data-patch-queue-action input {
  min-height: 38px;
}
.timeline-tag-form,
.timeline-follower-form,
.timeline-share-form,
.timeline-assignment-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 12px;
  margin-top: 12px;
}
.timeline-share-form .choice-grid {
  grid-column: 1 / -1;
  margin: 0;
}
.timeline-comment {
  padding: 16px 18px 18px;
  border-top: 1px solid var(--border);
}
.timeline-comment textarea { min-height: 88px; }
.form-section + .form-section {
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}
.fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.fields.cols-1 { grid-template-columns: 1fr; }
.field { display: grid; gap: 6px; }
.field span { font-weight: 650; }
.field small { color: var(--muted); }
.choice-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  margin: 18px 0 0;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.choice-grid legend {
  padding: 0 6px;
  color: var(--muted);
  font-weight: 700;
}
.choice {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
}
.report-builder-filter {
  display: grid;
  gap: 8px;
  align-content: start;
}
.report-formula-builder {
  grid-column: 1 / -1;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.report-formula-builder > .field {
  grid-column: 1 / -1;
}
.report-formula-operand,
.report-formula-nested-group {
  display: grid;
  gap: 10px;
}
.report-formula-operand {
  min-width: 0;
}
.report-formula-nested {
  display: grid;
  gap: 10px;
}
.report-formula-nested-group {
  border-left: 2px solid var(--border);
  padding-left: 12px;
}
.report-builder-filter .field span {
  color: var(--muted);
  font-size: 13px;
}
.report-builder-range-filter {
  display: grid;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
}
.choice input {
  width: auto;
  min-height: auto;
}
.bulk-select {
  width: auto;
  min-height: auto;
}
input, select, textarea {
  width: 100%;
  min-height: 44px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--text);
  padding: 9px 10px;
  font: inherit;
}
textarea { min-height: 120px; resize: vertical; }
input[readonly], textarea[readonly] { background: #f3f4f6; color: var(--muted); }
.actions, .command-row {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}
.command-row {
  justify-content: flex-start;
  border-top: 1px solid var(--border);
  padding-top: 16px;
}
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-weight: 650;
  text-decoration: none;
  cursor: pointer;
}
.button.primary {
  border-color: var(--primary);
  background: var(--primary);
  color: #fff;
}
.button.primary:hover { background: var(--primary-dark); }
.button.danger {
  border-color: #fecdca;
  color: var(--danger);
}
@media (max-width: 760px) {
  .sidebar {
    position: static;
    width: auto;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
  .main { margin-left: 0; padding: 16px; }
  .topbar, .form-head { align-items: flex-start; flex-direction: column; }
  .fields { grid-template-columns: 1fr; }
  .report-formula-builder { grid-template-columns: 1fr; }
  .compound-filter-group-head,
  .compound-filter-group-actions { align-items: stretch; flex-direction: column; }
  .compound-filter-row { grid-template-columns: 1fr; }
  .timeline-assignment-form { grid-template-columns: 1fr; }
}`;
}
