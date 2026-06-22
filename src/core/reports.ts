import { FrameworkError } from "./errors";
import type { Actor, DocTypeDefinition, FieldType, JsonPrimitive, PermissionAction } from "./types";
import { SYSTEM_MANAGER_ROLE } from "./types";

export type ReportFilterOperator = "eq" | "contains" | "gte" | "lte";
export type ReportSummaryAggregate = "count" | "sum" | "avg" | "min" | "max";
export type ReportChartType = "bar" | "line" | "pie";

export interface ReportColumnDefinition {
  readonly name: string;
  readonly label?: string;
  readonly field?: string;
  readonly type?: FieldType;
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
}

export interface ReportChartDefinition {
  readonly name: string;
  readonly label?: string;
  readonly type: ReportChartType;
  readonly group: string;
  readonly summary: string;
  readonly maxPoints?: number;
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
  readonly roles?: readonly string[];
  readonly permissionAction?: PermissionAction;
}

export function defineReport(definition: ReportDefinition): ReportDefinition {
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
    assertUnique(group.summaries.map((summary) => summary.name), `summary on group '${group.name}'`, definition.name);
  }
  assertChartsReferenceGroups(definition);
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
  const charts = definition.charts ? Object.freeze([...definition.charts]) : undefined;
  return Object.freeze({
    ...definition,
    columns: Object.freeze([...definition.columns]),
    ...(definition.filters ? { filters: Object.freeze([...definition.filters]) } : {}),
    ...(summaries ? { summaries } : {}),
    ...(groups ? { groups } : {}),
    ...(charts ? { charts } : {})
  });
}

export function canReadReport(actor: Actor, report: ReportDefinition): boolean {
  if (actor.roles.includes(SYSTEM_MANAGER_ROLE)) {
    return true;
  }
  return report.roles === undefined || report.roles.some((role) => actor.roles.includes(role));
}

export function assertReportMatchesDocType(report: ReportDefinition, doctype: DocTypeDefinition): void {
  const fields = new Map(doctype.fields.map((field) => [field.name, field]));
  for (const column of report.columns) {
    const field = column.field ?? column.name;
    if (!fields.has(field)) {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${report.name}' column '${column.name}' references unknown field '${field}'`,
        { status: 400 }
      );
    }
  }
  for (const filter of report.filters ?? []) {
    if (!fields.has(filter.field)) {
      throw new FrameworkError(
        "REPORT_INVALID",
        `Report '${report.name}' filter '${filter.name}' references unknown field '${filter.field}'`,
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
