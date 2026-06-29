import { badRequest } from "../core/errors.js";
import { csvLine } from "./csv.js";
import type {
  ReportChartDefinition,
  ReportChartOrder,
  ReportChartOrderBy,
  ReportChartType,
  ReportColumnDefinition,
  ReportFilterDefinition,
  ReportFilterOperator,
  ReportFilterValue,
  ReportFormulaOperand,
  ReportGroupDefinition,
  ReportOrder,
  ReportDefinition,
  ReportFilterExpression,
  ReportSummaryDefinition
} from "../core/reports.js";
import { assertReportFilterExpressionBounds, isCustomReport, isReportFilterGroup } from "../core/reports.js";
import type { DocTypeDefinition, DocumentSnapshot, FieldDefinition, FieldType, JsonPrimitive, JsonValue } from "../core/types.js";

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

export type ReportFilters = Readonly<Record<string, ReportFilterValue | undefined>>;

export interface ReportFilterControlResult {
  readonly name: string;
  readonly label: string;
  readonly field: string;
  readonly type?: FieldType;
  readonly operator: ReportFilterOperator;
  readonly required: boolean;
  readonly value?: ReportFilterValue;
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

export interface ReportOrderInput {
  readonly orderBy?: string;
  readonly order?: ReportOrder;
}

const EMPTY_CHART_COLORS: readonly string[] = Object.freeze([]);
const DEFAULT_CSV_EXPORT_LIMIT = 10_000;

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

export function buildReportSummary(
  rows: readonly ReportRow[],
  summaries: readonly ReportSummaryDefinition[]
): readonly ReportSummaryValue[] {
  return summaries.map((summary) => reportSummaryValue(summary, rows));
}

export function reportCsvHeader(columns: readonly ReportColumnDefinition[]): string {
  return csvLine(columns.map((column) => column.label ?? column.name));
}

export function reportRowToCsv(columns: readonly ReportColumnDefinition[], row: ReportRow): string {
  return csvLine(columns.map((column) => row[column.name]));
}

export function clampReportCsvExportLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_CSV_EXPORT_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest("CSV export limit must be a positive integer");
  }
  return Math.min(limit, DEFAULT_CSV_EXPORT_LIMIT);
}

export function clampReportRunLimit(limit?: number): number {
  if (limit === undefined) {
    return 50;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest("limit must be a positive integer");
  }
  return Math.min(limit, 200);
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

export function projectReportDocumentRow(
  document: DocumentSnapshot,
  columns: readonly ReportColumnDefinition[]
): ReportRow {
  return Object.fromEntries(
    columns.map((column) => [column.name, reportDocumentColumnValue(document, column)])
  ) as ReportRow;
}

export function projectReportRow(row: ReportRow, columns: readonly ReportColumnDefinition[]): ReportRow {
  return Object.fromEntries(
    columns.map((column) => [column.name, reportRowColumnValue(row, column)])
  ) as ReportRow;
}

export function reportDocumentColumnValue(document: DocumentSnapshot, column: ReportColumnDefinition): JsonValue {
  if (column.formula !== undefined) {
    return reportDocumentFormulaValue(document, column.formula);
  }
  return document.data[column.field ?? column.name] ?? null;
}

export function reportRowColumnValue(row: ReportRow, column: ReportColumnDefinition): JsonValue {
  if (column.formula !== undefined) {
    return reportRowFormulaValue(row, column.formula);
  }
  return row[column.field ?? column.name] ?? null;
}

export function reportSortValue(
  document: DocumentSnapshot,
  columns: readonly ReportColumnDefinition[],
  columnName: string
): JsonValue | undefined {
  const column = columns.find((item) => item.name === columnName);
  return column === undefined ? undefined : reportDocumentColumnValue(document, column);
}

interface OrderedReportRow {
  readonly row: ReportRow;
  readonly sortValue: JsonValue | undefined;
  readonly index: number;
}

export class BoundedOrderedReportRows {
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
        requireOrderedRowHeapEntry(this.heap, child, "child"),
        requireOrderedRowHeapEntry(this.heap, parent, "parent"),
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
        isWorseOrderedRow(
          requireOrderedRowHeapEntry(this.heap, left, "left"),
          requireOrderedRowHeapEntry(this.heap, worst, "worst"),
          this.direction
        )
      ) {
        worst = left;
      }
      if (
        right < this.heap.length &&
        isWorseOrderedRow(
          requireOrderedRowHeapEntry(this.heap, right, "right"),
          requireOrderedRowHeapEntry(this.heap, worst, "worst"),
          this.direction
        )
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
    const value = requireOrderedRowHeapEntry(this.heap, left, "left");
    this.heap[left] = requireOrderedRowHeapEntry(this.heap, right, "right");
    this.heap[right] = value;
  }
}

