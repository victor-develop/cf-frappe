import { type DashboardRunResult } from "../../src/application/dashboard-service.js";
import { type ReportChartResult } from "../../src/application/report-service.js";
import { renderDashboardList, renderDashboardView } from "../../src/adapters/desk/views/dashboards.js";

type DashboardCard = DashboardRunResult["cards"][number];

const chart: ReportChartResult = {
  name: "by_status",
  label: "By Status",
  type: "bar",
  group: "status",
  summary: "count",
  orderBy: "value",
  order: "desc",
  colors: [],
  showValues: false,
  points: [{ key: "Open", label: "Open", value: 2 }]
};

function dashboard(cards: readonly DashboardCard[], description?: string): DashboardRunResult {
  return {
    dashboard: {
      name: "ops",
      cards: cards.map((card) => ({ name: card.name, source: card.source })),
      ...(description === undefined ? {} : { description })
    },
    cards
  };
}

describe("Desk dashboard views", () => {
  it("renders an empty dashboard list state", () => {
    expect(renderDashboardList([])).toContain("No readable dashboards.");
  });

  it("renders dashboard list rows with and without optional fields", () => {
    const html = renderDashboardList([
      { name: "ops", cards: [] },
      { name: "sales", label: "Sales KPIs", module: "CRM", description: "Pipeline health", cards: [] }
    ]);
    expect(html).toContain(">ops</a>");
    expect(html).toContain(">Sales KPIs</a>");
    expect(html).toContain("Pipeline health");
  });

  it("renders an empty dashboard view without description", () => {
    const html = renderDashboardView(dashboard([]));
    expect(html).toContain("No dashboard cards.");
    expect(html).not.toContain('class="muted"');
  });

  it("renders metric cards for count, aggregate, and report summary sources", () => {
    const cards: DashboardCard[] = [
      {
        name: "open_tasks",
        label: "Open Tasks",
        value: 12,
        source: { kind: "documentCount", doctype: "Task" }
      },
      {
        name: "filtered_tasks",
        label: "Filtered Tasks",
        value: 4,
        indicator: "red",
        description: "Overdue",
        source: {
          kind: "documentCount",
          doctype: "Task",
          filters: [
            { field: "status", value: "Open" },
            { field: "status", operator: "ne", value: ["Done", "", null] }
          ],
          filterExpression: { kind: "group", match: "all", filters: [{ field: "status", operator: "eq", value: "Open" }] }
        }
      },
      {
        name: "task_count_agg",
        label: "Task Count",
        value: 7,
        source: { kind: "documentAggregate", doctype: "Task", aggregate: "count" }
      },
      {
        name: "hours_sum",
        label: "Hours",
        value: 33.5,
        source: { kind: "documentAggregate", doctype: "Task", aggregate: "sum" }
      },
      {
        name: "summary_plain",
        label: "Summary",
        value: "ok",
        source: { kind: "reportSummary", report: "Task Report", summary: "total" }
      },
      {
        name: "summary_filtered",
        label: "Summary Filtered",
        value: 9,
        source: {
          kind: "reportSummary",
          report: "Task Report",
          summary: "total",
          filters: { status: "Open", skipped: undefined }
        }
      }
    ];
    const html = renderDashboardView(dashboard(cards, "Operations overview"));
    expect(html).toContain("Operations overview");
    expect(html).toContain("Task count");
    expect(html).toContain("Task sum()");
    expect(html).toContain("<em>red</em>");
    expect(html).toContain("Overdue");
    expect(html).toContain('href="/desk/Task?default_filters=0"');
    expect(html).toContain("empty_filter");
    expect(html).toContain("filter_expression");
    expect(html).toContain("filter_status__ne");
    expect(html).toContain('href="/desk/reports/Task%20Report"');
    expect(html).toContain("/desk/reports/Task%20Report?filter_status=Open");
  });

  it("renders report chart cards with chart data, empty data, and filters", () => {
    const cards: DashboardCard[] = [
      {
        name: "chart_card",
        label: "Status Chart",
        description: "Chart notes",
        value: chart,
        source: { kind: "reportChart", report: "Task Report", chart: "by_status", filters: { status: "Open" } }
      },
      {
        name: "chart_missing",
        label: "Broken Chart",
        value: null,
        source: { kind: "reportChart", report: "Task Report", chart: "by_status" }
      }
    ];
    const html = renderDashboardView(dashboard(cards));
    expect(html).toContain("Chart notes");
    expect(html).toContain("report-chart-body");
    expect(html).toContain("No chart data.");
    expect(html).toContain("Task Report / by_status");
  });

  it("falls back to an unlinked card for unknown sources and hides chart values in metrics", () => {
    const unknownSource = { kind: "custom", report: "R", summary: "S" } as unknown as DashboardCard["source"];
    const cards: DashboardCard[] = [
      { name: "odd", label: "Odd", value: 1, source: unknownSource },
      {
        name: "chart_as_metric",
        label: "Chart Metric",
        value: chart,
        source: { kind: "documentCount", doctype: "Task" }
      }
    ];
    const html = renderDashboardView(dashboard(cards));
    expect(html).toContain("R / S");
    expect(html).toContain("<span>Odd</span><strong>1</strong>");
    expect(html).not.toContain('href="R');
  });
});
