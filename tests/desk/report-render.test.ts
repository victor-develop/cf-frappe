import { renderReportView } from "../../src";
import { openNotesReport } from "../helpers";
import type { ReportRunResult } from "../../src";

describe("Desk report rendering", () => {
  it("renders pie chart legend entries only for positive slices", () => {
    const html = renderReportView({
      report: openNotesReport,
      columns: openNotesReport.columns,
      summary: [],
      groups: [],
      charts: [
        {
          name: "priority_mix",
          label: "Priority Mix",
          type: "pie",
          group: "by_priority",
          summary: "note_count",
          points: [
            { key: "High", label: "High", value: 3 },
            { key: "Low", label: "Low", value: 0 },
            { key: "Negative", label: "Negative", value: -2 }
          ]
        }
      ],
      rows: [],
      limit: 50,
      offset: 0,
      total: 0
    } satisfies ReportRunResult);

    expect(html).toContain("Priority Mix");
    expect(html).toContain("High (3)");
    expect(html).not.toContain("Low (0)");
    expect(html).not.toContain("Negative (-2)");
  });
});