export function sortReportDocuments(
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
      const compared = compareReportSortValues(
        reportSortValue(left.document, report.columns, columnName),
        reportSortValue(right.document, report.columns, columnName)
      );
      return compared === 0 ? left.index - right.index : compared * direction;
    })
    .map((item) => item.document);
}

export function sortReportRows(
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
      const compared = compareReportSortValues(left.row[columnName], right.row[columnName]);
      return compared === 0 ? left.index - right.index : compared * direction;
    })
    .map((item) => item.row);
}

export function buildReportFilterControls(
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
      options: filter.options ?? (type === "select" ? field?.options ?? [] : [])
    };
  });
}

export function buildReportOrderOptions(
  report: ReportDefinition,
  doctype: DocTypeDefinition
): readonly ReportOrderOptionResult[] {
  if (isCustomReport(report)) {
    return report.columns
      .filter((column) => column.type !== "json" && column.type !== "table")
      .map((column) => ({
        name: column.name,
        label: column.label ?? column.name
      }));
  }
  const fields = new Map(doctype.fields.map((field) => [field.name, field]));
  return report.columns
    .filter((column) => {
      if (column.formula !== undefined) {
        return true;
      }
      const field = fields.get(column.field ?? column.name);
      return field?.type !== "json" && field?.type !== "table";
    })
    .map((column) => ({
      name: column.name,
      label: column.label ?? column.name
    }));
}

