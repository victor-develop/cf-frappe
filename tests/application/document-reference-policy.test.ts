import { describe, expect, it } from "vitest";

import {
  defineDocType,
  isEmptyFetchedTarget,
  isMutableData,
  parseFetchFrom,
  relatedDocTypeNames,
  validateDocumentLinks
} from "../../src";

describe("document reference policy", () => {
  it("parses fetch-from metadata paths", () => {
    expect(parseFetchFrom("project.title")).toEqual({ linkField: "project", sourceField: "title" });
    expect(parseFetchFrom("project")).toBeUndefined();
    expect(parseFetchFrom("project.title.extra")).toBeUndefined();
    expect(parseFetchFrom(".title")).toBeUndefined();
    expect(parseFetchFrom("project.")).toBeUndefined();
  });

  it("detects empty fetched targets for fetch-if-empty fields", () => {
    expect(isEmptyFetchedTarget(undefined)).toBe(true);
    expect(isEmptyFetchedTarget(null)).toBe(true);
    expect(isEmptyFetchedTarget("")).toBe(true);
    expect(isEmptyFetchedTarget([])).toBe(true);
    expect(isEmptyFetchedTarget("Apollo")).toBe(false);
    expect(isEmptyFetchedTarget(["Apollo"])).toBe(false);
    expect(isEmptyFetchedTarget(0)).toBe(false);
  });

  it("collects reachable related DocTypes from link and table fields once", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "project", type: "link", linkTo: "Project" },
        { name: "items", type: "table", tableOf: "Task Item" },
        { name: "review_project", type: "link", linkTo: "Project" },
        { name: "title", type: "text" }
      ]
    });

    expect(relatedDocTypeNames(Task)).toEqual(["Project", "Task Item"]);
  });

  it("identifies mutable child-table row data", () => {
    expect(isMutableData({ title: "A" })).toBe(true);
    expect(isMutableData(null)).toBe(false);
    expect(isMutableData(["A"])).toBe(false);
    expect(isMutableData("A")).toBe(false);
  });

  it("validates readable root link targets through an injected access predicate", async () => {
    const Project = defineDocType({ name: "Project", fields: [{ name: "title", type: "text" }] });
    const Task = defineDocType({
      name: "Task",
      fields: [{ name: "project", type: "link", linkTo: "Project" }]
    });

    const calls: string[] = [];
    const issues = await validateDocumentLinks({
      doctype: Task,
      data: { project: "PROJ-1" },
      relatedDocType: (name) => name === "Project" ? Project : undefined,
      canReadLinkedTarget: async ({ sourceDoctype, field, targetDoctype, targetName }) => {
        calls.push(`${sourceDoctype.name}.${field.name}->${targetDoctype.name}/${targetName}`);
        return true;
      }
    });

    expect(issues).toEqual([]);
    expect(calls).toEqual(["Task.project->Project/PROJ-1"]);
  });

  it("reports unreadable or missing root link targets as link-not-found issues", async () => {
    const Project = defineDocType({ name: "Project", fields: [{ name: "title", type: "text" }] });
    const Task = defineDocType({
      name: "Task",
      fields: [{ name: "project", type: "link", linkTo: "Project" }]
    });

    await expect(validateDocumentLinks({
      doctype: Task,
      data: { project: "PROJ-404" },
      relatedDocType: (name) => name === "Project" ? Project : undefined,
      canReadLinkedTarget: async () => false
    })).resolves.toEqual([
      {
        field: "project",
        code: "link_not_found",
        message: "Field 'project' references missing Project/PROJ-404"
      }
    ]);
  });

  it("validates nested table row links with stable field paths", async () => {
    const Project = defineDocType({ name: "Project", fields: [{ name: "title", type: "text" }] });
    const TaskItem = defineDocType({
      name: "Task Item",
      fields: [{ name: "project", type: "link", linkTo: "Project" }]
    });
    const Task = defineDocType({
      name: "Task",
      fields: [{ name: "items", type: "table", tableOf: "Task Item" }]
    });

    const issues = await validateDocumentLinks({
      doctype: Task,
      data: { items: [{ project: "PROJ-1" }, { project: "PROJ-404" }, "not-a-row"] },
      relatedDocType: (name) => ({ Project, "Task Item": TaskItem })[name],
      canReadLinkedTarget: async ({ targetName }) => targetName !== "PROJ-404"
    });

    expect(issues).toEqual([
      {
        field: "items[1].project",
        code: "link_not_found",
        message: "Field 'project' references missing Project/PROJ-404"
      }
    ]);
  });

  it("skips empty, absent, and unresolved link metadata", async () => {
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "project", type: "link", linkTo: "Project" },
        { name: "customer", type: "link", linkTo: "Customer" },
        { name: "items", type: "table", tableOf: "Task Item" }
      ]
    });
    let accessChecks = 0;

    const issues = await validateDocumentLinks({
      doctype: Task,
      data: { project: "", items: [] },
      relatedDocType: () => undefined,
      canReadLinkedTarget: async () => {
        accessChecks += 1;
        return false;
      }
    });

    expect(issues).toEqual([]);
    expect(accessChecks).toBe(0);
  });
});
