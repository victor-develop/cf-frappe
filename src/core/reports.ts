import { FrameworkError, type FrameworkErrorCode } from "./errors.js";
import type { Actor, DocTypeDefinition, FieldDefinition, FieldType, JsonPrimitive, PermissionAction } from "./types.js";
import { SYSTEM_MANAGER_ROLE } from "./types.js";

export type ReportFilterOperator = "eq" | "ne" | "contains" | "gte" | "lte" | "between" | "not_between";
export type ReportFilterValue = JsonPrimitive | readonly JsonPrimitive[];
export type ReportSummaryAggregate = "count" | "sum" | "avg" | "min" | "max";
export type ReportChartType = "bar" | "line" | "pie";
export type ReportChartOrderBy = "key" | "label" | "value";
export type ReportOrder = "asc" | "desc";
export type ReportChartOrder = ReportOrder;
export type ReportFormulaOperator = "add" | "subtract" | "multiply" | "divide";
export type ReportFormulaOperand = string | number | ReportFormulaDefinition;
export type ReportFilterGroupMatch = "all" | "any";
export type ReportFilterExpression = ReportFilterPredicate | ReportFilterGroup;
export type ReportSourceDefinition =
  | { readonly kind: "documents" }
  | { readonly kind: "custom"; readonly provider: string };

const REPORT_FILTER_OPERATORS = ["eq", "ne", "contains", "gte", "lte", "between", "not_between"] as const;
const REPORT_FILTER_TYPES = ["text", "longText", "integer", "number", "boolean", "date", "datetime", "select", "link"] as const;
const REPORT_FIELD_TYPES = ["text", "longText", "integer", "number", "boolean", "date", "datetime", "json", "select", "link", "table"] as const;
const REPORT_ORDERS = ["asc", "desc"] as const;
const REPORT_SUMMARY_AGGREGATES = ["count", "sum", "avg", "min", "max"] as const;
const REPORT_FORMULA_OPERATORS = ["add", "subtract", "multiply", "divide"] as const;
const REPORT_FILTER_GROUP_MATCHES = ["all", "any"] as const;
const REPORT_CHART_COLOR_PATTERN = /^#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?$/;
const REPORT_FILTER_EXPRESSION_RESERVED_FILTER_NAME = "expression";
export const REPORT_FORMULA_MAX_DEPTH = 16;
export const REPORT_FILTER_EXPRESSION_MAX_DEPTH = 5;
export const REPORT_FILTER_EXPRESSION_MAX_NODES = 64;

export interface ReportFilterPredicate {
  readonly filter: string;
  readonly value: ReportFilterValue;
}

export interface ReportFilterGroup {
  readonly kind: "group";
  readonly match: ReportFilterGroupMatch;
  readonly filters: readonly ReportFilterExpression[];
}

export interface ReportFormulaDefinition {
  readonly operator: ReportFormulaOperator;
  readonly left: ReportFormulaOperand;
  readonly right: ReportFormulaOperand;
}

export interface ReportColumnDefinition {
  readonly name: string;
  readonly label?: string;
  readonly field?: string;
  readonly type?: FieldType;
  readonly formula?: ReportFormulaDefinition;
}

export interface ReportFilterDefinition {
  readonly name: string;
  readonly label?: string;
  readonly field: string;
  readonly type?: FieldType;
  readonly operator?: ReportFilterOperator;
  readonly required?: boolean;
  readonly defaultValue?: ReportFilterValue;
  readonly options?: readonly string[];
}

export interface ReportSummaryDefinition {
  readonly name: string;
  readonly label?: string;
  readonly aggregate: ReportSummaryAggregate;
  readonly field?: string;
  readonly type?: FieldType;
  readonly indicator?: string;
}

export interface ReportGroupDefinition {
  readonly name: string;
  readonly label?: string;
  readonly field: string;
  readonly summaries: readonly ReportSummaryDefinition[];
  readonly maxRows?: number;
}

export interface ReportChartDefinition {
  readonly name: string;
  readonly label?: string;
  readonly type: ReportChartType;
  readonly group: string;
  readonly summary: string;
  readonly maxPoints?: number;
  readonly orderBy?: ReportChartOrderBy;
  readonly order?: ReportChartOrder;
  readonly colors?: readonly string[];
  readonly showValues?: boolean;
  readonly xAxisLabel?: string;
  readonly yAxisLabel?: string;
}

export interface ReportDefinition {
  readonly name: string;
  readonly label?: string;
  readonly module?: string;
  readonly description?: string;
  readonly doctype: string;
  readonly source?: ReportSourceDefinition;
  readonly columns: readonly ReportColumnDefinition[];
  readonly filters?: readonly ReportFilterDefinition[];
  readonly filterExpression?: ReportFilterExpression;
  readonly summaries?: readonly ReportSummaryDefinition[];
  readonly groups?: readonly ReportGroupDefinition[];
  readonly charts?: readonly ReportChartDefinition[];
  readonly orderBy?: string;
  readonly order?: ReportOrder;
  readonly roles?: readonly string[];
  readonly permissionAction?: PermissionAction;
}

