import { createRegistry, defineDocType, defineKanban, defineWorkspace, FrameworkError } from "../../src";

describe("kanban metadata", () => {
  it("freezes metadata-defined kanban boards", () => {
    const priorities = ["High", "Low"] as const;
    const board = defineKanban({
      name: "Task Board",
      label: "Task Board",
      roles: ["User"],
      doctype: "Task",
      columnField: "status",
      titleField: "title",
      filters: [{ field: "priority", operator: "in", value: priorities }],
      filterExpression: {
        kind: "group",
        match: "any",
        filters: [
          { field: "priority", value: "High" },
          { field: "title", operator: "contains", value: "Escalation" }
        ]
      },
      columns: [
        { value: "Open", label: "Open", indicator: "blue" },
        { value: "Done", label: "Done", indicator: "green" }
      ],
      maxCardsPerColumn: 25
    });

    expect(Object.isFrozen(board)).toBe(true);
    expect(Object.isFrozen(board.roles ?? [])).toBe(true);
    expect(Object.isFrozen(board.filters ?? [])).toBe(true);
    expect(Object.isFrozen(board.filters?.[0]?.value)).toBe(true);
    expect(Object.isFrozen(board.filterExpression)).toBe(true);
    expect(Object.isFrozen((board.filterExpression as { readonly filters: readonly unknown[] }).filters)).toBe(true);
    expect(Object.isFrozen(board.columns ?? [])).toBe(true);
    expect(Object.isFrozen(board.columns?.[0])).toBe(true);
    (priorities as unknown as string[]).push("Urgent");
    expect(board.filters?.[0]?.value).toEqual(["High", "Low"]);
  });

  it("validates kanban boards against registered DocType metadata", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "title", type: "text" },
        { name: "status", type: "select", options: ["Open", "Done"] },
        { name: "priority", type: "select", options: ["High", "Low"] },
        { name: "payload", type: "json" }
      ]
    });
    const board = defineKanban({
      name: "Task Board",
      doctype: "Task",
      columnField: "status",
      titleField: "title",
      filters: [{ field: "priority", value: "High" }]
    });

    const registry = createRegistry({ doctypes: [Task], kanbans: [board] });

    expect(registry.getKanban("Task Board")).toEqual(board);
    expect(registry.listKanbans().map((item) => item.name)).toEqual(["Task Board"]);
    expect(() => createRegistry({ doctypes: [Task], kanbans: [board, board] })).toThrow("already registered");
    expect(() =>
      createRegistry({
        doctypes: [Task],
        kanbans: [defineKanban({ name: "Broken", doctype: "Missing", columnField: "status" })]
      })
    ).toThrow("references unknown DocType");
    expect(() =>
      createRegistry({
        doctypes: [Task],
        kanbans: [defineKanban({ name: "Broken", doctype: "Task", columnField: "payload", columns: [{ value: "x" }] })]
      })
    ).toThrow("must be a select or text field");
    expect(() =>
      createRegistry({
        doctypes: [Task],
        kanbans: [
          defineKanban({
            name: "Typo Board",
            doctype: "Task",
            columnField: "status",
            columns: [{ value: "Dnne", label: "Done" }]
          })
        ]
      })
    ).toThrow("is not an option");
    expect(() =>
      createRegistry({
        doctypes: [Task],
        kanbans: [
          defineKanban({
            name: "Broken Filter",
            doctype: "Task",
            columnField: "status",
            filters: [{ field: "payload", value: "x" }]
          })
        ]
      })
    ).toThrow(FrameworkError);
    expect(() =>
      defineKanban({
        name: "Broken",
        doctype: "Task",
        columnField: "status",
        filterExpression: "not-an-expression" as never
      })
    ).toThrow("filter expression must be an object");
    expect(() =>
      defineKanban({
        name: "Broken",
        doctype: "Task",
        columnField: "status",
        filterExpression: deepKanbanFilterExpression(7) as never
      })
    ).toThrow("List filter expression cannot exceed 5 levels");
    expect(() =>
      defineKanban({
        name: "Broken",
        doctype: "Task",
        columnField: "status",
        filterExpression: wideKanbanFilterExpression(65) as never
      })
    ).toThrow("List filter expression cannot exceed 5 levels or 64 nodes");
    expect(() =>
      createRegistry({
        doctypes: [Task],
        kanbans: [
          defineKanban({
            name: "Broken Expression",
            doctype: "Task",
            columnField: "status",
            filterExpression: { field: "payload", value: "x" }
          })
        ]
      })
    ).toThrow("Filter field 'payload' cannot be a json field");
  });

  it("allows workspaces to reference registered kanban boards", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "title", type: "text" },
        { name: "status", type: "select", options: ["Open", "Done"] }
      ]
    });
    const board = defineKanban({ name: "Task Board", doctype: "Task", columnField: "status" });
    const workspace = defineWorkspace({
      name: "Operations",
      sections: [{ name: "main", shortcuts: [{ name: "task-board", kind: "kanban", target: "Task Board" }] }]
    });

    expect(createRegistry({ doctypes: [Task], kanbans: [board], workspaces: [workspace] }).getWorkspace("Operations"))
      .toEqual(workspace);
    expect(() => createRegistry({ doctypes: [Task], workspaces: [workspace] })).toThrow("references unknown kanban");
  });
});

function deepKanbanFilterExpression(depth: number): unknown {
  return depth <= 1
    ? { field: "priority", value: "High" }
    : { kind: "group", match: "all", filters: [deepKanbanFilterExpression(depth - 1)] };
}

function wideKanbanFilterExpression(nodes: number): unknown {
  return {
    kind: "group",
    match: "all",
    filters: Array.from({ length: nodes }, () => ({ field: "priority", value: "High" }))
  };
}
