import { badRequest } from "../core/errors.js";
import type { ReportSummaryDefinition } from "../core/reports.js";
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
