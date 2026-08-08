import type { FC } from "hono/jsx";
import { type DashboardDefinition } from "../../../core/dashboard.js";
import { type DashboardRunResult } from "../../../application/dashboard-service.js";
import { type JsonValue, type ListDocumentsFilter, type ListFilterOperator } from "../../../core/types.js";
import { type ReportRunResult } from "../../../application/report-service.js";
import { UnsafeRawHtml, renderFragment } from "../ui/primitives.js";
import { formatValue, renderReportChartBody } from "./shared.js";

export function renderDashboardList(dashboards: readonly DashboardDefinition[]): string {
  return renderFragment(<DashboardList dashboards={dashboards} />);
}

const DashboardList: FC<{ dashboards: readonly DashboardDefinition[] }> = ({ dashboards }) => (
  <section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead>
          <tr>
            <th>Dashboard</th>
            <th>Module</th>
            <th>Cards</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {dashboards.length === 0 ? (
            <tr>
              <td colspan={4} class="empty">
                No readable dashboards.
              </td>
            </tr>
          ) : (
            dashboards.map((dashboard) => (
              <tr>
                <td data-label="Dashboard">
                  <a href={`/desk/dashboards/${encodeURIComponent(dashboard.name)}`}>{dashboard.label ?? dashboard.name}</a>
                </td>
                <td data-label="Module">{dashboard.module ?? ""}</td>
                <td data-label="Cards">{String(dashboard.cards.length)}</td>
                <td data-label="Description">{dashboard.description ?? ""}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  </section>
);

export function renderDashboardView(result: DashboardRunResult): string {
  return renderFragment(<DashboardView result={result} />);
}

const DashboardView: FC<{ result: DashboardRunResult }> = ({ result }) => (
  <>
    {result.dashboard.description ? <p class="muted">{result.dashboard.description}</p> : null}
    <section class="dashboard-grid">
      {result.cards.length === 0 ? (
        <p class="empty">No dashboard cards.</p>
      ) : (
        result.cards.map((card) => <DashboardCard card={card} />)
      )}
    </section>
  </>
);

const DashboardCard: FC<{ card: DashboardRunResult["cards"][number] }> = ({ card }) => {
  if (card.source.kind === "reportChart") {
    const chart = dashboardChartValue(card.value);
    return (
      <section class="dashboard-card dashboard-chart-card">
        {card.description === undefined ? null : <p>{card.description}</p>}
        {chart === undefined ? (
          <>
            <h2>{card.label}</h2>
            <p class="empty">No chart data.</p>
          </>
        ) : (
          <UnsafeRawHtml
            reason="output of shared renderReportChartBody (prebuilt SVG chart markup); every interpolated value is escaped internally via escapeHtml"
            html={renderReportChartBody(chart, dashboardReportChartHref(card.source), card.label)}
          />
        )}
        <small>{dashboardCardSourceLabel(card.source)}</small>
      </section>
    );
  }
  const href = dashboardMetricHref(card.source);
  const content = (
    <>
      <span>{card.label}</span>
      <strong>{formatValue(dashboardMetricValue(card.value))}</strong>
      {card.indicator === undefined ? null : <em>{card.indicator}</em>}
      {card.description === undefined ? null : <p>{card.description}</p>}
      <small>{dashboardCardSourceLabel(card.source)}</small>
    </>
  );
  return (
    <section class="dashboard-card">
      {href === undefined ? (
        content
      ) : (
        <a class="dashboard-card-link" href={href}>
          {content}
        </a>
      )}
    </section>
  );
};

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
