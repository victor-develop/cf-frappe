import type { FC } from "hono/jsx";
import { type CalendarDefinition } from "../../../core/calendar.js";
import { DESK_STYLES_PATH } from "../ui/styles.js";
import { type DashboardDefinition } from "../../../core/dashboard.js";
import { type DocTypeDefinition, type GlobalSearchResult } from "../../../core/types.js";
import { type KanbanDefinition } from "../../../core/kanban.js";
import { type ReportDefinition } from "../../../core/reports.js";
import { type WorkspaceDefinition, type WorkspaceShortcutKind } from "../../../core/workspace.js";
import { labelFor } from "./shared.js";
import {
  EmptyState,
  ErrorState,
  Toolbar,
  UnsafeRawHtml,
  renderFragment,
  renderPage,
  type DeskNavItem,
  type DeskNavSection
} from "../ui/primitives.js";

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

function navSectionsFor(options: DeskLayoutOptions): readonly DeskNavSection[] {
  const workspaceItems: readonly DeskNavItem[] = (options.workspaces ?? []).map((workspace) => ({
    href: `/desk/workspaces/${encodeURIComponent(workspace.name)}`,
    label: workspace.label ?? workspace.name,
    active: workspace.name === options.activeWorkspace
  }));
  const doctypeItems: readonly DeskNavItem[] = options.doctypes.map((doctype) => ({
    href: `/desk/${encodeURIComponent(doctype.name)}`,
    label: labelFor(doctype),
    active: doctype.name === options.active
  }));
  const reportItems: readonly DeskNavItem[] = (options.reports ?? []).map((report) => ({
    href: `/desk/reports/${encodeURIComponent(report.name)}`,
    label: report.label ?? report.name,
    active: report.name === options.activeReport
  }));
  const dashboardItems: readonly DeskNavItem[] = (options.dashboards ?? []).map((dashboard) => ({
    href: `/desk/dashboards/${encodeURIComponent(dashboard.name)}`,
    label: dashboard.label ?? dashboard.name,
    active: dashboard.name === options.activeDashboard
  }));
  const kanbanItems: readonly DeskNavItem[] = (options.kanbans ?? []).map((kanban) => ({
    href: `/desk/kanbans/${encodeURIComponent(kanban.name)}`,
    label: kanban.label ?? kanban.name,
    active: kanban.name === options.activeKanban
  }));
  const calendarItems: readonly DeskNavItem[] = (options.calendars ?? []).map((calendar) => ({
    href: `/desk/calendars/${encodeURIComponent(calendar.name)}`,
    label: calendar.label ?? calendar.name,
    active: calendar.name === options.activeCalendar
  }));
  const adminItems: readonly DeskNavItem[] = (options.adminLinks ?? []).map((link) => ({
    href: link.href,
    label: link.label,
    active: link.id !== undefined && link.id === options.activeAdmin
  }));
  return [
    { heading: "Workspaces", items: workspaceItems },
    {
      heading: "Work",
      items:
        options.showAssignments === true
          ? [{ href: "/desk/assigned-to-me", label: "Assigned to Me", active: options.activeAssignments === true }]
          : []
    },
    {
      heading: "Search",
      items: [{ href: "/desk/search", label: "Global Search", active: options.activeSearch === true }]
    },
    { heading: "DocTypes", items: doctypeItems },
    { heading: "Reports", items: reportItems },
    { heading: "Dashboards", items: dashboardItems },
    { heading: "Kanban", items: kanbanItems },
    { heading: "Calendars", items: calendarItems },
    {
      heading: "Output",
      items:
        options.showPrinting === true
          ? [{ href: "/desk/printing", label: "Printing", active: options.activePrinting === true }]
          : []
    },
    {
      heading: "Notifications",
      items: options.showNotifications === true ? [{ href: "/desk/notifications", label: "Inbox", active: false }] : []
    },
    {
      heading: "Files",
      items: options.showFiles === true ? [{ href: "/desk/files", label: "Files", active: false }] : []
    },
    { heading: "Admin", items: adminItems }
  ];
}

const Navigation: FC<{ sections: readonly DeskNavSection[] }> = ({ sections }) => (
  <>
    {sections
      .filter((section) => section.items.length > 0)
      .map((section) => (
        <>
          <p class="nav-heading">{section.heading}</p>
          {section.items.map((item) => (
            <a class={`nav-link${item.active === true ? " is-active" : ""}`} href={item.href}>{item.label}</a>
          ))}
        </>
      ))}
  </>
);

