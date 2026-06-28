import { renderReportView } from "../../src";
import { openNotesReport } from "../helpers";
import type { ReportRunResult } from "../../src";

describe("Desk report rendering", () => {
  it("renders metadata-aware report filter controls with current values", () => {
    const html = renderReportView({
      ...reportResult([]),
      filters: [
        {
          name: "priority",
          label: "Priority",
          field: "priority",
          type: "select",
          operator: "eq",
          required: true,
          value: "High",
          options: ["Low", "Medium", "High"]
        },
        {
          name: "minimum",
          label: "Minimum Count",
          field: "count",
          type: "integer",
          operator: "gte",
          required: false,
          value: 2,
          options: []
        },
        {
          name: "mine",
          label: "Mine",
          field: "created_by",
          type: "boolean",
          operator: "eq",
          required: false,
          value: true,
          options: []
        }
      ]
    });

    expect(html).toContain('<select id="filter-priority" name="filter_priority" required>');
    expect(html).toContain('<option value="High" selected>High</option>');
    expect(html).toContain('name="filter_minimum" type="number" value="2"');
    expect(html).toContain('<option value="true" selected>True</option>');
  });

  it("renders report ordering controls with current values", () => {
    const html = renderReportView({
      ...reportResult([]),
      order: {
        orderBy: "priority",
        order: "desc",
        options: [
          { name: "title", label: "Title" },
          { name: "priority", label: "Priority" }
        ]
      }
    });

    expect(html).toContain('<select id="report-order-by" name="order_by">');
    expect(html).toContain('<option value="priority" selected>Priority</option>');
    expect(html).toContain('<select id="report-order" name="order">');
    expect(html).toContain('<option value="desc" selected>Descending</option>');
  });

  it("renders pie chart legend entries only for positive slices", () => {
    const html = renderReportView(reportResult([
      {
        name: "priority_mix",
        label: "Priority Mix",
        type: "pie",
        group: "by_priority",
        summary: "note_count",
        orderBy: "key",
        order: "asc",
        colors: [],
        showValues: true,
        points: [
          { key: "High", label: "High", value: 3 },
          { key: "Low", label: "Low", value: 0 },
          { key: "Negative", label: "Negative", value: -2 }
        ]
      }
    ]));

    expect(html).toContain("Priority Mix");
    expect(html).toContain("High (3)");
    expect(html).not.toContain("Low (0)");
    expect(html).not.toContain("Negative (-2)");
  });

  it("renders chart colors and hides configured value labels", () => {
    const html = renderReportView(reportResult([
      {
        name: "priority_bar",
        label: "Priority Bar",
        type: "bar",
        group: "by_priority",
        summary: "note_count",
        orderBy: "value",
        order: "desc",
        colors: ["#123456", "#abcdef"],
        showValues: false,
        xAxisLabel: "Priority",
        yAxisLabel: "Notes",
        points: [
          { key: "High", label: "High", value: 5 },
          { key: "Low", label: "Low", value: 2 }
        ]
      },
      {
        name: "priority_line",
        label: "Priority Line",
        type: "line",
        group: "by_priority",
        summary: "note_count",
        orderBy: "label",
        order: "asc",
        colors: ["#654321"],
        showValues: false,
        points: [
          { key: "At Risk", label: "At Risk", value: 7 },
          { key: "On Track", label: "On Track", value: 4 }
        ]
      },
      {
        name: "priority_mix",
        label: "Priority Mix",
        type: "pie",
        group: "by_priority",
        summary: "note_count",
        orderBy: "key",
        order: "asc",
        colors: ["#123456", "#abcdef"],
        showValues: false,
        points: [
          { key: "High", label: "High", value: 3 },
          { key: "Medium", label: "Medium", value: 2 }
        ]
      }
    ]));

    expect(html).toContain('style="fill: #123456"');
    expect(html).toContain('style="stroke: #654321"');
    expect(html).toContain('style="background: #abcdef"');
    expect(html).toContain('aria-label="Priority Bar, Priority, Notes"');
    expect(html).toContain('class="chart-axis-label chart-axis-x"');
    expect(html).toContain(">Priority</text>");
    expect(html).toContain(">Notes</text>");
    expect(html).not.toContain(">5</text>");
    expect(html).not.toContain(">7</text>");
    expect(html).not.toContain("High (3)");
    expect(html).not.toContain("Medium (2)");
  });

  it("renders report charts with the default palette when no colors are configured", () => {
    const html = renderReportView(reportResult([
      {
        name: "priority_bar",
        label: "Priority Bar",
        type: "bar",
        group: "by_priority",
        summary: "note_count",
        orderBy: "key",
        order: "asc",
        colors: [],
        showValues: true,
        points: [
          { key: "High", label: "High", value: 5 },
          { key: "Low", label: "Low", value: 2 }
        ]
      }
    ]));

    expect(html).toContain('style="fill: #1f6feb"');
    expect(html).toContain('style="fill: #2e7d32"');
  });

  it("renders chart drilldown links by merging point queries into the current report route", () => {
    const html = renderReportView(
      reportResult([
        {
          name: "priority_bar",
          label: "Priority Bar",
          type: "bar",
          group: "by_priority",
          summary: "note_count",
          orderBy: "key",
          order: "asc",
          colors: [],
          showValues: true,
          points: [
            {
              key: "High & <urgent>",
              label: "<High>",
              value: 5,
              drilldown: {
                filter: "priority",
                value: "High & <urgent>",
                query: "filter_priority=High+%26+%3Curgent%3E"
              }
            }
          ]
        },
        {
          name: "priority_mix",
          label: "Priority Mix",
          type: "pie",
          group: "by_priority",
          summary: "note_count",
          orderBy: "key",
          order: "asc",
          colors: [],
          showValues: true,
          points: [
            {
              key: "High & urgent",
              label: "High & urgent",
              value: 3,
              drilldown: {
                filter: "priority",
                value: "High & urgent",
                query: "filter_priority=High+%26+urgent"
              }
            }
          ]
        }
      ]),
      {
        drilldownBaseHref: "/desk/reports/Open%20Notes?filter_priority=Low&order_by=title&order=desc"
      }
    );

    expect(html).toContain(
      '<a class="chart-drilldown" href="/desk/reports/Open%20Notes?filter_priority=High+%26+%3Curgent%3E&amp;order_by=title&amp;order=desc"><g>'
    );
    expect(html).toContain("&lt;High&gt;");
    expect(html).toContain(
      '<li><a class="chart-drilldown" href="/desk/reports/Open%20Notes?filter_priority=High+%26+urgent&amp;order_by=title&amp;order=desc">'
    );
    expect(html).toContain("High &amp; urgent (3)");
  });
});

function reportResult(charts: ReportRunResult["charts"]): ReportRunResult {
  return {
    report: openNotesReport,
    columns: openNotesReport.columns,
    filters: [],
    order: {
      order: "asc",
      options: openNotesReport.columns.map((column) => ({
        name: column.name,
        label: column.label ?? column.name
      }))
    },
    summary: [],
    groups: [],
    charts,
    rows: [],
    limit: 50,
    offset: 0,
    total: 0
  };
}
