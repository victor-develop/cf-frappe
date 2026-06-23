import { badRequest, permissionDenied } from "../core/errors.js";
import { can } from "../core/permissions.js";
import {
  assertReportMatchesDocType,
  canReadReport,
  type ReportColumnDefinition,
  type ReportChartDefinition,
  type ReportChartOrder,
  type ReportChartOrderBy,
  type ReportChartType,
  type ReportDefinition,
  type ReportFilterDefinition,
  type ReportFilterOperator,
  type ReportGroupDefinition,
  type ReportOrder,
  type ReportSummaryAggregate,
  type ReportSummaryDefinition
} from "../core/reports.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Actor, DocTypeDefinition, DocumentSnapshot, FieldDefinition, FieldType, JsonPrimitive, JsonValue } from "../core/types.js";
import { QueryService } from "./query-service.js";

export type ReportFilters = Readonly<Record<string, JsonPrimitive | undefined>>;
export type ReportRow = Readonly<Record<string, JsonValue>>;

const DEFAULT_CSV_EXPORT_LIMIT = 10_000;
const EMPTY_CHART_COLORS: readonly string[] = Object.freeze([]);

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
  readonly orderBy: ReportChartOrderBy;
  readonly order: ReportChartOrder;
  readonly colors: readonly string[];
  readonly showValues: boolean;
  readonly xAxisLabel?: string;
  readonly yAxisLabel?: string;
  readonly points: readonly ReportChartPoint[];
}

export interface ReportFilterControlResult {
  readonly name: string;
  readonly label: string;
  readonly field: string;
  readonly type?: FieldType;
  readonly operator: ReportFilterOperator;
  readonly required: boolean;
  readonly value?: JsonPrimitive;
  readonly options: readonly string[];
}

export interface ReportOrderOptionResult {
  readonly name: string;
  readonly label: string;
}

export interface ReportOrderControlResult {
  readonly orderBy?: string;
  readonly order: ReportOrder;
  readonly options: readonly ReportOrderOptionResult[];
}

export interface ReportRunOptions {
  readonly filters?: ReportFilters;
  readonly limit?: number;
  readonly offset?: number;
  readonly orderBy?: string;
  readonly order?: ReportOrder;
}

export interface ReportRunResult {
  readonly report: ReportDefinition;
  readonly columns: readonly ReportColumnDefinition[];
  readonly filters: readonly ReportFilterControlResult[];
  readonly order: ReportOrderControlResult;
  readonly summary: readonly ReportSummaryValue[];
  readonly groups: readonly ReportGroupResult[];
  readonly charts: readonly ReportChartResult[];
  readonly rows: readonly ReportRow[];
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
}

export interface ReportCsvExportOptions extends Pick<ReportRunOptions, "filters"> {
  readonly limit?: number;
  readonly orderBy?: string;
  readonly order?: ReportOrder;
}

