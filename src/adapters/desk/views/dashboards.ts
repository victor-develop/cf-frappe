import { type DashboardDefinition } from "../../../core/dashboard.js";
import { type DashboardRunResult } from "../../../application/dashboard-service.js";
import { type JsonValue, type ListDocumentsFilter, type ListFilterOperator } from "../../../core/types.js";
import { type ReportRunResult } from "../../../application/report-service.js";
import { escapeHtml, formatValue, renderReportChartBody, renderTableCell } from "./shared.js";

export function renderDashboardList(dashboards: readonly DashboardDefinition[]): string {
  const rows = dashboards
    .map(
      (dashboard) => `<tr>
        ${renderTableCell("Dashboard", `<a href="/desk/dashboards/${encodeURIComponent(dashboard.name)}">${escapeHtml(dashboard.label ?? dashboard.name)}</a>`)}
        ${renderTableCell("Module", escapeHtml(dashboard.module ?? ""))}
        ${renderTableCell("Cards", String(dashboard.cards.length))}
        ${renderTableCell("Description", escapeHtml(dashboard.description ?? ""))}
      </tr>`
    )
    .join("");
  return `<section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>Dashboard</th><th>Module</th><th>Cards</th><th>Description</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="empty">No readable dashboards.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

export function renderDashboardView(result: DashboardRunResult): string {
  const description = result.dashboard.description
    ? `<p class="muted">${escapeHtml(result.dashboard.description)}</p>`
    : "";
  const cards = result.cards.map(renderDashboardCard).join("");
  return `${description}<section class="dashboard-grid">${cards || `<p class="empty">No dashboard cards.</p>`}</section>`;
}

function renderDashboardCard(card: DashboardRunResult["cards"][number]): string {
  if (card.source.kind === "reportChart") {
    const chart = dashboardChartValue(card.value);
    return `<section class="dashboard-card dashboard-chart-card">
      ${card.description === undefined ? "" : `<p>${escapeHtml(card.description)}</p>`}
      ${chart === undefined
        ? `<h2>${escapeHtml(card.label)}</h2><p class="empty">No chart data.</p>`
        : renderReportChartBody(chart, dashboardReportChartHref(card.source), card.label)}
      <small>${escapeHtml(dashboardCardSourceLabel(card.source))}</small>
    </section>`;
  }
  const href = dashboardMetricHref(card.source);
  const content = `<span>${escapeHtml(card.label)}</span>
    <strong>${escapeHtml(formatValue(dashboardMetricValue(card.value)))}</strong>
    ${card.indicator === undefined ? "" : `<em>${escapeHtml(card.indicator)}</em>`}
    ${card.description === undefined ? "" : `<p>${escapeHtml(card.description)}</p>`}
    <small>${escapeHtml(dashboardCardSourceLabel(card.source))}</small>`;
  return `<section class="dashboard-card">
    ${href === undefined ? content : `<a class="dashboard-card-link" href="${escapeHtml(href)}">${content}</a>`}
  </section>`;
}

function dashboardMetricValue(value: DashboardRunResult["cards"][number]["value"]): JsonValue | undefined {
  return dashboardChartValue(value) === undefined ? value as JsonValue : undefined;
}

function dashboardChartValue(
  value: DashboardRunResult["cards"][number]["value"]
): ReportRunResult["charts"][number] | undefined {
  if (typeof value === "object" && value !== null && "points" in value) {
    return value as ReportRunResult["charts"][number];
  }
  return undefined;
}

function dashboardReportChartHref(source: Extract<DashboardRunResult["cards"][number]["source"], { readonly kind: "reportChart" }>): string {
  return dashboardReportHref(source.report, source.filters ?? {});
}

function dashboardReportHref(report: string, filters: Readonly<Record<string, JsonValue | undefined>>): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(filters)) {
    if (value !== undefined && value !== null) {
      params.set(`filter_${name}`, String(value));
    }
  }
  const query = params.toString();
  return `/desk/reports/${encodeURIComponent(report)}${query ? `?${query}` : ""}`;
}

function dashboardMetricHref(source: DashboardRunResult["cards"][number]["source"]): string | undefined {
  if (source.kind === "documentCount" || source.kind === "documentAggregate") {
    const params = new URLSearchParams();
    params.set("default_filters", "0");
    for (const filter of source.filters ?? []) {
      appendDashboardListFilter(params, filter);
    }
    if (source.filterExpression !== undefined) {
      params.set("filter_expression", JSON.stringify(source.filterExpression));
    }
    return `/desk/${encodeURIComponent(source.doctype)}?${params.toString()}`;
  }
  if (source.kind === "reportSummary") {
    return dashboardReportHref(source.report, source.filters ?? {});
  }
  return undefined;
}

function appendDashboardListFilter(params: URLSearchParams, filter: ListDocumentsFilter): void {
  const key = dashboardListFilterQueryKey(filter.field, filter.operator);
  const values = Array.isArray(filter.value) ? filter.value : [filter.value];
  for (const value of values) {
    if (value === null) {
      continue;
    }
    params.append(key, String(value));
    if (value === "") {
      params.append("empty_filter", key);
    }
  }
}

function dashboardListFilterQueryKey(field: string, operator: ListFilterOperator | undefined): string {
  return `filter_${field}${operator === undefined || operator === "eq" ? "" : `__${operator}`}`;
}

function dashboardCardSourceLabel(source: DashboardRunResult["cards"][number]["source"]): string {
  if (source.kind === "documentCount") {
    return `${source.doctype} count`;
  }
  if (source.kind === "documentAggregate") {
    return source.aggregate === "count"
      ? `${source.doctype} count`
      : `${source.doctype} ${source.aggregate}(${source.field ?? ""})`;
  }
  if (source.kind === "reportChart") {
    return `${source.report} / ${source.chart}`;
  }
  return `${source.report} / ${source.summary}`;
}
