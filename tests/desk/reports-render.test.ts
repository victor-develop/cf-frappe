import { defineDocType } from "../../src/core/schema.js";
import { type ReportRunResult } from "../../src/application/report-service.js";
import { type SavedReport } from "../../src/application/saved-report-events.js";
import {
  renderReportList,
  renderReportView,
  renderSavedReportBuilder,
  renderSavedReportView
} from "../../src/adapters/desk/views/reports.js";

function runResult(overrides: Partial<ReportRunResult> = {}): ReportRunResult {
  return {
    report: { name: "task-report", doctype: "Task", columns: [{ name: "title" }] },
    columns: [{ name: "title" }],
    filters: [],
    order: { order: "asc", options: [] },
    summary: [],
    groups: [],
    charts: [],
    rows: [],
    limit: 20,
    offset: 0,
    total: 0,
    ...overrides
  };
}

function savedReport(definition: SavedReport["definition"]): SavedReport {
  return {
    tenantId: "tenant-a",
    doctype: "Task",
    id: "sr-1",
    label: "My Tasks",
    ownerId: "user-1",
    definition,
    createdAt: "2026-08-01T00:00:00Z",
    updatedAt: "2026-08-02T00:00:00Z"
  };
}

describe("Desk report views", () => {
  it("renders an empty report list without a builder panel", () => {
    const html = renderReportList([]);
    expect(html).toContain("No readable reports.");
    expect(html).not.toContain("Build Report");
  });

  it("renders report rows plus an empty builder doctype panel", () => {
    const html = renderReportList(
      [
        { name: "plain", doctype: "Task", columns: [{ name: "title" }] },
        { name: "rich", label: "Rich Report", module: "Ops", description: "All tasks", doctype: "Task", columns: [{ name: "title" }] }
      ],
      { builderDoctypes: [] }
    );
    expect(html).toContain(">plain</a>");
    expect(html).toContain(">Rich Report</a>");
    expect(html).toContain("All tasks");
    expect(html).toContain("No readable DocTypes.");
  });

  it("renders builder doctype rows", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "title", type: "text" },
        { name: "internal", type: "text", hidden: true }
      ]
    });
    const html = renderReportList([], { builderDoctypes: [Task] });
    expect(html).toContain('href="/desk/report-builder/Task"');
    expect(html).toContain('<td data-label="Fields">1</td>');
  });

  it("renders the saved report builder covering every filter field type", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "title", type: "text", label: "Title" },
        { name: "notes", type: "longText" },
        { name: "assignee", type: "link", linkTo: "User" },
        { name: "points", type: "integer" },
        { name: "cost", type: "number" },
        { name: "due", type: "date" },
        { name: "started_at", type: "datetime" },
        { name: "status", type: "select", options: ["Open", "Done"] },
        { name: "urgent", type: "boolean" },
        { name: "meta", type: "json" }
      ],
      listView: { columns: ["title", "status"] }
    });
    const html = renderSavedReportBuilder(Task, [], { error: "Label required" });
    expect(html).toContain("Label required");
    expect(html).toContain("No saved reports.");
    expect(html).toContain('name="filterOperator:title"');
    expect(html).toContain('name="filterRangeMinDefault:points"');
    expect(html).toContain('name="filterRangeMaxDefault:due"');
    expect(html).toContain('name="filterDefault:status"');
    expect(html).toContain('name="filterDefault:urgent"');
    expect(html).toContain('name="filterDefault:assignee"');
    expect(html).toContain("data-filter-expression-kind=\"report\"");
    expect(html).toContain("&quot;inputType&quot;:&quot;boolean&quot;");
    expect(html).toContain('value="sum_points"');
    expect(html).toContain("Total cost");
  });

  it("omits the filter expression builder when no field is groupable", () => {
    const Blob = defineDocType({
      name: "Blob",
      fields: [{ name: "payload", type: "json" }]
    });
    const html = renderSavedReportBuilder(Blob, []);
    expect(html).not.toContain("Filter Expression");
    expect(html).not.toContain('class="notice error"');
  });

  it("renders saved report rows with export and delete actions", () => {
    const Task = defineDocType({ name: "Task", fields: [{ name: "title", type: "text" }] });
    const html = renderSavedReportBuilder(Task, [
      savedReport({ columns: [{ name: "title", label: "Title" }, { name: "status" }] })
    ]);
    expect(html).toContain(">My Tasks</a>");
    expect(html).toContain("Title, status");
    expect(html).toContain("/desk/report-builder/Task/sr-1/export.csv");
    expect(html).toContain("/desk/report-builder/Task/sr-1/delete");
  });

  it("renders a saved report view with minimal options and metadata fallbacks", () => {
    const html = renderSavedReportView(
      savedReport({
        columns: [{ name: "title" }],
        summaries: [{ name: "record_count", aggregate: "count" }],
        groups: [{ name: "by_status", field: "status", summaries: [] }],
        charts: [{ name: "chart_status", type: "bar", group: "by_status", summary: "record_count" }]
      }),
      runResult(),
      { listHref: "/desk/report-builder/Task", exportHref: "/export.csv", deleteAction: "/delete" }
    );
    expect(html).toContain("record_count");
    expect(html).toContain("by_status");
    expect(html).toContain("chart_status");
    expect(html).not.toContain(">Print</a>");
    expect(html).not.toContain(">PDF</a>");
  });

  it("renders a saved report view with print and pdf links and labeled metadata", () => {
    const html = renderSavedReportView(
      savedReport({
        columns: [{ name: "title", label: "Title" }],
        summaries: [{ name: "record_count", label: "Records", aggregate: "count" }],
        groups: [{ name: "by_status", label: "By Status", field: "status", summaries: [] }],
        charts: [{ name: "chart_status", label: "Status Chart", type: "bar", group: "by_status", summary: "record_count" }]
      }),
      runResult(),
      {
        listHref: "/desk/report-builder/Task",
        exportHref: "/export.csv",
        printHref: "/print",
        pdfHref: "/pdf",
        deleteAction: "/delete",
        drilldownBaseHref: "/desk/Task"
      }
    );
    expect(html).toContain('href="/print"');
    expect(html).toContain('href="/pdf"');
    expect(html).toContain("Records");
    expect(html).toContain("By Status");
    expect(html).toContain("Status Chart");
  });

  it("renders a bare report view with no controls, actions, or rows", () => {
    const html = renderReportView(runResult());
    expect(html).toContain("No rows matched.");
    expect(html).not.toContain("<form");
    expect(html).not.toContain('class="toolbar"');
  });

  it("renders an action-only toolbar when there are no filter controls", () => {
    const html = renderReportView(runResult(), { exportHref: "/export.csv", printHref: "/print", pdfHref: "/pdf" });
    expect(html).toContain('class="toolbar"');
    expect(html).toContain(">Export CSV</a>");
    expect(html).toContain(">Print</a>");
    expect(html).toContain(">PDF</a>");
  });

  it("renders every filter control shape", () => {
    const result = runResult({
      filters: [
        { name: "title", label: "Title", field: "title", type: "text", operator: "contains", required: true, value: "urgent", options: [] },
        { name: "notes", label: "Notes", field: "notes", type: "longText", operator: "contains", required: false, options: [] },
        { name: "status", label: "Status", field: "status", type: "select", operator: "eq", required: false, value: "Archived", options: ["Open", "Done"] },
        { name: "urgent", label: "Urgent", field: "urgent", type: "boolean", operator: "eq", required: false, value: true, options: [] },
        { name: "quiet", label: "Quiet", field: "quiet", type: "boolean", operator: "eq", required: false, value: false, options: [] },
        { name: "due", label: "Due", field: "due", type: "date", operator: "between", required: false, value: ["2026-01-01", "2026-02-01"], options: [] },
        { name: "cost", label: "Cost", field: "cost", type: "number", operator: "not_between", required: false, options: [] }
      ],
      order: { orderBy: "title", order: "desc", options: [{ name: "title", label: "Title" }, { name: "due", label: "Due" }] },
      rows: [{ title: "Ship it", status: "Open" }],
      columns: [{ name: "title", label: "Title" }, { name: "status" }]
    });
    const html = renderReportView(result, { exportHref: "/export.csv" });
    expect(html).toContain('name="filter_title" type="text" value="urgent" required');
    expect(html).toContain("<textarea id=\"filter-notes\" name=\"filter_notes\">");
    expect(html).toContain('<option value="Archived" selected>Archived</option>');
    expect(html).toContain('<option value="true" selected>True</option>');
    expect(html).toContain('<option value="false" selected>False</option>');
    expect(html).toContain('id="filter-due-min"');
    expect(html).toContain('value="2026-02-01"');
    expect(html).toContain('id="filter-cost-max"');
    expect(html).toContain('<option value="title" selected>Title</option>');
    expect(html).toContain('<option value="desc" selected>Descending</option>');
    expect(html).toContain('<td data-label="Title">Ship it</td>');
    expect(html).toContain('<td data-label="status">Open</td>');
  });

  it("hides order controls when no order options exist but filters do", () => {
    const html = renderReportView(
      runResult({
        filters: [{ name: "title", label: "Title", field: "title", type: "text", operator: "eq", required: false, options: [] }]
      })
    );
    expect(html).toContain('name="filter_title"');
    expect(html).not.toContain('name="order_by"');
  });

  it("renders summaries, charts, and groups including empty group rows", () => {
    const result = runResult({
      summary: [{ name: "record_count", label: "Records", aggregate: "count", value: 3 }],
      charts: [
        {
          name: "by_status",
          label: "By Status",
          type: "bar",
          group: "by_status",
          summary: "record_count",
          orderBy: "value",
          order: "desc",
          colors: [],
          showValues: true,
          points: [{ key: "Open", label: "Open", value: 2, drilldown: { filter: "status", value: "Open", query: "filter_status=Open" } }]
        }
      ],
      groups: [
        {
          name: "by_status",
          label: "By Status",
          field: "status",
          rows: [
            { key: "Open", label: "Open", summaries: [{ name: "record_count", label: "Records", aggregate: "count", value: 2 }] }
          ]
        },
        { name: "by_owner", label: "By Owner", field: "owner", rows: [] }
      ]
    });
    const html = renderReportView(result, { drilldownBaseHref: "/desk/Task" });
    expect(html).toContain("Report summary");
    expect(html).toContain("report-chart-body");
    expect(html).toContain('<td data-label="status">Open</td>');
    expect(html).toContain("No rows matched.");
  });
});
