import type { JsonValue } from "../core/types.js";

export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";

export function csvLine(values: readonly (JsonValue | undefined)[]): string {
  return values.map(csvCell).join(",");
}

export function filenamePart(value: string, fallback: string): string {
  return value.trim().replaceAll(/[^A-Za-z0-9._-]+/g, "-").replaceAll(/^-+|-+$/g, "") || fallback;
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

function neutralizeSpreadsheetFormula(text: string): string {
  return /^(?:[=+\-@\t\r]|\s+[=+\-@])/u.test(text) ? `'${text}` : text;
}