export interface ReportCsvExport {
  readonly filename: string;
  readonly contentType: "text/csv; charset=utf-8";
  readonly body: string;
  readonly exported: number;
  readonly total: number;
  readonly truncated: boolean;
  readonly limit: number;
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
    this.readableReport(actor, report);
    return report;
  }

  async runReport(actor: Actor, reportName: string, options: ReportRunOptions = {}): Promise<ReportRunResult> {
    const report = this.getReport(actor, reportName);
    return this.runReportDefinition(actor, report, options);
  }

  async runReportDefinition(
    actor: Actor,
    report: ReportDefinition,
    options: ReportRunOptions = {}
  ): Promise<ReportRunResult> {
    const doctype = this.readableReport(actor, report);
    const limit = clampLimit(options.limit);
    const offset = Math.max(0, options.offset ?? 0);
    const filters = this.materializeFilters(report, doctype, options.filters ?? {});
    const order = resolveReportOrder(report, doctype, options);
    const filtered = await this.filteredDocuments(actor, report, filters);
    const sorted = sortReportDocuments(filtered, report, order);
    const groups = buildReportGroups(filtered, report.groups ?? []);
    const rows = sorted.slice(offset, offset + limit).map((document) => reportRow(document, report.columns));
    return {
      report,
      columns: report.columns,
      filters: buildReportFilterControls(report, doctype, filters),
      order,
      summary: buildReportSummary(filtered, report.summaries ?? []),
      groups: limitReportGroups(groups, report.groups ?? []),
      charts: buildReportCharts(groups, report.charts ?? []),
      rows,
      limit,
      offset,
      total: filtered.length
    };
  }

  async exportReportCsv(
    actor: Actor,
    reportName: string,
    options: ReportCsvExportOptions = {}
  ): Promise<ReportCsvExport> {
    const report = this.getReport(actor, reportName);
    return this.exportReportDefinitionCsv(actor, report, options);
  }

  async exportReportDefinitionCsv(
    actor: Actor,
    report: ReportDefinition,
    options: ReportCsvExportOptions = {}
  ): Promise<ReportCsvExport> {
    const doctype = this.readableReport(actor, report);
    const limit = clampCsvExportLimit(options.limit);
    const filters = this.materializeFilters(report, doctype, options.filters ?? {});
    const order = resolveReportOrder(report, doctype, options);
    if (order.orderBy === undefined) {
      return this.exportUnorderedReportCsv(actor, report, filters, limit);
    }
    const rows = new BoundedOrderedReportRows(report, order, limit);
    let total = 0;
    await this.scanReadableDocuments(actor, report.doctype, (document) => {
      if (!matchesReportFilters(document, report, filters)) {
        return;
      }
      rows.add(document, total);
      total += 1;
    });
    const lines = [
      reportCsvHeader(report.columns),
      ...rows.toRows().map((row) => reportRowToCsv(report.columns, row))
    ];
    const exported = Math.min(total, limit);
    return {
      filename: `${filenamePart(report.name)}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: lines.join("\n"),
      exported,
      total,
      truncated: exported < total,
      limit
    };
  }

  private async exportUnorderedReportCsv(
    actor: Actor,
    report: ReportDefinition,
    filters: ReportFilters,
    limit: number
  ): Promise<ReportCsvExport> {
    const lines = [reportCsvHeader(report.columns)];
    let total = 0;
    let exported = 0;
    await this.scanReadableDocuments(actor, report.doctype, (document) => {
      if (!matchesReportFilters(document, report, filters)) {
        return;
      }
      total += 1;
      if (exported >= limit) {
        return;
      }
      lines.push(reportRowToCsv(report.columns, reportRow(document, report.columns)));
      exported += 1;
    });
    return {
      filename: `${filenamePart(report.name)}.csv`,
      contentType: "text/csv; charset=utf-8",
      body: lines.join("\n"),
      exported,
      total,
      truncated: exported < total,
      limit
    };
  }

  private canAccess(actor: Actor, report: ReportDefinition): boolean {
    const doctype = this.registry.get(report.doctype);
    return canReadReport(actor, report) && can(actor, doctype, report.permissionAction ?? "read");
  }

  private readableReport(actor: Actor, report: ReportDefinition): DocTypeDefinition {
    const doctype = this.registry.get(report.doctype);
    if (!canReadReport(actor, report) || !can(actor, doctype, report.permissionAction ?? "read")) {
      throw permissionDenied(`Actor '${actor.id}' cannot read report '${report.name}'`);
    }
    assertReportMatchesDocType(report, doctype);
    return doctype;
  }

  private async listAllReadableDocuments(actor: Actor, doctype: string): Promise<readonly DocumentSnapshot[]> {
    const documents: DocumentSnapshot[] = [];
    await this.scanReadableDocuments(actor, doctype, (document) => {
      documents.push(document);
    });
    return documents;
  }

  private async scanReadableDocuments(
    actor: Actor,
    doctype: string,
    visit: (document: DocumentSnapshot) => void
  ): Promise<void> {
    const pageSize = 200;
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.queries.listDocuments(actor, doctype, { limit: pageSize, offset });
      for (const document of page.data) {
        visit(document);
      }
      if (offset + page.limit >= page.total) {
        return;
      }
    }
  }

  private async filteredDocuments(
    actor: Actor,
    report: ReportDefinition,
    input: ReportFilters
  ): Promise<readonly DocumentSnapshot[]> {
    const documents = await this.listAllReadableDocuments(actor, report.doctype);
    return documents.filter((document) => matchesReportFilters(document, report, input));
  }

  private materializeFilters(report: ReportDefinition, doctype: DocTypeDefinition, input: ReportFilters): ReportFilters {
    const fields = new Map(doctype.fields.map((field) => [field.name, field]));
    const values: Record<string, JsonPrimitive | undefined> = {};
    for (const filter of report.filters ?? []) {
      const type = resolvedReportFilterType(filter, fields.get(filter.field));
      const raw = input[filter.name] ?? filter.defaultValue;
      const value = coerceFilterValue(raw, type, filter.name);
      if (filter.required && (value === undefined || value === "")) {
        throw badRequest(`Report filter '${filter.name}' is required`);
      }
      values[filter.name] = value;
    }
    return values;
  }
}

function buildReportFilterControls(
  report: ReportDefinition,
  doctype: DocTypeDefinition,
  filters: ReportFilters
): readonly ReportFilterControlResult[] {
  const fields = new Map(doctype.fields.map((field) => [field.name, field]));
  return (report.filters ?? []).map((filter) => {
    const field = fields.get(filter.field);
    const type = resolvedReportFilterType(filter, field);
    const value = filters[filter.name];
    return {
      name: filter.name,
      label: filter.label ?? filter.name,
      field: filter.field,
      ...(type ? { type } : {}),
      operator: filter.operator ?? "eq",
      required: filter.required ?? false,
      ...(value === undefined ? {} : { value }),
      options: type === "select" ? field?.options ?? [] : []
    };
  });
}

function buildReportOrderOptions(report: ReportDefinition, doctype: DocTypeDefinition): readonly ReportOrderOptionResult[] {
  const fields = new Map(doctype.fields.map((field) => [field.name, field]));
  return report.columns
    .filter((column) => {
      const field = fields.get(column.field ?? column.name);
      return field?.type !== "json" && field?.type !== "table";
    })
    .map((column) => ({
      name: column.name,
      label: column.label ?? column.name
    }));
}

function resolveReportOrder(
  report: ReportDefinition,
  doctype: DocTypeDefinition,
  options: Pick<ReportRunOptions, "orderBy" | "order">
): ReportOrderControlResult {
  const orderOptions = buildReportOrderOptions(report, doctype);
  const orderBy = options.orderBy ?? report.orderBy;
  const order = options.order ?? report.order ?? "asc";
  if (order !== "asc" && order !== "desc") {
    throw badRequest("Report order must be asc or desc");
  }
  if (orderBy !== undefined && !orderOptions.some((option) => option.name === orderBy)) {
    throw badRequest(`Report orderBy '${orderBy}' is not a sortable report column`);
  }
  return {
    ...(orderBy === undefined ? {} : { orderBy }),
    order,
    options: orderOptions
  };
}

function resolvedReportFilterType(filter: ReportFilterDefinition, field: FieldDefinition | undefined): FieldType | undefined {
  return filter.type ?? field?.type;
}

interface OrderedReportRow {
  readonly row: ReportRow;
  readonly sortValue: JsonValue | undefined;
  readonly index: number;
}

class BoundedOrderedReportRows {
  private readonly direction: 1 | -1;
  private readonly field: string;
  private readonly heap: OrderedReportRow[] = [];
  private readonly limit: number;
  private readonly report: ReportDefinition;

  constructor(report: ReportDefinition, order: ReportOrderControlResult, limit: number) {
    const column = report.columns.find((item) => item.name === order.orderBy);
    this.field = column?.field ?? column?.name ?? "";
    this.direction = order.order === "desc" ? -1 : 1;
    this.limit = limit;
    this.report = report;
  }

  add(document: DocumentSnapshot, index: number): void {
    const entry: OrderedReportRow = {
      row: reportRow(document, this.report.columns),
      sortValue: document.data[this.field],
      index
    };
    if (this.heap.length < this.limit) {
      this.heap.push(entry);
      this.siftUp(this.heap.length - 1);
      return;
    }
    const worst = this.heap[0];
    if (worst && compareOrderedRows(entry, worst, this.direction) < 0) {
      this.heap[0] = entry;
      this.siftDown(0);
    }
  }

  toRows(): readonly ReportRow[] {
    return this.heap
      .slice()
      .sort((left, right) => compareOrderedRows(left, right, this.direction))
      .map((entry) => entry.row);
  }

  private siftUp(index: number): void {
    let child = index;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      if (!isWorseOrderedRow(this.heap[child]!, this.heap[parent]!, this.direction)) {
        return;
      }
      this.swap(child, parent);
      child = parent;
    }
  }

  private siftDown(index: number): void {
    let parent = index;
    while (true) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let worst = parent;
      if (left < this.heap.length && isWorseOrderedRow(this.heap[left]!, this.heap[worst]!, this.direction)) {
        worst = left;
      }
      if (right < this.heap.length && isWorseOrderedRow(this.heap[right]!, this.heap[worst]!, this.direction)) {
        worst = right;
      }
      if (worst === parent) {
        return;
      }
      this.swap(parent, worst);
      parent = worst;
    }
  }

  private swap(left: number, right: number): void {
    const value = this.heap[left]!;
    this.heap[left] = this.heap[right]!;
    this.heap[right] = value;
  }
}

function sortReportDocuments(
  documents: readonly DocumentSnapshot[],
  report: ReportDefinition,
  order: ReportOrderControlResult
): readonly DocumentSnapshot[] {
  if (order.orderBy === undefined) {
    return documents;
  }
  const column = report.columns.find((item) => item.name === order.orderBy);
  const field = column?.field ?? column?.name;
  if (!field) {
    return documents;
  }
  const direction = order.order === "desc" ? -1 : 1;
  return documents
    .map((document, index) => ({ document, index }))
    .sort((left, right) => {
      const compared = compareDocumentValues(left.document.data[field], right.document.data[field]);
      return compared === 0 ? left.index - right.index : compared * direction;
    })
    .map((item) => item.document);
}

function isWorseOrderedRow(left: OrderedReportRow, right: OrderedReportRow, direction: 1 | -1): boolean {
  return compareOrderedRows(left, right, direction) > 0;
}

function compareOrderedRows(left: OrderedReportRow, right: OrderedReportRow, direction: 1 | -1): number {
  const compared = compareDocumentValues(left.sortValue, right.sortValue) * direction;
  return compared === 0 ? left.index - right.index : compared;
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

function reportCsvHeader(columns: readonly ReportColumnDefinition[]): string {
  return columns.map((column) => csvCell(column.label ?? column.name)).join(",");
}

function reportRowToCsv(columns: readonly ReportColumnDefinition[], row: ReportRow): string {
  return columns.map((column) => csvCell(row[column.name])).join(",");
}

function csvCell(value: JsonValue | undefined): string {
  const text = typeof value === "string"
    ? neutralizeSpreadsheetFormula(csvValue(value))
    : csvValue(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function csvValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function filenamePart(value: string): string {
  return value.trim().replaceAll(/[^A-Za-z0-9._-]+/g, "-").replaceAll(/^-+|-+$/g, "") || "report";
}

function neutralizeSpreadsheetFormula(text: string): string {
  return /^(?:[=+\-@\t\r]|\s+[=+\-@])/u.test(text) ? `'${text}` : text;
}

function clampCsvExportLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_CSV_EXPORT_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest("CSV export limit must be a positive integer");
  }
  return Math.min(limit, DEFAULT_CSV_EXPORT_LIMIT);
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