export function defineReport(definition: ReportDefinition): ReportDefinition {
  assertReportDefinition(definition);
  const filters = definition.filters
    ? Object.freeze(
        definition.filters.map((filter) =>
          Object.freeze({
            ...filter,
            ...(Array.isArray(filter.defaultValue)
              ? { defaultValue: Object.freeze([...filter.defaultValue]) }
              : {}),
            ...(filter.options ? { options: Object.freeze([...filter.options]) } : {})
          })
        )
      )
    : undefined;
  const filterExpression = definition.filterExpression === undefined
    ? undefined
    : freezeReportFilterExpression(definition.filterExpression);
  const columns = Object.freeze(
    definition.columns.map((column) =>
      Object.freeze({
        ...column,
        ...(column.formula === undefined ? {} : { formula: freezeReportFormula(column.formula) })
      })
    )
  );
  const summaries = definition.summaries ? Object.freeze([...definition.summaries]) : undefined;
  const groups = definition.groups
    ? Object.freeze(
        definition.groups.map((group) =>
          Object.freeze({
            ...group,
            summaries: Object.freeze([...group.summaries])
          })
        )
      )
    : undefined;
  const charts = definition.charts
    ? Object.freeze(
        definition.charts.map((chart) =>
          Object.freeze({
            ...chart,
            ...(chart.colors ? { colors: Object.freeze([...chart.colors]) } : {})
          })
        )
      )
    : undefined;
  return Object.freeze({
    ...definition,
    ...(definition.source ? { source: Object.freeze({ ...definition.source }) } : {}),
    columns,
    ...(filters ? { filters } : {}),
    ...(filterExpression === undefined ? {} : { filterExpression }),
    ...(summaries ? { summaries } : {}),
    ...(groups ? { groups } : {}),
    ...(charts ? { charts } : {})
  });
}

export function assertReportDefinition(definition: ReportDefinition): void {
  assertIdentifier(definition.name, "report name");
  assertReportSourceValid(definition);
  if (definition.columns.length === 0) {
    throw new FrameworkError("REPORT_INVALID", `Report '${definition.name}' must define at least one column`, {
      status: 400
    });
  }
  assertUnique(definition.columns.map((column) => column.name), "column", definition.name);
  assertUnique((definition.filters ?? []).map((filter) => filter.name), "filter", definition.name);
  assertUnique((definition.summaries ?? []).map((summary) => summary.name), "summary", definition.name);
  assertUnique((definition.groups ?? []).map((group) => group.name), "group", definition.name);
  assertUnique((definition.charts ?? []).map((chart) => chart.name), "chart", definition.name);
  for (const group of definition.groups ?? []) {
    if (group.summaries.length === 0) {
      throw new FrameworkError("REPORT_INVALID", `Report '${definition.name}' group '${group.name}' must define at least one summary`, {
        status: 400
      });
    }
    if (group.maxRows !== undefined && (!Number.isInteger(group.maxRows) || group.maxRows < 1)) {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${definition.name}' group '${group.name}' maxRows must be a positive integer`,
        { status: 400 }
      );
    }
    assertUnique(group.summaries.map((summary) => summary.name), `summary on group '${group.name}'`, definition.name);
  }
  assertFiltersValid(definition);
  assertFilterExpressionSyntax(definition);
  assertSummariesValid(definition);
  assertFormulaColumnsValid(definition);
  assertDisplayTypesValid(definition);
  assertReportOrderValid(definition);
  assertChartsReferenceGroups(definition);
}

export function canReadReport(actor: Actor, report: ReportDefinition): boolean {
  if (actor.roles.includes(SYSTEM_MANAGER_ROLE)) {
    return true;
  }
  return report.roles === undefined || report.roles.some((role) => actor.roles.includes(role));
}

export function isReportFilterGroup(expression: ReportFilterExpression): expression is ReportFilterGroup {
  return "kind" in expression && expression.kind === "group";
}

export function assertReportFilterExpressionBounds(
  expression: ReportFilterExpression | undefined,
  label = "Report filter expression",
  options: ReportFilterExpressionValidationOptions = {}
): void {
  if (expression === undefined) {
    return;
  }
  const maxDepth = options.maxDepth ?? REPORT_FILTER_EXPRESSION_MAX_DEPTH;
  const maxNodes = options.maxNodes ?? REPORT_FILTER_EXPRESSION_MAX_NODES;
  assertFilterExpressionSyntaxNode(expression, {
    budget: { remaining: maxNodes },
    depth: 1,
    errorCode: options.errorCode ?? "BAD_REQUEST",
    label,
    maxDepth,
    maxNodes
  });
}

