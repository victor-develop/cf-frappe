import { badRequest, permissionDenied } from "../core/errors";
import { can } from "../core/permissions";
import {
  assertReportMatchesDocType,
  canReadReport,
  type ReportColumnDefinition,
  type ReportChartDefinition,
  type ReportChartType,
  type ReportDefinition,
  type ReportGroupDefinition,
  type ReportSummaryAggregate,
  type ReportSummaryDefinition
} from "../core/reports";
import type { ModelRegistry } from "../core/registry";
import type { Actor, DocumentSnapshot, FieldType, JsonPrimitive, JsonValue } from "../core/types";
import { QueryService } from "./query-service";

export type ReportFilters = Readonly<Record<string, JsonPrimitive | undefined>>;
export type ReportRow = Readonly<Record<string, JsonValue>>;

export interface ReportSummaryValue {
  readonly name: string;
  readonly label: string;
  readonly aggregate: ReportSummaryAggregate;
  readonly value: JsonPrimitive;
  readonly field?: string;
  readonly type?: FieldType;
  readonly indicator?: string;
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

export interface ReportChartPoint {
  readonly key: JsonPrimitive;
  readonly label: string;
  readonly value: number | null;
}

export interface ReportChartResult {
  readonly name: string;
  readonly label: string;
  readonly type: ReportChartType;
  readonly group: string;
  readonly summary: string;
  readonly points: readonly ReportChartPoint[];
}

export interface ReportRunOptions {
  readonly filters?: ReportFilters;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ReportRunResult {
  readonly report: ReportDefinition;
  readonly columns: readonly ReportColumnDefinition[];
  readonly summary: readonly ReportSummaryValue[];
  readonly groups: readonly ReportGroupResult[];
  readonly charts: readonly ReportChartResult[];
  readonly rows: readonly ReportRow[];
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
}

export interface ReportServiceOptions {
  readonly registry: ModelRegistry;
  readonly queries: QueryService;
}

export class ReportService {
  private readonly registry: ModelRegistry;
  private readonly queries: QueryService;

  constructor(options: ReportServiceOptions) {
    this.registry = options.registry;
    this.queries = options.queries;
  }

  listReports(actor: Actor): readonly ReportDefinition[] {
    return this.registry.listReports().filter((report) => this.canAccess(actor, report));
  }

  getReport(actor: Actor, reportName: string): ReportDefinition {
    const report = this.registry.getReport(reportName);
    if (!this.canAccess(actor, report)) {
      throw permissionDenied(`Actor '${actor.id}' cannot read report '${report.name}'`);
    }
    assertReportMatchesDocType(report, this.registry.get(report.doctype));
    return report;
  }

  async runReport(actor: Actor, reportName: string, options: ReportRunOptions = {}): Promise<ReportRunResult> {
    const report = this.getReport(actor, reportName);
    const limit = clampLimit(options.limit);
    const offset = Math.max(0, options.offset ?? 0);
    const filters = this.materializeFilters(report, options.filters ?? {});
    const documents = await this.listAllReadableDocuments(actor, report.doctype);
    const filtered = documents.filter((document) => matchesReportFilters(document, report, filters));
    const groups = buildReportGroups(filtered, report.groups ?? []);
    const rows = filtered.slice(offset, offset + limit).map((document) => reportRow(document, report.columns));
    return {
      report,
      columns: report.columns,
      summary: buildReportSummary(filtered, report.summaries ?? []),
      groups,
      charts: buildReportCharts(groups, report.charts ?? []),
      rows,
      limit,
      offset,
      total: filtered.length
    };
  }

  private canAccess(actor: Actor, report: ReportDefinition): boolean {
    const doctype = this.registry.get(report.doctype);
    return canReadReport(actor, report) && can(actor, doctype, report.permissionAction ?? "read");
  }

  private async listAllReadableDocuments(actor: Actor, doctype: string): Promise<readonly DocumentSnapshot[]> {
    const pageSize = 200;
    const documents: DocumentSnapshot[] = [];
    let offset = 0;
    while (true) {
      const page = await this.queries.listDocuments(actor, doctype, { limit: pageSize, offset });
      documents.push(...page.data);
      const scanned = offset + page.limit;
      if (scanned >= page.total) {
        return documents;
      }
      offset = scanned;
    }
  }

