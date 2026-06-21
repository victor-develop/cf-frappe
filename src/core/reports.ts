import { FrameworkError } from "./errors";
import type { Actor, DocTypeDefinition, FieldType, JsonPrimitive, PermissionAction } from "./types";
import { SYSTEM_MANAGER_ROLE } from "./types";

export type ReportFilterOperator = "eq" | "contains" | "gte" | "lte";

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

export interface ReportDefinition {
  readonly name: string;
  readonly label?: string;
  readonly module?: string;
  readonly description?: string;
  readonly doctype: string;
  readonly columns: readonly ReportColumnDefinition[];
  readonly filters?: readonly ReportFilterDefinition[];
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
  return Object.freeze({
    ...definition,
    columns: Object.freeze([...definition.columns]),
    ...(definition.filters ? { filters: Object.freeze([...definition.filters]) } : {})
  });
}

export function canReadReport(actor: Actor, report: ReportDefinition): boolean {
  if (actor.roles.includes(SYSTEM_MANAGER_ROLE)) {
    return true;
  }
  return report.roles === undefined || report.roles.some((role) => actor.roles.includes(role));
}

export function assertReportMatchesDocType(report: ReportDefinition, doctype: DocTypeDefinition): void {
  const fields = new Set(doctype.fields.map((field) => field.name));
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