const DeskShell: FC<{ options: DeskLayoutOptions }> = ({ options }) => {
  const sections = navSectionsFor(options);
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{options.title} - cf-frappe Desk</title>
        <UnsafeRawHtml
          reason="static stylesheet link tag; must render as <link ...> (not <link .../>) to match byte-level test assertions; href is the DESK_STYLES_PATH constant"
          html={`<link rel="stylesheet" href="${DESK_STYLES_PATH}">`}
        />
      </head>
      <body>
        <a class="skip-link" href="#main">Skip to content</a>
        <header class="mobile-shell-header">
          <a class="brand mobile-brand" href="/desk">cf-frappe</a>
          <details class="mobile-nav">
            <summary>Menu</summary>
            <nav>
              <Navigation sections={sections} />
            </nav>
          </details>
        </header>
        <aside class="sidebar" aria-label="Desk navigation">
          <a class="brand" href="/desk">cf-frappe</a>
          <nav>
            <Navigation sections={sections} />
          </nav>
        </aside>
        <main id="main" class="main">
          <header class="topbar">
            <div>
              <p class="kicker">Desk</p>
              <h1>{options.title}</h1>
            </div>
          </header>
          {options.message !== undefined && options.message !== "" ? (
            <p class="notice" role="status">{options.message}</p>
          ) : null}
          <UnsafeRawHtml
            reason="pre-rendered page body produced by the desk view renderers, which escape their own interpolations; mirrors the legacy renderDeskLayout body slot"
            html={options.body}
          />
        </main>
      </body>
    </html>
  );
};

export function renderDeskLayout(options: DeskLayoutOptions): string {
  return renderPage(<DeskShell options={options} />);
}

type HomeCard = {
  readonly href: string;
  readonly label: string;
  readonly kind: string;
  readonly meta: string;
  readonly description: string;
};

const HomeMetric: FC<{ label: string; value: number }> = ({ label, value }) => (
  <div class="metric-card"><span>{label}</span><strong>{String(value)}</strong></div>
);

const HomeLinkCard: FC<{ item: HomeCard }> = ({ item }) => (
  <a class="home-link-card" href={item.href}>
    <span class="resource-kind">{item.kind}</span>
    <strong>{item.label}</strong>
    {item.meta ? <small>{item.meta}</small> : null}
    {item.description ? <p>{item.description}</p> : null}
  </a>
);

