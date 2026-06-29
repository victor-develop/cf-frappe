import { badRequest, permissionDenied } from "../core/errors.js";
import { can } from "../core/permissions.js";
import {
  assertReportDefinition,
  assertReportFilterExpressionBounds,
  assertReportMatchesDocType,
  canReadReport,
  isCustomReport,
  type ReportColumnDefinition,
  type ReportDefinition,
  type ReportFilterDefinition,
  type ReportFilterExpression,
  type ReportFilterOperator,
  type ReportFilterValue,
  type ReportOrder,
  type ReportSummaryDefinition,
  isReportFilterGroup
} from "../core/reports.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Actor, DocTypeDefinition, DocumentSnapshot, FieldDefinition, FieldType, JsonPrimitive, JsonValue } from "../core/types.js";
import { QueryService } from "./query-service.js";
import { CSV_CONTENT_TYPE, csvLine, filenamePart } from "./csv.js";
import {
  buildReportFilterControls,
  buildReportCharts,
  buildReportGroups,
  limitReportGroups,
  projectReportDocumentRow,
  projectReportRow,
  resolveReportOrder,
  resolvedReportFilterType,
  reportSummaryValue,
  reportSortValue,
  type ReportChartResult,
  type ReportFilterControlResult,
  type ReportFilters,
  type ReportGroupResult,
  type ReportOrderControlResult,
  type ReportRow,
  type ReportSummaryValue
} from "./report-policy.js";

export type {
  ReportChartResult,
  ReportChartDrilldown,
  ReportChartPoint,
  ReportFilterControlResult,
  ReportFilters,
  ReportGroupResult,
  ReportGroupRow,
  ReportOrderControlResult,
  ReportOrderOptionResult,
  ReportRow,
  ReportSummaryValue
} from "./report-policy.js";

const DEFAULT_CSV_EXPORT_LIMIT = 10_000;

export interface ReportRunOptions {
  readonly filters?: ReportFilters;
  readonly filterExpression?: ReportFilterExpression;
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

export interface ReportCsvExportOptions extends Pick<ReportRunOptions, "filters" | "filterExpression"> {
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

export interface ReportRowProviderContext {
  readonly actor: Actor;
  readonly report: ReportDefinition;
  readonly filters: ReportFilters;
  readonly filterExpression?: ReportFilterExpression;
}

export interface ReportRowProvider {
  rows(context: ReportRowProviderContext): Promise<readonly ReportRow[]>;
}

export interface ReportServiceOptions {
  readonly registry: ModelRegistry;
  readonly queries: QueryService;
  readonly rowProviders?: Readonly<Record<string, ReportRowProvider>>;
}

export class ReportService {
  private readonly registry: ModelRegistry;
  private readonly queries: QueryService;
  private readonly rowProviders: Readonly<Record<string, ReportRowProvider>>;

