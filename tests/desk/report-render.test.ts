import { renderReportView } from "../../src";
import { openNotesReport } from "../helpers";
import type { ReportRunResult } from "../../src";

describe("Desk report rendering", () => {
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
    expect(html).not.toContain(">5</text>");
    expect(html).not.toContain(">7</text>");
    expect(html).not.toContain("High (3)");
    expect(html).not.toContain("Medium (2)");
  });
});

function reportResult(charts: ReportRunResult["charts"]): ReportRunResult {
  return {
    report: openNotesReport,
    columns: openNotesReport.columns,
    summary: [],
    groups: [],
    charts,
    rows: [],
    limit: 50,
    offset: 0,
    total: 0
  };
}
