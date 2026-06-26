import { badRequest, FrameworkError, type FrameworkErrorCode } from "../core/errors.js";
import type {
  Actor,
  DocTypeDefinition,
  DocumentData,
  DocumentSnapshot,
  FieldDefinition,
  JsonValue,
  MutableDocumentData
} from "../core/types.js";
import { can } from "../core/permissions.js";
import type { DocumentCommandExecutor } from "./document-service.js";
import type { QueryService } from "./query-service.js";
import { CSV_CONTENT_TYPE, csvLine, filenamePart, parseCsv, type ParsedCsvRow } from "./csv.js";

export type DocumentImportMode = "create" | "update";

export interface DocumentImportServiceOptions {
  readonly documents: Pick<DocumentCommandExecutor, "create" | "update">;
  readonly queries: Pick<QueryService, "getEffectiveMeta">;
  readonly maxRows?: number;
}

export interface ImportDocumentsCsvCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly csv: string;
  readonly mode?: DocumentImportMode;
  readonly metadata?: DocumentData;
}

export interface DocumentImportSuccess {
  readonly row: number;
  readonly action: DocumentImportMode;
  readonly name: string;
  readonly document: DocumentSnapshot;
}

export interface DocumentImportFailure {
  readonly row: number;
  readonly action: DocumentImportMode;
  readonly name?: string;
  readonly code: FrameworkErrorCode | "UNKNOWN";
  readonly message: string;
  readonly status: number;
}

export interface DocumentImportResult {
  readonly doctype: string;
  readonly mode: DocumentImportMode;
  readonly total: number;
  readonly succeeded: readonly DocumentImportSuccess[];
  readonly failed: readonly DocumentImportFailure[];
}

export interface DocumentImportTemplate {
  readonly doctype: string;
  readonly filename: string;
  readonly contentType: typeof CSV_CONTENT_TYPE;
  readonly body: string;
  readonly fields: readonly string[];
}

export function canImportDocuments(actor: Actor, doctype: DocTypeDefinition): boolean {
  return can(actor, doctype, "create") || can(actor, doctype, "update");
}

const DEFAULT_MAX_IMPORT_ROWS = 500;
const MAX_IMPORT_ROWS = 5_000;
const RESERVED_HEADERS = new Set(["name", "expectedVersion"]);

export class DocumentImportService {
  private readonly documents: Pick<DocumentCommandExecutor, "create" | "update">;
  private readonly queries: Pick<QueryService, "getEffectiveMeta">;
  private readonly maxRows: number;

  constructor(options: DocumentImportServiceOptions) {
    this.documents = options.documents;
    this.queries = options.queries;
    this.maxRows = normalizeMaxRows(options.maxRows);
  }

  async importCsv(command: ImportDocumentsCsvCommand): Promise<DocumentImportResult> {
    const mode = command.mode ?? "create";
    const parsed = parseCsv(command.csv);
    if (parsed.rows.length > this.maxRows) {
      throw badRequest(`CSV import cannot exceed ${this.maxRows} rows`);
    }
    const doctype = await this.queries.getEffectiveMeta(command.actor, command.doctype);
    validateImportHeaders(doctype, parsed.headers);

    const succeeded: DocumentImportSuccess[] = [];
    const failed: DocumentImportFailure[] = [];
    for (const row of parsed.rows) {
      let input: RowInput | undefined;
      try {
        input = rowInput(parsed.headers, row, doctype);
        const document = mode === "create"
          ? await this.documents.create({
              actor: command.actor,
              doctype: doctype.name,
              data: input.data,
              ...(input.name === undefined ? {} : { name: input.name }),
              ...(command.metadata === undefined ? {} : { metadata: command.metadata })
            })
          : await this.documents.update({
              actor: command.actor,
              doctype: doctype.name,
              name: requiredUpdateName(input.name, row.line),
              patch: input.data,
              ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
              ...(command.metadata === undefined ? {} : { metadata: command.metadata })
        });
        succeeded.push({ row: row.line, action: mode, name: document.name, document });
      } catch (error) {
        failed.push(importFailure(row.line, mode, input?.name ?? rowName(parsed.headers, row), error));
      }
    }
    return {
      doctype: doctype.name,
      mode,
      total: parsed.rows.length,
      succeeded,
      failed
    };
  }
}

