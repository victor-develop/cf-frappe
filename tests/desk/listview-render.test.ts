import { defineDocType } from "../../src/core/schema.js";
import { resolveListView } from "../../src/core/list-view.js";
import { type DocumentSnapshot, type ResolvedListView } from "../../src/core/types.js";
import { renderListView } from "../../src/adapters/desk/views/listview.js";

const Task = defineDocType({
  name: "Task",
  fields: [
    { name: "title", type: "text", label: "Title" },
    { name: "status", type: "select", options: ["Open", "Done"] },
    { name: "urgent", type: "boolean" },
    { name: "points", type: "integer" }
  ]
});

function doc(name: string, data: Record<string, string | number | boolean | null>): DocumentSnapshot {
  return {
    doctype: "Task",
    name,
    tenantId: "tenant-a",
    version: 1,
    docstatus: "draft",
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-02T00:00:00Z",
    data
  };
}

function bareListView(overrides: Partial<ResolvedListView> = {}): ResolvedListView {
  return {
    columns: [
      { name: "title", type: "text", label: "Title" },
      { name: "status", type: "select", options: ["Open", "Done"] }
    ],
    filterFields: [],
    filterBuilderFields: [],
    filterControls: [],
    filters: [],
    orderBy: "updatedAt",
    order: "desc",
    orderOptions: [{ name: "updatedAt", label: "Updated" }],
    pageSize: 20,
    ...overrides
  };
}

