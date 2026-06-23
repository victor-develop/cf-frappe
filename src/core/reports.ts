import { FrameworkError } from "./errors.js";
import type { Actor, DocTypeDefinition, FieldType, JsonPrimitive, PermissionAction } from "./types.js";
import { SYSTEM_MANAGER_ROLE } from "./types.js";

export type ReportFilterOperator = "eq" | "contains" | "gte" | "lte";
export type ReportSummaryAggregate = "count" | "sum" | "avg" | "min" | "max";
export type ReportChartType = "bar" | "line" | "pie";
export type ReportChartOrderBy = "key" | "label" | "value";
export type ReportOrder = "asc" | "desc";
export type ReportChartOrder = ReportOrder;
export type ReportFormulaOperator = "add" | "subtract" | "multiply" | "divide";
export type ReportFormulaOperand = string | number | ReportFormulaDefinition;

const REPORT_FILTER_OPERATORS = ["eq", "contains", "gte", "lte"] as const;
const REPORT_FILTER_TYPES = ["text", "longText", "integer", "number", "boolean", "date", "datetime", "select", "link"] as const;
const REPORT_FIELD_TYPES = ["text", "longText", "integer", "number", "boolean", "date", "datetime", "json", "select", "link", "table"] as const;
const REPORT_ORDERS = ["asc", "desc"] as const;
const REPORT_SUMMARY_AGGREGATES = ["count", "sum", "avg", "min", "max"] as const;
const REPORT_FORMULA_OPERATORS = ["add", "subtract", "multiply", "divide"] as const;
const REPORT_CHART_COLOR_PATTERN = /^#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]{3})?$/;
export const REPORT_FORMULA_MAX_DEPTH = 16;

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
  readonly defaultValue?: JsonPrimitive;
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
  readonly columns: readonly ReportColumnDefinition[];
  readonly filters?: readonly ReportFilterDefinition[];
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
    columns,
    ...(definition.filters ? { filters: Object.freeze([...definition.filters]) } : {}),
    ...(summaries ? { summaries } : {}),
    ...(groups ? { groups } : {}),
    ...(charts ? { charts } : {})
  });
}

export function assertReportDefinition(definition: ReportDefinition): void {
  assertIdentifier(definition.name, "report name");
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

export function isReportChartColor(value: string): boolean {
  return REPORT_CHART_COLOR_PATTERN.test(value);
}

export function assertReportMatchesDocType(report: ReportDefinition, doctype: DocTypeDefinition): void {
  const fields = new Map(doctype.fields.map((field) => [field.name, field]));
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
  }
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
  }
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
