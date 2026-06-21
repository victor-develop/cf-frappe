import { createRegistry, defineDocType, FrameworkError } from "../../src";

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

  it("throws a framework error for unknown doctypes", () => {
    const registry = createRegistry();

    expect(() => registry.get("Missing")).toThrow(FrameworkError);
  });

  it("keeps hooks grouped by doctype", () => {
    const registry = createRegistry();
    const hook = {};
    registry.registerHooks("Note", hook);

    expect(registry.hooksFor("Note")).toEqual([hook]);
    expect(registry.hooksFor("Other")).toEqual([]);
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
});