const DeskHome: FC<{
  doctypes: readonly DocTypeDefinition[];
  reports: readonly ReportDefinition[];
  workspaces: readonly WorkspaceDefinition[];
  dashboards: readonly DashboardDefinition[];
  kanbans: readonly KanbanDefinition[];
  calendars: readonly CalendarDefinition[];
  showAssignments: boolean;
}> = ({ doctypes, reports, workspaces, dashboards, kanbans, calendars, showAssignments }) => {
  const startCards: readonly HomeCard[] = [
    ...(showAssignments
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
  return (
    <>
      <section class="home-overview">
        <div>
          <p class="kicker">Workspace</p>
          <h2>Operational Desk</h2>
          <p class="muted">Lists, reports, boards, and admin surfaces available to the current actor.</p>
        </div>
        <div class="home-metrics" aria-label="Desk inventory">
          <HomeMetric label="DocTypes" value={doctypes.length} />
          <HomeMetric label="Reports" value={reports.length} />
          <HomeMetric label="Boards" value={kanbans.length} />
          <HomeMetric label="Dashboards" value={dashboards.length} />
        </div>
      </section>
      {workspaces.length > 0 ? (
        <section class="home-section">
          <div class="section-head">
            <h2>Workspaces</h2>
          </div>
          <div class="workspace-grid">
            {workspaces.map((workspace) => (
              <a class="workspace-card" href={`/desk/workspaces/${encodeURIComponent(workspace.name)}`}>
                <strong>{workspace.label ?? workspace.name}</strong>
                <span>{workspace.description ?? workspace.module ?? ""}</span>
              </a>
            ))}
          </div>
        </section>
      ) : null}
      <section class="home-section">
        <div class="section-head">
          <h2>Start work</h2>
          <span>{String(startCards.length)} shortcuts</span>
        </div>
        <div class="home-card-grid">
          {startCards.length > 0 ? (
            startCards.map((item) => <HomeLinkCard item={item} />)
          ) : (
            <p class="empty">No readable Desk resources.</p>
          )}
        </div>
      </section>
    </>
  );
};

export function renderDeskHome(
  doctypes: readonly DocTypeDefinition[],
  reports: readonly ReportDefinition[] = [],
  workspaces: readonly WorkspaceDefinition[] = [],
  dashboards: readonly DashboardDefinition[] = [],
  kanbans: readonly KanbanDefinition[] = [],
  calendars: readonly CalendarDefinition[] = [],
  options: { readonly showAssignments?: boolean } = {}
): string {
  return renderFragment(
    <DeskHome
      doctypes={doctypes}
      reports={reports}
      workspaces={workspaces}
      dashboards={dashboards}
      kanbans={kanbans}
      calendars={calendars}
      showAssignments={options.showAssignments === true}
    />
  );
}

type GlobalSearchPageState = {
  readonly query: string;
  readonly limit?: number | undefined;
  readonly tenant?: string | undefined;
  readonly result?: GlobalSearchResult | undefined;
};

const GlobalSearchPage: FC<{ state: GlobalSearchPageState }> = ({ state }) => {
  const limit = state.limit ?? state.result?.limit ?? 20;
  const items = state.result?.data ?? [];
  const emptyMessage = state.query ? "No documents matched." : "Enter a search query.";
  return (
    <>
      <form class="panel form list-filters" method="get" action="/desk/search">
        {state.tenant !== undefined ? <input type="hidden" name="tenant" value={state.tenant} /> : null}
        <div class="fields">
          <label class="field wide"><span>Search</span><input name="q" value={state.query} /></label>
          <label class="field"><span>Limit</span><input name="limit" type="number" min="1" max="100" value={String(limit)} /></label>
        </div>
        <div class="actions"><button class="button primary" type="submit">Search</button></div>
      </form>
      {state.result !== undefined ? (
        <Toolbar>
          <span class="muted">{String(state.result.total)} matches</span>
        </Toolbar>
      ) : null}
      <section class="panel">
        <div class="table-wrap">
          <table class="responsive-table">
            <thead>
              <tr><th>Document</th><th>DocType</th><th>Name</th><th>Matched Field</th><th>Matched Text</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {items.length > 0 ? (
                items.map((item) => (
                  <tr>
                    <td data-label="Document"><a href={item.route}>{item.label}</a></td>
                    <td data-label="DocType">{item.doctype}</td>
                    <td data-label="Name">{item.name}</td>
                    <td data-label="Matched Field">{item.matchedField}</td>
                    <td data-label="Matched Text">{item.matchedText}</td>
                    <td data-label="Updated"><time datetime={item.updatedAt}>{item.updatedAt}</time></td>
                  </tr>
                ))
              ) : (
                <tr><td colspan={6} class="empty">{emptyMessage}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
};

export function renderGlobalSearchPage(state: {
  readonly query: string;
  readonly limit?: number;
  readonly tenant?: string;
  readonly result?: GlobalSearchResult;
}): string {
  return renderFragment(<GlobalSearchPage state={state} />);
}

const WorkspaceSection: FC<{ section: WorkspaceSectionView }> = ({ section }) => (
  <section class="workspace-section">
    <h2>{section.label}</h2>
    <div class="workspace-grid">
      {section.shortcuts.length > 0 ? (
        section.shortcuts.map((shortcut) => (
          <a class="workspace-card" href={shortcut.href}>
            <strong>{shortcut.label}</strong>
            <span>{shortcut.description ?? workspaceShortcutKindLabel(shortcut.kind)}</span>
          </a>
        ))
      ) : (
        <p class="empty">No shortcuts available.</p>
      )}
    </div>
  </section>
);

const WorkspacePage: FC<{ view: WorkspacePageView }> = ({ view }) => (
  <>
    {view.workspace.description ? <p class="muted">{view.workspace.description}</p> : null}
    {view.sections.length > 0 ? (
      view.sections.map((section) => <WorkspaceSection section={section} />)
    ) : (
      <section class="panel form">
        <p class="empty">No shortcuts available.</p>
      </section>
    )}
  </>
);

export function renderWorkspacePage(view: WorkspacePageView): string {
  return renderFragment(<WorkspacePage view={view} />);
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
  return renderFragment(<EmptyState message={message} />);
}

export function renderErrorPanel(message: string): string {
  return renderFragment(<ErrorState message={message} />);
}
