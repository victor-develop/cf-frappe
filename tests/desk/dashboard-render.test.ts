import { renderDashboardView, type DashboardRunResult } from "../../src";

describe("Desk dashboard rendering", () => {
  it("links metric cards to their filtered document lists and reports", () => {
    const filterExpression = {
      kind: "group",
      match: "any",
      filters: [
        { field: "title", operator: "contains", value: "Visible" },
        { field: "title", operator: "contains", value: "Escalation" }
      ]
    } as const;
    const html = renderDashboardView({
      dashboard: {
        name: "Operations",
        cards: [
          {
            name: "open_notes",
            label: "Open Notes",
            source: {
              kind: "documentCount",
              doctype: "Note",
              filters: [
                { field: "workflow_state", value: "Open" },
                { field: "title", operator: "ne", value: "" },
                { field: "priority", operator: "in", value: ["High", "Medium"] }
              ],
              filterExpression
            }
          },
          {
            name: "high_total",
            label: "High Count",
            source: {
              kind: "reportSummary",
              report: "Open Notes",
              summary: "total_count",
              filters: { priority: "" }
            }
          }
        ]
      },
      cards: [
        {
          name: "open_notes",
          label: "Open Notes",
          value: 2,
          source: {
            kind: "documentCount",
            doctype: "Note",
            filters: [
              { field: "workflow_state", value: "Open" },
              { field: "title", operator: "ne", value: "" },
              { field: "priority", operator: "in", value: ["High", "Medium"] }
            ],
            filterExpression
          }
        },
        {
          name: "high_total",
          label: "High Count",
          value: 12,
          source: {
            kind: "reportSummary",
            report: "Open Notes",
            summary: "total_count",
            filters: { priority: "" }
          }
        }
      ]
    } satisfies DashboardRunResult);

    expect(html).toContain(
      `<a class="dashboard-card-link" href="/desk/Note?default_filters=0&amp;filter_workflow_state=Open&amp;filter_title__ne=&amp;empty_filter=filter_title__ne&amp;filter_priority__in=High&amp;filter_priority__in=Medium&amp;filter_expression=${encodeURIComponent(JSON.stringify(filterExpression))}">`
    );
    expect(html).toContain('<a class="dashboard-card-link" href="/desk/reports/Open%20Notes?filter_priority=">');
  });
});
