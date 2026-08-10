import { defineDocType } from "../../src/core/schema.js";
import {
  renderDeskHome,
  renderDeskLayout,
  renderErrorPanel,
  renderGlobalSearchPage,
  renderNotFound,
  renderWorkspacePage
} from "../../src/adapters/desk/views/shell.js";

const Task = defineDocType({
  name: "Task",
  module: "Ops",
  description: "Work items",
  fields: [{ name: "title", type: "text" }]
});

describe("Desk shell layout", () => {
  it("renders a minimal layout with only required sections", () => {
    const html = renderDeskLayout({ title: "Home", body: "<p>hello</p>", doctypes: [] });
    expect(html).toContain("<title>Home - cf-frappe Desk</title>");
    expect(html).toContain("Global Search");
    expect(html).not.toContain("Assigned to Me");
    expect(html).not.toContain(">Printing</a>");
    expect(html).not.toContain(">Inbox</a>");
    expect(html).not.toContain(">Files</a>");
    expect(html).not.toContain('class="notice"');
    expect(html).toContain("<p>hello</p>");
  });

  it("renders every optional nav section with label fallbacks and active states", () => {
    const html = renderDeskLayout({
      title: "Tasks",
      body: "",
      message: "Saved",
      active: "Task",
      activeReport: "r1",
      activeDashboard: "d1",
      activeKanban: "k1",
      activeCalendar: "c1",
      activeSearch: true,
      activeAssignments: true,
      activePrinting: true,
      activeAdmin: "custom-fields",
      activeWorkspace: "ops",
      showFiles: true,
      showNotifications: true,
      showAssignments: true,
      showPrinting: true,
      adminLinks: [
        { href: "/desk/admin/custom-fields", label: "Custom Fields", id: "custom-fields" },
        { href: "/desk/admin/naming", label: "Naming" }
      ],
      doctypes: [Task],
      reports: [{ name: "r1", doctype: "Task", columns: [{ name: "title" }] }],
      dashboards: [{ name: "d1", cards: [] }],
      kanbans: [{ name: "k1", doctype: "Task", columnField: "status" }],
      calendars: [{ name: "c1", doctype: "Task", startField: "due" }],
      workspaces: [{ name: "ops", sections: [] }, { name: "hr", label: "People", sections: [] }]
    });
    expect(html).toContain('class="nav-link is-active" href="/desk/Task"');
    expect(html).toContain('class="nav-link is-active" href="/desk/reports/r1"');
    expect(html).toContain('class="nav-link is-active" href="/desk/dashboards/d1"');
    expect(html).toContain('class="nav-link is-active" href="/desk/kanbans/k1"');
    expect(html).toContain('class="nav-link is-active" href="/desk/calendars/c1"');
    expect(html).toContain('class="nav-link is-active" href="/desk/workspaces/ops"');
    expect(html).toContain('class="nav-link" href="/desk/workspaces/hr">People</a>');
    expect(html).toContain('class="nav-link is-active" href="/desk/admin/custom-fields"');
    expect(html).toContain('class="nav-link" href="/desk/admin/naming"');
    expect(html).toContain("Assigned to Me");
    expect(html).toContain(">Printing</a>");
    expect(html).toContain(">Inbox</a>");
    expect(html).toContain(">Files</a>");
    expect(html).toContain('<p class="notice" role="status">Saved</p>');
  });
});

describe("Desk home", () => {
  it("renders an empty home with no shortcuts", () => {
    const html = renderDeskHome([]);
    expect(html).toContain("No readable Desk resources.");
    expect(html).toContain("0 shortcuts");
  });

  it("renders shortcut cards for every resource kind with fallbacks", () => {
    const html = renderDeskHome(
      [Task],
      [
        { name: "r1", doctype: "Task", columns: [{ name: "title" }] },
        { name: "r2", label: "Report Two", description: "R2", doctype: "Task", columns: [{ name: "title" }] }
      ],
      [
        { name: "ops", sections: [] },
        { name: "hr", label: "People", description: "HR things", module: "HR", sections: [] }
      ],
      [{ name: "d1", cards: [] }, { name: "d2", label: "Dash Two", module: "Ops", description: "D2", cards: [] }],
      [{ name: "k1", doctype: "Task", columnField: "status" }, { name: "k2", label: "Kanban Two", description: "K2", doctype: "Task", columnField: "status" }],
      [{ name: "c1", doctype: "Task", startField: "due" }, { name: "c2", label: "Cal Two", description: "C2", doctype: "Task", startField: "due" }],
      { showAssignments: true }
    );
    expect(html).toContain("Assigned to Me");
    expect(html).toContain("Ops · 1 fields");
    expect(html).toContain("Work items");
    expect(html).toContain("Report Two");
    expect(html).toContain("Dash Two");
    expect(html).toContain("Kanban Two");
    expect(html).toContain("Cal Two");
    expect(html).toContain(">People</strong>");
    expect(html).toContain("HR things");
    expect(html).toContain('href="/desk/workspaces/ops"');
  });
});

