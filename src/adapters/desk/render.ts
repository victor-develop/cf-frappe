import {
  CHILD_TABLE_ROW_INDEX_FIELD,
  type DocTypeDefinition,
  type DocumentData,
  type DocumentSnapshot,
  type FieldDefinition,
  type FieldType,
  type ListFilterControlDefinition,
  type JsonValue,
  type LinkOption,
  type ListDocumentsFilter,
  type ListFilterOperator,
  type ResolvedFormSection,
  type ResolvedFormView,
  type ResolvedListView
} from "../../core/types.js";
import { isReportChartColor, type ReportDefinition } from "../../core/reports.js";
import type { ClientScriptDefinition, ClientScriptScope } from "../../core/client-script.js";
import type {
  DocumentAssignments,
  DocumentFollowers,
  DocumentTags,
  DocumentTimeline
} from "../../application/document-history-service.js";
import type { FileDashboard } from "../../application/file-service.js";
import type { DataPatchDashboard, DataPatchDashboardEntry } from "../../application/data-patch-service.js";
import type { JobExecutionDashboard } from "../../application/job-history-service.js";
import type { JobScheduleDashboard } from "../../application/job-schedule-service.js";
import type { ReportRunResult } from "../../application/report-service.js";
import type { RoleCatalogState } from "../../core/roles.js";
import type { SavedListFilter } from "../../application/saved-list-filter-service.js";
import type { SavedReport } from "../../application/saved-report-service.js";
import type { PrintFormatDefinition } from "../../core/print-format.js";
import type { UserAccount } from "../../core/user-accounts.js";
import { USER_PROFILE_FIELDS, type UserProfileState } from "../../core/user-profiles.js";
import type { UserPermissionState } from "../../core/user-permissions.js";
import { DESK_CLIENT_SCRIPT_PATH } from "./client.js";
import {
  deskReportFieldLabel,
  deskReportSumSummaryLabel,
  deskReportSumSummaryName,
  isDeskGroupableReportField,
  isDeskNumericReportField
} from "./report-builder.js";

export type FormLinkOptions = Readonly<Record<string, readonly LinkOption[]>>;
export type FormTableDefinitions = Readonly<Record<string, DocTypeDefinition>>;
export type FormLifecycleAction = "submit" | "cancel";
export interface FormWorkflowAction {
  readonly action: string;
  readonly label: string;
  readonly to: string;
}

export interface DeskLayoutOptions {
  readonly title: string;
  readonly body: string;
  readonly active?: string;
  readonly activeReport?: string;
  readonly activeAdmin?: string;
  readonly showFiles?: boolean;
  readonly adminLinks?: readonly DeskNavLink[];
  readonly doctypes: readonly DocTypeDefinition[];
  readonly reports?: readonly ReportDefinition[];
  readonly message?: string;
}

export interface DeskNavLink {
  readonly href: string;
  readonly label: string;
  readonly id?: string;
}

