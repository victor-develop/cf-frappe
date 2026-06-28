import { createRegistry, defineClientScript, defineDataPatch, defineDocType, FrameworkError } from "../../src";

describe("registry", () => {
  it("lists doctypes in stable name order", () => {
    const registry = createRegistry({
      doctypes: [
        defineDocType({ name: "Zulu", fields: [] }),
        defineDocType({ name: "Alpha", fields: [] })
      ]
    });

    expect(registry.list().map((doctype) => doctype.name)).toEqual(["Alpha", "Zulu"]);
  });

  it("returns frozen registry list collections", () => {
    const registry = createRegistry({
      apps: [{ name: "notes", modules: ["Notes"], dependencies: [] }],
      doctypes: [defineDocType({ name: "Note", fields: [] })],
      dataPatches: [defineDataPatch({ id: "notes.seed", checksum: "v1", run: () => ({ seeded: true }) })]
    });

    expect(Object.isFrozen(registry.list())).toBe(true);
    expect(Object.isFrozen(registry.listApps())).toBe(true);
    expect(Object.isFrozen(registry.listDataPatches())).toBe(true);
    expect(() => (registry.list() as unknown as unknown[]).push(defineDocType({ name: "Other", fields: [] }))).toThrow(
      TypeError
    );
  });

  it("throws a framework error for unknown doctypes", () => {
    const registry = createRegistry();

    expect(() => registry.get("Missing")).toThrow(FrameworkError);
  });

  it("snapshots registry option doctypes by value", () => {
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
    const registry = createRegistry({ doctypes: [doctype] });

    statusOptions[0] = "Mutated";
    doctype.fields[0]!.name = "mutated";
    doctype.formView.sections[0]!.fields[0] = "mutated";
    doctype.listView.columns[0] = "status";
    doctype.listView.filters[0]!.value = "Closed";

    expect(registry.get("Task").fields).toEqual([
      { name: "title", type: "text" },
      { name: "status", type: "select", options: ["Open", "Closed"] }
    ]);
    expect(registry.get("Task").formView?.sections).toEqual([{ heading: "Main", fields: ["title", "status"] }]);
    expect(registry.get("Task").listView?.columns).toEqual(["title"]);
    expect(registry.get("Task").listView?.filters).toEqual([{ field: "status", value: "Open" }]);
    expect(Object.isFrozen(registry.get("Task"))).toBe(true);
    expect(Object.isFrozen(registry.get("Task").fields)).toBe(true);
    expect(Object.isFrozen(registry.get("Task").fields[1]?.options)).toBe(true);
  });

  it("snapshots registered doctypes by value", () => {
    const doctype = {
      name: "Note",
      fields: [{ name: "title", type: "text" as const }]
    };
    const registry = createRegistry();

    registry.registerDocType(doctype);
    doctype.fields[0]!.name = "mutated";

    expect(registry.get("Note").fields).toEqual([{ name: "title", type: "text" }]);
    expect(Object.isFrozen(registry.get("Note"))).toBe(true);
    expect(Object.isFrozen(registry.get("Note").fields[0])).toBe(true);
  });

  it("keeps hooks grouped by doctype", () => {
    const registry = createRegistry({ doctypes: [defineDocType({ name: "Note", fields: [] })] });
    const hook = {};
    registry.registerHooks("Note", hook);

    const hooks = registry.hooksFor("Note");

    expect(hooks).toEqual([hook]);
    expect(Object.isFrozen(hooks)).toBe(true);
    expect(() => (hooks as unknown as unknown[]).push({})).toThrow(TypeError);
    expect(registry.hooksFor("Note")).toEqual([hook]);
    expect(registry.hooksFor("Other")).toEqual([]);
    expect(() => registry.registerHooks("Other", {})).toThrow(FrameworkError);
  });

  it("snapshots registered hook entries by value", () => {
    const registry = createRegistry({ doctypes: [defineDocType({ name: "Note", fields: [] })] });
    const beforeValidate = vi.fn();
    const replacementBeforeValidate = vi.fn();
    const hook = { beforeValidate };

    registry.registerHooks("Note", hook);
    hook.beforeValidate = replacementBeforeValidate;

    expect(registry.hooksFor("Note")[0]?.beforeValidate).toBe(beforeValidate);
    expect(registry.hooksFor("Note")[0]?.beforeValidate).not.toBe(replacementBeforeValidate);
    expect(Object.isFrozen(registry.hooksFor("Note")[0])).toBe(true);
  });

  it("registers client scripts for known doctypes and filters them by scope", () => {
    const registry = createRegistry({ doctypes: [defineDocType({ name: "Note", fields: [] })] });
    const formScript = defineClientScript({ name: "note-form", doctype: "Note", src: "/assets/note-form.js" });
    const listScript = defineClientScript({
      name: "note-list",
      doctype: "Note",
      src: "/assets/note-list.js",
      scope: "list"
    });
    const sharedScript = defineClientScript({
      name: "note-shared",
      doctype: "Note",
      src: "/assets/note-shared.js",
      scope: "both"
    });

    registry.registerClientScript(listScript);
    registry.registerClientScript(formScript);
    registry.registerClientScript(sharedScript);

    expect(registry.listClientScripts("Note").map((script) => script.name)).toEqual([
      "note-form",
      "note-list",
      "note-shared"
    ]);
    expect(registry.listClientScripts("Note", "form").map((script) => script.name)).toEqual([
      "note-form",
      "note-shared"
    ]);
    expect(registry.listClientScripts("Note", "list").map((script) => script.name)).toEqual([
      "note-list",
      "note-shared"
    ]);
    expect(Object.isFrozen(registry.listClientScripts("Note"))).toBe(true);
    expect(Object.isFrozen(registry.listClientScripts("Note")[0])).toBe(true);
    expect(() => registry.registerClientScript(formScript)).toThrow("already registered");
    expect(() =>
      registry.registerClientScript(defineClientScript({ name: "missing", doctype: "Missing", src: "/missing.js" }))
    ).toThrow(FrameworkError);
  });

  it("allows link fields to reference doctypes registered later in the same registry", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [{ name: "project", type: "link", linkTo: "Project" }]
    });
    const Project = defineDocType({ name: "Project", fields: [] });

    const registry = createRegistry({ doctypes: [Task, Project] });

    expect(registry.get("Task").fields).toMatchObject([{ linkTo: "Project" }]);
  });

  it("rejects link fields that target an unregistered doctype", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [{ name: "project", type: "link", linkTo: "Project" }]
    });

    expect(() => createRegistry({ doctypes: [Task] })).toThrow(FrameworkError);
  });

  it("allows table fields to reference child doctypes registered later in the same registry", () => {
    const Invoice = defineDocType({
      name: "Sales Invoice",
      fields: [{ name: "items", type: "table", tableOf: "Sales Invoice Item" }]
    });
    const InvoiceItem = defineDocType({ name: "Sales Invoice Item", fields: [] });

    const registry = createRegistry({ doctypes: [Invoice, InvoiceItem] });

    expect(registry.get("Sales Invoice").fields).toMatchObject([{ tableOf: "Sales Invoice Item" }]);
  });

  it("rejects table fields that target an unregistered child doctype", () => {
    const Invoice = defineDocType({
      name: "Sales Invoice",
      fields: [{ name: "items", type: "table", tableOf: "Sales Invoice Item" }]
    });

    expect(() => createRegistry({ doctypes: [Invoice] })).toThrow(FrameworkError);
  });
});
