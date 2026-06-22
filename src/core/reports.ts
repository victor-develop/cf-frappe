import { FrameworkError } from "./errors";
import type { Actor, DocTypeDefinition, FieldType, JsonPrimitive, PermissionAction } from "./types";
import { SYSTEM_MANAGER_ROLE } from "./types";

export type ReportFilterOperator = "eq" | "contains" | "gte" | "lte";
export type ReportSummaryAggregate = "count" | "sum" | "avg" | "min" | "max";

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
  for (const group of definition.groups ?? []) {
    if (group.summaries.length === 0) {
      throw new FrameworkError("REPORT_INVALID", `Report '${definition.name}' group '${group.name}' must define at least one summary`, {
        status: 400
      });
    }
    assertUnique(group.summaries.map((summary) => summary.name), `summary on group '${group.name}'`, definition.name);
  }
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
  return Object.freeze({
    ...definition,
    columns: Object.freeze([...definition.columns]),
    ...(definition.filters ? { filters: Object.freeze([...definition.filters]) } : {}),
    ...(summaries ? { summaries } : {}),
    ...(groups ? { groups } : {})
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
