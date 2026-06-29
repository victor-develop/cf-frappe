import { badRequest } from "../core/errors.js";
import type {
  ReportChartDefinition,
  ReportChartOrder,
  ReportChartOrderBy,
  ReportChartType,
  ReportFilterDefinition,
  ReportGroupDefinition,
  ReportSummaryDefinition
} from "../core/reports.js";
import type { FieldType, JsonPrimitive, JsonValue } from "../core/types.js";

export type ReportRow = Readonly<Record<string, JsonValue>>;

export interface ReportSummaryValue {
  readonly name: string;
  readonly label: string;
  readonly aggregate: ReportSummaryDefinition["aggregate"];
  readonly value: JsonPrimitive;
  readonly field?: string;
  readonly type?: FieldType;
  readonly indicator?: string;
}

export interface ReportChartDrilldown {
  readonly filter: string;
  readonly value: JsonPrimitive;
  readonly query: string;
}

export interface ReportChartPoint {
  readonly key: JsonPrimitive;
  readonly label: string;
  readonly value: number | null;
  readonly drilldown?: ReportChartDrilldown;
}

export interface ReportChartResult {
  readonly name: string;
  readonly label: string;
  readonly type: ReportChartType;
  readonly group: string;
  readonly summary: string;
  readonly orderBy: ReportChartOrderBy;
  readonly order: ReportChartOrder;
  readonly colors: readonly string[];
  readonly showValues: boolean;
  readonly xAxisLabel?: string;
  readonly yAxisLabel?: string;
  readonly points: readonly ReportChartPoint[];
}

export interface ReportGroupRow {
  readonly key: JsonPrimitive;
  readonly label: string;
  readonly summaries: readonly ReportSummaryValue[];
}

export interface ReportGroupResult {
  readonly name: string;
  readonly label: string;
  readonly field: string;
  readonly rows: readonly ReportGroupRow[];
}

const EMPTY_CHART_COLORS: readonly string[] = Object.freeze([]);

export function reportSummaryValue(
  summary: ReportSummaryDefinition,
  rows: readonly ReportRow[]
): ReportSummaryValue {
  return {
    name: summary.name,
    label: summary.label ?? summary.name,
    aggregate: summary.aggregate,
    value: reportAggregateValue(summary, rows),
    ...(summary.field ? { field: summary.field } : {}),
    ...(summary.type ? { type: summary.type } : summary.aggregate === "count" ? { type: "integer" } : {}),
    ...(summary.indicator ? { indicator: summary.indicator } : {})
  };
}

export function reportAggregateValue(summary: ReportSummaryDefinition, rows: readonly ReportRow[]): JsonPrimitive {
  const field = summary.field;
  switch (summary.aggregate) {
    case "count":
      return field
        ? rows.filter((row) => isPresentReportValue(row[field])).length
        : rows.length;
    case "sum":
      return numericReportValues(rows, requiredSummaryField(summary)).reduce((total, value) => total + value, 0);
    case "avg": {
      const values = numericReportValues(rows, requiredSummaryField(summary));
      return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
    }
    case "min":
      return minMaxReportValue(rows, requiredSummaryField(summary), "min");
    case "max":
      return minMaxReportValue(rows, requiredSummaryField(summary), "max");
  }
}

export function primitiveReportRowValue(row: ReportRow, field: string): JsonPrimitive | undefined {
  const value = row[field];
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return undefined;
}

export function reportChartDrilldown(
  filter: Pick<ReportFilterDefinition, "name">,
  value: JsonPrimitive
): ReportChartDrilldown | undefined {
  if (value === null) {
    return undefined;
  }
  const params = new URLSearchParams();
  params.set(`filter_${filter.name}`, String(value));
  return {
    filter: filter.name,
    value,
    query: params.toString()
  };
}

export function sortReportChartPoints(
  points: readonly ReportChartPoint[],
  orderBy: ReportChartOrderBy,
  order: ReportChartOrder
): readonly ReportChartPoint[] {
  const direction = order === "desc" ? -1 : 1;
  return [...points].sort((left, right) => {
    const comparison = compareChartPoints(left, right, orderBy, direction);
    return comparison === 0
      ? compareReportValues(left.label, right.label) || compareReportValues(left.key, right.key)
      : comparison;
  });
}

export function buildReportCharts(
  groups: readonly ReportGroupResult[],
  charts: readonly ReportChartDefinition[],
  filters: readonly ReportFilterDefinition[] = []
): readonly ReportChartResult[] {
  return charts.map((chart) => {
    const group = groups.find((item) => item.name === chart.group);
    const drilldownFilter = group === undefined ? undefined : exactDrilldownFilterForGroup(filters, group);
    const orderBy = chart.orderBy ?? "key";
    const order = chart.order ?? "asc";
    const points = sortReportChartPoints(
      (group?.rows ?? []).map((row) => reportChartPoint(row, chart.summary, drilldownFilter)),
      orderBy,
      order
    ).slice(0, chart.maxPoints ?? Number.POSITIVE_INFINITY);
    return {
      name: chart.name,
      label: chart.label ?? chart.name,
      type: chart.type,
      group: chart.group,
      summary: chart.summary,
      orderBy,
      order,
      colors: chart.colors ?? EMPTY_CHART_COLORS,
      showValues: chart.showValues ?? true,
      ...(chart.xAxisLabel === undefined ? {} : { xAxisLabel: chart.xAxisLabel }),
      ...(chart.yAxisLabel === undefined ? {} : { yAxisLabel: chart.yAxisLabel }),
      points
    };
  });
}

