import type { JsonValue } from "../core/types.js";
import { badRequest } from "../core/errors.js";

export const CSV_CONTENT_TYPE = "text/csv; charset=utf-8";

export interface ParsedCsvRow {
  readonly line: number;
  readonly cells: readonly string[];
}

export interface ParsedCsv {
  readonly headers: readonly string[];
  readonly rows: readonly ParsedCsvRow[];
}

export function csvLine(values: readonly (JsonValue | undefined)[]): string {
  return values.map(csvCell).join(",");
}

export function parseCsv(text: string): ParsedCsv {
  const parsedRows = parseCsvCells(text);
  const nonEmptyRows = trimTrailingEmptyRows(parsedRows);
  if (nonEmptyRows.length === 0) {
    throw badRequest("CSV import requires a header row");
  }
  const headerRow = nonEmptyRows[0]!;
  const rows = nonEmptyRows.slice(1);
  const headers = headerRow.cells.map((header, index) => normalizeHeader(header, index));
  validateHeaders(headers);
  const dataRows = rows.filter((row) => row.cells.some((cell) => cell.trim() !== ""));
  validateRowWidths(headers, dataRows);
  return {
    headers,
    rows: dataRows
  };
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

function parseCsvCells(text: string): ParsedCsvRow[] {
  const rows: ParsedCsvRow[] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let rowLine = 1;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === "\"") {
      if (inQuotes && text[index + 1] === "\"") {
        cell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      row.push(cell);
      rows.push({ line: rowLine, cells: row });
      row = [];
      cell = "";
      if (char === "\r" && text[index + 1] === "\n") {
        index += 1;
      }
      line += 1;
      rowLine = line;
      continue;
    }
    if (inQuotes && char === "\r" && text[index + 1] === "\n") {
      line += 1;
      cell += "\r\n";
      index += 1;
      continue;
    }
    if (char === "\n" || char === "\r") {
      line += 1;
    }
    cell += char;
  }

  if (inQuotes) {
    throw badRequest("CSV import has an unterminated quoted value");
  }
  row.push(cell);
  rows.push({ line: rowLine, cells: row });
  return rows;
}

function trimTrailingEmptyRows(rows: readonly ParsedCsvRow[]): readonly ParsedCsvRow[] {
  let end = rows.length;
  while (end > 0 && rows[end - 1]!.cells.every((cell) => cell === "")) {
    end -= 1;
  }
  return rows.slice(0, end);
}

function validateHeaders(headers: readonly string[]): void {
  const seen = new Set<string>();
  for (const header of headers) {
    if (!header) {
      throw badRequest("CSV import headers cannot be empty");
    }
    if (seen.has(header)) {
      throw badRequest(`CSV import header '${header}' is duplicated`);
    }
    seen.add(header);
  }
}

function normalizeHeader(header: string, index: number): string {
  const text = index === 0 && header.charCodeAt(0) === 0xfeff ? header.slice(1) : header;
  return text.trim();
}

function validateRowWidths(headers: readonly string[], rows: readonly ParsedCsvRow[]): void {
  for (const row of rows) {
    if (row.cells.length !== headers.length) {
      throw badRequest(
        `CSV row ${row.line} has ${row.cells.length} columns but the header has ${headers.length}`
      );
    }
  }
}
