import {
  dashboardCardResult,
  dashboardCardIndicator,
  dashboardIndicatorMatches,
  dashboardReportCardValue,
  emptyDashboardDocumentAggregate,
  ensureDashboardServiceAvailable,
  finishDashboardDocumentAggregate,
  planDashboardReadAccess,
  updateDashboardDocumentAggregate
} from "../../src";

describe("dashboard policy", () => {
  it("guards dashboard service availability before Desk dashboard routes", () => {
    expect(() => ensureDashboardServiceAvailable({ runDashboard: async () => ({}) })).not.toThrow();

    let error: unknown;
    try {
      ensureDashboardServiceAvailable(undefined);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: "DASHBOARD_NOT_FOUND",
      message: "Dashboards are not enabled",
      status: 404
    });
  });

  it("shapes dashboard card results with default labels", () => {
    expect(dashboardCardResult({
      name: "open_notes",
      source: { kind: "documentCount", doctype: "Note" }
    }, 3)).toEqual({
      name: "open_notes",
      label: "open_notes",
      value: 3,
      source: { kind: "documentCount", doctype: "Note" }
    });
  });

  it("shapes dashboard card results with descriptions and matched indicators", () => {
    expect(dashboardCardResult({
      name: "open_notes",
      label: "Open Notes",
      description: "Open work",
      indicator: "gray",
      indicatorRules: [{ operator: "gte", value: 2, indicator: "green" }],
      source: { kind: "documentCount", doctype: "Note" }
    }, 3)).toEqual({
      name: "open_notes",
      label: "Open Notes",
      description: "Open work",
      value: 3,
      source: { kind: "documentCount", doctype: "Note" },
      indicator: "green"
    });
  });

  it("omits dashboard card indicators when neither static nor rules apply", () => {
    expect(dashboardCardResult({
      name: "priority_chart",
      source: { kind: "reportChart", report: "Open Notes", chart: "notes_by_priority" }
    }, null)).toEqual({
      name: "priority_chart",
      label: "priority_chart",
      value: null,
      source: { kind: "reportChart", report: "Open Notes", chart: "notes_by_priority" }
    });
  });

  it("selects report chart values for dashboard cards", () => {
    const chart = {
      name: "notes_by_priority",
      label: "Notes by Priority",
      type: "bar" as const,
      group: "by_priority",
      summary: "note_count",
      orderBy: "key" as const,
      order: "asc" as const,
      colors: [],
      showValues: false,
      points: [{ key: "High", label: "High", value: 3 }]
    };

    expect(dashboardReportCardValue(
      { kind: "reportChart", report: "Open Notes", chart: "notes_by_priority" },
      { charts: [chart], summary: [] }
    )).toBe(chart);
  });

  it("returns null when dashboard report chart values are missing", () => {
    expect(dashboardReportCardValue(
      { kind: "reportChart", report: "Open Notes", chart: "missing_chart" },
      { charts: [], summary: [] }
    )).toBeNull();
  });

  it("selects report summary values for dashboard cards", () => {
    expect(dashboardReportCardValue(
      { kind: "reportSummary", report: "Open Notes", summary: "total_count" },
      {
        charts: [],
        summary: [{ name: "total_count", label: "Total Count", aggregate: "count", value: 3 }]
      }
    )).toBe(3);
  });

  it("returns null when dashboard report summary values are missing", () => {
    expect(dashboardReportCardValue(
      { kind: "reportSummary", report: "Open Notes", summary: "missing_summary" },
      { charts: [], summary: [] }
    )).toBeNull();
  });

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

  it("plans dashboard read access from dashboard roles and card source readability", () => {
    const actor = { id: "analyst", roles: ["Analytics User"] };
    const dashboard = {
      name: "Operations",
      roles: ["Analytics User"],
      cards: [{ name: "open_notes", source: { kind: "documentCount", doctype: "Note" } }]
    } as const;

    expect(planDashboardReadAccess({ actor, dashboard, cardsReadable: true })).toEqual({ status: "allow" });
    expect(planDashboardReadAccess({ actor, dashboard, cardsReadable: false })).toEqual({
      status: "deny",
      message: "Actor 'analyst' cannot read dashboard 'Operations'"
    });
    expect(
      planDashboardReadAccess({
        actor: { id: "guest", roles: ["Guest"] },
        dashboard,
        cardsReadable: true
      })
    ).toEqual({
      status: "deny",
      message: "Actor 'guest' cannot read dashboard 'Operations'"
    });
  });
});
