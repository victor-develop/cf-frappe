import {
  dashboardCardIndicator,
  dashboardIndicatorMatches,
  emptyDashboardDocumentAggregate,
  finishDashboardDocumentAggregate,
  updateDashboardDocumentAggregate
} from "../../src";

describe("dashboard policy", () => {
  it("folds finite document aggregate values", () => {
    const aggregate = [7, 3, 11].reduce(updateDashboardDocumentAggregate, emptyDashboardDocumentAggregate());

    expect(aggregate).toEqual({
      count: 3,
      sum: 21,
      min: 3,
      max: 11
    });
    expect(finishDashboardDocumentAggregate(aggregate, "count")).toBe(3);
    expect(finishDashboardDocumentAggregate(aggregate, "sum")).toBe(21);
    expect(finishDashboardDocumentAggregate(aggregate, "avg")).toBe(7);
    expect(finishDashboardDocumentAggregate(aggregate, "min")).toBe(3);
    expect(finishDashboardDocumentAggregate(aggregate, "max")).toBe(11);
  });

  it("ignores non-finite or non-number document aggregate values", () => {
    const start = emptyDashboardDocumentAggregate();
    expect(updateDashboardDocumentAggregate(start, "7")).toBe(start);
    expect(updateDashboardDocumentAggregate(start, Number.NaN)).toBe(start);
    expect(updateDashboardDocumentAggregate(start, Number.POSITIVE_INFINITY)).toBe(start);
  });

  it("finishes empty document aggregates deterministically", () => {
    const aggregate = emptyDashboardDocumentAggregate();

    expect(finishDashboardDocumentAggregate(aggregate, "count")).toBe(0);
    expect(finishDashboardDocumentAggregate(aggregate, "sum")).toBe(0);
    expect(finishDashboardDocumentAggregate(aggregate, "avg")).toBeNull();
    expect(finishDashboardDocumentAggregate(aggregate, "min")).toBeNull();
    expect(finishDashboardDocumentAggregate(aggregate, "max")).toBeNull();
  });

  it("matches all dashboard indicator operators", () => {
    expect(dashboardIndicatorMatches(5, "eq", 5)).toBe(true);
    expect(dashboardIndicatorMatches(5, "eq", 4)).toBe(false);
    expect(dashboardIndicatorMatches(5, "ne", 4)).toBe(true);
    expect(dashboardIndicatorMatches(5, "ne", 5)).toBe(false);
    expect(dashboardIndicatorMatches(5, "gt", 4)).toBe(true);
    expect(dashboardIndicatorMatches(5, "gt", 5)).toBe(false);
    expect(dashboardIndicatorMatches(5, "gte", 5)).toBe(true);
    expect(dashboardIndicatorMatches(5, "gte", 6)).toBe(false);
    expect(dashboardIndicatorMatches(5, "lt", 6)).toBe(true);
    expect(dashboardIndicatorMatches(5, "lt", 5)).toBe(false);
    expect(dashboardIndicatorMatches(5, "lte", 5)).toBe(true);
    expect(dashboardIndicatorMatches(5, "lte", 4)).toBe(false);
  });

  it("selects the first matching numeric indicator rule", () => {
    expect(dashboardCardIndicator({
      indicator: "gray",
      indicatorRules: [
        { operator: "gte", value: 10, indicator: "green" },
        { operator: "gte", value: 5, indicator: "blue" }
      ]
    }, 7)).toBe("blue");
  });

  it("falls back to static indicators for non-numeric or unmatched card values", () => {
    const card = {
      indicator: "gray",
      indicatorRules: [{ operator: "gt", value: 0, indicator: "green" }]
    } as const;

    expect(dashboardCardIndicator(card, 0)).toBe("gray");
    expect(dashboardCardIndicator(card, null)).toBe("gray");
    expect(dashboardCardIndicator(card, Number.NaN)).toBe("gray");
  });
});
