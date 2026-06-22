import type { FieldDefinition } from "../../core/types.js";

export function deskReportFieldLabel(field: FieldDefinition): string {
  return field.label ?? field.name;
}

export function deskReportSumSummaryName(field: FieldDefinition): string {
  return `sum_${field.name}`;
}

export function deskReportSumSummaryLabel(field: FieldDefinition): string {
  return `Total ${deskReportFieldLabel(field)}`;
}

export function isDeskNumericReportField(
  field: FieldDefinition
): field is FieldDefinition & { readonly type: "integer" | "number" } {
  return field.type === "integer" || field.type === "number";
}

export function isDeskGroupableReportField(field: FieldDefinition): boolean {
  return field.type !== "json" && field.type !== "table";
}
