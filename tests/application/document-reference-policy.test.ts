import { describe, expect, it } from "vitest";

import {
  defineDocType,
  isEmptyFetchedTarget,
  isMutableData,
  parseFetchFrom,
  relatedDocTypeNames
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
});