export function resolveReportOrder(
  report: ReportDefinition,
  doctype: DocTypeDefinition,
  options: ReportOrderInput
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

export function resolvedReportFilterType(
  filter: ReportFilterDefinition,
  field: FieldDefinition | undefined
): FieldType | undefined {
  return filter.type ?? field?.type;
}

export function coerceReportFilterValue(
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

export function isEmptyReportFilterValue(value: ReportFilterValue | undefined): value is undefined | null | "" {
  return value === undefined || value === null || value === "";
}

export function combineReportFilterExpression(
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

export function materializeReportFilters(
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
    const value = coerceReportFilterValue(raw, type, filter.name, filter.operator ?? "eq");
    if (filter.required && (value === undefined || value === "") && !reportFilterExpressionHasValue(filterExpression, filter.name)) {
      throw badRequest(`Report filter '${filter.name}' is required`);
    }
    values[filter.name] = value;
  }
  return values;
}

export function materializeReportFilterExpression(
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
  return materializeReportFilterExpressionNode(filters, fields, expression);
}

export function matchesReportFilters(
  document: DocumentSnapshot,
  report: ReportDefinition,
  filters: ReportFilters,
  expression: ReportFilterExpression | undefined
): boolean {
  return matchesReportRowFilters(document.data, report, filters, expression);
}

export function matchesReportRowFilters(
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

function materializeReportFilterExpressionNode(
  filters: ReadonlyMap<string, ReportFilterDefinition>,
  fields: ReadonlyMap<string, FieldDefinition>,
  expression: ReportFilterExpression
): ReportFilterExpression {
  if (isReportFilterGroup(expression)) {
    return {
      kind: "group",
      match: expression.match,
      filters: expression.filters.map((filter) =>
        materializeReportFilterExpressionNode(filters, fields, filter)
      )
    };
  }
  const filter = filters.get(expression.filter);
  if (filter === undefined) {
    throw badRequest(`Report filter expression references unknown filter '${expression.filter}'`);
  }
  const type = resolvedReportFilterType(filter, fields.get(filter.field));
  const value = coerceReportFilterValue(expression.value, type, filter.name, filter.operator ?? "eq");
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
      return compareReportValues(actual, scalarReportFilterValue(expected)) >= 0;
    case "lte":
      return compareReportValues(actual, scalarReportFilterValue(expected)) <= 0;
    case "between": {
      if (actual === undefined || actual === null) {
        return false;
      }
      const [minimum, maximum] = rangeFilterValues(expected);
      return compareReportValues(actual, minimum) >= 0 && compareReportValues(actual, maximum) <= 0;
    }
    case "not_between": {
      if (actual === undefined || actual === null) {
        return false;
      }
      const [minimum, maximum] = rangeFilterValues(expected);
      return compareReportValues(actual, minimum) < 0 || compareReportValues(actual, maximum) > 0;
    }
  }
}

function reportDocumentFormulaValue(
  document: DocumentSnapshot,
  formula: NonNullable<ReportColumnDefinition["formula"]>
): number | null {
  const left = numericDocumentFormulaOperand(document, formula.left);
  const right = numericDocumentFormulaOperand(document, formula.right);
  return reportFormulaOperationValue(formula.operator, left, right);
}

function reportRowFormulaValue(
  row: ReportRow,
  formula: NonNullable<ReportColumnDefinition["formula"]>
): number | null {
  const left = numericRowFormulaOperand(row, formula.left);
  const right = numericRowFormulaOperand(row, formula.right);
  return reportFormulaOperationValue(formula.operator, left, right);
}

function numericDocumentFormulaOperand(document: DocumentSnapshot, operand: ReportFormulaOperand): number | null {
  if (typeof operand === "number") {
    return operand;
  }
  if (typeof operand === "object") {
    return reportDocumentFormulaValue(document, operand);
  }
  const value = document.data[operand];
  return typeof value === "number" ? value : null;
}

function numericRowFormulaOperand(row: ReportRow, operand: ReportFormulaOperand): number | null {
  if (typeof operand === "number") {
    return operand;
  }
  if (typeof operand === "object") {
    return reportRowFormulaValue(row, operand);
  }
  const value = row[operand];
  return typeof value === "number" ? value : null;
}

function reportFormulaOperationValue(
  operator: NonNullable<ReportColumnDefinition["formula"]>["operator"],
  left: number | null,
  right: number | null
): number | null {
  if (left === null || right === null) {
    return null;
  }
  switch (operator) {
    case "add":
      return left + right;
    case "subtract":
      return left - right;
    case "multiply":
      return left * right;
    case "divide":
      return right === 0 ? null : left / right;
  }
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
  return coerceReportFilterValue(value, type, filterName, "eq") as JsonPrimitive;
}

function numericFilterValue(value: JsonPrimitive, filterName: string, expectedType: "an integer" | "a number"): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) {
    throw badRequest(`Report filter '${filterName}' must be ${expectedType}`);
  }
  return parsed;
}

function scalarReportFilterValue(value: ReportFilterValue): JsonPrimitive {
  if (isReportFilterArray(value)) {
    throw badRequest("Report filter must be scalar");
  }
  return value;
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

function isReportFilterArray(value: ReportFilterValue): value is readonly JsonPrimitive[] {
  return Array.isArray(value);
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

function requireOrderedRowHeapEntry(
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

function isWorseOrderedRow(left: OrderedReportRow, right: OrderedReportRow, direction: 1 | -1): boolean {
  return compareOrderedRows(left, right, direction) > 0;
}

function compareOrderedRows(left: OrderedReportRow, right: OrderedReportRow, direction: 1 | -1): number {
  const compared = compareReportSortValues(left.sortValue, right.sortValue) * direction;
  return compared === 0 ? left.index - right.index : compared;
}

function compareReportSortValues(left: JsonValue | undefined, right: JsonValue | undefined): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left ?? "").localeCompare(String(right ?? ""));
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
