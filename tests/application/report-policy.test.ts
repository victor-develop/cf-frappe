import {
  primitiveReportRowValue,
  reportAggregateValue,
  reportChartDrilldown,
  reportSummaryValue,
  sortReportChartPoints
} from "../../src";

describe("report policy", () => {
  const rows = [
    { title: "High", count: 7, priority: "High", active: true },
    { title: "Low", count: 3, priority: "Low", active: false },
    { title: "Empty", count: null, priority: null, active: null },
    { title: "Missing" }
  ];

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

  it("reads primitive report row values only", () => {
    expect(primitiveReportRowValue(rows[0]!, "title")).toBe("High");
    expect(primitiveReportRowValue(rows[0]!, "count")).toBe(7);
    expect(primitiveReportRowValue(rows[0]!, "active")).toBe(true);
    expect(primitiveReportRowValue(rows[2]!, "priority")).toBeNull();
    expect(primitiveReportRowValue({ meta: { nested: true } }, "meta")).toBeUndefined();
    expect(primitiveReportRowValue({}, "missing")).toBeUndefined();
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
});
