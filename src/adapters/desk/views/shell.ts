import { type CalendarDefinition } from "../../../core/calendar.js";
import { DESK_STYLES_PATH } from "../ui/styles.js";
import { type DashboardDefinition } from "../../../core/dashboard.js";
import { type DocTypeDefinition, type GlobalSearchResult } from "../../../core/types.js";
import { type KanbanDefinition } from "../../../core/kanban.js";
import { type ReportDefinition } from "../../../core/reports.js";
import { type WorkspaceDefinition, type WorkspaceShortcutKind } from "../../../core/workspace.js";
import { escapeHtml, labelFor, renderTableCell } from "./shared.js";

export interface DeskLayoutOptions {
  readonly title: string;
  readonly body: string;
  readonly active?: string;
  readonly activeReport?: string;
  readonly activeDashboard?: string;
  readonly activeKanban?: string;
  readonly activeCalendar?: string;
  readonly activeSearch?: boolean;
  readonly activeAssignments?: boolean;
  readonly activePrinting?: boolean;
  readonly activeAdmin?: string;
  readonly activeWorkspace?: string;
  readonly showFiles?: boolean;
  readonly showNotifications?: boolean;
  readonly showAssignments?: boolean;
  readonly showPrinting?: boolean;
  readonly adminLinks?: readonly DeskNavLink[];
  readonly doctypes: readonly DocTypeDefinition[];
  readonly reports?: readonly ReportDefinition[];
  readonly dashboards?: readonly DashboardDefinition[];
  readonly kanbans?: readonly KanbanDefinition[];
  readonly calendars?: readonly CalendarDefinition[];
  readonly workspaces?: readonly WorkspaceDefinition[];
  readonly message?: string;
}