export function buildReportGroups(
  rows: readonly ReportRow[],
  groups: readonly ReportGroupDefinition[]
): readonly ReportGroupResult[] {
  return groups.map((group) => {
    const buckets = new Map<string, { readonly key: JsonPrimitive; readonly rows: ReportRow[] }>();
    for (const row of rows) {
      const key = primitiveReportRowValue(row, group.field) ?? null;
      const bucketKey = JSON.stringify(key);
      const existing = buckets.get(bucketKey);
      if (existing) {
        existing.rows.push(row);
      } else {
        buckets.set(bucketKey, { key, rows: [row] });
      }
    }
    const groupRows = [...buckets.values()]
      .sort((left, right) => compareReportValues(left.key, right.key))
      .map((bucket) => ({
        key: bucket.key,
        label: reportGroupLabel(bucket.key),
        summaries: group.summaries.map((summary) => reportSummaryValue(summary, bucket.rows))
      }));
    return {
      name: group.name,
      label: group.label ?? group.name,
      field: group.field,
      rows: groupRows
    };
  });
}

export function limitReportGroups(
  groups: readonly ReportGroupResult[],
  definitions: readonly ReportGroupDefinition[]
): readonly ReportGroupResult[] {
  const maxRowsByName = new Map(definitions.map((definition) => [definition.name, definition.maxRows]));
  return groups.map((group) => {
    const maxRows = maxRowsByName.get(group.name);
    return maxRows === undefined
      ? group
      : { ...group, rows: group.rows.slice(0, maxRows) };
  });
}

function reportChartPoint(
  row: ReportGroupRow,
  summaryName: string,
  drilldownFilter: ReportFilterDefinition | undefined
): ReportChartPoint {
  const summary = row.summaries.find((item) => item.name === summaryName);
  const drilldown = drilldownFilter === undefined ? undefined : reportChartDrilldown(drilldownFilter, row.key);
  return {
    key: row.key,
    label: row.label,
    value: typeof summary?.value === "number" ? summary.value : null,
    ...(drilldown === undefined ? {} : { drilldown })
  };
}

function exactDrilldownFilterForGroup(
  filters: readonly ReportFilterDefinition[],
  group: ReportGroupResult
): ReportFilterDefinition | undefined {
  return filters.find((filter) =>
    filter.field === group.field && (filter.operator ?? "eq") === "eq"
  );
}

function requiredSummaryField(summary: ReportSummaryDefinition): string {
  if (!summary.field) {
    throw badRequest(`Report summary '${summary.name}' requires a field for ${summary.aggregate}`);
  }
  return summary.field;
}

function numericReportValues(rows: readonly ReportRow[], field: string): readonly number[] {
  return rows
    .map((row) => primitiveReportRowValue(row, field))
    .filter((value): value is number => typeof value === "number");
}

function minMaxReportValue(
  rows: readonly ReportRow[],
  field: string,
  direction: "min" | "max"
): JsonPrimitive {
  const values = rows
    .map((row) => primitiveReportRowValue(row, field))
    .filter((value): value is Exclude<JsonPrimitive, null> => value !== undefined && value !== null);
  if (values.length === 0) {
    return null;
  }
  return values.slice(1).reduce((selected, value) => {
    const comparison = compareReportValues(value, selected);
    return direction === "min"
      ? comparison < 0 ? value : selected
      : comparison > 0 ? value : selected;
  }, firstMinMaxCandidate(values, field, direction));
}

function firstMinMaxCandidate(
  values: readonly Exclude<JsonPrimitive, null>[],
  field: string,
  direction: "min" | "max"
): Exclude<JsonPrimitive, null> {
  const value = values[0];
  if (value === undefined) {
    throw new Error(`Report ${direction} summary for field '${field}' has no candidate values`);
  }
  return value;
}

function isPresentReportValue(value: JsonValue | undefined): boolean {
  return value !== undefined && value !== null;
}

function compareReportValues(actual: JsonValue | undefined, expected: JsonPrimitive): number {
  if (typeof actual === "number" && typeof expected === "number") {
    return actual - expected;
  }
  return String(actual ?? "").localeCompare(String(expected));
}

function compareChartPoints(
  left: ReportChartPoint,
  right: ReportChartPoint,
  orderBy: ReportChartOrderBy,
  direction: number
): number {
  if (orderBy === "value") {
    return compareChartValues(left.value, right.value, direction);
  }
  if (orderBy === "label") {
    return compareReportValues(left.label, right.label) * direction;
  }
  return compareReportValues(left.key, right.key) * direction;
}

function compareChartValues(left: number | null, right: number | null, direction: number): number {
  if (left === null || right === null) {
    if (left === right) {
      return 0;
    }
    return left === null ? 1 : -1;
  }
  return compareReportValues(left, right) * direction;
}

function reportGroupLabel(value: JsonPrimitive): string {
  return value === null ? "(empty)" : String(value);
}