export function documentImportTemplate(doctype: DocTypeDefinition): DocumentImportTemplate {
  const fieldNames = importableFields(doctype).map((field) => field.name);
  const headers = ["name", "expectedVersion", ...fieldNames];
  const defaults = importableFields(doctype).map((field) =>
    field.defaultValue === undefined || typeof field.defaultValue === "function" ? undefined : field.defaultValue
  );
  const sample = ["", "", ...defaults];
  const body = defaults.some((value) => value !== undefined)
    ? [csvLine(headers), csvLine(sample)].join("\n")
    : csvLine(headers);
  return {
    doctype: doctype.name,
    filename: `${filenamePart(doctype.name, "documents")}-import-template.csv`,
    contentType: CSV_CONTENT_TYPE,
    body,
    fields: fieldNames
  };
}

interface RowInput {
  readonly name?: string;
  readonly expectedVersion?: number;
  readonly data: MutableDocumentData;
}

function importableFields(doctype: DocTypeDefinition): readonly FieldDefinition[] {
  return doctype.fields.filter((field) => !field.readOnly && !field.hidden && !RESERVED_HEADERS.has(field.name));
}

function rowInput(headers: readonly string[], row: ParsedCsvRow, doctype: DocTypeDefinition): RowInput {
  const fields = new Map(doctype.fields.map((field) => [field.name, field] as const));
  const data: MutableDocumentData = {};
  let name: string | undefined;
  let expectedVersion: number | undefined;
  headers.forEach((header, index) => {
    const raw = row.cells[index] ?? "";
    if (header === "name") {
      name = blankToUndefined(raw);
      return;
    }
    if (header === "expectedVersion") {
      expectedVersion = parseExpectedVersion(raw, row.line);
      return;
    }
    const value = csvFieldValue(fields.get(header)!, raw, row.line);
    if (value !== undefined) {
      data[header] = value;
    }
  });
  return {
    ...(name === undefined ? {} : { name }),
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    data
  };
}

function rowName(headers: readonly string[], row: ParsedCsvRow): string | undefined {
  const index = headers.indexOf("name");
  return index < 0 ? undefined : blankToUndefined(row.cells[index] ?? "");
}

function csvFieldValue(field: FieldDefinition, raw: string, row: number): JsonValue | undefined {
  if (raw === "") {
    return undefined;
  }
  switch (field.type) {
    case "integer": {
      const value = Number(raw);
      if (!Number.isInteger(value)) {
        throw badRequest(`CSV row ${row} field '${field.name}' must be an integer`);
      }
      return value;
    }
    case "number": {
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw badRequest(`CSV row ${row} field '${field.name}' must be a number`);
      }
      return value;
    }
    case "boolean":
      return csvBooleanValue(field, raw, row);
    case "json":
    case "table":
      return csvJsonValue(field, raw, row);
    default:
      return raw;
  }
}

function csvBooleanValue(field: FieldDefinition, raw: string, row: number): boolean {
  const normalized = raw.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  throw badRequest(`CSV row ${row} field '${field.name}' must be a boolean`);
}

function csvJsonValue(field: FieldDefinition, raw: string, row: number): JsonValue {
  try {
    return JSON.parse(raw) as JsonValue;
  } catch {
    throw badRequest(`CSV row ${row} field '${field.name}' must be JSON`);
  }
}

function parseExpectedVersion(raw: string, row: number): number | undefined {
  if (raw === "") {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isInteger(value)) {
    throw badRequest(`CSV row ${row} expectedVersion must be an integer`);
  }
  return value;
}

function requiredUpdateName(name: string | undefined, row: number): string {
  if (name === undefined) {
    throw badRequest(`CSV row ${row} requires a name column value for update imports`);
  }
  return name;
}

function blankToUndefined(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function validateImportHeaders(doctype: DocTypeDefinition, headers: readonly string[]): void {
  const fields = new Set(doctype.fields.map((field) => field.name));
  for (const header of headers) {
    if (RESERVED_HEADERS.has(header)) {
      continue;
    }
    if (!fields.has(header)) {
      throw badRequest(`CSV import header '${header}' is not a field on ${doctype.name}`);
    }
  }
}

function importFailure(
  row: number,
  action: DocumentImportMode,
  name: string | undefined,
  error: unknown
): DocumentImportFailure {
  if (error instanceof FrameworkError) {
    return {
      row,
      action,
      ...(name === undefined ? {} : { name }),
      code: error.code,
      message: error.message,
      status: error.status
    };
  }
  return {
    row,
    action,
    ...(name === undefined ? {} : { name }),
    code: "UNKNOWN",
    message: error instanceof Error ? error.message : "Unknown import failure",
    status: 500
  };
}

function normalizeMaxRows(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MAX_IMPORT_ROWS;
  }
  if (!Number.isInteger(value) || value < 1 || value > MAX_IMPORT_ROWS) {
    throw badRequest(`CSV import maxRows must be an integer from 1 to ${MAX_IMPORT_ROWS}`);
  }
  return value;
}
