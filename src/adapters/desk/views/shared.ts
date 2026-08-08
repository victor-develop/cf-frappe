import { type ClientScriptDefinition, type ClientScriptScope } from "../../../core/client-script.js";
import { DESK_CLIENT_SCRIPT_PATH } from "../client.js";
import { type DocTypeDefinition, type DocumentSnapshot, type FieldDefinition, type FieldType, type JsonValue, type ListDocumentsFilter, type ListFilterBuilderField, type ListFilterGroupMatch } from "../../../core/types.js";
import { type ReportRunResult } from "../../../application/report-service.js";
import { isReportChartColor } from "../../../core/reports.js";

export type ReportChartPointResult = ReportRunResult["charts"][number]["points"][number];

export function renderTableCell(label: string, content: string): string {
  return `<td data-label="${escapeHtml(label)}">${content}</td>`;
}

export function uniqueSortedStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

export function renderReportChartBody(
  chart: ReportRunResult["charts"][number],
  drilldownBaseHref: string | undefined,
  title: string
): string {
  const points = chart.points.filter((point) => point.value !== null);
  const svg = points.length === 0
    ? `<p class="empty">No chart data.</p>`
    : chart.type === "line"
      ? renderLineChart(chart, points, drilldownBaseHref)
      : chart.type === "pie"
        ? renderPieChart(chart, points, drilldownBaseHref)
        : renderBarChart(chart, points, drilldownBaseHref);
  return `<div class="report-chart-body">
    <h2>${escapeHtml(title)}</h2>
    ${svg}
  </div>`;
}

export function renderBarChart(
  chart: ReportRunResult["charts"][number],
  points: readonly ReportChartPointResult[],
  drilldownBaseHref: string | undefined
): string {
  const width = 520;
  const height = 220;
  const chartHeight = 150;
  const scale = chartScale(points);
  const gap = 12;
  const barWidth = Math.max(12, (width - gap * (points.length + 1)) / points.length);
  const baseline = chartY(0, scale, chartHeight);
  const bars = points
    .map((point, index) => {
      const value = point.value ?? 0;
      const x = gap + index * (barWidth + gap);
      const valueY = chartY(value, scale, chartHeight);
      const y = Math.min(valueY, baseline);
      const barHeight = Math.max(1, Math.abs(baseline - valueY));
      const valueLabel = chart.showValues
        ? `<text x="${x + barWidth / 2}" y="${Math.max(14, y - 6)}" text-anchor="middle">${escapeHtml(formatValue(value))}</text>`
        : "";
      return renderChartPointLink(point, drilldownBaseHref, `<g>
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="3" style="fill: ${chartColor(chart, index)}"></rect>
        ${valueLabel}
        <text x="${x + barWidth / 2}" y="202" text-anchor="middle">${escapeHtml(point.label)}</text>
      </g>`);
    })
    .join("");
  return `<svg class="chart-svg chart-bar" role="img" aria-label="${escapeHtml(chartAriaLabel(chart))}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">${bars}${renderChartAxisLabels(chart, width, height)}</svg>`;
}

export function renderLineChart(
  chart: ReportRunResult["charts"][number],
  points: readonly ReportChartPointResult[],
  drilldownBaseHref: string | undefined
): string {
  const width = 520;
  const height = 220;
  const scale = chartScale(points);
  const step = points.length <= 1 ? 0 : 440 / (points.length - 1);
  const coords = points.map((point, index) => {
    const x = 40 + index * step;
    const y = chartY(point.value ?? 0, scale, 140);
    return { point, x, y };
  });
  const path = coords.map((coord, index) => `${index === 0 ? "M" : "L"} ${coord.x} ${coord.y}`).join(" ");
  const markers = coords
    .map(
      ({ point, x, y }, index) => renderChartPointLink(point, drilldownBaseHref, `<g>
        <circle cx="${x}" cy="${y}" r="4" style="fill: ${chartColor(chart, index)}"></circle>
        ${chart.showValues ? `<text x="${x}" y="${Math.max(14, y - 8)}" text-anchor="middle">${escapeHtml(formatValue(point.value ?? 0))}</text>` : ""}
        <text x="${x}" y="202" text-anchor="middle">${escapeHtml(point.label)}</text>
      </g>`)
    )
    .join("");
  return `<svg class="chart-svg chart-line" role="img" aria-label="${escapeHtml(chartAriaLabel(chart))}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet"><path d="${path}" style="stroke: ${chartColor(chart, 0)}"></path>${markers}${renderChartAxisLabels(chart, width, height)}</svg>`;
}

