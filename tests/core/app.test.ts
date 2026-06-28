import {
  createRegistry,
  createRegistryFromApps,
  defineDashboard,
  defineApp,
  defineClientScript,
  defineDataPatch,
  defineDocType,
  definePrintFormat,
  definePrintLetterhead,
  defineReport,
  defineWorkspace,
  FrameworkError,
  registryOptionsFromApps,
  resolveAppInstallOrder
} from "../../src";

describe("app manifests", () => {
  it("composes installed apps into a registry in dependency order", () => {
    const Project = defineDocType({ name: "Project", fields: [{ name: "title", type: "text" }] });
    const Task = defineDocType({
      name: "Task",
      fields: [{ name: "project", type: "link", linkTo: "Project" }]
    });
    const beforeValidate = vi.fn();
    const auditHook = { beforeValidate };
    const coreHook = { validate: () => [] };
    const projectPatch = defineDataPatch({ id: "projects.seed_statuses", checksum: "v1", run: () => ({ seeded: true }) });
    const taskPatch = defineDataPatch({
      id: "tasks.backfill_project_links",
      checksum: "v1",
      run: () => ({ touched: 0 })
    });

    const projects = defineApp({
      name: "projects",
      label: "Projects",
      version: "1.0.0",
      modules: ["Projects"],
      doctypes: [Project],
      dataPatches: [projectPatch],
      hooks: { Task: [coreHook] }
    });
    const tasks = defineApp({
      name: "tasks",
      dependencies: ["projects"],
      modules: ["Tasks"],
      doctypes: [Task],
      dataPatches: [taskPatch],
      hooks: { Task: [auditHook] }
    });

    const registry = createRegistryFromApps([tasks, projects]);

    expect(registry.listApps().map((app) => app.name)).toEqual(["projects", "tasks"]);
    expect(registry.list().map((doctype) => doctype.name)).toEqual(["Project", "Task"]);
    expect(registry.listDataPatches().map((patch) => patch.id)).toEqual([
      "projects.seed_statuses",
      "tasks.backfill_project_links"
    ]);
    expect(registry.get("Task").fields).toMatchObject([{ linkTo: "Project" }]);
    expect(registry.hooksFor("Task")).toEqual([coreHook, auditHook]);
  });

  it("carries print, report, dashboard, workspace, and letterhead metadata from apps", () => {
    const Note = defineDocType({ name: "Note", fields: [{ name: "title", type: "text" }] });
    const letterhead = definePrintLetterhead({ name: "Standard", headerHtml: "<strong>Acme</strong>" });
    const printFormat = definePrintFormat({
      name: "Note Standard",
      doctype: "Note",
      letterhead: "Standard",
      sections: [{ fields: [{ field: "title" }] }]
    });
    const report = defineReport({
      name: "All Notes",
      doctype: "Note",
      columns: [{ name: "title" }],
      summaries: [{ name: "note_count", aggregate: "count" }]
    });
    const workspace = defineWorkspace({
      name: "Operations",
      sections: [
        {
          name: "main",
          shortcuts: [
            { name: "notes", kind: "doctype", target: "Note" },
            { name: "all-notes", kind: "report", target: "All Notes" }
          ]
        }
      ]
    });
    const dashboard = defineDashboard({
      name: "Operations Dashboard",
      cards: [{ name: "all_notes", source: { kind: "reportSummary", report: "All Notes", summary: "note_count" } }]
    });
    const clientScript = defineClientScript({ name: "note-form", doctype: "Note", src: "/assets/note-form.js" });

    const registry = createRegistryFromApps([
      defineApp({
        name: "notes",
        doctypes: [Note],
        letterheads: [letterhead],
        printFormats: [printFormat],
        reports: [report],
        dashboards: [dashboard],
        workspaces: [workspace],
        clientScripts: [clientScript]
      })
    ]);

    expect(registry.getPrintLetterhead("Standard")).toEqual(letterhead);
    expect(registry.getPrintFormat("Note Standard")).toEqual(printFormat);
    expect(registry.getReport("All Notes")).toEqual(report);
    expect(registry.getDashboard("Operations Dashboard")).toEqual(dashboard);
    expect(registry.getWorkspace("Operations")).toEqual(workspace);
    expect(registry.listClientScripts("Note")).toEqual([clientScript]);
  });

  it("rejects duplicate apps and invalid dependency graphs", () => {
    const one = defineApp({ name: "one" });
    const duplicate = defineApp({ name: "one" });
    const missingDependency = defineApp({ name: "two", dependencies: ["missing"] });
    const cycleA = defineApp({ name: "cycle_a", dependencies: ["cycle_b"] });
    const cycleB = defineApp({ name: "cycle_b", dependencies: ["cycle_a"] });

    expect(() => resolveAppInstallOrder([one, duplicate])).toThrow(FrameworkError);
    expect(() => resolveAppInstallOrder([missingDependency])).toThrow("depends on missing app");
    expect(() => resolveAppInstallOrder([cycleA, cycleB])).toThrow("dependency cycle");
    expect(() =>
      createRegistry({
        apps: [
          { name: "two", modules: [], dependencies: ["one"] },
          { name: "one", modules: [], dependencies: [] }
        ]
      })
    ).not.toThrow();
    expect(() =>
      createRegistry({
        apps: [
          { name: "cycle_a", modules: [], dependencies: ["cycle_b"] },
          { name: "cycle_b", modules: [], dependencies: ["cycle_a"] }
        ]
      })
    ).toThrow("dependency cycle");
    expect(() => createRegistry().registerApp({ name: "two", modules: [], dependencies: ["one"] })).toThrow(
      "depends on missing app"
    );
  });

  it("normalizes registry options without requiring consumers to use ModelRegistry directly", () => {
    const hook = {};
    const app = defineApp({
      name: "notes",
      modules: ["Notes"],
      doctypes: [defineDocType({ name: "Note", fields: [] })],
      dashboards: [
        defineDashboard({
          name: "Operations",
          cards: [{ name: "notes", source: { kind: "documentCount", doctype: "Note" } }]
        })
      ],
      workspaces: [
        defineWorkspace({
          name: "Operations",
          sections: [{ name: "main", shortcuts: [{ name: "notes", kind: "doctype", target: "Note" }] }]
        })
      ],
      hooks: { Note: [hook] },
      clientScripts: [defineClientScript({ name: "note-form", doctype: "Note", src: "/assets/note-form.js" })]
    });

    const options = registryOptionsFromApps([app]);

    expect(options.apps).toEqual([{ name: "notes", modules: ["Notes"], dependencies: [] }]);
    expect(options.doctypes?.map((doctype) => doctype.name)).toEqual(["Note"]);
    expect(options.dashboards?.map((dashboard) => dashboard.name)).toEqual(["Operations"]);
    expect(options.workspaces?.map((workspace) => workspace.name)).toEqual(["Operations"]);
    expect(options.clientScripts?.map((script) => script.name)).toEqual(["note-form"]);
    expect(options.hooks?.Note).toEqual([hook]);
  });

  it("returns frozen registry option collections from apps", () => {
    const hook = {};
    const app = defineApp({
      name: "notes",
      modules: ["Notes"],
      doctypes: [defineDocType({ name: "Note", fields: [] })],
      hooks: { Note: [hook] }
    });

    const options = registryOptionsFromApps([app]);

    expect(Object.isFrozen(options.apps)).toBe(true);
    expect(Object.isFrozen(options.doctypes)).toBe(true);
    expect(Object.isFrozen(options.hooks)).toBe(true);
    expect(Object.isFrozen(options.hooks?.Note)).toBe(true);
    expect(() => (options.doctypes as unknown as unknown[]).push(defineDocType({ name: "Other", fields: [] }))).toThrow(
      TypeError
    );
    expect(() => (options.hooks?.Note as unknown as unknown[]).push({})).toThrow(TypeError);
    expect(() => ((options.hooks as Record<string, unknown>).Other = [])).toThrow(TypeError);
  });

  it("snapshots raw app manifests while normalizing registry options", () => {
    const modules = ["Notes"];
    const statusOptions = ["Open", "Closed"];
    const beforeValidate = vi.fn();
    const replacementBeforeValidate = vi.fn();
    const hook = { beforeValidate };
    const app = {
      name: "notes",
      modules,
      doctypes: [
        {
          name: "Note",
          fields: [
            { name: "title", type: "text" as const },
            { name: "status", type: "select" as const, options: statusOptions }
          ]
        }
      ],
      hooks: { Note: [hook] }
    };

    const options = registryOptionsFromApps([app]);

    modules[0] = "Mutated";
    statusOptions[0] = "Mutated";
    app.doctypes[0]!.fields[0]!.name = "mutated";
    hook.beforeValidate = replacementBeforeValidate;

    expect(options.apps).toEqual([{ name: "notes", modules: ["Notes"], dependencies: [] }]);
    expect(options.doctypes?.[0]?.fields).toEqual([
      { name: "title", type: "text" },
      { name: "status", type: "select", options: ["Open", "Closed"] }
    ]);
    expect(options.hooks?.Note?.[0]?.beforeValidate).toBe(beforeValidate);
    expect(options.hooks?.Note?.[0]?.beforeValidate).not.toBe(replacementBeforeValidate);
    expect(Object.isFrozen(options.doctypes?.[0])).toBe(true);
    expect(Object.isFrozen(options.hooks?.Note?.[0])).toBe(true);
  });

  it("snapshots app manifest arrays, hooks, and website settings by value", () => {
    const modules = ["Notes"];
    const dependencies = ["core"];
    const settingsRoles = ["Guest"];
    const navRoles = ["Guest"];
    const hook = {};
    const hooks = { Note: [hook] };
    const app = defineApp({
      name: "notes",
      modules,
      dependencies,
      websiteSettings: {
        title: "Starter Site",
        homePageRoute: "about",
        roles: settingsRoles,
        navItems: [{ name: "about", label: "About", pageRoute: "about", roles: navRoles }]
      },
      hooks
    });

    modules[0] = "Mutated";
    dependencies[0] = "mutated";
    settingsRoles[0] = "User";
    navRoles[0] = "User";
    hooks.Note.push({});

    expect(app.modules).toEqual(["Notes"]);
    expect(app.dependencies).toEqual(["core"]);
    expect(app.websiteSettings?.roles).toEqual(["Guest"]);
    expect(app.websiteSettings?.navItems?.[0]?.roles).toEqual(["Guest"]);
    expect(app.hooks?.Note).toEqual([hook]);
    expect(Object.isFrozen(app.modules)).toBe(true);
    expect(Object.isFrozen(app.dependencies)).toBe(true);
    expect(Object.isFrozen(app.websiteSettings)).toBe(true);
    expect(Object.isFrozen(app.websiteSettings?.roles)).toBe(true);
    expect(Object.isFrozen(app.websiteSettings?.navItems)).toBe(true);
    expect(Object.isFrozen(app.websiteSettings?.navItems?.[0]?.roles)).toBe(true);
    expect(Object.isFrozen(app.hooks)).toBe(true);
    expect(Object.isFrozen(app.hooks?.Note)).toBe(true);
  });

  it("snapshots app manifest hook entries by value", () => {
    const beforeValidate = vi.fn();
    const replacementBeforeValidate = vi.fn();
    const hook = { beforeValidate };
    const app = defineApp({
      name: "notes",
      hooks: { Note: [hook] }
    });

    hook.beforeValidate = replacementBeforeValidate;

    expect(app.hooks?.Note?.[0]?.beforeValidate).toBe(beforeValidate);
    expect(app.hooks?.Note?.[0]?.beforeValidate).not.toBe(replacementBeforeValidate);
    expect(registryOptionsFromApps([app]).hooks?.Note?.[0]?.beforeValidate).toBe(beforeValidate);
    expect(Object.isFrozen(app.hooks?.Note?.[0])).toBe(true);
  });

  it("snapshots app manifest website theme tokens by value", () => {
    const tokens = {
      primaryColor: "#2563eb",
      backgroundColor: "#ffffff"
    };
    const app = defineApp({
      name: "website",
      websiteThemes: [
        {
          name: "Starter",
          tokens
        }
      ]
    });

    tokens.primaryColor = "#111827";

    expect(app.websiteThemes?.[0]?.tokens).toEqual({
      primaryColor: "#2563eb",
      backgroundColor: "#ffffff"
    });
    expect(Object.isFrozen(app.websiteThemes)).toBe(true);
    expect(Object.isFrozen(app.websiteThemes?.[0])).toBe(true);
    expect(Object.isFrozen(app.websiteThemes?.[0]?.tokens)).toBe(true);
    expect(createRegistryFromApps([app]).getWebsiteTheme("Starter").tokens).toEqual({
      primaryColor: "#2563eb",
      backgroundColor: "#ffffff"
    });
  });

  it("snapshots app manifest client script and data patch metadata by value", async () => {
    const clientScript = {
      name: " note-form ",
      doctype: " Note ",
      src: " /assets/note-form.js ",
      scope: "form" as const
    };
    const rollback = { label: "Undo seed notes", run: () => "original rollback" };
    const dataPatch = {
      id: "notes.seed",
      checksum: "v1",
      run: () => "original apply",
      rollback
    };
    const app = defineApp({
      name: "notes",
      clientScripts: [clientScript],
      dataPatches: [dataPatch]
    });

    clientScript.name = "mutated-script";
    clientScript.doctype = "Mutated";
    clientScript.src = "/assets/mutated.js";
    dataPatch.checksum = "v2";
    dataPatch.run = () => "mutated apply";
    rollback.run = () => "mutated rollback";

    expect(app.clientScripts).toEqual([
      {
        name: "note-form",
        doctype: "Note",
        src: "/assets/note-form.js",
        scope: "form"
      }
    ]);
    expect(app.dataPatches?.[0]?.checksum).toBe("v1");
    expect(await app.dataPatches?.[0]?.run({ resources: {} })).toBe("original apply");
    expect(await app.dataPatches?.[0]?.rollback?.run({ resources: {} })).toBe("original rollback");
    expect(Object.isFrozen(app.clientScripts)).toBe(true);
    expect(Object.isFrozen(app.clientScripts?.[0])).toBe(true);
    expect(Object.isFrozen(app.dataPatches)).toBe(true);
    expect(Object.isFrozen(app.dataPatches?.[0])).toBe(true);
    expect(Object.isFrozen(app.dataPatches?.[0]?.rollback)).toBe(true);
  });

  it("snapshots app manifest workspace metadata by value", () => {
    const workspaceRoles = ["User"];
    const shortcutRoles = ["User"];
    const workspace = {
      name: "Operations",
      roles: workspaceRoles,
      sections: [
        {
          name: "main",
          shortcuts: [{ name: "notes", kind: "doctype" as const, target: "Note", roles: shortcutRoles }]
        }
      ]
    };
    const app = defineApp({
      name: "notes",
      workspaces: [workspace]
    });

    workspaceRoles[0] = "Guest";
    shortcutRoles[0] = "Guest";
    workspace.sections[0]!.shortcuts.push({ name: "mutated", kind: "doctype", target: "Mutated", roles: ["Guest"] });

    expect(app.workspaces?.[0]?.roles).toEqual(["User"]);
    expect(app.workspaces?.[0]?.sections[0]?.shortcuts).toEqual([
      { name: "notes", kind: "doctype", target: "Note", roles: ["User"] }
    ]);
    expect(registryOptionsFromApps([app]).workspaces?.[0]?.sections[0]?.shortcuts).toEqual([
      { name: "notes", kind: "doctype", target: "Note", roles: ["User"] }
    ]);
    expect(Object.isFrozen(app.workspaces)).toBe(true);
    expect(Object.isFrozen(app.workspaces?.[0])).toBe(true);
    expect(Object.isFrozen(app.workspaces?.[0]?.roles)).toBe(true);
    expect(Object.isFrozen(app.workspaces?.[0]?.sections)).toBe(true);
    expect(Object.isFrozen(app.workspaces?.[0]?.sections[0]?.shortcuts)).toBe(true);
    expect(Object.isFrozen(app.workspaces?.[0]?.sections[0]?.shortcuts[0]?.roles)).toBe(true);
  });

  it("snapshots app manifest Web Page metadata by value", () => {
    const roles = ["Guest"];
    const page = {
      name: "About",
      route: "about",
      title: "About",
      roles,
      sections: [{ heading: "Intro", body: "Original body" }]
    };
    const app = defineApp({
      name: "website",
      webPages: [page]
    });

    roles[0] = "User";
    page.sections[0]!.body = "Mutated body";
    page.sections.push({ heading: "Injected", body: "Injected body" });

    expect(app.webPages?.[0]?.roles).toEqual(["Guest"]);
    expect(app.webPages?.[0]?.sections).toEqual([{ heading: "Intro", body: "Original body" }]);
    expect(registryOptionsFromApps([app]).webPages?.[0]?.sections).toEqual([
      { heading: "Intro", body: "Original body" }
    ]);
    expect(Object.isFrozen(app.webPages)).toBe(true);
    expect(Object.isFrozen(app.webPages?.[0])).toBe(true);
    expect(Object.isFrozen(app.webPages?.[0]?.roles)).toBe(true);
    expect(Object.isFrozen(app.webPages?.[0]?.sections)).toBe(true);
    expect(Object.isFrozen(app.webPages?.[0]?.sections[0])).toBe(true);
  });

  it("snapshots app manifest Web Form metadata by value", () => {
    const roles = ["Guest"];
    const form = {
      name: "Task Intake",
      route: "task-intake",
      roles,
      doctype: "Task",
      fields: [{ field: "title", label: "Title", required: true }]
    };
    const app = defineApp({
      name: "tasks",
      webForms: [form]
    });

    roles[0] = "User";
    form.fields[0]!.label = "Mutated";
    form.fields.push({ field: "status", label: "Status", required: false });

    expect(app.webForms?.[0]?.roles).toEqual(["Guest"]);
    expect(app.webForms?.[0]?.fields).toEqual([{ field: "title", label: "Title", required: true }]);
    expect(registryOptionsFromApps([app]).webForms?.[0]?.fields).toEqual([
      { field: "title", label: "Title", required: true }
    ]);
    expect(Object.isFrozen(app.webForms)).toBe(true);
    expect(Object.isFrozen(app.webForms?.[0])).toBe(true);
    expect(Object.isFrozen(app.webForms?.[0]?.roles)).toBe(true);
    expect(Object.isFrozen(app.webForms?.[0]?.fields)).toBe(true);
    expect(Object.isFrozen(app.webForms?.[0]?.fields[0])).toBe(true);
  });

  it("snapshots app manifest Web View metadata by value", () => {
    const roles = ["Guest"];
    const view = {
      name: "Task Updates",
      roles,
      doctype: "Task",
      routeField: "slug",
      titleField: "title",
      fields: [{ field: "title", label: "Title" }],
      filters: [{ field: "published", operator: "eq" as const, value: true }]
    };
    const app = defineApp({
      name: "tasks",
      webViews: [view]
    });

    roles[0] = "User";
    view.fields[0]!.label = "Mutated";
    view.fields.push({ field: "status", label: "Status" });
    view.filters[0]!.value = false;

    expect(app.webViews?.[0]?.roles).toEqual(["Guest"]);
    expect(app.webViews?.[0]?.fields).toEqual([{ field: "title", label: "Title" }]);
    expect(app.webViews?.[0]?.filters).toEqual([{ field: "published", operator: "eq", value: true }]);
    expect(registryOptionsFromApps([app]).webViews?.[0]?.filters).toEqual([
      { field: "published", operator: "eq", value: true }
    ]);
    expect(Object.isFrozen(app.webViews)).toBe(true);
    expect(Object.isFrozen(app.webViews?.[0])).toBe(true);
    expect(Object.isFrozen(app.webViews?.[0]?.roles)).toBe(true);
    expect(Object.isFrozen(app.webViews?.[0]?.fields)).toBe(true);
    expect(Object.isFrozen(app.webViews?.[0]?.fields?.[0])).toBe(true);
    expect(Object.isFrozen(app.webViews?.[0]?.filters)).toBe(true);
    expect(Object.isFrozen(app.webViews?.[0]?.filters?.[0])).toBe(true);
  });

  it("snapshots app manifest Calendar metadata by value", () => {
    const roles = ["User"];
    const calendar = {
      name: "Task Calendar",
      roles,
      doctype: "Task",
      startField: "startsOn",
      titleField: "title",
      filters: [{ field: "published", operator: "eq" as const, value: true }]
    };
    const app = defineApp({
      name: "tasks",
      calendars: [calendar]
    });

    roles[0] = "Guest";
    calendar.filters[0]!.value = false;

    expect(app.calendars?.[0]?.roles).toEqual(["User"]);
    expect(app.calendars?.[0]?.filters).toEqual([{ field: "published", operator: "eq", value: true }]);
    expect(registryOptionsFromApps([app]).calendars?.[0]?.filters).toEqual([
      { field: "published", operator: "eq", value: true }
    ]);
    expect(Object.isFrozen(app.calendars)).toBe(true);
    expect(Object.isFrozen(app.calendars?.[0])).toBe(true);
    expect(Object.isFrozen(app.calendars?.[0]?.roles)).toBe(true);
    expect(Object.isFrozen(app.calendars?.[0]?.filters)).toBe(true);
    expect(Object.isFrozen(app.calendars?.[0]?.filters?.[0])).toBe(true);
  });

  it("snapshots app manifest Kanban metadata by value", () => {
    const roles = ["User"];
    const kanban = {
      name: "Task Board",
      roles,
      doctype: "Task",
      columnField: "status",
      titleField: "title",
      filters: [{ field: "published", operator: "eq" as const, value: true }],
      columns: [{ value: "Open", label: "Open", indicator: "blue" }]
    };
    const app = defineApp({
      name: "tasks",
      kanbans: [kanban]
    });

    roles[0] = "Guest";
    kanban.filters[0]!.value = false;
    kanban.columns[0]!.label = "Mutated";
    kanban.columns.push({ value: "Closed", label: "Closed", indicator: "green" });

    expect(app.kanbans?.[0]?.roles).toEqual(["User"]);
    expect(app.kanbans?.[0]?.filters).toEqual([{ field: "published", operator: "eq", value: true }]);
    expect(app.kanbans?.[0]?.columns).toEqual([{ value: "Open", label: "Open", indicator: "blue" }]);
    expect(registryOptionsFromApps([app]).kanbans?.[0]?.columns).toEqual([
      { value: "Open", label: "Open", indicator: "blue" }
    ]);
    expect(Object.isFrozen(app.kanbans)).toBe(true);
    expect(Object.isFrozen(app.kanbans?.[0])).toBe(true);
    expect(Object.isFrozen(app.kanbans?.[0]?.roles)).toBe(true);
    expect(Object.isFrozen(app.kanbans?.[0]?.filters)).toBe(true);
    expect(Object.isFrozen(app.kanbans?.[0]?.filters?.[0])).toBe(true);
    expect(Object.isFrozen(app.kanbans?.[0]?.columns)).toBe(true);
    expect(Object.isFrozen(app.kanbans?.[0]?.columns?.[0])).toBe(true);
  });

  it("snapshots app manifest dashboard metadata by value", () => {
    const roles = ["User"];
    const dashboard = {
      name: "Task Dashboard",
      roles,
      cards: [
        {
          name: "open_tasks",
          source: {
            kind: "documentCount" as const,
            doctype: "Task",
            filters: [{ field: "status", operator: "eq" as const, value: "Open" }]
          },
          indicatorRules: [{ operator: "gt" as const, value: 10, indicator: "red" }]
        }
      ]
    };
    const app = defineApp({
      name: "tasks",
      dashboards: [dashboard]
    });

    roles[0] = "Guest";
    dashboard.cards[0]!.source.filters![0]!.value = "Closed";
    dashboard.cards[0]!.indicatorRules![0]!.indicator = "green";
    dashboard.cards.push({
      name: "injected",
      source: { kind: "documentCount", doctype: "Task", filters: [] },
      indicatorRules: []
    });

    expect(app.dashboards?.[0]?.roles).toEqual(["User"]);
    expect(app.dashboards?.[0]?.cards).toEqual([
      {
        name: "open_tasks",
        source: {
          kind: "documentCount",
          doctype: "Task",
          filters: [{ field: "status", operator: "eq", value: "Open" }]
        },
        indicatorRules: [{ operator: "gt", value: 10, indicator: "red" }]
      }
    ]);
    expect(registryOptionsFromApps([app]).dashboards?.[0]?.cards).toEqual(app.dashboards?.[0]?.cards);
    expect(Object.isFrozen(app.dashboards)).toBe(true);
    expect(Object.isFrozen(app.dashboards?.[0])).toBe(true);
    expect(Object.isFrozen(app.dashboards?.[0]?.roles)).toBe(true);
    expect(Object.isFrozen(app.dashboards?.[0]?.cards)).toBe(true);
    expect(Object.isFrozen(app.dashboards?.[0]?.cards[0])).toBe(true);
    const dashboardSource = app.dashboards?.[0]?.cards[0]?.source;
    expect(dashboardSource?.kind).toBe("documentCount");
    if (dashboardSource?.kind !== "documentCount") {
      throw new Error("Expected a document-count dashboard source");
    }
    expect(Object.isFrozen(dashboardSource)).toBe(true);
    expect(Object.isFrozen(dashboardSource.filters)).toBe(true);
    expect(Object.isFrozen(dashboardSource.filters?.[0])).toBe(true);
    const indicatorRules = app.dashboards?.[0]?.cards[0]?.indicatorRules;
    expect(Object.isFrozen(indicatorRules)).toBe(true);
    expect(Object.isFrozen(indicatorRules?.[0])).toBe(true);
  });

  it("snapshots app manifest report metadata by value", () => {
    const roles = ["User"];
    const filterDefault = ["Open", "In Progress"];
    const filterOptions = ["Open", "In Progress", "Closed"];
    const chartColors = ["#2563eb"];
    const report = {
      name: "Task Summary",
      doctype: "Task",
      roles,
      columns: [{ name: "title", field: "title", type: "text" as const }],
      filters: [
        {
          name: "status",
          field: "status",
          type: "select" as const,
          operator: "eq" as const,
          defaultValue: filterDefault,
          options: filterOptions
        }
      ],
      summaries: [{ name: "task_count", aggregate: "count" as const, indicator: "blue" }],
      groups: [
        {
          name: "by_status",
          field: "status",
          summaries: [{ name: "group_count", aggregate: "count" as const, indicator: "gray" }]
        }
      ],
      charts: [
        {
          name: "status_chart",
          type: "bar" as const,
          group: "by_status",
          summary: "group_count",
          colors: chartColors
        }
      ]
    };
    const app = defineApp({
      name: "tasks",
      reports: [report]
    });

    roles[0] = "Guest";
    filterDefault[0] = "Closed";
    filterOptions.push("Cancelled");
    chartColors[0] = "#dc2626";
    report.summaries[0]!.indicator = "red";
    report.groups[0]!.summaries[0]!.indicator = "green";
    report.columns.push({ name: "body", field: "body", type: "text" });

    expect(app.reports?.[0]?.roles).toEqual(["User"]);
    expect(app.reports?.[0]?.columns).toEqual([{ name: "title", field: "title", type: "text" }]);
    expect(app.reports?.[0]?.filters?.[0]?.defaultValue).toEqual(["Open", "In Progress"]);
    expect(app.reports?.[0]?.filters?.[0]?.options).toEqual(["Open", "In Progress", "Closed"]);
    expect(app.reports?.[0]?.summaries).toEqual([{ name: "task_count", aggregate: "count", indicator: "blue" }]);
    expect(app.reports?.[0]?.groups?.[0]?.summaries).toEqual([
      { name: "group_count", aggregate: "count", indicator: "gray" }
    ]);
    expect(app.reports?.[0]?.charts?.[0]?.colors).toEqual(["#2563eb"]);
    expect(registryOptionsFromApps([app]).reports?.[0]?.filters?.[0]?.defaultValue).toEqual([
      "Open",
      "In Progress"
    ]);
    expect(Object.isFrozen(app.reports)).toBe(true);
    expect(Object.isFrozen(app.reports?.[0])).toBe(true);
    expect(Object.isFrozen(app.reports?.[0]?.roles)).toBe(true);
    expect(Object.isFrozen(app.reports?.[0]?.columns)).toBe(true);
    expect(Object.isFrozen(app.reports?.[0]?.columns[0])).toBe(true);
    expect(Object.isFrozen(app.reports?.[0]?.filters)).toBe(true);
    expect(Object.isFrozen(app.reports?.[0]?.filters?.[0]?.defaultValue)).toBe(true);
    expect(Object.isFrozen(app.reports?.[0]?.filters?.[0]?.options)).toBe(true);
    expect(Object.isFrozen(app.reports?.[0]?.summaries)).toBe(true);
    expect(Object.isFrozen(app.reports?.[0]?.groups)).toBe(true);
    expect(Object.isFrozen(app.reports?.[0]?.groups?.[0]?.summaries)).toBe(true);
    expect(Object.isFrozen(app.reports?.[0]?.charts)).toBe(true);
    expect(Object.isFrozen(app.reports?.[0]?.charts?.[0]?.colors)).toBe(true);
  });

  it("snapshots app manifest print metadata by value", () => {
    const letterheadRoles = ["User"];
    const formatRoles = ["User"];
    const margins = { topMm: 10 };
    const field = { field: "title", label: "Title" };
    const format = {
      name: "Task Standard",
      doctype: "Task",
      roles: formatRoles,
      sections: [{ heading: "Main", fields: [field] }],
      layout: { margins }
    };
    const app = defineApp({
      name: "tasks",
      letterheads: [{ name: "Standard", headerHtml: "<strong>Acme</strong>", roles: letterheadRoles }],
      printFormats: [format]
    });

    letterheadRoles[0] = "Guest";
    formatRoles[0] = "Guest";
    margins.topMm = 20;
    field.label = "Mutated";
    format.sections[0]!.fields.push({ field: "status", label: "Status" });

    expect(app.letterheads?.[0]?.roles).toEqual(["User"]);
    expect(app.printFormats?.[0]?.roles).toEqual(["User"]);
    expect(app.printFormats?.[0]?.sections).toEqual([{ heading: "Main", fields: [{ field: "title", label: "Title" }] }]);
    expect(app.printFormats?.[0]?.layout?.margins).toEqual({ topMm: 10 });
    expect(registryOptionsFromApps([app]).printFormats?.[0]?.sections).toEqual([
      { heading: "Main", fields: [{ field: "title", label: "Title" }] }
    ]);
    expect(Object.isFrozen(app.letterheads)).toBe(true);
    expect(Object.isFrozen(app.letterheads?.[0])).toBe(true);
    expect(Object.isFrozen(app.letterheads?.[0]?.roles)).toBe(true);
    expect(Object.isFrozen(app.printFormats)).toBe(true);
    expect(Object.isFrozen(app.printFormats?.[0])).toBe(true);
    expect(Object.isFrozen(app.printFormats?.[0]?.roles)).toBe(true);
    expect(Object.isFrozen(app.printFormats?.[0]?.sections)).toBe(true);
    expect(Object.isFrozen(app.printFormats?.[0]?.sections?.[0])).toBe(true);
    expect(Object.isFrozen(app.printFormats?.[0]?.sections?.[0]?.fields)).toBe(true);
    expect(Object.isFrozen(app.printFormats?.[0]?.sections?.[0]?.fields[0])).toBe(true);
    expect(Object.isFrozen(app.printFormats?.[0]?.layout?.margins)).toBe(true);
  });

  it("snapshots app manifest DocType schema metadata by value", () => {
    const statusOptions = ["Open", "Closed"];
    const doctype = {
      name: "Task",
      fields: [
        { name: "title", type: "text" as const },
        { name: "status", type: "select" as const, options: statusOptions }
      ],
      formView: { sections: [{ heading: "Main", fields: ["title", "status"] }] },
      listView: {
        columns: ["title"],
        filters: [{ field: "status", operator: "eq" as const, value: "Open" }]
      }
    };
    const app = defineApp({
      name: "tasks",
      doctypes: [doctype]
    });

    statusOptions[0] = "Mutated";
    doctype.fields[0]!.name = "mutated";
    doctype.formView.sections[0]!.fields[0] = "mutated";
    doctype.listView.columns[0] = "status";
    doctype.listView.filters[0]!.value = "Closed";

    expect(app.doctypes?.[0]?.fields).toEqual([
      { name: "title", type: "text" },
      { name: "status", type: "select", options: ["Open", "Closed"] }
    ]);
    expect(app.doctypes?.[0]?.formView?.sections).toEqual([{ heading: "Main", fields: ["title", "status"] }]);
    expect(app.doctypes?.[0]?.listView?.columns).toEqual(["title"]);
    expect(app.doctypes?.[0]?.listView?.filters).toEqual([{ field: "status", value: "Open" }]);
    expect(registryOptionsFromApps([app]).doctypes?.[0]?.fields).toEqual(app.doctypes?.[0]?.fields);
    expect(Object.isFrozen(app.doctypes)).toBe(true);
    expect(Object.isFrozen(app.doctypes?.[0])).toBe(true);
    expect(Object.isFrozen(app.doctypes?.[0]?.fields)).toBe(true);
    expect(Object.isFrozen(app.doctypes?.[0]?.fields[0])).toBe(true);
    expect(Object.isFrozen(app.doctypes?.[0]?.fields[1]?.options)).toBe(true);
    expect(Object.isFrozen(app.doctypes?.[0]?.formView)).toBe(true);
    expect(Object.isFrozen(app.doctypes?.[0]?.formView?.sections)).toBe(true);
    expect(Object.isFrozen(app.doctypes?.[0]?.formView?.sections?.[0])).toBe(true);
    expect(Object.isFrozen(app.doctypes?.[0]?.formView?.sections?.[0]?.fields)).toBe(true);
    expect(Object.isFrozen(app.doctypes?.[0]?.listView)).toBe(true);
    expect(Object.isFrozen(app.doctypes?.[0]?.listView?.columns)).toBe(true);
    expect(Object.isFrozen(app.doctypes?.[0]?.listView?.filters)).toBe(true);
    expect(Object.isFrozen(app.doctypes?.[0]?.listView?.filters?.[0])).toBe(true);
  });

  it("validates app names at the manifest boundary", () => {
    expect(() => defineApp({ name: "" })).toThrow(FrameworkError);
    expect(() => defineApp({ name: "Bad Name" })).toThrow("Invalid app name");
    expect(() => defineApp({ name: "good-app", dependencies: ["Bad Name"] })).toThrow("Invalid app name");
    expect(() => resolveAppInstallOrder([{ name: "good_app", dependencies: ["Bad Name"] }])).toThrow(
      "Invalid app name"
    );
    expect(() =>
      createRegistryFromApps([]).registerApp({ name: "Bad Name", modules: [], dependencies: [] })
    ).toThrow("Invalid app name");
    expect(() =>
      createRegistryFromApps([]).registerApp({ name: "good_app", modules: [], dependencies: ["Bad Name"] })
    ).toThrow("Invalid app name");
    expect(() => createRegistryFromApps([defineApp({ name: "notes", hooks: { Ntoe: [{}] } })])).toThrow(
      "DocType 'Ntoe' is not registered"
    );
  });

  it("rejects duplicate and invalid data patch ids", () => {
    const patch = defineDataPatch({ id: "notes.seed", checksum: "v1", run: () => undefined });

    expect(() => defineDataPatch({ id: "Bad Patch", checksum: "v1", run: () => undefined })).toThrow(FrameworkError);
    expect(() => defineDataPatch({ id: "notes.empty", checksum: "", run: () => undefined })).toThrow(FrameworkError);
    expect(() => createRegistry({ dataPatches: [patch, patch] })).toThrow("already registered");
  });
});
