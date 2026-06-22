import { defineDocType, FrameworkError, listFilterControlsForField, listFilterOperatorsForField, resolveListView } from "../../src";

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
    expect(listView.filterBuilderFields).toEqual([
      {
        field: "status",
        inputType: "select",
        operators: [
          { operator: "eq", label: "equals" },
          { operator: "ne", label: "is not" }
        ]
      }
    ]);
    expect(listView.filterControls).toEqual([
      {
        field: "status",
        inputType: "select",
        operator: "eq",
        operatorLabel: "equals",
        queryKey: "filter_status"
      },
      {
        field: "status",
        inputType: "select",
        labelSuffix: "is not",
        operator: "ne",
        operatorLabel: "is not",
        queryKey: "filter_status__ne"
      }
    ]);
    expect(listView.filters).toEqual([{ field: "count", operator: "gte", value: 2 }]);
    expect(listView.pageSize).toBe(200);
  });

  it("exposes field-aware operators for visual filter builders", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "title", type: "text" },
        { name: "count", type: "integer" },
        { name: "done", type: "boolean" },
        { name: "payload", type: "json" }
      ]
    });

    expect(listFilterOperatorsForField(Task.fields[0] ?? failField())).toEqual([
      { operator: "eq", label: "equals" },
      { operator: "ne", label: "is not" },
      { operator: "contains", label: "contains" }
    ]);
    expect(listFilterOperatorsForField(Task.fields[1] ?? failField()).map((item) => item.operator)).toEqual([
      "eq",
      "ne",
      "gt",
      "gte",
      "lt",
      "lte"
    ]);
    expect(listFilterOperatorsForField(Task.fields[2] ?? failField()).map((item) => item.operator)).toEqual([
      "eq",
      "ne"
    ]);
    expect(listFilterOperatorsForField(Task.fields[3] ?? failField())).toEqual([]);
    expect(listFilterControlsForField(Task.fields[3] ?? failField())).toEqual([]);
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

function failField(): never {
  throw new Error("Expected field");
}