describe("Desk global search page", () => {
  it("prompts for a query when none is provided", () => {
    const html = renderGlobalSearchPage({ query: "" });
    expect(html).toContain("Enter a search query.");
    expect(html).not.toContain("matches");
    expect(html).toContain('value="20"');
  });

  it("renders matches with tenant, limit, and result rows", () => {
    const html = renderGlobalSearchPage({
      query: "ship",
      limit: 5,
      tenant: "tenant-a",
      result: {
        query: "ship",
        limit: 5,
        total: 1,
        data: [
          {
            doctype: "Task",
            name: "TASK-1",
            label: "Ship it",
            matchedField: "title",
            matchedText: "Ship it",
            route: "/desk/Task/TASK-1",
            updatedAt: "2026-08-01T00:00:00Z"
          }
        ]
      }
    });
    expect(html).toContain("1 matches");
    expect(html).toContain('name="tenant" value="tenant-a"');
    expect(html).toContain('href="/desk/Task/TASK-1"');
  });

  it("shows no-match message for an unmatched query", () => {
    const html = renderGlobalSearchPage({
      query: "ghost",
      result: { query: "ghost", limit: 10, total: 0, data: [] }
    });
    expect(html).toContain("No documents matched.");
    expect(html).toContain('value="10"');
  });
});

describe("Desk workspace page", () => {
  it("renders an empty workspace without description", () => {
    const html = renderWorkspacePage({ workspace: { name: "ops", sections: [] }, sections: [] });
    expect(html).toContain("No shortcuts available.");
    expect(html).not.toContain('class="muted"');
  });

  it("renders sections covering every shortcut kind label and empty sections", () => {
    const html = renderWorkspacePage({
      workspace: { name: "ops", label: "Operations", description: "Everything ops", sections: [] },
      sections: [
        {
          name: "main",
          label: "Main",
          shortcuts: [
            { name: "s1", label: "Tasks", kind: "doctype", href: "/desk/Task" },
            { name: "s2", label: "New Task", kind: "newDoc", href: "/desk/Task/new" },
            { name: "s3", label: "Report", kind: "report", href: "/desk/reports/r1" },
            { name: "s4", label: "Dash", kind: "dashboard", href: "/desk/dashboards/d1" },
            { name: "s5", label: "Board", kind: "kanban", href: "/desk/kanbans/k1" },
            { name: "s6", label: "Files", kind: "file", href: "/desk/files" },
            { name: "s7", label: "Inbox", kind: "notifications", href: "/desk/notifications" },
            { name: "s8", label: "Admin", kind: "admin", href: "/desk/admin/custom-fields" },
            { name: "s9", label: "Docs", kind: "url", href: "https://example.com", description: "External docs" }
          ]
        },
        { name: "empty", label: "Empty", shortcuts: [] }
      ]
    });
    expect(html).toContain("Everything ops");
    expect(html).toContain(">DocType</span>");
    expect(html).toContain(">New Document</span>");
    expect(html).toContain(">Report</span>");
    expect(html).toContain(">Dashboard</span>");
    expect(html).toContain(">Files</span>");
    expect(html).toContain(">Notifications</span>");
    expect(html).toContain(">Admin</span>");
    expect(html).toContain(">External docs</span>");
    expect(html).toContain("No shortcuts available.");
  });
});

describe("Desk fallback panels", () => {
  it("renders not-found and error panels", () => {
    expect(renderNotFound("Missing page")).toContain("Missing page");
    expect(renderErrorPanel("Broken page")).toContain("Broken page");
  });
});