export function assertReportFilterValues(
  report: ReportDefinition,
  doctype: DocTypeDefinition,
  filters: Readonly<Record<string, unknown>>,
  options: {
    readonly context?: string;
    readonly code?: FrameworkErrorCode;
  } = {}
): void {
  const code = options.code ?? "REPORT_INVALID";
  const context = options.context ?? `Report '${report.name}' filters`;
  const filtersByName = new Map((report.filters ?? []).map((filter) => [filter.name, filter]));
  const fieldsByName = new Map(doctype.fields.map((field) => [field.name, field]));

  for (const filterName of Object.keys(filters)) {
    if (!filtersByName.has(filterName)) {
      throw new FrameworkError(
        code,
        `${context} references unknown filter '${filterName}' on report '${report.name}'`,
        { status: 400 }
      );
    }
  }

  for (const filter of report.filters ?? []) {
    const value = Object.prototype.hasOwnProperty.call(filters, filter.name)
      ? filters[filter.name]
      : filter.defaultValue;
    const type = filter.type ?? fieldsByName.get(filter.field)?.type;
    if (filter.required && (value === undefined || value === null || value === "")) {
      throw new FrameworkError(
        code,
        `${context} is missing required filter '${filter.name}' on report '${report.name}'`,
        { status: 400 }
      );
    }
    assertReportFilterValue(report, filter, value, type, context, code);
  }
}

function assertReportFilterValue(
  report: ReportDefinition,
  filter: ReportFilterDefinition,
  value: unknown,
  type: FieldType | undefined,
  context: string,
  code: FrameworkErrorCode
): void {
  const operator = filter.operator ?? "eq";
  const filterName = filter.name;
  if (value === undefined || value === null || value === "") {
    return;
  }
  if (operator === "between" || operator === "not_between") {
    if (!Array.isArray(value) || value.length !== 2) {
      throw new FrameworkError(
        code,
        `${context} filter '${filterName}' on report '${report.name}' must include exactly two values for ${operator}`,
        { status: 400 }
      );
    }
    for (const endpoint of value) {
      assertReportRangeEndpoint(report, filterName, endpoint, type, context, code);
    }
    return;
  }
  if (!isJsonPrimitive(value)) {
    throw new FrameworkError(
      code,
      `${context} filter '${filterName}' on report '${report.name}' must be a JSON primitive`,
      { status: 400 }
    );
  }
  if (type === "integer") {
    const parsed = numericReportFilterValue(value);
    if (!Number.isInteger(parsed)) {
      throw new FrameworkError(
        code,
        `${context} filter '${filterName}' on report '${report.name}' must be an integer`,
        { status: 400 }
      );
    }
    return;
  }
  if (type === "number") {
    if (!Number.isFinite(numericReportFilterValue(value))) {
      throw new FrameworkError(
        code,
        `${context} filter '${filterName}' on report '${report.name}' must be a number`,
        { status: 400 }
      );
    }
    return;
  }
  if (type === "boolean" && !isBooleanReportFilterValue(value)) {
    throw new FrameworkError(
      code,
      `${context} filter '${filterName}' on report '${report.name}' must be a boolean`,
      { status: 400 }
    );
  }
}

function assertReportRangeEndpoint(
  report: ReportDefinition,
  filterName: string,
  value: unknown,
  type: FieldType | undefined,
  context: string,
  code: FrameworkErrorCode
): void {
  if (value === undefined || value === null) {
    throw new FrameworkError(
      code,
      `${context} filter '${filterName}' on report '${report.name}' range values cannot be null`,
      { status: 400 }
    );
  }
  if (typeof value === "string" && value.trim() === "") {
    throw new FrameworkError(
      code,
      `${context} filter '${filterName}' on report '${report.name}' range values cannot be empty`,
      { status: 400 }
    );
  }
  if (!isJsonPrimitive(value)) {
    throw new FrameworkError(
      code,
      `${context} filter '${filterName}' on report '${report.name}' range values must be JSON primitives`,
      { status: 400 }
    );
  }
  if (type === "date" || type === "datetime") {
    if (typeof value !== "string") {
      throw new FrameworkError(
        code,
        `${context} filter '${filterName}' on report '${report.name}' range values must be strings`,
        { status: 400 }
      );
    }
    return;
  }
  if (typeof value === "boolean") {
    throw new FrameworkError(
      code,
      `${context} filter '${filterName}' on report '${report.name}' range values cannot be boolean`,
      { status: 400 }
    );
  }
  assertReportFilterValue(report, { name: filterName, field: filterName }, value, type, context, code);
}

