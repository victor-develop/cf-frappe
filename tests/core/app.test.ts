import {
  createRegistry,
  createRegistryFromApps,
  defineApp,
  defineClientScript,
  defineDataPatch,
  defineDocType,
  definePrintFormat,
  definePrintLetterhead,
  defineReport,
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

  it("carries print, report, and letterhead metadata from apps", () => {
    const Note = defineDocType({ name: "Note", fields: [{ name: "title", type: "text" }] });
    const letterhead = definePrintLetterhead({ name: "Standard", headerHtml: "<strong>Acme</strong>" });
    const printFormat = definePrintFormat({
      name: "Note Standard",
      doctype: "Note",
      letterhead: "Standard",
      sections: [{ fields: [{ field: "title" }] }]
    });
    const report = defineReport({ name: "All Notes", doctype: "Note", columns: [{ name: "title" }] });
    const clientScript = defineClientScript({ name: "note-form", doctype: "Note", src: "/assets/note-form.js" });

    const registry = createRegistryFromApps([
      defineApp({
        name: "notes",
        doctypes: [Note],
        letterheads: [letterhead],
        printFormats: [printFormat],
        reports: [report],
        clientScripts: [clientScript]
      })
    ]);

    expect(registry.getPrintLetterhead("Standard")).toBe(letterhead);
    expect(registry.getPrintFormat("Note Standard")).toBe(printFormat);
    expect(registry.getReport("All Notes")).toBe(report);
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
      hooks: { Note: [hook] },
      clientScripts: [defineClientScript({ name: "note-form", doctype: "Note", src: "/assets/note-form.js" })]
    });

    const options = registryOptionsFromApps([app]);

    expect(options.apps).toEqual([{ name: "notes", modules: ["Notes"], dependencies: [] }]);
    expect(options.doctypes?.map((doctype) => doctype.name)).toEqual(["Note"]);
    expect(options.clientScripts?.map((script) => script.name)).toEqual(["note-form"]);
    expect(options.hooks?.Note).toEqual([hook]);
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