export function renderDeskLayout(options: DeskLayoutOptions): string {
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
      ${nav ? `<p class="nav-heading">DocTypes</p>${nav}` : ""}
      ${reportNav ? `<p class="nav-heading">Reports</p>${reportNav}` : ""}
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
  reports: readonly ReportDefinition[] = []
): string {
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
  return `<section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>DocType</th><th>Module</th><th>Fields</th><th>Description</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="empty">No readable DocTypes.</td></tr>`}</tbody>
      </table>
    </div>
  </section>
  ${renderReportList(reports)}`;
}

export function renderFileManager(
  dashboard: FileDashboard,
  options: { readonly error?: string } = {}
): string {
  const rows = dashboard.files
    .map((file) => {
      const attachedTo = attachmentLabel(file);
      return `<tr>
        <td><a href="/desk/files/${encodeURIComponent(file.name)}/content">${escapeHtml(file.filename)}</a></td>
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
      <label class="field"><span>Limit</span><input name="limit" type="number" min="1" max="200" value="${String(dashboard.limit)}"></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Filter</button><a class="button" href="/desk/files">Clear</a></div>
  </form>
  <section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Filename</th><th>ID</th><th>Content Type</th><th>Size</th><th>Private</th><th>Attached To</th><th>Uploaded By</th><th>Uploaded At</th><th>Action</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="9" class="empty">No files found.</td></tr>`}</tbody>
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
        <td><a href="/desk/files/${encodeURIComponent(file.name)}/content">${escapeHtml(file.filename)}</a></td>
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

export function renderDocumentPresencePanel(
  document: DocumentSnapshot,
  options: { readonly realtimeRoute?: string } = {}
): string {
  const realtimeAttribute = options.realtimeRoute === undefined
    ? ""
    : ` data-realtime-route="${escapeHtml(options.realtimeRoute)}"`;
  return `<section class="panel presence" aria-labelledby="document-presence" data-cf-frappe-presence="document" data-doctype="${escapeHtml(document.doctype)}" data-document-name="${escapeHtml(document.name)}" data-tenant-id="${escapeHtml(document.tenantId)}"${realtimeAttribute}>
    <div class="presence-head">
      <h2 id="document-presence">Presence</h2>
      <p data-cf-frappe-presence-count>Checking active collaborators.</p>
    </div>
    <p class="presence-list" data-cf-frappe-presence-list>Checking active collaborators.</p>
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
    .map((field) => renderReportBuilderCheckbox("filter", field, false))
    .join("");
  const numericFields = visibleFields.filter(isDeskNumericReportField);
  const summaryOptions = [
    renderReportBuilderValueCheckbox("summaryCount", "1", "Records", false),
    ...numericFields.map((field) => renderReportBuilderCheckbox("summary", field, false))
  ].join("");
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
    <fieldset class="choice-grid">
      <legend>Summaries</legend>
      ${summaryOptions}
    </fieldset>
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
  </section>`;
}

export function renderSavedReportView(
  saved: SavedReport,
  result: ReportRunResult,
  options: {
    readonly listHref: string;
    readonly exportHref: string;
    readonly deleteAction: string;
  }
): string {
  return `<section class="toolbar saved-report-toolbar">
    <a class="button" href="${escapeHtml(options.listHref)}">Back</a>
    <a class="button" href="${escapeHtml(options.exportHref)}">Export CSV</a>
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
  ${renderReportView(result, { exportHref: options.exportHref })}`;
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

function renderReportBuilderFieldOptions(fields: readonly FieldDefinition[]): string {
  return [
    `<option value=""></option>`,
    ...fields.map((field) => `<option value="${escapeHtml(field.name)}">${escapeHtml(deskReportFieldLabel(field))}</option>`)
  ].join("");
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

export function renderJobAdmin(
  dashboard: JobExecutionDashboard,
  options: { readonly allowRetry?: boolean; readonly showSchedulesLink?: boolean } = {}
): string {
  const jobRows = dashboard.jobs
    .map((job) => {
      const retry = job.retry ? JSON.stringify(job.retry) : "";
      return `<tr>
        <td>${escapeHtml(job.name)}</td>
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
        <thead><tr><th>Job</th><th>Description</th><th>Retry</th></tr></thead>
        <tbody>${jobRows || `<tr><td colspan="3" class="empty">No jobs registered.</td></tr>`}</tbody>
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
  options: { readonly error?: string } = {}
): string {
  const rows = dashboard.patches
    .map((patch) => `<tr>
      <td>${escapeHtml(patch.id)}</td>
      <td>${escapeHtml(patch.label ?? "")}</td>
      <td>${escapeHtml(patch.checksum)}</td>
      <td>${escapeHtml(patch.status)}</td>
      <td>${escapeHtml(dataPatchTimestamp(patch))}</td>
      <td>${escapeHtml(dataPatchDetail(patch))}</td>
      <td>${renderDataPatchAction(patch)}</td>
    </tr>`)
    .join("");
  return `<form class="panel form" method="post" action="/desk/admin/data-patches/apply">
    <div class="form-head"><h2>Apply Pending Patches</h2><p>${String(dashboard.totals.notApplied)} pending</p></div>
    ${options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : ""}
    <div class="fields">
      <label class="field"><span>Limit</span><input name="limit" type="number" min="1" value="1"></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Apply Batch</button></div>
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

function renderDataPatchAction(patch: DataPatchDashboardEntry): string {
  if (patch.status !== "not_applied") {
    return "";
  }
  return `<form class="inline-action" method="post">
    <button class="button" type="submit" formaction="/desk/admin/data-patches/${encodeURIComponent(patch.id)}/apply">Apply</button>
  </form>`;
}

function dataPatchTimestamp(patch: DataPatchDashboardEntry): string {
  return patch.appliedAt ?? patch.failedAt ?? patch.claimedAt ?? "";
}

function dataPatchDetail(patch: DataPatchDashboardEntry): string {
  if (patch.status === "failed") {
    return patch.error ?? "";
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
  options: { readonly allowRun?: boolean; readonly allowOverride?: boolean; readonly showHistoryLink?: boolean } = {}
): string {
  const rows = dashboard.schedules
    .map((schedule) => `<tr>
        <td>${escapeHtml(schedule.id)}</td>
        <td>${escapeHtml(schedule.cron)}</td>
        <td>${escapeHtml(schedule.jobName)}</td>
        <td>${escapeHtml(schedule.tenantId ?? (schedule.dynamic.tenantId ? "dynamic" : ""))}</td>
        <td>${schedule.enabled ? "yes" : "no"}</td>
        <td>${schedule.overridden ? escapeHtml(schedule.overrideEnabled ? "enabled" : "disabled") : ""}</td>
        <td>${schedule.registered ? "yes" : "no"}</td>
        <td>${escapeHtml(schedule.delaySeconds === undefined ? "" : String(schedule.delaySeconds))}</td>
        <td>${escapeHtml(dynamicScheduleFields(schedule))}</td>
        <td>${options.allowRun ? renderScheduleRunAction(schedule.id, schedule.dispatchable) : ""}${options.allowOverride ? renderScheduleOverrideAction(schedule) : ""}</td>
      </tr>`)
    .join("");
  return `<form class="panel form list-filters" method="get" action="/desk/admin/jobs/schedules">
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
        <thead><tr><th>ID</th><th>Cron</th><th>Job</th><th>Tenant</th><th>Enabled</th><th>Override</th><th>Registered</th><th>Delay</th><th>Dynamic</th><th>Action</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="10" class="empty">No schedules configured.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

function renderScheduleRunAction(scheduleId: string, dispatchable: boolean): string {
  if (!dispatchable) {
    return "";
  }
  return `<form class="inline-action" method="post">
    <button class="button" type="submit" formaction="/desk/admin/jobs/schedules/${encodeURIComponent(scheduleId)}/run">Run</button>
  </form>`;
}

function renderScheduleOverrideAction(schedule: JobScheduleDashboard["schedules"][number]): string {
  if (!schedule.overrideable) {
    return "";
  }
  const action = schedule.enabled ? "disable" : "enable";
  const label = schedule.enabled ? "Disable" : "Enable";
  const reset = schedule.overridden
    ? `<button class="button" type="submit" formaction="/desk/admin/jobs/schedules/${encodeURIComponent(schedule.id)}/reset">Reset</button>`
    : "";
  return `<form class="inline-action" method="post">
    <button class="button" type="submit" formaction="/desk/admin/jobs/schedules/${encodeURIComponent(schedule.id)}/${action}">${label}</button>
    ${reset}
  </form>`;
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
  options: { readonly exportHref?: string } = {}
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
  return `${controls ? `<form class="panel form report-filters" method="get"><div class="fields">${controls}</div><div class="actions"><button class="button primary" type="submit">Run</button>${exportAction}</div></form>` : exportAction ? `<section class="toolbar">${exportAction}</section>` : ""}
  ${renderReportSummary(result.summary)}
  ${renderReportCharts(result.charts)}
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

function renderReportCharts(charts: ReportRunResult["charts"]): string {
  if (charts.length === 0) {
    return "";
  }
  return `<section class="report-charts">${charts.map(renderReportChart).join("")}</section>`;
}

function renderReportChart(chart: ReportRunResult["charts"][number]): string {
  const points = chart.points.filter((point) => point.value !== null);
  const svg = points.length === 0
    ? `<p class="empty">No chart data.</p>`
    : chart.type === "line"
      ? renderLineChart(chart, points)
      : chart.type === "pie"
        ? renderPieChart(chart, points)
        : renderBarChart(chart, points);
  return `<section class="panel report-chart">
    <h2>${escapeHtml(chart.label)}</h2>
    ${svg}
  </section>`;
}

function renderBarChart(
  chart: ReportRunResult["charts"][number],
  points: readonly ReportRunResult["charts"][number]["points"][number][]
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
      return `<g>
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="3" style="fill: ${chartColor(chart, index)}"></rect>
        ${valueLabel}
        <text x="${x + barWidth / 2}" y="202" text-anchor="middle">${escapeHtml(point.label)}</text>
      </g>`;
    })
    .join("");
  return `<svg class="chart-svg chart-bar" role="img" aria-label="${escapeHtml(chart.label)}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">${bars}</svg>`;
}

function renderLineChart(
  chart: ReportRunResult["charts"][number],
  points: readonly ReportRunResult["charts"][number]["points"][number][]
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
      ({ point, x, y }, index) => `<g>
        <circle cx="${x}" cy="${y}" r="4" style="fill: ${chartColor(chart, index)}"></circle>
        ${chart.showValues ? `<text x="${x}" y="${Math.max(14, y - 8)}" text-anchor="middle">${escapeHtml(formatValue(point.value ?? 0))}</text>` : ""}
        <text x="${x}" y="202" text-anchor="middle">${escapeHtml(point.label)}</text>
      </g>`
    )
    .join("");
  return `<svg class="chart-svg chart-line" role="img" aria-label="${escapeHtml(chart.label)}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet"><path d="${path}" style="stroke: ${chartColor(chart, 0)}"></path>${markers}</svg>`;
}

function renderPieChart(
  chart: ReportRunResult["charts"][number],
  points: readonly ReportRunResult["charts"][number]["points"][number][]
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
      return circle;
    })
    .join("");
  const legend = positivePoints
    .map((point, index) => {
      const value = chart.showValues ? ` (${escapeHtml(formatValue(point.value ?? 0))})` : "";
      return `<li><span class="chart-swatch chart-swatch-${index % 6}" style="background: ${chartColor(chart, index)}"></span>${escapeHtml(point.label)}${value}</li>`;
    })
    .join("");
  return `<div class="chart-pie-wrap"><svg class="chart-svg chart-pie" role="img" aria-label="${escapeHtml(chart.label)}" viewBox="0 0 220 220">${rings}</svg><ul>${legend}</ul></div>`;
}

const chartPalette = ["#1f6feb", "#2e7d32", "#ad1457", "#ef6c00", "#00695c", "#6a1b9a"];

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
    readonly clientScripts?: readonly ClientScriptDefinition[];
    readonly realtimeRoute?: string;
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
  const savedFilterPanel = renderSavedFilters(doctype, options.savedFilters ?? [], options.selectedSavedFilterId);
  const header = fields.map((field) => `<th>${escapeHtml(field.label ?? field.name)}</th>`).join("");
  const rows = documents
    .map((document) => {
      const cells = fields
        .map((field) => `<td>${escapeHtml(formatValue(document.data[field.name]))}</td>`)
        .join("");
      return `<tr>
        <td><a href="/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(document.name)}">${escapeHtml(document.name)}</a></td>
        ${cells}
        <td>${String(document.version)}</td>
        <td>${escapeHtml(document.updatedAt)}</td>
      </tr>`;
    })
    .join("");
  return `<section class="toolbar">
    <a class="button primary" href="/desk/${encodeURIComponent(doctype.name)}/new">New ${escapeHtml(labelFor(doctype))}</a>
  </section>
  ${savedFilterPanel}
  ${filterForm ? `<form class="panel form list-filters" method="get"><div class="fields">${filterForm}<label class="field" for="saved-filter-label"><span>Saved filter name</span><input id="saved-filter-label" name="saved_filter_label" type="text"></label></div><div class="actions"><button class="button primary" type="submit">Filter</button><button class="button" type="submit" formmethod="post" formaction="/desk/${encodeURIComponent(doctype.name)}/saved-filters">Save filter</button><a class="button" href="/desk/${encodeURIComponent(doctype.name)}?default_filters=0">Clear</a></div></form>` : ""}
  <section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th>${header}<th>Version</th><th>Updated</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="${fields.length + 3}" class="empty">No documents yet.</td></tr>`}</tbody>
      </table>
    </div>
  </section>
  ${renderClientScripts(doctype.name, "list", options.clientScripts ?? [], undefined, undefined, options.realtimeRoute)}`;
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
    readonly clientScripts?: readonly ClientScriptDefinition[];
    readonly realtimeRoute?: string;
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
          .map(
            (format) =>
              `<a class="button" href="/desk/print/${encodeURIComponent(format.name)}/${encodeURIComponent(options.document!.name)}">${escapeHtml(format.label ?? format.name)}</a>`
          )
          .join("")}</section>`
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
    options.realtimeRoute
  )}`;
}

