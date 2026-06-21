import { defineDocType, FrameworkError, resolveListView } from "../../src";

describe("list views", () => {
  it("resolves explicit list-view metadata and coerces default filters", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "title", type: "text" },
        { name: "status", type: "select", options: ["Open", "Closed"] },
        { name: "count", type: "integer" }
      ],
      listView: {
        columns: ["status", "title"],
        filterFields: ["status"],
        filters: [{ field: "count", operator: "gte", value: "2" }],
        pageSize: 500
      }
    });

    const listView = resolveListView(Task);

    expect(listView.columns.map((field) => field.name)).toEqual(["status", "title"]);
    expect(listView.filterFields.map((field) => field.name)).toEqual(["status"]);
    expect(listView.filters).toEqual([{ field: "count", operator: "gte", value: 2 }]);
    expect(listView.pageSize).toBe(200);
  });

  it("falls back to field-level list flags", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "title", type: "text", inListView: true },
        { name: "status", type: "select", options: ["Open", "Closed"], inListFilter: true },
        { name: "body", type: "longText" }
      ]
    });

    const listView = resolveListView(Task);

    expect(listView.columns.map((field) => field.name)).toEqual(["title"]);
    expect(listView.filterFields.map((field) => field.name)).toEqual(["status"]);
  });

  it("rejects list columns that are not DocType fields", () => {
    expect(() =>
      defineDocType({
        name: "Task",
        fields: [{ name: "title", type: "text" }],
        listView: { columns: ["missing"] }
      })
    ).toThrow("List view on Task references unknown column 'missing'");
  });

  it("rejects json fields as list filter fields", () => {
    expect(() =>
      defineDocType({
        name: "Task",
        fields: [{ name: "payload", type: "json" }],
        listView: { filterFields: ["payload"] }
      })
    ).toThrow(FrameworkError);
  });

  it("rejects table fields as list filter fields", () => {
    expect(() =>
      defineDocType({
        name: "Task",
        fields: [{ name: "items", type: "table", tableOf: "Task Item" }],
        listView: { filterFields: ["items"] }
      })
    ).toThrow(FrameworkError);
  });

  it("reports invalid default filter metadata as a list-view error", () => {
    expect(() =>
      defineDocType({
        name: "Task",
        fields: [{ name: "count", type: "integer" }],
        listView: { filters: [{ field: "count", operator: "gte", value: "many" }] }
      })
    ).toThrow(expect.objectContaining({ code: "LIST_VIEW_INVALID" }));
  });
});