function limitReportGroups(
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

function buildReportCharts(
  groups: readonly ReportGroupResult[],
  charts: readonly ReportChartDefinition[]
): readonly ReportChartResult[] {
  return charts.map((chart) => {
    const group = groups.find((item) => item.name === chart.group);
    const orderBy = chart.orderBy ?? "key";
    const order = chart.order ?? "asc";
    const points = sortChartPoints(
      (group?.rows ?? []).map((row) => {
        const summary = row.summaries.find((item) => item.name === chart.summary);
        return {
          key: row.key,
          label: row.label,
          value: typeof summary?.value === "number" ? summary.value : null
        };
      }),
      orderBy,
      order
    )
      .slice(0, chart.maxPoints ?? Number.POSITIVE_INFINITY);
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

function sortChartPoints(
  points: readonly ReportChartPoint[],
  orderBy: ReportChartOrderBy,
  order: ReportChartOrder
): readonly ReportChartPoint[] {
  const direction = order === "desc" ? -1 : 1;
  return [...points].sort((left, right) => {
    const comparison = compareChartPoints(left, right, orderBy, direction);
    return comparison === 0
      ? compareValues(left.label, right.label) || compareValues(left.key, right.key)
      : comparison;
  });
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
    return compareValues(left.label, right.label) * direction;
  }
  return compareValues(left.key, right.key) * direction;
}

function compareChartValues(left: number | null, right: number | null, direction: number): number {
  if (left === null || right === null) {
    if (left === right) {
      return 0;
    }
    return left === null ? 1 : -1;
  }
  return compareValues(left, right) * direction;
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

function coerceFilterValue(value: JsonPrimitive | undefined, type: FieldType | undefined, filterName: string): JsonPrimitive | undefined {
  if (value === undefined || value === null || value === "") {
    return value;
  }
  if (type === "integer") {
    const parsed = numericFilterValue(value, filterName, "an integer");
    if (!Number.isInteger(parsed)) {
      throw badRequest(`Report filter '${filterName}' must be an integer`);
    }
    return parsed;
  }
  if (type === "number") {
    return numericFilterValue(value, filterName, "a number");
  }
  if (type === "boolean") {
    if (typeof value === "boolean") {
      return value;
    }
    if (value === "true" || value === "1" || value === "on") {
      return true;
    }
    if (value === "false" || value === "0" || value === "off") {
      return false;
    }
    throw badRequest(`Report filter '${filterName}' must be a boolean`);
  }
  return typeof value === "string" ? value : String(value);
}

function numericFilterValue(value: JsonPrimitive, filterName: string, expectedType: "an integer" | "a number"): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) {
    throw badRequest(`Report filter '${filterName}' must be ${expectedType}`);
  }
  return parsed;
}

function compareValues(actual: JsonValue | undefined, expected: JsonPrimitive): number {
  if (typeof actual === "number" && typeof expected === "number") {
    return actual - expected;
  }
  return String(actual ?? "").localeCompare(String(expected));
}

function compareDocumentValues(left: JsonValue | undefined, right: JsonValue | undefined): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left ?? "").localeCompare(String(right ?? ""));
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