export interface DeskNavLink {
  readonly href: string;
  readonly label: string;
  readonly id?: string;
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
  const kanbanNav = (options.kanbans ?? [])
    .map(
      (kanban) =>
        `<a class="nav-link${kanban.name === options.activeKanban ? " is-active" : ""}" href="/desk/kanbans/${encodeURIComponent(kanban.name)}">${escapeHtml(kanban.label ?? kanban.name)}</a>`
    )
    .join("");
  const calendarNav = (options.calendars ?? [])
    .map(
      (calendar) =>
        `<a class="nav-link${calendar.name === options.activeCalendar ? " is-active" : ""}" href="/desk/calendars/${encodeURIComponent(calendar.name)}">${escapeHtml(calendar.label ?? calendar.name)}</a>`
    )
    .join("");
  const adminNav = (options.adminLinks ?? [])
    .map(
      (link) =>
        `<a class="nav-link${link.id !== undefined && link.id === options.activeAdmin ? " is-active" : ""}" href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a>`
    )
    .join("");
  const navigation = `${workspaceNav ? `<p class="nav-heading">Workspaces</p>${workspaceNav}` : ""}
      ${options.showAssignments ? `<p class="nav-heading">Work</p><a class="nav-link${options.activeAssignments ? " is-active" : ""}" href="/desk/assigned-to-me">Assigned to Me</a>` : ""}
      <p class="nav-heading">Search</p><a class="nav-link${options.activeSearch ? " is-active" : ""}" href="/desk/search">Global Search</a>
      ${nav ? `<p class="nav-heading">DocTypes</p>${nav}` : ""}
      ${reportNav ? `<p class="nav-heading">Reports</p>${reportNav}` : ""}
      ${dashboardNav ? `<p class="nav-heading">Dashboards</p>${dashboardNav}` : ""}
      ${kanbanNav ? `<p class="nav-heading">Kanban</p>${kanbanNav}` : ""}
      ${calendarNav ? `<p class="nav-heading">Calendars</p>${calendarNav}` : ""}
      ${options.showPrinting ? `<p class="nav-heading">Output</p><a class="nav-link${options.activePrinting ? " is-active" : ""}" href="/desk/printing">Printing</a>` : ""}
      ${options.showNotifications ? `<p class="nav-heading">Notifications</p><a class="nav-link" href="/desk/notifications">Inbox</a>` : ""}
      ${options.showFiles ? `<p class="nav-heading">Files</p><a class="nav-link" href="/desk/files">Files</a>` : ""}
      ${adminNav ? `<p class="nav-heading">Admin</p>${adminNav}` : ""}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title)} - cf-frappe Desk</title>
  <link rel="stylesheet" href="${DESK_STYLES_PATH}">
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="mobile-shell-header">
    <a class="brand mobile-brand" href="/desk">cf-frappe</a>
    <details class="mobile-nav">
      <summary>Menu</summary>
      <nav>${navigation}</nav>
    </details>
  </header>
  <aside class="sidebar" aria-label="Desk navigation">
    <a class="brand" href="/desk">cf-frappe</a>
    <nav>${navigation}</nav>
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
  dashboards: readonly DashboardDefinition[] = [],
  kanbans: readonly KanbanDefinition[] = [],
  calendars: readonly CalendarDefinition[] = [],
  options: { readonly showAssignments?: boolean } = {}
): string {
  const workspaceCards = workspaces
    .map(
      (workspace) => `<a class="workspace-card" href="/desk/workspaces/${encodeURIComponent(workspace.name)}">
        <strong>${escapeHtml(workspace.label ?? workspace.name)}</strong>
        <span>${escapeHtml(workspace.description ?? workspace.module ?? "")}</span>
      </a>`
    )
    .join("");
  const startCards = [
    ...(options.showAssignments
      ? [{
          href: "/desk/assigned-to-me",
          label: "Assigned to Me",
          kind: "Work",
          meta: "Assignments",
          description: ""
        }]
      : []),
    ...doctypes.map((doctype) => ({
      href: `/desk/${encodeURIComponent(doctype.name)}`,
      label: labelFor(doctype),
      kind: "DocType",
      meta: [doctype.module, `${String(doctype.fields.length)} fields`].filter(Boolean).join(" · "),
      description: doctype.description ?? ""
    })),
    ...reports.map((report) => ({
      href: `/desk/reports/${encodeURIComponent(report.name)}`,
      label: report.label ?? report.name,
      kind: "Report",
      meta: report.doctype,
      description: report.description ?? ""
    })),
    ...dashboards.map((dashboard) => ({
      href: `/desk/dashboards/${encodeURIComponent(dashboard.name)}`,
      label: dashboard.label ?? dashboard.name,
      kind: "Dashboard",
      meta: dashboard.module ?? "",
      description: dashboard.description ?? ""
    })),
    ...kanbans.map((kanban) => ({
      href: `/desk/kanbans/${encodeURIComponent(kanban.name)}`,
      label: kanban.label ?? kanban.name,
      kind: "Kanban",
      meta: kanban.doctype,
      description: kanban.description ?? ""
    })),
    ...calendars.map((calendar) => ({
      href: `/desk/calendars/${encodeURIComponent(calendar.name)}`,
      label: calendar.label ?? calendar.name,
      kind: "Calendar",
      meta: calendar.doctype,
      description: calendar.description ?? ""
    }))
  ];
  const startGrid = startCards.map(renderHomeLinkCard).join("");
  return `<section class="home-overview">
    <div>
      <p class="kicker">Workspace</p>
      <h2>Operational Desk</h2>
      <p class="muted">Lists, reports, boards, and admin surfaces available to the current actor.</p>
    </div>
    <div class="home-metrics" aria-label="Desk inventory">
      ${renderHomeMetric("DocTypes", doctypes.length)}
      ${renderHomeMetric("Reports", reports.length)}
      ${renderHomeMetric("Boards", kanbans.length)}
      ${renderHomeMetric("Dashboards", dashboards.length)}
    </div>
  </section>
  ${workspaceCards ? `<section class="home-section"><div class="section-head"><h2>Workspaces</h2></div><div class="workspace-grid">${workspaceCards}</div></section>` : ""}
  <section class="home-section">
    <div class="section-head">
      <h2>Start work</h2>
      <span>${String(startCards.length)} shortcuts</span>
    </div>
    <div class="home-card-grid">${startGrid || `<p class="empty">No readable Desk resources.</p>`}</div>
  </section>`;
}

function renderHomeMetric(label: string, value: number): string {
  return `<div class="metric-card"><span>${escapeHtml(label)}</span><strong>${String(value)}</strong></div>`;
}

function renderHomeLinkCard(item: {
  readonly href: string;
  readonly label: string;
  readonly kind: string;
  readonly meta: string;
  readonly description: string;
}): string {
  const description = item.description ? `<p>${escapeHtml(item.description)}</p>` : "";
  return `<a class="home-link-card" href="${escapeHtml(item.href)}">
    <span class="resource-kind">${escapeHtml(item.kind)}</span>
    <strong>${escapeHtml(item.label)}</strong>
    ${item.meta ? `<small>${escapeHtml(item.meta)}</small>` : ""}
    ${description}
  </a>`;
}

export function renderGlobalSearchPage(state: {
  readonly query: string;
  readonly limit?: number;
  readonly tenant?: string;
  readonly result?: GlobalSearchResult;
}): string {
  const limit = state.limit ?? state.result?.limit ?? 20;
  const hiddenTenant =
    state.tenant === undefined ? "" : `<input type="hidden" name="tenant" value="${escapeHtml(state.tenant)}">`;
  const rows = (state.result?.data ?? [])
    .map(
      (item) => `<tr>
        ${renderTableCell("Document", `<a href="${escapeHtml(item.route)}">${escapeHtml(item.label)}</a>`)}
        ${renderTableCell("DocType", escapeHtml(item.doctype))}
        ${renderTableCell("Name", escapeHtml(item.name))}
        ${renderTableCell("Matched Field", escapeHtml(item.matchedField))}
        ${renderTableCell("Matched Text", escapeHtml(item.matchedText))}
        ${renderTableCell("Updated", `<time datetime="${escapeHtml(item.updatedAt)}">${escapeHtml(item.updatedAt)}</time>`)}
      </tr>`
    )
    .join("");
  const emptyMessage = state.query ? "No documents matched." : "Enter a search query.";
  const summary =
    state.result === undefined
      ? ""
      : `<section class="toolbar"><span class="muted">${String(state.result.total)} matches</span></section>`;
  return `<form class="panel form list-filters" method="get" action="/desk/search">
    ${hiddenTenant}
    <div class="fields">
      <label class="field wide"><span>Search</span><input name="q" value="${escapeHtml(state.query)}"></label>
      <label class="field"><span>Limit</span><input name="limit" type="number" min="1" max="100" value="${String(limit)}"></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Search</button></div>
  </form>
  ${summary}
  <section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>Document</th><th>DocType</th><th>Name</th><th>Matched Field</th><th>Matched Text</th><th>Updated</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="empty">${emptyMessage}</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
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
  if (kind === "newDoc") {
    return "New Document";
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

export function renderNotFound(message: string): string {
  return `<section class="panel"><p class="empty">${escapeHtml(message)}</p></section>`;
}

export function renderErrorPanel(message: string): string {
  return `<section class="panel"><p class="error" role="alert">${escapeHtml(message)}</p></section>`;
}
