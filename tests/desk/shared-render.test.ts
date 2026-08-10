import { describe, expect, it } from "vitest";
import {
  chartColor,
  chartPalette,
  chartPaletteColor,
  chartScale,
  renderBarChart,
  renderLineChart,
  renderPieChart,
  renderReportChartBody
} from "../../src/adapters/desk/views/shared.js";
import { renderDocumentPresencePanel } from "../../src/adapters/desk/views/inbox.js";
import type { DocumentSnapshot } from "../../src/core/types.js";

type Chart = Parameters<typeof renderReportChartBody>[0];
type ChartPoint = Chart["points"][number];

function chart(overrides: Partial<Chart> = {}): Chart {
  return {
    name: "by_status",
    label: "By status",
    type: "bar",
    group: "status",
    summary: "count",
    orderBy: "label",
    order: "asc",
    colors: [],
    showValues: false,
    points: [],
    ...overrides
  };
}

function point(overrides: Partial<ChartPoint> = {}): ChartPoint {
  return { key: "open", label: "Open", value: 4, ...overrides };
}

describe("shared chart rendering branches", () => {
  it("renders the empty body when every point value is null", () => {
    const html = renderReportChartBody(
      chart({ points: [point({ value: null }), point({ key: "done", label: "Done", value: null })] }),
      undefined,
      "By status"
    );
    expect(html).toContain("No chart data.");
    expect(html).not.toContain("<svg");
  });

  it("treats null bar values as zero when called directly", () => {
    const html = renderBarChart(chart(), [point({ value: null })], undefined);
    expect(html).toContain("chart-bar");
    expect(html).toContain("<rect");
  });

  it("renders a single-point line chart with zero step and value labels", () => {
    const html = renderLineChart(
      chart({ type: "line", showValues: true }),
      [point({ value: null })],
      undefined
    );
    expect(html).toContain("chart-line");
    expect(html).toContain("M 40");
    expect(html).not.toContain("L 40");
    expect(html).toContain('text-anchor="middle">0<');
  });

  it("renders the pie empty state when no point is positive", () => {
    const html = renderPieChart(
      chart({ type: "pie" }),
      [point({ value: 0 }), point({ key: "done", label: "Done", value: null })],
      undefined
    );
    expect(html).toContain("No chart data.");
  });

  it("renders pie legend values when showValues is enabled", () => {
    const html = renderPieChart(
      chart({ type: "pie", showValues: true }),
      [point({ value: 3 }), point({ key: "done", label: "Done", value: 1 })],
      undefined
    );
    expect(html).toContain("chart-pie");
    expect(html).toContain("(3)");
    expect(html).toContain("(1)");
  });

  it("falls back to the palette when a chart color is missing or invalid", () => {
    expect(chartColor(chart({ colors: [] }), 0)).toBe(chartPalette[0]);
    expect(chartColor(chart({ colors: ["not-a-color"] }), 0)).toBe(chartPalette[0]);
  });

  it("falls back to the default palette color on out-of-range indexes", () => {
    expect(chartPaletteColor(-1)).toBe("#1f6feb");
    expect(chartPaletteColor(chartPalette.length)).toBe(chartPalette[0]);
  });

  it("expands a flat scale so charts never divide by zero", () => {
    expect(chartScale([])).toEqual({ min: 0, max: 1 });
    expect(chartScale([point({ value: 0 })])).toEqual({ min: 0, max: 1 });
    expect(chartScale([point({ value: -2 }), point({ key: "d", label: "D", value: 5 })])).toEqual({ min: -2, max: 5 });
  });
});

describe("presence panel live regions", () => {
  const document: DocumentSnapshot = {
    tenantId: "tenant-1",
    doctype: "Note",
    name: "NOTE-1",
    version: 1,
    docstatus: "draft",
    data: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };

  it("announces presence updates politely and conflict notices assertively", () => {
    const html = renderDocumentPresencePanel(document);
    expect(html).toContain('role="status" data-cf-frappe-presence-count');
    expect(html).toContain('role="status" data-cf-frappe-presence-list');
    expect(html).toContain('role="status" data-cf-frappe-field-edits');
    expect(html).toContain('role="alert" data-cf-frappe-shared-draft');
    expect(html).toContain('role="alert" data-cf-frappe-document-update');
  });
});
