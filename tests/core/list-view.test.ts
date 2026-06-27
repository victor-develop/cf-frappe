import {
  defineDocType,
  FrameworkError,
  assertListFilterExpressionShape,
  freezeListFilterExpression,
  listFilterControlsForField,
  listFilterOperatorsForField,
  matchesListFilterExpression,
  normalizeListFilterExpression,
  resolveListView,
  type DocumentSnapshot,
  type JsonValue,
  type ListFilterExpression
} from "../../src";

describe("list views", () => {
  it("resolves explicit list-view metadata and coerces default filters", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "title", type: "text" },
        { name: "status", type: "select", options: ["Open", "Closed"] },
        { name: "count", type: "integer" },
        { name: "secret", type: "text", hidden: true }
      ],
      listView: {
        columns: ["status", "title"],
        filterFields: ["status"],
        filters: [
          { field: "count", operator: "gte", value: "2" },
          { field: "system.docstatus", value: "draft" }
        ],
        orderBy: "count",
        order: "asc",
        pageSize: 500
      }
    });

    const listView = resolveListView(Task);

    expect(listView.columns.map((field) => field.name)).toEqual(["status", "title"]);
    expect(listView.filterFields.map((field) => field.name)).toEqual(["status"]);
    expect(listView.filterBuilderFields.map((field) => field.field)).toEqual([
      "status",
      "system.name",
      "system.docstatus",
      "system.createdAt",
      "system.updatedAt",
      "system.version"
    ]);
    expect(listView.filterBuilderFields).toEqual(expect.arrayContaining([
      {
        field: "status",
        inputType: "select",
        operators: [
          { operator: "eq", label: "equals" },
          { operator: "ne", label: "is not" },
          { operator: "in", label: "is in" },
          { operator: "not_in", label: "is not in" },
          { operator: "is", label: "is" }
        ]
      }
    ]));
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
    expect(listView.filters).toEqual([
      { field: "count", operator: "gte", value: 2 },
      { field: "system.docstatus", value: "draft" }
    ]);
    expect(listView.orderBy).toBe("count");
    expect(listView.order).toBe("asc");
    expect(listView.orderOptions).toEqual([
      { name: "name", label: "Name" },
      { name: "createdAt", label: "Created" },
      { name: "updatedAt", label: "Updated" },
      { name: "version", label: "Version" },
      { name: "title", label: "title" },
      { name: "status", label: "status" },
      { name: "count", label: "count" }
    ]);
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
      { operator: "in", label: "is in" },
      { operator: "not_in", label: "is not in" },
      { operator: "is", label: "is" },
      { operator: "contains", label: "contains" },
      { operator: "like", label: "like" },
      { operator: "not_like", label: "not like" }
    ]);
    expect(listFilterOperatorsForField(Task.fields[1] ?? failField()).map((item) => item.operator)).toEqual([
      "eq",
      "ne",
      "in",
      "not_in",
      "is",
      "gt",
      "gte",
      "lt",
      "lte",
      "between",
      "not_between"
    ]);
    expect(listFilterOperatorsForField(Task.fields[2] ?? failField()).map((item) => item.operator)).toEqual([
      "eq",
      "ne",
      "in",
      "not_in",
      "is"
    ]);
    expect(listFilterOperatorsForField(Task.fields[3] ?? failField())).toEqual([]);
    expect(listFilterControlsForField(Task.fields[3] ?? failField())).toEqual([]);
  });

  it("normalizes nested compound filter expressions through field metadata", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "status", type: "select", options: ["Open", "Closed"] },
        { name: "count", type: "integer" }
      ]
    });

    expect(
      normalizeListFilterExpression(Task, {
        kind: "group",
        match: "any",
        filters: [
          { field: "status", value: "Open" },
          {
            kind: "group",
            match: "all",
            filters: [
              { field: "count", operator: "gte", value: "2" },
              { field: "system.version", operator: "gt", value: "1" }
            ]
          }
        ]
      })
    ).toEqual({
      kind: "group",
      match: "any",
      filters: [
        { field: "status", value: "Open" },
        {
          kind: "group",
          match: "all",
          filters: [
            { field: "count", operator: "gte", value: 2 },
            { field: "system.version", operator: "gt", value: 1 }
          ]
        }
      ]
    });
  });

  it("validates and freezes reusable compound filter expression metadata", () => {
    const priorities = ["High", "Low"] as const;
    const expression: ListFilterExpression = {
      kind: "group",
      match: "any",
      filters: [
        { field: "priority", operator: "in", value: priorities },
        { field: "title", operator: "contains", value: "Launch" }
      ]
    };

    assertListFilterExpressionShape(expression, { errorCode: "LIST_VIEW_INVALID", label: "Shared filter expression" });
    const frozen = freezeListFilterExpression(expression);

    expect(Object.isFrozen(frozen)).toBe(true);
    expect(Object.isFrozen((frozen as { readonly filters: readonly unknown[] }).filters)).toBe(true);
    expect(Object.isFrozen((frozen as { readonly filters: readonly { readonly value?: unknown }[] }).filters[0]?.value)).toBe(true);
    (priorities as unknown as string[]).push("Urgent");
    expect((frozen as { readonly filters: readonly { readonly value?: unknown }[] }).filters[0]?.value).toEqual([
      "High",
      "Low"
    ]);
    expect(() =>
      assertListFilterExpressionShape(
        { kind: "group", match: "sideways", filters: [{ field: "priority", value: "High" }] },
        { errorCode: "LIST_VIEW_INVALID" }
      )
    ).toThrow(FrameworkError);
    expect(() =>
      assertListFilterExpressionShape(
        { kind: "group", match: "all", filters: [{ kind: "group", match: "any", filters: [{ field: "priority", value: "High" }] }] },
        { maxExpressionDepth: 1 }
      )
    ).toThrow("List filter expression cannot exceed 1 levels");
    expect(() =>
      assertListFilterExpressionShape(
        { kind: "group", match: "all", filters: [{ field: "priority", value: "High" }] },
        { maxExpressionNodes: 1 }
      )
    ).toThrow("List filter expression cannot exceed 5 levels or 1 nodes");
  });

  it("matches normalized list filter expressions against document snapshots", () => {
    const snapshot = listViewSnapshot({
      title: "Launch TASK_100%",
      status: "Open",
      count: 5,
      done: true
    });
    const cases: readonly (readonly [string, ListFilterExpression, boolean])[] = [
      ["eq", { field: "status", value: "Open" }, true],
      ["ne", { field: "status", operator: "ne", value: "Closed" }, true],
      ["ne missing", { field: "missing", operator: "ne", value: "Closed" }, false],
      ["in", { field: "status", operator: "in", value: ["Open", "Pending"] }, true],
      ["not_in", { field: "status", operator: "not_in", value: ["Closed"] }, true],
      ["not_in missing", { field: "missing", operator: "not_in", value: ["Closed"] }, false],
      ["is set", { field: "title", operator: "is", value: "set" }, true],
      ["is not set", { field: "missing", operator: "is", value: "not set" }, true],
      ["contains", { field: "title", operator: "contains", value: "task" }, true],
      ["like escaped wildcards", { field: "title", operator: "like", value: "launch TASK\\_100\\%" }, true],
      ["not_like", { field: "title", operator: "not_like", value: "%Draft%" }, true],
      ["gt", { field: "count", operator: "gt", value: 4 }, true],
      ["gte system", { field: "system.version", operator: "gte", value: 3 }, true],
      ["lt", { field: "count", operator: "lt", value: 6 }, true],
      ["lte", { field: "count", operator: "lte", value: 5 }, true],
      ["between", { field: "count", operator: "between", value: [2, 5] }, true],
      ["not_between", { field: "count", operator: "not_between", value: [6, 8] }, true],
      [
        "nested any/all",
        {
          kind: "group",
          match: "any",
          filters: [
            { field: "status", value: "Closed" },
            {
              kind: "group",
              match: "all",
              filters: [
                { field: "done", value: true },
                { field: "system.docstatus", value: "draft" }
              ]
            }
          ]
        },
        true
      ]
    ];

    for (const [label, expression, expected] of cases) {
      expect(matchesListFilterExpression(snapshot, expression), label).toBe(expected);
    }
  });

  it("bounds compound filter expression depth and node count", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [{ name: "status", type: "text" }]
    });

    expect(() =>
      normalizeListFilterExpression(
        Task,
        {
          kind: "group",
          match: "all",
          filters: [{ kind: "group", match: "any", filters: [{ field: "status", value: "Open" }] }]
        },
        { maxExpressionDepth: 1 }
      )
    ).toThrow("List filter expression cannot exceed 1 levels");

    expect(() =>
      normalizeListFilterExpression(
        Task,
        { kind: "group", match: "all", filters: [{ field: "status", value: "Open" }] },
        { maxExpressionNodes: 1 }
      )
    ).toThrow("List filter expression cannot exceed 5 levels or 1 nodes");
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

    expect(() =>
      defineDocType({
        name: "Task",
        fields: [{ name: "title", type: "text" }],
        listView: { filters: [{ field: "title", operator: "is", value: "present" }] }
      })
    ).toThrow(expect.objectContaining({ code: "LIST_VIEW_INVALID" }));

    expect(() =>
      defineDocType({
        name: "Task",
        fields: [{ name: "count", type: "integer" }],
        listView: { filters: [{ field: "count", operator: "like", value: "1%" }] }
      })
    ).toThrow(expect.objectContaining({ code: "LIST_VIEW_INVALID" }));

    expect(() =>
      defineDocType({
        name: "Task",
        fields: [{ name: "count", type: "integer" }],
        listView: { filters: [{ field: "count", operator: "not_between", value: ["1"] }] }
      })
    ).toThrow(expect.objectContaining({ code: "LIST_VIEW_INVALID" }));
  });

  it("rejects invalid list ordering metadata", () => {
    expect(() =>
      defineDocType({
        name: "Task",
        fields: [{ name: "title", type: "text" }],
        listView: { orderBy: "missing" }
      })
    ).toThrow("List orderBy field 'missing' is not defined on Task");

    expect(() =>
      defineDocType({
        name: "Task",
        fields: [{ name: "payload", type: "json" }],
        listView: { orderBy: "payload" }
      })
    ).toThrow("List orderBy field 'payload' cannot be a json field");

    expect(() =>
      defineDocType({
        name: "Task",
        fields: [{ name: "secret", type: "text", hidden: true }],
        listView: { orderBy: "secret" }
      })
    ).toThrow("List orderBy field 'secret' is hidden on Task");

    expect(() =>
      defineDocType({
        name: "Task",
        fields: [{ name: "title", type: "text" }],
        listView: { order: "sideways" as "asc" }
      })
    ).toThrow("List order must be asc or desc");
  });
});

function failField(): never {
  throw new Error("Expected field");
}

function listViewSnapshot(data: Record<string, JsonValue>): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Task",
    name: "TASK-1",
    version: 3,
    docstatus: "draft",
    data,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z"
  };
}