  private materializeFilters(report: ReportDefinition, input: ReportFilters): ReportFilters {
    const values: Record<string, JsonPrimitive | undefined> = {};
    for (const filter of report.filters ?? []) {
      const raw = input[filter.name] ?? filter.defaultValue;
      const value = coerceFilterValue(raw, filter.type);
      if (filter.required && (value === undefined || value === "")) {
        throw badRequest(`Report filter '${filter.name}' is required`);
      }
      values[filter.name] = value;
    }
    return values;
  }
}

function matchesReportFilters(document: DocumentSnapshot, report: ReportDefinition, filters: ReportFilters): boolean {
  return (report.filters ?? []).every((filter) => {
    const expected = filters[filter.name];
    if (expected === undefined || expected === "") {
      return true;
    }
    const actual = document.data[filter.field];
    switch (filter.operator ?? "eq") {
      case "eq":
        return actual === expected;
      case "contains":
        return String(actual ?? "").toLowerCase().includes(String(expected).toLowerCase());
      case "gte":
        return compareValues(actual, expected) >= 0;
      case "lte":
        return compareValues(actual, expected) <= 0;
    }
  });
}

function reportRow(document: DocumentSnapshot, columns: readonly ReportColumnDefinition[]): ReportRow {
  return Object.fromEntries(
    columns.map((column) => [column.name, document.data[column.field ?? column.name] ?? null])
  ) as ReportRow;
}

function buildReportSummary(
  documents: readonly DocumentSnapshot[],
  summaries: readonly ReportSummaryDefinition[]
): readonly ReportSummaryValue[] {
  return summaries.map((summary) => summaryValue(summary, documents));
}

function buildReportGroups(
  documents: readonly DocumentSnapshot[],
  groups: readonly ReportGroupDefinition[]
): readonly ReportGroupResult[] {
  return groups.map((group) => {
    const buckets = new Map<string, { readonly key: JsonPrimitive; readonly documents: DocumentSnapshot[] }>();
    for (const document of documents) {
      const key = primitiveValue(document, group.field) ?? null;
      const bucketKey = JSON.stringify(key);
      const existing = buckets.get(bucketKey);
      if (existing) {
        existing.documents.push(document);
      } else {
        buckets.set(bucketKey, { key, documents: [document] });
      }
    }
    const rows = [...buckets.values()]
      .sort((left, right) => compareValues(left.key, right.key))
      .map((bucket) => ({
        key: bucket.key,
        label: groupLabel(bucket.key),
        summaries: buildReportSummary(bucket.documents, group.summaries)
      }));
    return {
      name: group.name,
      label: group.label ?? group.name,
      field: group.field,
      rows
    };
  });
}

function buildReportCharts(
  groups: readonly ReportGroupResult[],
  charts: readonly ReportChartDefinition[]
): readonly ReportChartResult[] {
  return charts.map((chart) => {
    const group = groups.find((item) => item.name === chart.group);
    const points = (group?.rows ?? [])
      .map((row) => {
        const summary = row.summaries.find((item) => item.name === chart.summary);
        return {
          key: row.key,
          label: row.label,
          value: typeof summary?.value === "number" ? summary.value : null
        };
      })
      .slice(0, chart.maxPoints ?? Number.POSITIVE_INFINITY);
    return {
      name: chart.name,
      label: chart.label ?? chart.name,
      type: chart.type,
      group: chart.group,
      summary: chart.summary,
      points
    };
  });
}

function summaryValue(
  summary: ReportSummaryDefinition,
  documents: readonly DocumentSnapshot[]
): ReportSummaryValue {
  return {
    name: summary.name,
    label: summary.label ?? summary.name,
    aggregate: summary.aggregate,
    value: aggregateValue(summary, documents),
    ...(summary.field ? { field: summary.field } : {}),
    ...(summary.type ? { type: summary.type } : summary.aggregate === "count" ? { type: "integer" } : {}),
    ...(summary.indicator ? { indicator: summary.indicator } : {})
  };
}

function aggregateValue(summary: ReportSummaryDefinition, documents: readonly DocumentSnapshot[]): JsonPrimitive {
  const field = summary.field;
  switch (summary.aggregate) {
    case "count":
      return field
        ? documents.filter((document) => isPresentValue(document.data[field])).length
        : documents.length;
    case "sum":
      return numericValues(documents, requiredSummaryField(summary)).reduce((total, value) => total + value, 0);
    case "avg": {
      const values = numericValues(documents, requiredSummaryField(summary));
      return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
    }
    case "min":
      return minMaxValue(documents, requiredSummaryField(summary), "min");
    case "max":
      return minMaxValue(documents, requiredSummaryField(summary), "max");
  }
}

function requiredSummaryField(summary: ReportSummaryDefinition): string {
  if (!summary.field) {
    throw badRequest(`Report summary '${summary.name}' requires a field for ${summary.aggregate}`);
  }
  return summary.field;
}

function numericValues(documents: readonly DocumentSnapshot[], field: string): readonly number[] {
  return documents
    .map((document) => primitiveValue(document, field))
    .filter((value): value is number => typeof value === "number");
}

function minMaxValue(
  documents: readonly DocumentSnapshot[],
  field: string,
  direction: "min" | "max"
): JsonPrimitive {
  const values = documents
    .map((document) => primitiveValue(document, field))
    .filter((value): value is Exclude<JsonPrimitive, null> => value !== undefined && value !== null);
  if (values.length === 0) {
    return null;
  }
  return values.slice(1).reduce((selected, value) => {
    const comparison = compareValues(value, selected);
    return direction === "min"
      ? comparison < 0 ? value : selected
      : comparison > 0 ? value : selected;
  }, values[0]!);
}

function primitiveValue(document: DocumentSnapshot, field: string): JsonPrimitive | undefined {
  const value = document.data[field];
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function isPresentValue(value: JsonValue | undefined): boolean {
  return value !== undefined && value !== null;
}

function groupLabel(value: JsonPrimitive): string {
  return value === null ? "(empty)" : String(value);
}

function coerceFilterValue(value: JsonPrimitive | undefined, type?: FieldType): JsonPrimitive | undefined {
  if (value === undefined || value === null || typeof value !== "string") {
    return value;
  }
  if (type === "integer") {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : value;
  }
  if (type === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (type === "boolean") {
    if (value === "true" || value === "1" || value === "on") {
      return true;
    }
    if (value === "false" || value === "0" || value === "off") {
      return false;
    }
  }
  return value;
}

function compareValues(actual: JsonValue | undefined, expected: JsonPrimitive): number {
  if (typeof actual === "number" && typeof expected === "number") {
    return actual - expected;
  }
  return String(actual ?? "").localeCompare(String(expected));
}

function clampLimit(limit?: number): number {
  if (limit === undefined) {
    return 50;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest("limit must be a positive integer");
  }
  return Math.min(limit, 200);
}