function renderClientScripts(
  doctype: string,
  scope: Exclude<ClientScriptScope, "both">,
  scripts: readonly ClientScriptDefinition[],
  documentName?: string,
  documentTenantId?: string,
  realtimeRoute?: string
): string {
  const documentAttribute = documentName === undefined
    ? ""
    : ` data-document-name="${escapeHtml(documentName)}"`;
  const tenantAttribute = documentTenantId === undefined
    ? ""
    : ` data-tenant-id="${escapeHtml(documentTenantId)}"`;
  const realtimeAttribute = realtimeRoute === undefined
    ? ""
    : ` data-realtime-route="${escapeHtml(realtimeRoute)}"`;
  const runtime = `<script src="${DESK_CLIENT_SCRIPT_PATH}" data-cf-frappe-runtime="desk" data-doctype="${escapeHtml(doctype)}" data-scope="${scope}"${documentAttribute}${tenantAttribute}${realtimeAttribute}></script>`;
  const declared = scripts
    .map((script) => {
      const type = (script.type ?? "module") === "module" ? ' type="module"' : "";
      return `<script${type} src="${escapeHtml(script.src)}" data-cf-frappe-script="${escapeHtml(script.name)}" data-doctype="${escapeHtml(doctype)}" data-scope="${scope}"${documentAttribute}${tenantAttribute}${realtimeAttribute}></script>`;
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
    readonly actorId?: string;
    readonly assignments?: DocumentAssignments;
    readonly tags?: DocumentTags;
    readonly followers?: DocumentFollowers;
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
  return `<section class="panel timeline" aria-labelledby="document-timeline">
    <div class="timeline-head">
      <h2 id="document-timeline">Timeline</h2>
      <p>v${String(timeline.version)} · ${escapeHtml(timeline.docstatus)}</p>
    </div>
    ${tagPanel}
    ${followerPanel}
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
        linkOptions
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
  allLinkOptions: FormLinkOptions
): string {
  const id = `field-${slug(field.name)}`;
  const label = escapeHtml(field.label ?? field.name);
  const required = field.required ? " required" : "";
  const readonly = field.readOnly || (mode === "update" && field.readOnly) ? " readonly" : "";
  const common = `id="${id}" name="${escapeHtml(field.name)}"${required}${readonly}`;
  const formatted = formatFormValue(value);
  const help = field.readOnly ? `<small>Read only</small>` : "";
  if (field.type === "table") {
    return renderTableField(field, value, tableDefinition, allLinkOptions);
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
  linkOptions: FormLinkOptions
): string {
  const label = escapeHtml(field.label ?? field.name);
  if (!child) {
    return `<label class="field" for="field-${slug(field.name)}"><span>${label}${field.required ? " *" : ""}</span><textarea id="field-${slug(field.name)}" name="${escapeHtml(field.name)}">${escapeHtml(formatFormValue(value))}</textarea></label>`;
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
        tableField: field.name,
        rowIndex,
        ...(rows.length > 0 ? { originIndex: rowIndex } : {}),
        row,
        childFields,
        linkOptions
      })
    )
    .join("");
  const nextRow = rows.length > 0 ? renderBlankTableRow(field.name, rows.length, childFields, linkOptions) : "";
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
  readonly tableField: string;
  readonly rowIndex: number;
  readonly originIndex?: number;
  readonly row: Record<string, JsonValue>;
  readonly childFields: readonly FieldDefinition[];
  readonly linkOptions: FormLinkOptions;
}): string {
  const marker =
    options.originIndex === undefined ? "" : renderTableRowOrigin(options.tableField, options.rowIndex, options.originIndex);
  if (options.childFields.length === 0) {
    return `<tr><td>${marker}</td></tr>`;
  }
  return `<tr>${options.childFields
    .map((childField, cellIndex) => {
      const input = renderTableCellInput(
        options.tableField,
        options.rowIndex,
        childField,
        options.row[childField.name],
        options.linkOptions[`${options.tableField}.${childField.name}`] ?? []
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
  tableField: string,
  rowIndex: number,
  childFields: readonly FieldDefinition[],
  linkOptions: FormLinkOptions
): string {
  return `<tr>${childFields
    .map((childField) =>
      `<td>${renderTableCellInput(tableField, rowIndex, childField, undefined, linkOptions[`${tableField}.${childField.name}`] ?? [])}</td>`
    )
    .join("")}</tr>`;
}

function renderTableCellInput(
  tableField: string,
  rowIndex: number,
  field: FieldDefinition,
  value: JsonValue | undefined,
  linkOptions: readonly LinkOption[]
): string {
  const name = `${tableField}[${rowIndex}].${field.name}`;
  const id = `field-${slug(name)}`;
  const common = `id="${id}" name="${escapeHtml(name)}"`;
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
.toolbar { margin-bottom: 16px; }
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
.timeline-assignments {
  padding: 0 18px 18px;
  border-bottom: 1px solid var(--border);
}
.timeline-tags + .timeline-followers,
.timeline-followers + .timeline-assignments {
  padding-top: 18px;
}
.tag-list,
.follower-list,
.assignment-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.tag-list li,
.follower-list li,
.assignment-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
}
.inline-action { margin: 0; }
.timeline-tag-form,
.timeline-follower-form,
.timeline-assignment-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 12px;
  margin-top: 12px;
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
.choice input {
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
  .timeline-assignment-form { grid-template-columns: 1fr; }
}`;
}
