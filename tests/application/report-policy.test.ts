import {
  BoundedOrderedReportRows,
  buildReportFilterControls,
  buildReportCharts,
  buildReportGroups,
  buildReportOrderOptions,
  buildReportSummary,
  clampReportCsvExportLimit,
  clampReportRunLimit,
  combineReportFilterExpression,
  coerceReportFilterValue,
  defineDocType,
  defineReport,
  isEmptyReportFilterValue,
  limitReportGroups,
  materializeReportFilterExpression,
  materializeReportFilters,
  matchesReportFilters,
  matchesReportRowFilters,
  planReportReadAccess,
  primitiveReportRowValue,
  projectReportDocumentRow,
  projectReportRow,
  reportAggregateValue,
  reportCsvHeader,
  reportChartDrilldown,
  reportDocumentColumnValue,
  reportRowToCsv,
  reportRowColumnValue,
  reportSortValue,
  resolveReportOrder,
  resolvedReportFilterType,
  reportSummaryValue,
  sortReportChartPoints,
  sortReportDocuments,
  sortReportRows
} from "../../src";
import type { JsonValue } from "../../src";
import { guest, owner } from "../helpers";

describe("report policy", () => {
  const rows = [
    { title: "High", count: 7, priority: "High", active: true },
    { title: "Low", count: 3, priority: "Low", active: false },
    { title: "Empty", count: null, priority: null, active: null },
    { title: "Missing" }
  ];

  it("plans report read access from report roles and DocType permissions", () => {
    const doctype = defineDocType({
      name: "Private Report Source",
      fields: [{ name: "title", type: "text", required: true }],
      permissions: [{ roles: ["User"], actions: ["read"] }]
    });
    const report = defineReport({
      name: "Private Report",
      doctype: doctype.name,
      columns: [{ name: "title" }],
      roles: ["User"]
    });

    expect(planReportReadAccess({ actor: owner, report, doctype })).toEqual({ status: "allow" });
    expect(planReportReadAccess({ actor: guest, report, doctype })).toEqual({
      status: "deny",
      message: "Actor 'guest' cannot read report 'Private Report'"
    });
  });

  it("shapes report summary values with labels, fields, types, and indicators", () => {
    expect(reportSummaryValue({
      name: "total_count",
      label: "Total Count",
      aggregate: "sum",
      field: "count",
      type: "integer",
      indicator: "green"
    }, rows)).toEqual({
      name: "total_count",
      label: "Total Count",
      aggregate: "sum",
      field: "count",
      type: "integer",
      indicator: "green",
      value: 10
    });
  });

  it("defaults count report summary types to integer", () => {
    expect(reportSummaryValue({
      name: "row_count",
      aggregate: "count"
    }, rows)).toEqual({
      name: "row_count",
      label: "row_count",
      aggregate: "count",
      type: "integer",
      value: 4
    });
  });

  it("counts present field values only when a count summary has a field", () => {
    expect(reportAggregateValue({ name: "present_count", aggregate: "count", field: "count" }, rows)).toBe(2);
  });

  it("builds report summary lists by delegating each summary definition", () => {
    expect(buildReportSummary(rows, [
      { name: "row_count", aggregate: "count" },
      { name: "total_count", label: "Total Count", aggregate: "sum", field: "count" }
    ])).toEqual([
      { name: "row_count", label: "row_count", aggregate: "count", type: "integer", value: 4 },
      { name: "total_count", label: "Total Count", aggregate: "sum", field: "count", value: 10 }
    ]);
  });

  it("computes numeric sum and average summaries while ignoring non-numeric values", () => {
    expect(reportAggregateValue({ name: "total", aggregate: "sum", field: "count" }, rows)).toBe(10);
    expect(reportAggregateValue({ name: "average", aggregate: "avg", field: "count" }, rows)).toBe(5);
    expect(reportAggregateValue({ name: "empty_average", aggregate: "avg", field: "missing" }, rows)).toBeNull();
  });

  it("computes min and max summaries using report primitive ordering", () => {
    expect(reportAggregateValue({ name: "minimum", aggregate: "min", field: "title" }, rows)).toBe("Empty");
    expect(reportAggregateValue({ name: "maximum", aggregate: "max", field: "title" }, rows)).toBe("Missing");
    expect(reportAggregateValue({ name: "empty_min", aggregate: "min", field: "missing" }, rows)).toBeNull();
  });

  it("requires fields for non-count report summaries", () => {
    expect(() => reportAggregateValue({ name: "total", aggregate: "sum" }, rows))
      .toThrow("Report summary 'total' requires a field for sum");
  });

  it("normalizes report run and CSV export limits at the policy boundary", () => {
    expect(clampReportRunLimit(undefined)).toBe(50);
    expect(clampReportRunLimit(500)).toBe(200);
    expect(clampReportCsvExportLimit(undefined)).toBe(10_000);
    expect(clampReportCsvExportLimit(20_000)).toBe(10_000);
    expect(() => clampReportRunLimit(0)).toThrow("limit must be a positive integer");
    expect(() => clampReportCsvExportLimit(0)).toThrow("CSV export limit must be a positive integer");
  });

  it("renders report CSV headers and rows with labels, missing cells, and escaped content", () => {
    const columns = [
      { name: "title", label: "Title" },
      { name: "notes", label: "Notes" },
      { name: "missing" }
    ];

    expect(reportCsvHeader(columns)).toBe("Title,Notes,missing");
    expect(reportRowToCsv(columns, {
      title: "Needs, quotes",
      notes: "Line\nbreak"
    })).toBe("\"Needs, quotes\",\"Line\nbreak\",");
  });

  it("reads primitive report row values only", () => {
    expect(primitiveReportRowValue(rows[0]!, "title")).toBe("High");
    expect(primitiveReportRowValue(rows[0]!, "count")).toBe(7);
    expect(primitiveReportRowValue(rows[0]!, "active")).toBe(true);
    expect(primitiveReportRowValue(rows[2]!, "priority")).toBeNull();
    expect(primitiveReportRowValue({ meta: { nested: true } }, "meta")).toBeUndefined();
    expect(primitiveReportRowValue({}, "missing")).toBeUndefined();
  });

  it("projects document report rows with aliases, defaults, and nested formula columns", () => {
    const document = {
      tenantId: "tenant-a",
      doctype: "Task",
      name: "TASK-1",
      version: 3,
      docstatus: "draft" as const,
      data: { title: "High", count: 7 },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z"
    };
    const columns = [
      { name: "title" },
      { name: "display_title", field: "title" },
      { name: "missing" },
      { name: "double_count", formula: { operator: "multiply" as const, left: "count", right: 2 } },
      {
        name: "nested_score",
        formula: {
          operator: "add" as const,
          left: { operator: "multiply" as const, left: "count", right: 2 },
          right: 1
        }
      },
      { name: "count_ratio", formula: { operator: "divide" as const, left: "count", right: 2 } },
      { name: "divide_by_zero", formula: { operator: "divide" as const, left: "count", right: 0 } },
      { name: "text_math", formula: { operator: "add" as const, left: "title", right: 1 } }
    ];

    expect(projectReportDocumentRow(document, columns)).toEqual({
      title: "High",
      display_title: "High",
      missing: null,
      double_count: 14,
      nested_score: 15,
      count_ratio: 3.5,
      divide_by_zero: null,
      text_math: null
    });
    expect(reportDocumentColumnValue(document, { name: "display_title", field: "title" })).toBe("High");
    expect(reportSortValue(document, columns, "nested_score")).toBe(15);
    expect(reportSortValue(document, columns, "unknown")).toBeUndefined();
  });

  it("projects custom report rows with aliases, defaults, and formula columns", () => {
    const row = { title: "Custom", count: 4 };
    const columns = [
      { name: "title" },
      { name: "display_title", field: "title" },
      { name: "missing" },
      { name: "remaining", formula: { operator: "subtract" as const, left: "count", right: 1 } },
      { name: "scaled", formula: { operator: "multiply" as const, left: { operator: "add" as const, left: "count", right: 2 }, right: 3 } },
      { name: "text_math", formula: { operator: "add" as const, left: "title", right: 1 } }
    ];

    expect(projectReportRow(row, columns)).toEqual({
      title: "Custom",
      display_title: "Custom",
      missing: null,
      remaining: 3,
      scaled: 18,
      text_math: null
    });
    expect(reportRowColumnValue(row, { name: "remaining", formula: { operator: "subtract", left: "count", right: 1 } })).toBe(3);
  });

  it("sorts report documents by field and formula columns with stable ties", () => {
    const documents = [
      reportDocument("TASK-1", { title: "Alpha", count: 3, bonus: 1 }),
      reportDocument("TASK-2", { title: "Beta", count: 4, bonus: 2 }),
      reportDocument("TASK-3", { title: "Gamma", count: 4, bonus: 2 }),
      reportDocument("TASK-4", { title: "Delta", count: 2, bonus: 4 })
    ];
    const report = {
      name: "Task Report",
      doctype: "Task",
      columns: [
        { name: "title" },
        { name: "count" },
        { name: "score", formula: { operator: "add" as const, left: "count", right: "bonus" } }
      ]
    };

    expect(sortReportDocuments(documents, report, { orderBy: "score", order: "desc", options: [] })
      .map((document) => document.name)).toEqual(["TASK-2", "TASK-3", "TASK-4", "TASK-1"]);
    expect(sortReportDocuments(documents, report, { orderBy: "title", order: "asc", options: [] })
      .map((document) => document.name)).toEqual(["TASK-1", "TASK-2", "TASK-4", "TASK-3"]);
  });

  it("sorts custom report rows by projected values while preserving input order for ties", () => {
    const report = {
      name: "External Report",
      doctype: "External Row",
      source: { kind: "custom" as const, provider: "external" },
      columns: [
        { name: "title" },
        { name: "score" }
      ]
    };
    const projected = [
      { title: "First", score: 2 },
      { title: "Second", score: 4 },
      { title: "Third", score: 4 },
      { title: "Fourth", score: 1 }
    ];

    expect(sortReportRows(projected, report, { orderBy: "score", order: "desc", options: [] })
      .map((row) => row.title)).toEqual(["Second", "Third", "First", "Fourth"]);
    expect(sortReportRows(projected, report, { order: "asc", options: [] })).toBe(projected);
  });

  it("keeps the lowest bounded ordered document report rows for ascending exports", () => {
    const report = {
      name: "Task Report",
      doctype: "Task",
      columns: [
        { name: "title" },
        { name: "score" }
      ]
    };
    const rows = new BoundedOrderedReportRows(report, { orderBy: "score", order: "asc", options: [] }, 3);
    [
      reportDocument("TASK-1", { title: "Middle", score: 3 }),
      reportDocument("TASK-2", { title: "High", score: 7 }),
      reportDocument("TASK-3", { title: "Low", score: 1 }),
      reportDocument("TASK-4", { title: "Also Middle", score: 3 }),
      reportDocument("TASK-5", { title: "Lowest", score: 0 })
    ].forEach((document, index) => rows.add(document, index));

    expect(rows.toRows()).toEqual([
      { title: "Lowest", score: 0 },
      { title: "Low", score: 1 },
      { title: "Middle", score: 3 }
    ]);
  });

  it("keeps the highest bounded ordered document report rows for descending exports", () => {
    const report = {
      name: "Task Report",
      doctype: "Task",
      columns: [
        { name: "title" },
        { name: "score" }
      ]
    };
    const rows = new BoundedOrderedReportRows(report, { orderBy: "score", order: "desc", options: [] }, 3);
    [
      reportDocument("TASK-1", { title: "Middle", score: 3 }),
      reportDocument("TASK-2", { title: "High", score: 7 }),
      reportDocument("TASK-3", { title: "Also High", score: 7 }),
      reportDocument("TASK-4", { title: "Low", score: 1 }),
      reportDocument("TASK-5", { title: "Higher", score: 8 })
    ].forEach((document, index) => rows.add(document, index));

    expect(rows.toRows()).toEqual([
      { title: "Higher", score: 8 },
      { title: "High", score: 7 },
      { title: "Also High", score: 7 }
    ]);
  });

  it("builds report filter controls from metadata, field definitions, and materialized values", () => {
    const doctype = {
      name: "Task",
      fields: [
        { name: "priority", type: "select" as const, options: ["Low", "High"] },
        { name: "count", type: "integer" as const },
        { name: "archived", type: "boolean" as const }
      ]
    };
    const report = {
      name: "Task Report",
      doctype: "Task",
      columns: [{ name: "priority" }],
      filters: [
        { name: "priority", label: "Priority", field: "priority", required: true },
        { name: "minimum", field: "count", operator: "gte" as const, type: "number" as const },
        { name: "archived", field: "archived", options: ["true", "false"] }
      ]
    };

    expect(buildReportFilterControls(report, doctype, {
      priority: "High",
      minimum: 2
    })).toEqual([
      {
        name: "priority",
        label: "Priority",
        field: "priority",
        type: "select",
        operator: "eq",
        required: true,
        value: "High",
        options: ["Low", "High"]
      },
      {
        name: "minimum",
        label: "minimum",
        field: "count",
        type: "number",
        operator: "gte",
        required: false,
        value: 2,
        options: []
      },
      {
        name: "archived",
        label: "archived",
        field: "archived",
        type: "boolean",
        operator: "eq",
        required: false,
        options: ["true", "false"]
      }
    ]);
    expect(resolvedReportFilterType({ name: "minimum", field: "count", type: "number" }, doctype.fields[1])).toBe("number");
  });

  it("resolves document report ordering from sortable metadata columns", () => {
    const doctype = {
      name: "Task",
      fields: [
        { name: "title", type: "text" as const },
        { name: "metadata", type: "json" as const },
        { name: "children", type: "table" as const }
      ]
    };
    const report = {
      name: "Task Report",
      doctype: "Task",
      columns: [
        { name: "title", label: "Title" },
        { name: "metadata" },
        { name: "children" },
        { name: "score", label: "Score", formula: { operator: "add" as const, left: 1, right: 2 } }
      ],
      orderBy: "score",
      order: "desc" as const
    };

    expect(buildReportOrderOptions(report, doctype)).toEqual([
      { name: "title", label: "Title" },
      { name: "score", label: "Score" }
    ]);
    expect(resolveReportOrder(report, doctype, {})).toEqual({
      orderBy: "score",
      order: "desc",
      options: [
        { name: "title", label: "Title" },
        { name: "score", label: "Score" }
      ]
    });
    expect(resolveReportOrder(report, doctype, { orderBy: "title", order: "asc" })).toMatchObject({
      orderBy: "title",
      order: "asc"
    });
    expect(() => resolveReportOrder(report, doctype, { orderBy: "metadata" }))
      .toThrow("Report orderBy 'metadata' is not a sortable report column");
  });

  it("resolves custom report ordering from projected column types only", () => {
    const doctype = { name: "External Row", fields: [] };
    const report = {
      name: "External Report",
      doctype: "External Row",
      source: { kind: "custom" as const, provider: "external" },
      columns: [
        { name: "title", label: "Title" },
        { name: "payload", type: "json" as const },
        { name: "children", type: "table" as const },
        { name: "score", label: "Score", type: "number" as const }
      ]
    };

    expect(buildReportOrderOptions(report, doctype)).toEqual([
      { name: "title", label: "Title" },
      { name: "score", label: "Score" }
    ]);
    expect(resolveReportOrder(report, doctype, { orderBy: "score" })).toMatchObject({
      orderBy: "score",
      order: "asc"
    });
    expect(() => resolveReportOrder(report, doctype, { order: "sideways" as "asc" }))
      .toThrow("Report order must be asc or desc");
  });

  it("coerces scalar report filter values by field type", () => {
    expect(coerceReportFilterValue("42", "integer", "minimum", "eq")).toBe(42);
    expect(coerceReportFilterValue("4.5", "number", "score", "eq")).toBe(4.5);
    expect(coerceReportFilterValue("on", "boolean", "enabled", "eq")).toBe(true);
    expect(coerceReportFilterValue(false, "boolean", "enabled", "eq")).toBe(false);
    expect(coerceReportFilterValue(123, "text", "title", "eq")).toBe("123");
    expect(() => coerceReportFilterValue("4.5", "integer", "minimum", "eq"))
      .toThrow("Report filter 'minimum' must be an integer");
    expect(() => coerceReportFilterValue("maybe", "boolean", "enabled", "eq"))
      .toThrow("Report filter 'enabled' must be a boolean");
    expect(() => coerceReportFilterValue([1, 2], "integer", "minimum", "eq"))
      .toThrow("Report filter 'minimum' must be scalar");
  });

  it("coerces between and not-between report filter endpoints", () => {
    expect(coerceReportFilterValue(["2", "8"], "integer", "count_range", "between")).toEqual([2, 8]);
    expect(coerceReportFilterValue(["2026-01-01", "2026-01-31"], "date", "created", "not_between"))
      .toEqual(["2026-01-01", "2026-01-31"]);
  });

  it("rejects malformed report range filters before matching", () => {
    expect(() => coerceReportFilterValue(["2"], "integer", "count_range", "between"))
      .toThrow("Report filter 'count_range' must include exactly two values for between");
    expect(() => coerceReportFilterValue([null, "8"], "integer", "count_range", "between"))
      .toThrow("Report filter 'count_range' range values cannot be null");
    expect(() => coerceReportFilterValue(["", "8"], "integer", "count_range", "between"))
      .toThrow("Report filter 'count_range' range values cannot be empty");
    expect(() => coerceReportFilterValue([true, false], "integer", "count_range", "between"))
      .toThrow("Report filter 'count_range' range values cannot be boolean");
    expect(() => coerceReportFilterValue([1, 2], "date", "created", "between"))
      .toThrow("Report filter 'created' range values must be strings");
  });

  it("recognizes empty report filter values without coercing them", () => {
    expect(coerceReportFilterValue(undefined, "integer", "minimum", "eq")).toBeUndefined();
    expect(coerceReportFilterValue(null, "integer", "minimum", "eq")).toBeNull();
    expect(coerceReportFilterValue("", "integer", "minimum", "eq")).toBe("");
    expect(isEmptyReportFilterValue(undefined)).toBe(true);
    expect(isEmptyReportFilterValue(null)).toBe(true);
    expect(isEmptyReportFilterValue("")).toBe(true);
    expect(isEmptyReportFilterValue(0)).toBe(false);
  });

  it("combines report filter expressions through an outer all group", () => {
    expect(combineReportFilterExpression(
      { kind: "group", match: "all", filters: [{ filter: "priority", value: "High" }] },
      { filter: "minimum", value: 3 }
    )).toEqual({
      kind: "group",
      match: "all",
      filters: [
        { filter: "priority", value: "High" },
        { filter: "minimum", value: 3 }
      ]
    });
    expect(combineReportFilterExpression(undefined, { filter: "priority", value: "Low" }))
      .toEqual({ filter: "priority", value: "Low" });
  });

  it("materializes report filters and expressions with type coercion and required-filter checks", () => {
    const doctype = {
      name: "Task",
      fields: [
        { name: "priority", type: "select" as const },
        { name: "count", type: "integer" as const },
        { name: "title", type: "text" as const }
      ]
    };
    const report = {
      name: "Task Report",
      doctype: "Task",
      columns: [{ name: "title" }],
      filters: [
        { name: "priority", field: "priority", required: true },
        { name: "minimum", field: "count", operator: "gte" as const },
        { name: "title", field: "title", operator: "contains" as const }
      ]
    };
    const expression = materializeReportFilterExpression(report, doctype, {
      kind: "group",
      match: "any",
      filters: [
        { filter: "priority", value: "High" },
        { filter: "minimum", value: "3" }
      ]
    });

    expect(expression).toEqual({
      kind: "group",
      match: "any",
      filters: [
        { filter: "priority", value: "High" },
        { filter: "minimum", value: 3 }
      ]
    });
    expect(materializeReportFilters(report, doctype, { title: "Urgent" }, expression)).toEqual({
      priority: undefined,
      minimum: undefined,
      title: "Urgent"
    });
    expect(() => materializeReportFilters(report, doctype, {}, undefined))
      .toThrow("Report filter 'priority' is required");
    expect(() => materializeReportFilterExpression(report, doctype, { filter: "missing", value: "x" }))
      .toThrow("Report filter expression references unknown filter 'missing'");
    expect(() => materializeReportFilterExpression(report, doctype, { filter: "minimum", value: "" }))
      .toThrow("Report filter expression filter 'minimum' is missing a value");
  });

  it("matches report rows through flat filters and compound expressions", () => {
    const report = {
      name: "Task Report",
      doctype: "Task",
      columns: [{ name: "title" }],
      filters: [
        { name: "priority", field: "priority" },
        { name: "title", field: "title", operator: "contains" as const },
        { name: "minimum", field: "count", operator: "gte" as const },
        { name: "count_range", field: "count", operator: "between" as const },
        { name: "outside_count", field: "count", operator: "not_between" as const }
      ]
    };
    const row = { title: "High Routine", priority: "High", count: 7 };

    expect(matchesReportRowFilters(row, report, { priority: "High", minimum: 5 }, undefined)).toBe(true);
    expect(matchesReportRowFilters(row, report, { title: "routine", count_range: [6, 8] }, undefined)).toBe(true);
    expect(matchesReportRowFilters(row, report, { outside_count: [2, 6] }, undefined)).toBe(true);
    expect(matchesReportRowFilters(row, report, { priority: "Low" }, undefined)).toBe(false);
    expect(matchesReportRowFilters(row, report, {}, {
      kind: "group",
      match: "all",
      filters: [
        { filter: "priority", value: "High" },
        {
          kind: "group",
          match: "any",
          filters: [
            { filter: "title", value: "Urgent" },
            { filter: "minimum", value: 7 }
          ]
        }
      ]
    })).toBe(true);
  });

  it("matches document report filters against document data", () => {
    const report = {
      name: "Task Report",
      doctype: "Task",
      columns: [{ name: "title" }],
      filters: [{ name: "priority", field: "priority" }]
    };
    const document = {
      tenantId: "tenant-a",
      doctype: "Task",
      name: "TASK-1",
      version: 1,
      docstatus: "draft" as const,
      data: { title: "High Routine", priority: "High" },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z"
    };

    expect(matchesReportFilters(document, report, { priority: "High" }, undefined)).toBe(true);
    expect(matchesReportFilters(document, report, { priority: "Low" }, undefined)).toBe(false);
  });

  it("builds chart drilldown queries from exact report filters", () => {
    expect(reportChartDrilldown({ name: "priority" }, "High")).toEqual({
      filter: "priority",
      value: "High",
      query: "filter_priority=High"
    });
    expect(reportChartDrilldown({ name: "count" }, 7)).toEqual({
      filter: "count",
      value: 7,
      query: "filter_count=7"
    });
  });

  it("omits chart drilldowns for empty group keys", () => {
    expect(reportChartDrilldown({ name: "priority" }, null)).toBeUndefined();
  });

  it("sorts chart points by value with nulls last", () => {
    expect(sortReportChartPoints([
      { key: "empty", label: "Empty", value: null },
      { key: "low", label: "Low", value: 1 },
      { key: "high", label: "High", value: 3 }
    ], "value", "desc").map((point) => point.key)).toEqual(["high", "low", "empty"]);
  });

  it("sorts chart points by label and key", () => {
    expect(sortReportChartPoints([
      { key: "b", label: "Beta", value: 1 },
      { key: "a", label: "Alpha", value: 2 }
    ], "label", "asc").map((point) => point.key)).toEqual(["a", "b"]);
    expect(sortReportChartPoints([
      { key: "b", label: "Beta", value: 1 },
      { key: "a", label: "Alpha", value: 2 }
    ], "key", "desc").map((point) => point.key)).toEqual(["b", "a"]);
  });

  it("uses label and key tie-breakers for chart point value ties", () => {
    expect(sortReportChartPoints([
      { key: "b", label: "Same", value: 2 },
      { key: "a", label: "Same", value: 2 },
      { key: "c", label: "After", value: 2 }
    ], "value", "asc").map((point) => point.key)).toEqual(["c", "a", "b"]);
  });

  it("builds report charts with default result metadata and numeric points", () => {
    const groups = buildReportGroups(rows, [{
      name: "by_priority",
      field: "priority",
      summaries: [{ name: "row_count", aggregate: "count" }]
    }]);

    expect(buildReportCharts(groups, [{
      name: "priority_chart",
      type: "bar",
      group: "by_priority",
      summary: "row_count"
    }])).toEqual([{
      name: "priority_chart",
      label: "priority_chart",
      type: "bar",
      group: "by_priority",
      summary: "row_count",
      orderBy: "key",
      order: "asc",
      colors: [],
      showValues: true,
      points: [
        { key: "High", label: "High", value: 1 },
        { key: "Low", label: "Low", value: 1 },
        { key: null, label: "(empty)", value: 2 }
      ]
    }]);
  });

  it("builds report charts with configured labels, colors, axes, value ordering, and point caps", () => {
    const groups = buildReportGroups(rows, [{
      name: "by_priority",
      field: "priority",
      summaries: [{ name: "total_count", aggregate: "sum", field: "count" }]
    }]);

    expect(buildReportCharts(groups, [{
      name: "priority_chart",
      label: "Priority Chart",
      type: "line",
      group: "by_priority",
      summary: "total_count",
      orderBy: "value",
      order: "desc",
      maxPoints: 2,
      colors: ["#2563eb"],
      showValues: false,
      xAxisLabel: "Priority",
      yAxisLabel: "Total Count"
    }])).toEqual([{
      name: "priority_chart",
      label: "Priority Chart",
      type: "line",
      group: "by_priority",
      summary: "total_count",
      orderBy: "value",
      order: "desc",
      colors: ["#2563eb"],
      showValues: false,
      xAxisLabel: "Priority",
      yAxisLabel: "Total Count",
      points: [
        { key: "High", label: "High", value: 7 },
        { key: "Low", label: "Low", value: 3 }
      ]
    }]);
  });

  it("adds chart drilldowns only for matching exact group filters", () => {
    const groups = buildReportGroups(rows, [{
      name: "by_priority",
      field: "priority",
      summaries: [{ name: "row_count", aggregate: "count" }]
    }]);

    expect(buildReportCharts(groups, [{
      name: "priority_chart",
      type: "pie",
      group: "by_priority",
      summary: "row_count"
    }], [
      { name: "priority_search", field: "priority", operator: "contains" },
      { name: "active", field: "active" },
      { name: "priority", field: "priority" }
    ])[0]?.points).toEqual([
      {
        key: "High",
        label: "High",
        value: 1,
        drilldown: { filter: "priority", value: "High", query: "filter_priority=High" }
      },
      {
        key: "Low",
        label: "Low",
        value: 1,
        drilldown: { filter: "priority", value: "Low", query: "filter_priority=Low" }
      },
      { key: null, label: "(empty)", value: 2 }
    ]);
  });

  it("builds empty chart points for missing groups and non-numeric summaries", () => {
    const groups = buildReportGroups(rows, [{
      name: "by_priority",
      field: "priority",
      summaries: [{ name: "first_title", aggregate: "min", field: "title" }]
    }]);

    expect(buildReportCharts(groups, [{
      name: "missing_group",
      type: "bar",
      group: "missing",
      summary: "first_title"
    }])[0]?.points).toEqual([]);
    expect(buildReportCharts(groups, [{
      name: "text_summary",
      type: "bar",
      group: "by_priority",
      summary: "first_title"
    }])[0]?.points.map((point) => point.value)).toEqual([null, null, null]);
  });

  it("builds report groups sorted by primitive group keys", () => {
    expect(buildReportGroups(rows, [{
      name: "by_priority",
      label: "By Priority",
      field: "priority",
      summaries: [{ name: "row_count", aggregate: "count" }]
    }])).toEqual([{
      name: "by_priority",
      label: "By Priority",
      field: "priority",
      rows: [
        {
          key: null,
          label: "(empty)",
          summaries: [{ name: "row_count", label: "row_count", aggregate: "count", type: "integer", value: 2 }]
        },
        {
          key: "High",
          label: "High",
          summaries: [{ name: "row_count", label: "row_count", aggregate: "count", type: "integer", value: 1 }]
        },
        {
          key: "Low",
          label: "Low",
          summaries: [{ name: "row_count", label: "row_count", aggregate: "count", type: "integer", value: 1 }]
        }
      ]
    }]);
  });

  it("builds report groups with default labels and grouped summary aggregates", () => {
    expect(buildReportGroups(rows, [{
      name: "by_active",
      field: "active",
      summaries: [{ name: "total_count", aggregate: "sum", field: "count" }]
    }])).toMatchObject([{
      name: "by_active",
      label: "by_active",
      field: "active",
      rows: [
        { key: null, label: "(empty)", summaries: [{ name: "total_count", value: 0 }] },
        { key: false, label: "false", summaries: [{ name: "total_count", value: 3 }] },
        { key: true, label: "true", summaries: [{ name: "total_count", value: 7 }] }
      ]
    }]);
  });

  it("limits report groups by matching group definition names", () => {
    const groups = buildReportGroups(rows, [{
      name: "by_priority",
      field: "priority",
      maxRows: 2,
      summaries: [{ name: "row_count", aggregate: "count" }]
    }]);

    expect(limitReportGroups(groups, [{
      name: "by_priority",
      field: "priority",
      maxRows: 2,
      summaries: [{ name: "row_count", aggregate: "count" }]
    }])[0]?.rows.map((row) => row.key)).toEqual([null, "High"]);
  });
});

function reportDocument(name: string, data: Record<string, JsonValue>) {
  return {
    tenantId: "tenant-a",
    doctype: "Task",
    name,
    version: 1,
    docstatus: "draft" as const,
    data,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z"
  };
}