export function renderPieChart(
  chart: ReportRunResult["charts"][number],
  points: readonly ReportChartPointResult[],
  drilldownBaseHref: string | undefined
): string {
  const positivePoints = points.filter((point) => (point.value ?? 0) > 0);
  const total = positivePoints.reduce((sum, point) => sum + (point.value ?? 0), 0);
  if (total <= 0) {
    return `<p class="empty">No chart data.</p>`;
  }
  let offset = 0;
  const rings = positivePoints
    .map((point, index) => {
      const value = point.value ?? 0;
      const dash = (value / total) * 100;
      const circle = `<circle r="70" cx="110" cy="110" stroke-dasharray="${dash} ${100 - dash}" stroke-dashoffset="${-offset}" style="stroke: ${chartColor(chart, index)}"></circle>`;
      offset += dash;
      return renderChartPointLink(point, drilldownBaseHref, circle);
    })
    .join("");
  const legend = positivePoints
    .map((point, index) => {
      const value = chart.showValues ? ` (${escapeHtml(formatValue(point.value ?? 0))})` : "";
      return `<li>${renderChartPointLink(point, drilldownBaseHref, `<span class="chart-swatch chart-swatch-${index % 6}" style="background: ${chartColor(chart, index)}"></span>${escapeHtml(point.label)}${value}`)}</li>`;
    })
    .join("");
  return `<div class="chart-pie-wrap"><svg class="chart-svg chart-pie" role="img" aria-label="${escapeHtml(chart.label)}" viewBox="0 0 220 220">${rings}</svg><ul>${legend}</ul></div>`;
}

export function renderChartPointLink(
  point: ReportChartPointResult,
  drilldownBaseHref: string | undefined,
  content: string
): string {
  const href = chartPointDrilldownHref(point, drilldownBaseHref);
  return href === undefined
    ? content
    : `<a class="chart-drilldown" href="${escapeHtml(href)}">${content}</a>`;
}

export function chartPointDrilldownHref(
  point: ReportChartPointResult,
  drilldownBaseHref: string | undefined
): string | undefined {
  if (drilldownBaseHref === undefined || point.drilldown === undefined) {
    return undefined;
  }
  const url = new URL(drilldownBaseHref, "https://cf-frappe.local");
  const drilldown = new URLSearchParams(point.drilldown.query);
  drilldown.forEach((value, key) => {
    url.searchParams.set(key, value);
  });
  return `${url.pathname}${url.search}${url.hash}`;
}

export const chartPalette = ["#1f6feb", "#2e7d32", "#ad1457", "#ef6c00", "#00695c", "#6a1b9a"];

export function renderChartAxisLabels(chart: ReportRunResult["charts"][number], width: number, height: number): string {
  const xAxis = chart.xAxisLabel
    ? `<text class="chart-axis-label chart-axis-x" x="${width / 2}" y="${height - 4}" text-anchor="middle">${escapeHtml(chart.xAxisLabel)}</text>`
    : "";
  const yAxis = chart.yAxisLabel
    ? `<text class="chart-axis-label chart-axis-y" x="14" y="${height / 2}" text-anchor="middle" transform="rotate(-90 14 ${height / 2})">${escapeHtml(chart.yAxisLabel)}</text>`
    : "";
  return `${xAxis}${yAxis}`;
}

export function chartAriaLabel(chart: ReportRunResult["charts"][number]): string {
  const labels = [chart.label, chart.xAxisLabel, chart.yAxisLabel].filter(Boolean);
  return labels.join(", ");
}