function numericReportFilterValue(value: JsonPrimitive): number {
  return typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
}

function isBooleanReportFilterValue(value: JsonPrimitive): boolean {
  return (
    typeof value === "boolean" ||
    value === "true" ||
    value === "1" ||
    value === "on" ||
    value === "false" ||
    value === "0" ||
    value === "off"
  );
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isReportFilterValue(value: unknown): value is ReportFilterValue {
  return isJsonPrimitive(value) || (Array.isArray(value) && value.every(isJsonPrimitive));
}

export function isReportChartColor(value: string): boolean {
  return REPORT_CHART_COLOR_PATTERN.test(value);
}

export function assertReportMatchesDocType(report: ReportDefinition, doctype: DocTypeDefinition): void {
  const fields = new Map(doctype.fields.map((field) => [field.name, field]));
  if (isCustomReport(report)) {
    assertCustomReportReferences(report, fields);
    assertFilterExpressionMatchesReport(report, fields);
    return;
  }
  for (const column of report.columns) {
    const formula = column.formula;
    if (formula !== undefined) {
      assertFormulaMatchesDocType(report.name, { ...column, formula }, fields);
      continue;
    }
    const field = column.field ?? column.name;
    if (!fields.has(field)) {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${report.name}' column '${column.name}' references unknown field '${field}'`,
        { status: 400 }
      );
    }
  }
  assertReportOrderMatchesDocType(report, fields);
  for (const filter of report.filters ?? []) {
    const field = fields.get(filter.field);
    if (!field) {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${report.name}' filter '${filter.name}' references unknown field '${filter.field}'`,
        { status: 400 }
      );
    }
    if (field.type === "json" || field.type === "table") {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${report.name}' filter '${filter.name}' cannot filter by ${field.type} field '${filter.field}'`,
        { status: 400 }
      );
    }
    assertReportFilterOperatorMatchesType(report, filter, field.type);
  }
  assertFilterExpressionMatchesReport(report, fields);
  for (const summary of report.summaries ?? []) {
    assertSummaryMatchesDocType(report.name, summary, fields);
  }
  for (const group of report.groups ?? []) {
    const groupField = fields.get(group.field);
    if (!groupField) {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${report.name}' group '${group.name}' references unknown field '${group.field}'`,
        { status: 400 }
      );
    }
    if (groupField.type === "json" || groupField.type === "table") {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${report.name}' group '${group.name}' cannot group by ${groupField.type} field '${group.field}'`,
        { status: 400 }
      );
    }
    for (const summary of group.summaries) {
      assertSummaryMatchesDocType(report.name, summary, fields, ` on group '${group.name}'`);
    }
  }
}

export function isCustomReport(report: ReportDefinition): boolean {
  return report.source?.kind === "custom";
}

function assertCustomReportReferences(
  report: ReportDefinition,
  fields: ReadonlyMap<string, FieldDefinition>
): void {
  for (const filter of report.filters ?? []) {
    const field = fields.get(filter.field);
    if (field?.type === "json" || field?.type === "table") {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${report.name}' filter '${filter.name}' cannot filter by ${field.type} field '${filter.field}'`,
        { status: 400 }
      );
    }
    if (!field && filter.type === undefined) {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${report.name}' custom filter '${filter.name}' must declare a type when field '${filter.field}' is not on DocType '${report.doctype}'`,
        { status: 400 }
      );
    }
    assertReportFilterOperatorMatchesType(report, filter, filter.type ?? field?.type);
  }
}

function assertFilterExpressionMatchesReport(
  report: ReportDefinition,
  fields: ReadonlyMap<string, FieldDefinition>
): void {
  const expression = report.filterExpression;
  if (expression === undefined) {
    return;
  }
  const filters = new Map((report.filters ?? []).map((filter) => [filter.name, filter]));
  assertFilterExpressionNodeMatchesReport(report, filters, fields, expression);
}

function assertFilterExpressionNodeMatchesReport(
  report: ReportDefinition,
  filters: ReadonlyMap<string, ReportFilterDefinition>,
  fields: ReadonlyMap<string, FieldDefinition>,
  expression: ReportFilterExpression
): void {
  if (isReportFilterGroup(expression)) {
    for (const child of expression.filters) {
      assertFilterExpressionNodeMatchesReport(report, filters, fields, child);
    }
    return;
  }
  const filter = filters.get(expression.filter);
  if (filter === undefined) {
    throw new FrameworkError(
      "REPORT_INVALID",
      `Report '${report.name}' filter expression references unknown filter '${expression.filter}'`,
      { status: 400 }
    );
  }
  assertReportFilterValue(
    report,
    filter,
    expression.value,
    filter.type ?? fields.get(filter.field)?.type,
    `Report '${report.name}' filter expression`,
    "REPORT_INVALID"
  );
}

