import {
  QUERY_PATHS,
  defineDashboard,
  defineReport,
  isQueryPath,
  planAnalyticsQueryPath,
  reportAnalyticsPrefilters
} from "../../src";

const columns = [{ name: "title" }];

describe("queryPath on reports and dashboards", () => {
  it("defaults to undefined, which is the operational path", () => {
    const report = defineReport({ name: "Notes", doctype: "Note", columns });

    expect(report.queryPath).toBeUndefined();
    expect(planAnalyticsQueryPath({ declared: report.queryPath, configured: true })).toEqual({ status: "operational" });
  });

  it("accepts either path and keeps it on the frozen definition", () => {
    expect(QUERY_PATHS).toEqual(["operational", "analytical"]);
    for (const queryPath of QUERY_PATHS) {
      expect(defineReport({ name: "Notes", doctype: "Note", columns, queryPath }).queryPath).toBe(queryPath);
      expect(defineDashboard({ name: "Ops", queryPath, cards: [{ name: "n", source: { kind: "documentCount", doctype: "Note" } }] }).queryPath).toBe(queryPath);
    }
  });

  it("rejects anything else, on reports and on dashboards", () => {
    expect(isQueryPath("r2")).toBe(false);
    expect(() => defineReport({ name: "Notes", doctype: "Note", columns, queryPath: "r2" as never })).toThrow(
      expect.objectContaining({ code: "REPORT_INVALID", message: expect.stringContaining("invalid queryPath 'r2'") })
    );
    expect(() =>
      defineDashboard({ name: "Ops", queryPath: "fast" as never, cards: [{ name: "n", source: { kind: "documentCount", doctype: "Note" } }] })
    ).toThrow(expect.objectContaining({ code: "DASHBOARD_INVALID" }));
  });

  it("refuses an analytical custom-source report, whose rows never came from the projection", () => {
    expect(() =>
      defineReport({ name: "Feed", doctype: "Note", columns, source: { kind: "custom", provider: "feed" }, queryPath: "analytical" })
    ).toThrow(expect.objectContaining({ code: "REPORT_INVALID", message: expect.stringContaining("custom source") }));
    expect(defineReport({ name: "Feed", doctype: "Note", columns, source: { kind: "custom", provider: "feed" } }).queryPath).toBeUndefined();
  });

  it("takes the analytical path only when it is both declared and configured", () => {
    expect(planAnalyticsQueryPath({ declared: "analytical", configured: true })).toEqual({ status: "analytical" });
    expect(planAnalyticsQueryPath({ declared: "analytical", configured: false })).toEqual({ status: "operational" });
    expect(planAnalyticsQueryPath({ declared: "operational", configured: true })).toEqual({ status: "operational" });
  });
});

describe("reportAnalyticsPrefilters", () => {
  const report = defineReport({
    name: "Notes",
    doctype: "Note",
    columns,
    filters: [
      { name: "priority", field: "priority" },
      { name: "title", field: "title", operator: "contains" },
      { name: "count", field: "count", type: "integer" },
      { name: "done", field: "done", type: "boolean" },
      { name: "status", field: "status", operator: "ne" }
    ]
  });

  it("pushes only eq filters holding a non-empty string", () => {
    // contains / ne are not supersets as equality; numbers and booleans would
    // need per-dialect type checks (SQLite reads JSON true as 1).
    expect(
      reportAnalyticsPrefilters(report, { priority: "High", title: "x", count: 3, done: true, status: "Open" })
    ).toEqual([{ field: "priority", value: "High" }]);
    expect(reportAnalyticsPrefilters(report, { priority: "" })).toEqual([]);
    expect(reportAnalyticsPrefilters(report, {})).toEqual([]);
  });
});