export function chartColor(chart: ReportRunResult["charts"][number], index: number): string {
  const fallback = chartPaletteColor(index);
  const color = chart.colors.length > 0 ? chart.colors[index % chart.colors.length] : undefined;
  return color && isReportChartColor(color) ? color : fallback;
}

export function chartPaletteColor(index: number): string {
  return chartPalette[index % chartPalette.length] ?? "#1f6feb";
}

export function chartScale(points: readonly ReportRunResult["charts"][number]["points"][number][]): { readonly min: number; readonly max: number } {
  const values = points.map((point) => point.value ?? 0);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  return min === max ? { min: 0, max: 1 } : { min, max };
}

export function chartY(value: number, scale: { readonly min: number; readonly max: number }, height: number): number {
  return 170 - ((value - scale.min) / (scale.max - scale.min)) * height;
}

export function renderCompoundFilterMatchOptions(match: ListFilterGroupMatch): string {
  return [
    { value: "all", label: "All" },
    { value: "any", label: "Any" }
  ]
    .map((option) => `<option value="${option.value}"${option.value === match ? " selected" : ""}>${option.label}</option>`)
    .join("");
}

export function formatCompoundFilterVisualValue(value: ListDocumentsFilter["value"]): string {
  return Array.isArray(value) ? value.map((item) => formatFormValue(item)).join(", ") : formatFormValue(value);
}

export function renderCompoundFilterFieldOptions(
  fields: readonly ListFilterBuilderField[],
  selected: string
): string {
  return [`<option value=""></option>`]
    .concat(
      fields.map((field) =>
        `<option value="${escapeHtml(field.field)}"${field.field === selected ? " selected" : ""}>${escapeHtml(field.field)}</option>`
      )
    )
    .join("");
}

export function renderClientScripts(
  doctype: string,
  scope: Exclude<ClientScriptScope, "both"> | "report-builder",
  scripts: readonly ClientScriptDefinition[],
  documentName?: string,
  documentTenantId?: string,
  realtimeRoute?: string,
  document?: DocumentSnapshot
): string {
  const documentAttribute = documentName === undefined
    ? ""
    : ` data-document-name="${escapeHtml(documentName)}"`;
  const documentVersionAttribute = document === undefined
    ? ""
    : ` data-document-version="${String(document.version)}"`;
  const documentStatusAttribute = document === undefined
    ? ""
    : ` data-document-status="${escapeHtml(document.docstatus)}"`;
  const tenantAttribute = documentTenantId === undefined
    ? ""
    : ` data-tenant-id="${escapeHtml(documentTenantId)}"`;
  const realtimeAttribute = realtimeRoute === undefined
    ? ""
    : ` data-realtime-route="${escapeHtml(realtimeRoute)}"`;
  const runtime = `<script src="${DESK_CLIENT_SCRIPT_PATH}" data-cf-frappe-runtime="desk" data-doctype="${escapeHtml(doctype)}" data-scope="${scope}"${documentAttribute}${documentVersionAttribute}${documentStatusAttribute}${tenantAttribute}${realtimeAttribute}></script>`;
  const declared = scripts
    .map((script) => {
      const type = (script.type ?? "module") === "module" ? ' type="module"' : "";
      return `<script${type} src="${escapeHtml(script.src)}" data-cf-frappe-script="${escapeHtml(script.name)}" data-doctype="${escapeHtml(doctype)}" data-scope="${scope}"${documentAttribute}${documentVersionAttribute}${documentStatusAttribute}${tenantAttribute}${realtimeAttribute}></script>`;
    })
    .join("");
  return `${runtime}${declared}`;
}

export function inputType(field: FieldDefinition): string {
  return inputTypeForFieldType(field.type);
}

export function inputTypeForFieldType(type?: FieldType): string {
  switch (type) {
    case "integer":
    case "number":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime-local";
    case "boolean":
      return "checkbox";
    default:
      return "text";
  }
}

export function labelFor(doctype: DocTypeDefinition): string {
  return doctype.label ?? doctype.name;
}

export function formatValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

export function formatFormValue(value: JsonValue | undefined): string {
  return formatValue(value);
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function slug(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-+|-+$/g, "");
}