function assertReportFilterOperatorMatchesType(
  report: ReportDefinition,
  filter: ReportFilterDefinition,
  type: FieldType | undefined
): void {
  const operator = filter.operator ?? "eq";
  if ((operator === "between" || operator === "not_between") && !isReportRangeFilterType(type)) {
    throw new FrameworkError(
      "REPORT_INVALID",
      `Report '${report.name}' filter '${filter.name}' does not support ${operator}`,
      { status: 400 }
    );
  }
}

function isReportRangeFilterType(type: FieldType | undefined): boolean {
  return type === "integer" || type === "number" || type === "date" || type === "datetime";
}

function assertReportOrderValid(report: ReportDefinition): void {
  if (report.order !== undefined && !(REPORT_ORDERS as readonly string[]).includes(report.order)) {
    throw new FrameworkError(
      "REPORT_INVALID",
      `Report '${report.name}' has invalid order '${String(report.order)}'`,
      { status: 400 }
    );
  }
  if (report.orderBy === undefined) {
    return;
  }
  if (!report.columns.some((column) => column.name === report.orderBy)) {
    throw new FrameworkError(
      "REPORT_INVALID",
      `Report '${report.name}' orderBy references unknown column '${report.orderBy}'`,
      { status: 400 }
    );
  }
}

function assertReportSourceValid(report: ReportDefinition): void {
  if (report.source === undefined || report.source.kind === "documents") {
    return;
  }
  if (report.source.kind === "custom" && typeof report.source.provider === "string" && report.source.provider.trim() !== "") {
    return;
  }
  throw new FrameworkError(
    "REPORT_INVALID",
    `Report '${report.name}' has invalid source`,
    { status: 400 }
  );
}

function assertReportOrderMatchesDocType(
  report: ReportDefinition,
  fields: ReadonlyMap<string, { readonly type: FieldType }>
): void {
  if (report.orderBy === undefined) {
    return;
  }
  const column = report.columns.find((item) => item.name === report.orderBy);
  if (column?.formula !== undefined) {
    return;
  }
  const fieldName = column?.field ?? column?.name;
  const field = fieldName ? fields.get(fieldName) : undefined;
  if (fieldName && (field?.type === "json" || field?.type === "table")) {
    throw new FrameworkError(
      "REPORT_INVALID",
      `Report '${report.name}' cannot order by ${field.type} column '${report.orderBy}'`,
      { status: 400 }
    );
  }
}

function assertFormulaColumnsValid(report: ReportDefinition): void {
  for (const column of report.columns) {
    const formula = column.formula;
    if (formula === undefined) {
      continue;
    }
    if (column.field !== undefined) {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${report.name}' formula column '${column.name}' cannot also reference field '${column.field}'`,
        { status: 400 }
      );
    }
    if (column.type !== undefined && column.type !== "integer" && column.type !== "number") {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${report.name}' formula column '${column.name}' must use a numeric display type`,
        { status: 400 }
      );
    }
    assertFormulaSyntax(report.name, column.name, formula, "");
  }
}

function assertFormulaSyntax(
  reportName: string,
  columnName: string,
  formula: ReportFormulaDefinition,
  path: string,
  depth = 1,
  seen: WeakSet<ReportFormulaDefinition> = new WeakSet()
): void {
  assertFormulaTraversalSafe(reportName, columnName, formula, path, depth, seen);
  seen.add(formula);
  try {
    if (!REPORT_FORMULA_OPERATORS.includes(formula.operator)) {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${reportName}' formula column '${columnName}'${formulaPath(path)} has invalid operator '${String(formula.operator)}'`,
        { status: 400 }
      );
    }
    assertFormulaOperandSyntax(reportName, columnName, formula.left, formulaOperandPath(path, "left"), depth + 1, seen);
    assertFormulaOperandSyntax(reportName, columnName, formula.right, formulaOperandPath(path, "right"), depth + 1, seen);
  } finally {
    seen.delete(formula);
  }
}

function assertFormulaOperandSyntax(
  reportName: string,
  columnName: string,
  operand: ReportFormulaOperand,
  path: string,
  depth: number,
  seen: WeakSet<ReportFormulaDefinition>
): void {
  if (typeof operand === "string") {
    if (operand.length > 0) {
      return;
    }
  } else if (typeof operand === "number" && Number.isFinite(operand)) {
    return;
  } else if (isReportFormulaDefinition(operand)) {
    assertFormulaSyntax(reportName, columnName, operand, `${path} formula`, depth, seen);
    return;
  }
  throw new FrameworkError(
    "REPORT_INVALID",
    `Report '${reportName}' formula column '${columnName}' ${path} operand must be a field name, finite numeric literal, or nested formula`,
    { status: 400 }
  );
}

