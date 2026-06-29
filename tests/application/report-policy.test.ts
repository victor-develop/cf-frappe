import {
  primitiveReportRowValue,
  reportAggregateValue,
  reportSummaryValue
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
});