  constructor(options: ReportServiceOptions) {
    this.registry = options.registry;
    this.queries = options.queries;
    this.rowProviders = options.rowProviders ?? {};
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
    if (isCustomReport(report)) {
      return this.runCustomReportDefinition(actor, report, doctype, options);
    }
    const limit = clampLimit(options.limit);
    const offset = Math.max(0, options.offset ?? 0);
    const filterExpression = this.materializeFilterExpression(
      report,
      doctype,
      combinedReportFilterExpression(report.filterExpression, options.filterExpression)
    );
    const filters = this.materializeFilters(report, doctype, options.filters ?? {}, filterExpression);
    const order = resolveReportOrder(report, doctype, options);
    const filtered = await this.filteredDocuments(actor, report, filters, filterExpression);
    const sorted = sortReportDocuments(filtered, report, order);
    const aggregateRows = filtered.map((document) => document.data as ReportRow);
    const groups = buildReportGroups(aggregateRows, report.groups ?? []);
    const limitedGroups = limitReportGroups(groups, report.groups ?? []);
    const rows = sorted.slice(offset, offset + limit).map((document) => projectReportDocumentRow(document, report.columns));
    return {
      report,
      columns: report.columns,
      filters: buildReportFilterControls(report, doctype, filters),
      order,
      summary: buildReportSummary(aggregateRows, report.summaries ?? []),
      groups: limitedGroups,
      charts: buildReportCharts(groups, report.charts ?? [], report.filters ?? []),
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
    if (isCustomReport(report)) {
      return this.exportCustomReportCsv(actor, report, doctype, options);
    }
    const limit = clampCsvExportLimit(options.limit);
    const filterExpression = this.materializeFilterExpression(
      report,
      doctype,
      combinedReportFilterExpression(report.filterExpression, options.filterExpression)
    );
    const filters = this.materializeFilters(report, doctype, options.filters ?? {}, filterExpression);
    const order = resolveReportOrder(report, doctype, options);
    if (order.orderBy === undefined) {
      return this.exportUnorderedReportCsv(actor, report, filters, filterExpression, limit);
    }
    const rows = new BoundedOrderedReportRows(report, order, limit);
    let total = 0;
    await this.scanReadableDocuments(actor, report.doctype, (document) => {
      if (!matchesReportFilters(document, report, filters, filterExpression)) {
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
      filename: `${filenamePart(report.name, "report")}.csv`,
      contentType: CSV_CONTENT_TYPE,
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
    filterExpression: ReportFilterExpression | undefined,
    limit: number
  ): Promise<ReportCsvExport> {
    const lines = [reportCsvHeader(report.columns)];
    let total = 0;
    let exported = 0;
    await this.scanReadableDocuments(actor, report.doctype, (document) => {
      if (!matchesReportFilters(document, report, filters, filterExpression)) {
        return;
      }
      total += 1;
      if (exported >= limit) {
        return;
      }
      lines.push(reportRowToCsv(report.columns, projectReportDocumentRow(document, report.columns)));
      exported += 1;
    });
    return {
      filename: `${filenamePart(report.name, "report")}.csv`,
      contentType: CSV_CONTENT_TYPE,
      body: lines.join("\n"),
      exported,
      total,
      truncated: exported < total,
      limit
    };
  }

  private async runCustomReportDefinition(
    actor: Actor,
    report: ReportDefinition,
    doctype: DocTypeDefinition,
    options: ReportRunOptions
  ): Promise<ReportRunResult> {
    const limit = clampLimit(options.limit);
    const offset = Math.max(0, options.offset ?? 0);
    const filterExpression = this.materializeFilterExpression(
      report,
      doctype,
      combinedReportFilterExpression(report.filterExpression, options.filterExpression)
    );
    const filters = this.materializeFilters(report, doctype, options.filters ?? {}, filterExpression);
    const order = resolveReportOrder(report, doctype, options);
    const rows = await this.customReportRows(actor, report, filters, filterExpression);
    const filtered = rows.filter((row) => matchesReportRowFilters(row, report, filters, filterExpression));
    const projected = filtered.map((row) => projectReportRow(row, report.columns));
    const sorted = sortReportRows(projected, report, order);
    const groups = buildReportGroups(filtered, report.groups ?? []);
    const limitedGroups = limitReportGroups(groups, report.groups ?? []);
    return {
      report,
      columns: report.columns,
      filters: buildReportFilterControls(report, doctype, filters),
      order,
      summary: buildReportSummary(filtered, report.summaries ?? []),
      groups: limitedGroups,
      charts: buildReportCharts(groups, report.charts ?? [], report.filters ?? []),
      rows: sorted.slice(offset, offset + limit),
      limit,
      offset,
      total: filtered.length
    };
  }

  private async exportCustomReportCsv(
    actor: Actor,
    report: ReportDefinition,
    doctype: DocTypeDefinition,
    options: ReportCsvExportOptions
  ): Promise<ReportCsvExport> {
    const limit = clampCsvExportLimit(options.limit);
    const filterExpression = this.materializeFilterExpression(
      report,
      doctype,
      combinedReportFilterExpression(report.filterExpression, options.filterExpression)
    );
    const filters = this.materializeFilters(report, doctype, options.filters ?? {}, filterExpression);
    const order = resolveReportOrder(report, doctype, options);
    const rows = await this.customReportRows(actor, report, filters, filterExpression);
    const projected = rows
      .filter((row) => matchesReportRowFilters(row, report, filters, filterExpression))
      .map((row) => projectReportRow(row, report.columns));
    const sorted = sortReportRows(projected, report, order);
    const exportedRows = sorted.slice(0, limit);
    return {
      filename: `${filenamePart(report.name, "report")}.csv`,
      contentType: CSV_CONTENT_TYPE,
      body: [reportCsvHeader(report.columns), ...exportedRows.map((row) => reportRowToCsv(report.columns, row))].join("\n"),
      exported: exportedRows.length,
      total: sorted.length,
      truncated: exportedRows.length < sorted.length,
      limit
    };
  }

  private async customReportRows(
    actor: Actor,
    report: ReportDefinition,
    filters: ReportFilters,
    filterExpression: ReportFilterExpression | undefined
  ): Promise<readonly ReportRow[]> {
    const providerName = report.source?.kind === "custom" ? report.source.provider : undefined;
    const provider = providerName === undefined ? undefined : this.rowProviders[providerName];
    if (!provider || providerName === undefined) {
      throw badRequest(`Custom report provider '${providerName ?? report.name}' is not configured`);
    }
    return provider.rows({
      actor,
      report,
      filters,
      ...(filterExpression === undefined ? {} : { filterExpression })
    });
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
    assertReportDefinition(report);
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
    input: ReportFilters,
    filterExpression: ReportFilterExpression | undefined
  ): Promise<readonly DocumentSnapshot[]> {
    const documents = await this.listAllReadableDocuments(actor, report.doctype);
    return documents.filter((document) => matchesReportFilters(document, report, input, filterExpression));
  }

  private materializeFilters(
    report: ReportDefinition,
    doctype: DocTypeDefinition,
    input: ReportFilters,
    filterExpression: ReportFilterExpression | undefined
  ): ReportFilters {
    const fields = new Map(doctype.fields.map((field) => [field.name, field]));
    const values: Record<string, ReportFilterValue | undefined> = {};
    for (const filter of report.filters ?? []) {
      const type = resolvedReportFilterType(filter, fields.get(filter.field));
      const raw = input[filter.name] ?? filter.defaultValue;
      const value = coerceFilterValue(raw, type, filter.name, filter.operator ?? "eq");
      if (filter.required && (value === undefined || value === "") && !reportFilterExpressionHasValue(filterExpression, filter.name)) {
        throw badRequest(`Report filter '${filter.name}' is required`);
      }
      values[filter.name] = value;
    }
    return values;
  }

  private materializeFilterExpression(
    report: ReportDefinition,
    doctype: DocTypeDefinition,
    expression: ReportFilterExpression | undefined
  ): ReportFilterExpression | undefined {
    if (expression === undefined) {
      return undefined;
    }
    assertReportFilterExpressionBounds(expression);
    const fields = new Map(doctype.fields.map((field) => [field.name, field]));
    const filters = new Map((report.filters ?? []).map((filter) => [filter.name, filter]));
    return materializeReportFilterExpressionNode(report, filters, fields, expression);
  }
}

interface OrderedReportRow {
  readonly row: ReportRow;
  readonly sortValue: JsonValue | undefined;
  readonly index: number;
}

class BoundedOrderedReportRows {
  private readonly columnName: string;
  private readonly direction: 1 | -1;
  private readonly heap: OrderedReportRow[] = [];
  private readonly limit: number;
  private readonly report: ReportDefinition;

  constructor(report: ReportDefinition, order: ReportOrderControlResult, limit: number) {
    const column = report.columns.find((item) => item.name === order.orderBy);
    this.columnName = column?.name ?? "";
    this.direction = order.order === "desc" ? -1 : 1;
    this.limit = limit;
    this.report = report;
  }

  add(document: DocumentSnapshot, index: number): void {
    const entry: OrderedReportRow = {
      row: projectReportDocumentRow(document, this.report.columns),
      sortValue: reportSortValue(document, this.report.columns, this.columnName),
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
      if (!isWorseOrderedRow(
        requireHeapEntry(this.heap, child, "child"),
        requireHeapEntry(this.heap, parent, "parent"),
        this.direction
      )) {
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
      if (
        left < this.heap.length &&
        isWorseOrderedRow(requireHeapEntry(this.heap, left, "left"), requireHeapEntry(this.heap, worst, "worst"), this.direction)
      ) {
        worst = left;
      }
      if (
        right < this.heap.length &&
        isWorseOrderedRow(requireHeapEntry(this.heap, right, "right"), requireHeapEntry(this.heap, worst, "worst"), this.direction)
      ) {
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
    const value = requireHeapEntry(this.heap, left, "left");
    this.heap[left] = requireHeapEntry(this.heap, right, "right");
    this.heap[right] = value;
  }
}

function requireHeapEntry(
  heap: readonly OrderedReportRow[],
  index: number,
  label: string
): OrderedReportRow {
  const entry = heap[index];
  if (entry === undefined) {
    throw new Error(`Report ordered-row heap is missing ${label} entry at index ${index}`);
  }
  return entry;
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
  const columnName = column?.name;
  if (!columnName) {
    return documents;
  }
  const direction = order.order === "desc" ? -1 : 1;
  return documents
    .map((document, index) => ({ document, index }))
    .sort((left, right) => {
      const compared = compareDocumentValues(
        reportSortValue(left.document, report.columns, columnName),
        reportSortValue(right.document, report.columns, columnName)
      );
      return compared === 0 ? left.index - right.index : compared * direction;
    })
    .map((item) => item.document);
}

function sortReportRows(
  rows: readonly ReportRow[],
  report: ReportDefinition,
  order: ReportOrderControlResult
): readonly ReportRow[] {
  if (order.orderBy === undefined) {
    return rows;
  }
  const column = report.columns.find((item) => item.name === order.orderBy);
  const columnName = column?.name;
  if (!columnName) {
    return rows;
  }
  const direction = order.order === "desc" ? -1 : 1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const compared = compareDocumentValues(left.row[columnName], right.row[columnName]);
      return compared === 0 ? left.index - right.index : compared * direction;
    })
    .map((item) => item.row);
}

function isWorseOrderedRow(left: OrderedReportRow, right: OrderedReportRow, direction: 1 | -1): boolean {
  return compareOrderedRows(left, right, direction) > 0;
}

function compareOrderedRows(left: OrderedReportRow, right: OrderedReportRow, direction: 1 | -1): number {
  const compared = compareDocumentValues(left.sortValue, right.sortValue) * direction;
  return compared === 0 ? left.index - right.index : compared;
}

function combinedReportFilterExpression(
  left: ReportFilterExpression | undefined,
  right: ReportFilterExpression | undefined
): ReportFilterExpression | undefined {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return {
    kind: "group",
    match: "all",
    filters: [
      ...(isReportFilterGroup(left) && left.match === "all" ? left.filters : [left]),
      ...(isReportFilterGroup(right) && right.match === "all" ? right.filters : [right])
    ]
  };
}

function materializeReportFilterExpressionNode(
  report: ReportDefinition,
  filters: ReadonlyMap<string, ReportFilterDefinition>,
  fields: ReadonlyMap<string, FieldDefinition>,
  expression: ReportFilterExpression
): ReportFilterExpression {
  if (isReportFilterGroup(expression)) {
    return {
      kind: "group",
      match: expression.match,
      filters: expression.filters.map((filter) =>
        materializeReportFilterExpressionNode(report, filters, fields, filter)
      )
    };
  }
  const filter = filters.get(expression.filter);
  if (filter === undefined) {
    throw badRequest(`Report filter expression references unknown filter '${expression.filter}'`);
  }
  const type = resolvedReportFilterType(filter, fields.get(filter.field));
  const value = coerceFilterValue(expression.value, type, filter.name, filter.operator ?? "eq");
  if (isEmptyReportFilterValue(value)) {
    throw badRequest(`Report filter expression filter '${filter.name}' is missing a value`);
  }
  return { filter: filter.name, value };
}

function reportFilterExpressionHasValue(
  expression: ReportFilterExpression | undefined,
  filterName: string
): boolean {
  if (expression === undefined) {
    return false;
  }
  if (isReportFilterGroup(expression)) {
    return expression.filters.some((filter) => reportFilterExpressionHasValue(filter, filterName));
  }
  return expression.filter === filterName && !isEmptyReportFilterValue(expression.value);
}

function matchesReportFilters(
  document: DocumentSnapshot,
  report: ReportDefinition,
  filters: ReportFilters,
  expression: ReportFilterExpression | undefined
): boolean {
  return (report.filters ?? []).every((filter) => {
    const expected = filters[filter.name];
    if (isEmptyReportFilterValue(expected)) {
      return true;
    }
    return matchesReportFilterValue(document.data, filter, expected);
  }) && matchesReportFilterExpression(document.data, report, expression);
}

function matchesReportRowFilters(
  row: ReportRow,
  report: ReportDefinition,
  filters: ReportFilters,
  expression: ReportFilterExpression | undefined
): boolean {
  return (report.filters ?? []).every((filter) => {
    const expected = filters[filter.name];
    if (isEmptyReportFilterValue(expected)) {
      return true;
    }
    return matchesReportFilterValue(row, filter, expected);
  }) && matchesReportFilterExpression(row, report, expression);
}

function matchesReportFilterExpression(
  row: Readonly<Record<string, JsonValue | undefined>>,
  report: ReportDefinition,
  expression: ReportFilterExpression | undefined
): boolean {
  if (expression === undefined) {
    return true;
  }
  if (isReportFilterGroup(expression)) {
    return expression.match === "all"
      ? expression.filters.every((filter) => matchesReportFilterExpression(row, report, filter))
      : expression.filters.some((filter) => matchesReportFilterExpression(row, report, filter));
  }
  const filter = (report.filters ?? []).find((item) => item.name === expression.filter);
  return filter === undefined ? false : matchesReportFilterValue(row, filter, expression.value);
}

function matchesReportFilterValue(
  row: Readonly<Record<string, JsonValue | undefined>>,
  filter: ReportFilterDefinition,
  expected: ReportFilterValue
): boolean {
  const actual = row[filter.field];
  switch (filter.operator ?? "eq") {
    case "eq":
      return actual === expected;
    case "ne":
      return actual !== expected;
    case "contains":
      return String(actual ?? "").toLowerCase().includes(String(expected).toLowerCase());
    case "gte":
      return compareValues(actual, scalarReportFilterValue(expected)) >= 0;
    case "lte":
      return compareValues(actual, scalarReportFilterValue(expected)) <= 0;
    case "between": {
      if (actual === undefined || actual === null) {
        return false;
      }
      const [minimum, maximum] = rangeFilterValues(expected);
      return compareValues(actual, minimum) >= 0 && compareValues(actual, maximum) <= 0;
    }
    case "not_between": {
      if (actual === undefined || actual === null) {
        return false;
      }
      const [minimum, maximum] = rangeFilterValues(expected);
      return compareValues(actual, minimum) < 0 || compareValues(actual, maximum) > 0;
    }
  }
}

function reportCsvHeader(columns: readonly ReportColumnDefinition[]): string {
  return csvLine(columns.map((column) => column.label ?? column.name));
}

function reportRowToCsv(columns: readonly ReportColumnDefinition[], row: ReportRow): string {
  return csvLine(columns.map((column) => row[column.name]));
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
  rows: readonly ReportRow[],
  summaries: readonly ReportSummaryDefinition[]
): readonly ReportSummaryValue[] {
  return summaries.map((summary) => reportSummaryValue(summary, rows));
}

function coerceFilterValue(
  value: ReportFilterValue | undefined,
  type: FieldType | undefined,
  filterName: string,
  operator: ReportFilterOperator
): ReportFilterValue | undefined {
  if (value === undefined || value === null || value === "") {
    return value;
  }
  if (operator === "between" || operator === "not_between") {
    if (!isReportFilterArray(value) || value.length !== 2) {
      throw badRequest(`Report filter '${filterName}' must include exactly two values for ${operator}`);
    }
    const minimum = value[0];
    const maximum = value[1];
    if (minimum === undefined || maximum === undefined) {
      throw badRequest(`Report filter '${filterName}' must include exactly two values for ${operator}`);
    }
    return [
      coerceRangeFilterEndpoint(minimum, type, filterName),
      coerceRangeFilterEndpoint(maximum, type, filterName)
    ];
  }
  if (Array.isArray(value)) {
    throw badRequest(`Report filter '${filterName}' must be scalar`);
  }
  const scalar = scalarReportFilterValue(value);
  if (type === "integer") {
    const parsed = numericFilterValue(scalar, filterName, "an integer");
    if (!Number.isInteger(parsed)) {
      throw badRequest(`Report filter '${filterName}' must be an integer`);
    }
    return parsed;
  }
  if (type === "number") {
    return numericFilterValue(scalar, filterName, "a number");
  }
  if (type === "boolean") {
    if (typeof scalar === "boolean") {
      return scalar;
    }
    if (scalar === "true" || scalar === "1" || scalar === "on") {
      return true;
    }
    if (scalar === "false" || scalar === "0" || scalar === "off") {
      return false;
    }
    throw badRequest(`Report filter '${filterName}' must be a boolean`);
  }
  return typeof scalar === "string" ? scalar : String(scalar);
}

function coerceRangeFilterEndpoint(
  value: JsonPrimitive,
  type: FieldType | undefined,
  filterName: string
): JsonPrimitive {
  if (value === null) {
    throw badRequest(`Report filter '${filterName}' range values cannot be null`);
  }
  if (typeof value === "string" && value.trim() === "") {
    throw badRequest(`Report filter '${filterName}' range values cannot be empty`);
  }
  if (type === "date" || type === "datetime") {
    if (typeof value !== "string") {
      throw badRequest(`Report filter '${filterName}' range values must be strings`);
    }
    return value;
  }
  if (typeof value === "boolean") {
    throw badRequest(`Report filter '${filterName}' range values cannot be boolean`);
  }
  return coerceFilterValue(value, type, filterName, "eq") as JsonPrimitive;
}

function numericFilterValue(value: JsonPrimitive, filterName: string, expectedType: "an integer" | "a number"): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) {
    throw badRequest(`Report filter '${filterName}' must be ${expectedType}`);
  }
  return parsed;
}

function isEmptyReportFilterValue(value: ReportFilterValue | undefined): value is undefined | null | "" {
  return value === undefined || value === null || value === "";
}

function rangeFilterValues(value: ReportFilterValue): readonly [JsonPrimitive, JsonPrimitive] {
  if (!isReportFilterArray(value) || value.length !== 2) {
    throw badRequest("Report range filter must include exactly two values");
  }
  const minimum = value[0];
  const maximum = value[1];
  if (minimum === undefined || maximum === undefined) {
    throw badRequest("Report range filter must include exactly two values");
  }
  return [minimum, maximum];
}

function scalarReportFilterValue(value: ReportFilterValue): JsonPrimitive {
  if (isReportFilterArray(value)) {
    throw badRequest("Report filter must be scalar");
  }
  return value;
}

function isReportFilterArray(value: ReportFilterValue): value is readonly JsonPrimitive[] {
  return Array.isArray(value);
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