function assertFiltersValid(report: ReportDefinition): void {
  for (const filter of report.filters ?? []) {
    if (filter.name === REPORT_FILTER_EXPRESSION_RESERVED_FILTER_NAME) {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${report.name}' filter name '${filter.name}' is reserved for filter_expression query parameters`,
        { status: 400 }
      );
    }
    if (filter.operator !== undefined && !REPORT_FILTER_OPERATORS.includes(filter.operator)) {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${report.name}' filter '${filter.name}' has invalid operator '${String(filter.operator)}'`,
        { status: 400 }
      );
    }
    if (filter.type !== undefined && !(REPORT_FILTER_TYPES as readonly FieldType[]).includes(filter.type)) {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${report.name}' filter '${filter.name}' has invalid type '${String(filter.type)}'`,
        { status: 400 }
      );
    }
    if (filter.options !== undefined) {
      if (filter.type !== "select") {
        throw new FrameworkError(
          "REPORT_INVALID",
          `Report '${report.name}' filter '${filter.name}' options require select type`,
          { status: 400 }
        );
      }
      if (!filter.options.every((option) => typeof option === "string")) {
        throw new FrameworkError(
          "REPORT_INVALID",
          `Report '${report.name}' filter '${filter.name}' options must be strings`,
          { status: 400 }
        );
      }
    }
  }
}

function assertFilterExpressionSyntax(report: ReportDefinition): void {
  assertReportFilterExpressionBounds(report.filterExpression, `Report '${report.name}' filter expression`, {
    errorCode: "REPORT_INVALID"
  });
}

function assertFilterExpressionSyntaxNode(
  expression: ReportFilterExpression,
  options: {
    readonly budget: { remaining: number };
    readonly depth: number;
    readonly errorCode: FrameworkErrorCode;
    readonly label: string;
    readonly maxDepth: number;
    readonly maxNodes: number;
  }
): void {
  options.budget.remaining -= 1;
  if (options.budget.remaining < 0) {
    throw new FrameworkError(
      options.errorCode,
      `${options.label} cannot exceed ${options.maxDepth} levels or ${options.maxNodes} nodes`,
      { status: 400 }
    );
  }
  if (isReportFilterGroup(expression)) {
    if (options.depth > options.maxDepth) {
      throw new FrameworkError(
        options.errorCode,
        `${options.label} cannot exceed ${options.maxDepth} levels`,
        { status: 400 }
      );
    }
    if (!REPORT_FILTER_GROUP_MATCHES.includes(expression.match)) {
      throw new FrameworkError(options.errorCode, `${options.label} match must be all or any`, {
        status: 400
      });
    }
    if (!Array.isArray(expression.filters) || expression.filters.length === 0) {
      throw new FrameworkError(options.errorCode, `${options.label} group must include at least one filter`, {
        status: 400
      });
    }
    for (const child of expression.filters) {
      assertFilterExpressionSyntaxNode(child, {
        ...options,
        depth: options.depth + 1
      });
    }
    return;
  }
  if (typeof expression.filter !== "string" || expression.filter.trim() === "") {
    throw new FrameworkError(options.errorCode, `${options.label} filter must be a string`, {
      status: 400
    });
  }
  if (!isReportFilterValue(expression.value)) {
    throw new FrameworkError(options.errorCode, `${options.label} value must be scalar or scalar array`, {
      status: 400
    });
  }
}

export interface ReportFilterExpressionValidationOptions {
  readonly errorCode?: FrameworkErrorCode;
  readonly maxDepth?: number;
  readonly maxNodes?: number;
}

function assertSummariesValid(report: ReportDefinition): void {
  for (const summary of report.summaries ?? []) {
    assertSummaryAggregateValid(report.name, summary);
  }
  for (const group of report.groups ?? []) {
    for (const summary of group.summaries) {
      assertSummaryAggregateValid(report.name, summary, ` on group '${group.name}'`);
    }
  }
}

function assertDisplayTypesValid(report: ReportDefinition): void {
  for (const column of report.columns) {
    if (column.type !== undefined && !(REPORT_FIELD_TYPES as readonly string[]).includes(column.type)) {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${report.name}' column '${column.name}' has invalid type '${String(column.type)}'`,
        { status: 400 }
      );
    }
  }
  for (const summary of report.summaries ?? []) {
    assertSummaryTypeValid(report.name, summary);
  }
  for (const group of report.groups ?? []) {
    for (const summary of group.summaries) {
      assertSummaryTypeValid(report.name, summary, ` on group '${group.name}'`);
    }
  }
}