describe("Desk list view rendering", () => {
  it("renders an empty list with no options and no filter controls", () => {
    const html = renderListView(Task, bareListView(), []);
    expect(html).toContain("No documents yet.");
    expect(html).toContain('colspan="5"');
    expect(html).toContain(">New Task</a>");
    expect(html).toContain("Ready when needed");
    expect(html).not.toContain("Export CSV");
    expect(html).not.toContain("Saved filter name");
    expect(html).not.toContain("Import CSV");
    expect(html).not.toContain("Saved filters");
  });

  it("hides the create button and widens the empty row for bulk actions", () => {
    const html = renderListView(Task, bareListView(), [], [], {
      canCreate: false,
      bulkActions: [{ id: "submit", label: "Submit selected", action: "/desk/Task/bulk-submit", names: ["TASK-9"] }]
    });
    expect(html).not.toContain(">New Task</a>");
    expect(html).toContain('colspan="6"');
    expect(html).toContain("Submit selected");
  });

  it("renders rows with chips, empty cells, bulk selection, and unselectable rows", () => {
    const html = renderListView(
      Task,
      bareListView(),
      [doc("TASK-1", { title: "Ship it", status: "Open" }), doc("TASK/2", { title: "", status: "!!!" })],
      [{ field: "status", value: "Open" }, { field: "points", operator: "gte", value: 3 }],
      {
        exportHref: "/desk/Task/export.csv",
        bulkActions: [
          { id: "delete", label: "Delete selected", action: "/desk/Task/bulk-delete", names: ["TASK-1"], variant: "danger" }
        ],
        bulkReturnHref: "/desk/Task?status=Open"
      }
    );
    expect(html).toContain("Export CSV");
    expect(html).toContain("2 records");
    expect(html).toContain("value-chip-open");
    expect(html).toContain("value-chip-value");
    expect(html).toContain('<span class="empty">-</span>');
    expect(html).toContain('aria-label="Select TASK-1"');
    expect(html).not.toContain('aria-label="Select TASK/2"');
    expect(html).toContain('name="returnTo" value="/desk/Task?status=Open"');
    expect(html).toContain("status eq Open");
    expect(html).toContain("points gte 3");
    expect(html).toContain("2 active");
    expect(html).toContain("button danger");
  });

  it("renders plain per-operator filter controls for select, boolean, and text fields", () => {
    const listView = bareListView({
      filterFields: [
        { name: "status", type: "select", options: ["Open", "Done"] },
        { name: "urgent", type: "boolean" },
        { name: "title", type: "text", label: "Title" },
        { name: "points", type: "integer" }
      ],
      filterControls: [
        { field: "status", operator: "eq", operatorLabel: "is", inputType: "select", queryKey: "filter_status" },
        { field: "urgent", operator: "eq", operatorLabel: "is", inputType: "boolean", queryKey: "filter_urgent" },
        { field: "title", operator: "contains", operatorLabel: "contains", inputType: "text", queryKey: "filter_title__contains", labelSuffix: "contains" },
        { field: "title", operator: "ne", operatorLabel: "is not", inputType: "text", queryKey: "filter_title__ne", labelSuffix: "is not" },
        { field: "title", operator: "eq", operatorLabel: "is", inputType: "text", queryKey: "filter_title" }
      ]
    });
    const html = renderListView(Task, listView, [], [
      { field: "status", value: "Open" },
      { field: "urgent", value: true }
    ]);
    expect(html).toContain('<option value="Open" selected>Open</option>');
    expect(html).toContain('<option value="true" selected>True</option>');
    expect(html).toContain("Title contains");
    expect(html).toContain("Exclude Title");
    expect(html).toContain("Saved filter name");
  });

  it("renders quick filter choice controls when exactly one operator pair exists", () => {
    const listView = bareListView({
      filterFields: [
        { name: "status", type: "select", options: ["Open", "Done"] },
        { name: "urgent", type: "boolean" },
        { name: "title", type: "text", label: "Title" }
      ],
      filterControls: [
        { field: "status", operator: "eq", operatorLabel: "is", inputType: "select", queryKey: "filter_status" },
        { field: "status", operator: "ne", operatorLabel: "is not", inputType: "select", queryKey: "filter_status__ne" },
        { field: "urgent", operator: "eq", operatorLabel: "is", inputType: "boolean", queryKey: "filter_urgent" },
        { field: "urgent", operator: "ne", operatorLabel: "is not", inputType: "boolean", queryKey: "filter_urgent__ne" },
        { field: "title", operator: "contains", operatorLabel: "contains", inputType: "text", queryKey: "filter_title__contains" },
        { field: "title", operator: "ne", operatorLabel: "is not", inputType: "text", queryKey: "filter_title__ne" }
      ]
    });
    const html = renderListView(Task, listView, [], [
      { field: "status", operator: "ne", value: "Done" },
      { field: "title", operator: "contains", value: "ship" },
      { field: "title", operator: "ne", value: "junk" }
    ]);
    expect(html).toContain('name="quick_filter_operator:status"');
    expect(html).toContain('<option value="ne" selected>is not</option>');
    expect(html).toContain('name="quick_filter_value:urgent"');
    expect(html).toContain('name="filter_title__contains" value="ship"');
    expect(html).toContain('name="filter_title__ne" value="junk"');
  });

  it("renders the compound filter builder with a leaf expression wrapped in a group", () => {
    const listView = resolveListView(Task);
    const html = renderListView(Task, listView, [], [], {
      filterExpression: { field: "points", operator: "gte", value: 2 }
    });
    expect(html).toContain("Advanced filters");
    expect(html).toContain('compound-filter-disclosure" open');
    expect(html).toContain("Advanced expression");
    expect(html).toContain("points gte 2");
  });

  it("renders a nested group expression with mixed operators", () => {
    const listView = resolveListView(Task);
    const html = renderListView(Task, listView, [], [], {
      filterExpression: {
        kind: "group",
        match: "any",
        filters: [
          { field: "title", operator: "contains", value: "ship" },
          {
            kind: "group",
            match: "all",
            filters: [{ field: "points", operator: "between", value: [1, 5] }]
          }
        ]
      }
    });
    expect(html).toContain("<strong>Any</strong>");
    expect(html).toContain("<strong>All</strong>");
    expect(html).toContain("Remove group");
  });

  it("renders saved filters with the selected one highlighted", () => {
    const html = renderListView(Task, bareListView(), [], [], {
      savedFilters: [
        {
          tenantId: "tenant-a",
          doctype: "Task",
          id: "sf-1",
          label: "Mine",
          ownerId: "user-1",
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-08-01T00:00:00Z"
        },
        {
          tenantId: "tenant-a",
          doctype: "Task",
          id: "sf-2",
          label: "Open",
          ownerId: "user-1",
          createdAt: "2026-08-01T00:00:00Z",
          updatedAt: "2026-08-01T00:00:00Z"
        }
      ],
      selectedSavedFilterId: "sf-2"
    });
    expect(html).toContain('saved-filter-link" href="/desk/Task?saved_filter=sf-1"');
    expect(html).toContain('saved-filter-link is-active" href="/desk/Task?saved_filter=sf-2"');
    expect(html).toContain("sf-1/delete");
  });

  it("renders the import panel with results including named and unnamed failures", () => {
    const html = renderListView(Task, bareListView(), [], [], {
      importModes: ["create", "update"],
      importReturnHref: "/desk/Task",
      importResult: {
        doctype: "Task",
        mode: "update",
        total: 3,
        succeeded: [
          { row: 1, action: "update", name: "TASK-1", document: doc("TASK-1", { title: "ok" }) }
        ],
        failed: [
          { row: 2, action: "update", name: "TASK-2", code: "DOCUMENT_CONFLICT", message: "stale", status: 409 },
          { row: 3, action: "update", code: "UNKNOWN", message: "bad row", status: 400 }
        ]
      }
    });
    expect(html).toContain("Import CSV");
    expect(html).toContain("Imported 1 of 3 Task rows.");
    expect(html).toContain("Row 2 (TASK-2): stale");
    expect(html).toContain("Row 3: bad row");
    expect(html).toContain('<option value="update" selected>Update</option>');
    expect(html).toContain('name="returnTo" value="/desk/Task"');
  });

  it("renders a successful import result without failures", () => {
    const html = renderListView(Task, bareListView(), [], [], {
      importModes: ["create"],
      importResult: {
        doctype: "Task",
        mode: "create",
        total: 1,
        succeeded: [{ row: 1, action: "create", name: "TASK-9", document: doc("TASK-9", { title: "new" }) }],
        failed: []
      }
    });
    expect(html).toContain('class="notice"');
    expect(html).not.toContain("import-failures");
  });
});
