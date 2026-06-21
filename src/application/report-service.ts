import { badRequest, permissionDenied } from "../core/errors";
import { can } from "../core/permissions";
import { assertReportMatchesDocType, canReadReport, type ReportColumnDefinition, type ReportDefinition } from "../core/reports";
import type { ModelRegistry } from "../core/registry";
import type { Actor, DocumentSnapshot, FieldType, JsonPrimitive, JsonValue } from "../core/types";
import { QueryService } from "./query-service";

export type ReportFilters = Readonly<Record<string, JsonPrimitive | undefined>>;
export type ReportRow = Readonly<Record<string, JsonValue>>;

export interface ReportRunOptions {
  readonly filters?: ReportFilters;
  readonly limit?: number;
  readonly offset?: number;
}

export interface ReportRunResult {
  readonly report: ReportDefinition;
  readonly columns: readonly ReportColumnDefinition[];
  readonly rows: readonly ReportRow[];
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
}

export interface ReportServiceOptions {
  readonly registry: ModelRegistry;
  readonly queries: QueryService;
}

export class ReportService {
  private readonly registry: ModelRegistry;
  private readonly queries: QueryService;

  constructor(options: ReportServiceOptions) {
    this.registry = options.registry;
    this.queries = options.queries;
  }

  listReports(actor: Actor): readonly ReportDefinition[] {
    return this.registry.listReports().filter((report) => this.canAccess(actor, report));
  }

  getReport(actor: Actor, reportName: string): ReportDefinition {
    const report = this.registry.getReport(reportName);
    if (!this.canAccess(actor, report)) {
      throw permissionDenied(`Actor '${actor.id}' cannot read report '${report.name}'`);
    }
    assertReportMatchesDocType(report, this.registry.get(report.doctype));
    return report;
  }

  async runReport(actor: Actor, reportName: string, options: ReportRunOptions = {}): Promise<ReportRunResult> {
    const report = this.getReport(actor, reportName);
    const limit = clampLimit(options.limit);
    const offset = Math.max(0, options.offset ?? 0);
    const filters = this.materializeFilters(report, options.filters ?? {});
    const documents = await this.listAllReadableDocuments(actor, report.doctype);
    const filtered = documents.filter((document) => matchesReportFilters(document, report, filters));
    const rows = filtered.slice(offset, offset + limit).map((document) => reportRow(document, report.columns));
    return {
      report,
      columns: report.columns,
      rows,
      limit,
      offset,
      total: filtered.length
    };
  }

  private canAccess(actor: Actor, report: ReportDefinition): boolean {
    const doctype = this.registry.get(report.doctype);
    return canReadReport(actor, report) && can(actor, doctype, report.permissionAction ?? "read");
  }

  private async listAllReadableDocuments(actor: Actor, doctype: string): Promise<readonly DocumentSnapshot[]> {
    const pageSize = 200;
    const documents: DocumentSnapshot[] = [];
    let offset = 0;
    while (true) {
      const page = await this.queries.listDocuments(actor, doctype, { limit: pageSize, offset });
      documents.push(...page.data);
      const scanned = offset + page.limit;
      if (scanned >= page.total) {
        return documents;
      }
      offset = scanned;
    }
  }

  private materializeFilters(report: ReportDefinition, input: ReportFilters): ReportFilters {
    const values: Record<string, JsonPrimitive | undefined> = {};
    for (const filter of report.filters ?? []) {
      const raw = input[filter.name] ?? filter.defaultValue;
      const value = coerceFilterValue(raw, filter.type);
      if (filter.required && (value === undefined || value === "")) {
        throw badRequest(`Report filter '${filter.name}' is required`);
      }
      values[filter.name] = value;
    }
    return values;
  }
}

function matchesReportFilters(document: DocumentSnapshot, report: ReportDefinition, filters: ReportFilters): boolean {
  return (report.filters ?? []).every((filter) => {
    const expected = filters[filter.name];
    if (expected === undefined || expected === "") {
      return true;
    }
    const actual = document.data[filter.field];
    switch (filter.operator ?? "eq") {
      case "eq":
        return actual === expected;
      case "contains":
        return String(actual ?? "").toLowerCase().includes(String(expected).toLowerCase());
      case "gte":
        return compareValues(actual, expected) >= 0;
      case "lte":
        return compareValues(actual, expected) <= 0;
    }
  });
}

function reportRow(document: DocumentSnapshot, columns: readonly ReportColumnDefinition[]): ReportRow {
  return Object.fromEntries(
    columns.map((column) => [column.name, document.data[column.field ?? column.name] ?? null])
  ) as ReportRow;
}

function coerceFilterValue(value: JsonPrimitive | undefined, type?: FieldType): JsonPrimitive | undefined {
  if (value === undefined || value === null || typeof value !== "string") {
    return value;
  }
  if (type === "integer") {
    const parsed = Number(value);
    return Number.isInteger(parsed) ? parsed : value;
  }
  if (type === "number") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : value;
  }
  if (type === "boolean") {
    if (value === "true" || value === "1" || value === "on") {
      return true;
    }
    if (value === "false" || value === "0" || value === "off") {
      return false;
    }
  }
  return value;
}

function compareValues(actual: JsonValue | undefined, expected: JsonPrimitive): number {
  if (typeof actual === "number" && typeof expected === "number") {
    return actual - expected;
  }
  return String(actual ?? "").localeCompare(String(expected));
}

function clampLimit(limit?: number): number {
  if (limit === undefined) {
    return 50;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest("limit must be a positive integer");
  }
  return Math.min(limit, 200);
}