function assertSummaryAggregateValid(
  reportName: string,
  summary: ReportSummaryDefinition,
  context = ""
): void {
  if (!(REPORT_SUMMARY_AGGREGATES as readonly string[]).includes(summary.aggregate)) {
    throw new FrameworkError(
      "REPORT_INVALID",
      `Report '${reportName}' summary '${summary.name}'${context} has invalid aggregate '${String(summary.aggregate)}'`,
      { status: 400 }
    );
  }
}

function assertSummaryTypeValid(
  reportName: string,
  summary: ReportSummaryDefinition,
  context = ""
): void {
  if (summary.type !== undefined && !(REPORT_FIELD_TYPES as readonly string[]).includes(summary.type)) {
    throw new FrameworkError(
      "REPORT_INVALID",
      `Report '${reportName}' summary '${summary.name}'${context} has invalid type '${String(summary.type)}'`,
      { status: 400 }
    );
  }
}

function assertChartsReferenceGroups(report: ReportDefinition): void {
  const groups = new Map((report.groups ?? []).map((group) => [group.name, group]));
  for (const chart of report.charts ?? []) {
    if (chart.type !== "bar" && chart.type !== "line" && chart.type !== "pie") {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${report.name}' chart '${chart.name}' has invalid type '${String(chart.type)}'`,
        { status: 400 }
      );
    }
    const group = groups.get(chart.group);
    if (!group) {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${report.name}' chart '${chart.name}' references unknown group '${chart.group}'`,
        { status: 400 }
      );
    }
    const summary = group.summaries.find((item) => item.name === chart.summary);
    if (!summary) {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${report.name}' chart '${chart.name}' references unknown summary '${chart.summary}' on group '${chart.group}'`,
        { status: 400 }
      );
    }
    if (summary.aggregate !== "count" && summary.aggregate !== "sum" && summary.aggregate !== "avg") {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${report.name}' chart '${chart.name}' requires a numeric count, sum, or avg summary`,
        { status: 400 }
      );
    }
    if (chart.maxPoints !== undefined && (!Number.isInteger(chart.maxPoints) || chart.maxPoints < 1)) {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${report.name}' chart '${chart.name}' maxPoints must be a positive integer`,
        { status: 400 }
      );
    }
    if (chart.orderBy !== undefined && chart.orderBy !== "key" && chart.orderBy !== "label" && chart.orderBy !== "value") {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${report.name}' chart '${chart.name}' has invalid orderBy '${String(chart.orderBy)}'`,
        { status: 400 }
      );
    }
    if (chart.order !== undefined && !(REPORT_ORDERS as readonly string[]).includes(chart.order)) {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${report.name}' chart '${chart.name}' has invalid order '${String(chart.order)}'`,
        { status: 400 }
      );
    }
    for (const color of chart.colors ?? []) {
      if (!isReportChartColor(color)) {
        throw new FrameworkError(
          "REPORT_INVALID",
          `Report '${report.name}' chart '${chart.name}' has invalid color '${color}'`,
          { status: 400 }
        );
      }
    }
  }
}

function assertFormulaMatchesDocType(
  reportName: string,
  column: ReportColumnDefinition & { readonly formula: ReportFormulaDefinition },
  fields: ReadonlyMap<string, { readonly type: FieldType }>
): void {
  assertFormulaMatchesDocTypeFields(reportName, column, column.formula, "", 1, new WeakSet());

  function assertFormulaMatchesDocTypeFields(
    name: string,
    reportColumn: ReportColumnDefinition,
    formula: ReportFormulaDefinition,
    path: string,
    depth: number,
    seen: WeakSet<ReportFormulaDefinition>
  ): void {
    assertFormulaTraversalSafe(name, reportColumn.name, formula, path, depth, seen);
    seen.add(formula);
    try {
      assertFormulaOperandMatchesDocType(name, reportColumn, formula.left, formulaOperandPath(path, "left"), depth + 1, seen);
      assertFormulaOperandMatchesDocType(name, reportColumn, formula.right, formulaOperandPath(path, "right"), depth + 1, seen);
    } finally {
      seen.delete(formula);
    }
  }

  function assertFormulaOperandMatchesDocType(
    name: string,
    reportColumn: ReportColumnDefinition,
    operand: ReportFormulaOperand,
    path: string,
    depth: number,
    seen: WeakSet<ReportFormulaDefinition>
  ): void {
    if (typeof operand === "number") {
      return;
    }
    if (isReportFormulaDefinition(operand)) {
      assertFormulaMatchesDocTypeFields(name, reportColumn, operand, `${path} formula`, depth, seen);
      return;
    }
    const fieldName = operand;
    const field = fields.get(fieldName);
    if (!field) {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${name}' formula column '${reportColumn.name}' references unknown ${path} field '${fieldName}'`,
        { status: 400 }
      );
    }
    if (field.type !== "integer" && field.type !== "number") {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${name}' formula column '${reportColumn.name}' requires a numeric ${path} field '${fieldName}'`,
        { status: 400 }
      );
    }
  }
}

function freezeReportFormula(
  formula: ReportFormulaDefinition,
  depth = 1,
  seen: WeakSet<ReportFormulaDefinition> = new WeakSet()
): ReportFormulaDefinition {
  assertFormulaTraversalSafe("Report", "formula", formula, "", depth, seen);
  seen.add(formula);
  try {
    return Object.freeze({
      operator: formula.operator,
      left: freezeReportFormulaOperand(formula.left, depth + 1, seen),
      right: freezeReportFormulaOperand(formula.right, depth + 1, seen)
    });
  } finally {
    seen.delete(formula);
  }
}

function freezeReportFormulaOperand(
  operand: ReportFormulaOperand,
  depth: number,
  seen: WeakSet<ReportFormulaDefinition>
): ReportFormulaOperand {
  return isReportFormulaDefinition(operand) ? freezeReportFormula(operand, depth, seen) : operand;
}

function isReportFormulaDefinition(operand: ReportFormulaOperand): operand is ReportFormulaDefinition {
  return typeof operand === "object" && operand !== null && !Array.isArray(operand);
}

function freezeReportFilterExpression(expression: ReportFilterExpression): ReportFilterExpression {
  if (isReportFilterGroup(expression)) {
    return Object.freeze({
      kind: "group",
      match: expression.match,
      filters: Object.freeze(expression.filters.map(freezeReportFilterExpression))
    });
  }
  return Object.freeze({
    filter: expression.filter,
    value: Array.isArray(expression.value) ? Object.freeze([...expression.value]) : expression.value
  });
}

function formulaPath(path: string): string {
  return path.length === 0 ? "" : ` ${path}`;
}

function formulaOperandPath(path: string, side: "left" | "right"): string {
  return path.length === 0 ? side : `${path} ${side}`;
}

function assertFormulaTraversalSafe(
  reportName: string,
  columnName: string,
  formula: ReportFormulaDefinition,
  path: string,
  depth: number,
  seen: WeakSet<ReportFormulaDefinition>
): void {
  if (depth > REPORT_FORMULA_MAX_DEPTH) {
    throw new FrameworkError(
      "REPORT_INVALID",
      `Report '${reportName}' formula column '${columnName}'${formulaPath(path)} exceeds maximum formula depth of ${REPORT_FORMULA_MAX_DEPTH}`,
      { status: 400 }
    );
  }
  if (seen.has(formula)) {
    throw new FrameworkError(
      "REPORT_INVALID",
      `Report '${reportName}' formula column '${columnName}'${formulaPath(path)} contains a cyclic formula reference`,
      { status: 400 }
    );
  }
}

function assertSummaryMatchesDocType(
  reportName: string,
  summary: ReportSummaryDefinition,
  fields: ReadonlyMap<string, { readonly type: FieldType }>,
  context = ""
): void {
  const fieldName = summary.field;
  if (summary.aggregate !== "count" && !fieldName) {
    throw new FrameworkError(
      "REPORT_INVALID",
      `Report '${reportName}' summary '${summary.name}'${context} requires a field for ${summary.aggregate}`,
      { status: 400 }
    );
  }
  if (!fieldName) {
    return;
  }
  const field = fields.get(fieldName);
  if (!field) {
    throw new FrameworkError(
      "REPORT_INVALID",
      `Report '${reportName}' summary '${summary.name}'${context} references unknown field '${fieldName}'`,
      { status: 400 }
    );
  }
  if ((summary.aggregate === "sum" || summary.aggregate === "avg") && field.type !== "integer" && field.type !== "number") {
    throw new FrameworkError(
      "REPORT_INVALID",
      `Report '${reportName}' summary '${summary.name}'${context} requires a numeric field for ${summary.aggregate}`,
      { status: 400 }
    );
  }
  if ((summary.aggregate === "min" || summary.aggregate === "max") && (field.type === "json" || field.type === "table")) {
    throw new FrameworkError(
      "REPORT_INVALID",
      `Report '${reportName}' summary '${summary.name}'${context} cannot aggregate ${field.type} field '${fieldName}'`,
      { status: 400 }
    );
  }
}

function assertUnique(values: readonly string[], label: string, reportName: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    assertIdentifier(value, `${label} name on report '${reportName}'`);
    if (seen.has(value)) {
      throw new FrameworkError("REPORT_INVALID", `Duplicate ${label} '${value}' on report '${reportName}'`, {
        status: 400
      });
    }
    seen.add(value);
  }
}

function assertIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_ ]*$/.test(value)) {
    throw new FrameworkError("REPORT_INVALID", `Invalid ${label}: '${value}'`, {
      status: 400
    });
  }
}
