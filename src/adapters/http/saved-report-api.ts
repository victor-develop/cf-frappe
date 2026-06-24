import { Hono } from "hono";
import type { PrintSettingsService } from "../../application/print-settings-service.js";
import type { SavedReportDefinition, SavedReportService } from "../../application/saved-report-service.js";
import { badRequest } from "../../core/errors.js";
import type {
  ReportChartDefinition,
  ReportChartOrderBy,
  ReportColumnDefinition,
  ReportFilterExpression,
  ReportFilterDefinition,
  ReportFormulaOperand,
  ReportGroupDefinition,
  ReportOrder,
  ReportSummaryDefinition
} from "../../core/reports.js";
import { REPORT_FORMULA_MAX_DEPTH } from "../../core/reports.js";
import type { FieldType, JsonPrimitive } from "../../core/types.js";
import type { PrintPdfRenderer } from "../../ports/print-pdf-renderer.js";
import { defaultPrintLayoutFor, printPdfResponseBody, printPdfResponseHeaders, renderPrintPdfReport } from "../print/index.js";
import { reportFilterExpressionFromUrl, reportFilterExpressionFromValue, reportFiltersFromUrl, reportOrderingFromUrl } from "../report-request.js";
import type { ActorResolver } from "./actor.js";
import { parseOptionalInteger, readJsonObject } from "./request.js";
import { writeReportCsvHeaders } from "./report-export.js";

export interface SavedReportApiOptions {
  readonly savedReports: SavedReportService;
  readonly printSettings?: PrintSettingsService;
  readonly pdfRenderer?: PrintPdfRenderer;
  readonly actor: ActorResolver;
  readonly maxJsonBytes?: number;
}

export function createSavedReportApi(options: SavedReportApiOptions): Hono {
  const app = new Hono();
  const maxJsonBytes = options.maxJsonBytes ?? 1_048_576;

  app.get("/api/report-builder/:doctype", async (c) => {
    const actor = await options.actor(c.req.raw);
    const data = await options.savedReports.list(actor, c.req.param("doctype"));
    return c.json({ data });
  });

  app.post("/api/report-builder/:doctype", async (c) => {
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    if (body.id !== undefined) {
      throw badRequest("Saved report id is server-generated");
    }
    const input = savedReportInput(body);
    const data = await options.savedReports.save({
      actor,
      doctype: c.req.param("doctype"),
      label: input.label,
      definition: input.definition
    });
    return c.json({ data }, 201);
  });

  app.get("/api/report-builder/:doctype/:id", async (c) => {
    const actor = await options.actor(c.req.raw);
    const data = await options.savedReports.get(actor, c.req.param("doctype"), c.req.param("id"));
    return c.json({ data });
  });

  app.put("/api/report-builder/:doctype/:id", async (c) => {
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const input = savedReportInput(body);
    const data = await options.savedReports.save({
      actor,
      doctype: c.req.param("doctype"),
      id: c.req.param("id"),
      label: input.label,
      definition: input.definition
    });
    return c.json({ data });
  });

  app.delete("/api/report-builder/:doctype/:id", async (c) => {
    const actor = await options.actor(c.req.raw);
    await options.savedReports.delete({
      actor,
      doctype: c.req.param("doctype"),
      id: c.req.param("id")
    });
    return c.body(null, 204);
  });

  app.get("/api/report-builder/:doctype/:id/run", async (c) => {
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const limit = parseOptionalInteger(c.req.query("limit"));
    const offset = parseOptionalInteger(c.req.query("offset"));
    const filterExpression = reportFilterExpressionFromUrl(url);
    const result = await options.savedReports.run({
      actor,
      doctype: c.req.param("doctype"),
      id: c.req.param("id"),
      options: {
        filters: reportFiltersFromUrl(url),
        ...(filterExpression === undefined ? {} : { filterExpression }),
        ...reportOrderingFromUrl(url),
        ...(limit !== undefined ? { limit } : {}),
        ...(offset !== undefined ? { offset } : {})
      }
    });
    return c.json(result);
  });

  app.get("/api/report-builder/:doctype/:id/export.csv", async (c) => {
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const limit = parseOptionalInteger(c.req.query("limit"));
    const filterExpression = reportFilterExpressionFromUrl(url);
    const csv = await options.savedReports.exportCsv({
      actor,
      doctype: c.req.param("doctype"),
      id: c.req.param("id"),
      options: {
        filters: reportFiltersFromUrl(url),
        ...(filterExpression === undefined ? {} : { filterExpression }),
        ...reportOrderingFromUrl(url),
        ...(limit !== undefined ? { limit } : {})
      }
    });
    writeReportCsvHeaders(c, csv);
    return c.body(csv.body);
  });

  app.get("/api/report-builder/:doctype/:id/pdf", async (c) => {
    if (!options.pdfRenderer) {
      throw badRequest("PDF print rendering is not configured");
    }
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const limit = parseOptionalInteger(c.req.query("limit"));
    const offset = parseOptionalInteger(c.req.query("offset"));
    const filterExpression = reportFilterExpressionFromUrl(url);
    const result = await options.savedReports.run({
      actor,
      doctype: c.req.param("doctype"),
      id: c.req.param("id"),
      options: {
        filters: reportFiltersFromUrl(url),
        ...(filterExpression === undefined ? {} : { filterExpression }),
        ...reportOrderingFromUrl(url),
        ...(limit !== undefined ? { limit } : {}),
        ...(offset !== undefined ? { offset } : {})
      }
    });
    const layout = await defaultPrintLayoutFor(options.printSettings, actor);
    const pdf = await renderPrintPdfReport({
      actor,
      renderer: options.pdfRenderer,
      result,
      ...(layout === undefined ? {} : { layout })
    });
    return new Response(printPdfResponseBody(pdf.body), { headers: printPdfResponseHeaders(pdf) });
  });

  return app;
}

interface SavedReportInput {
  readonly label: string;
  readonly definition: SavedReportDefinition;
}

function savedReportInput(body: Record<string, unknown>): SavedReportInput {
  return {
    label: requiredString(body.label, "Saved report label must be a string"),
    definition: savedReportDefinitionValue(body.definition)
  };
}

function savedReportDefinitionValue(value: unknown): SavedReportDefinition {
  const definition = recordValue(value, "Saved report definition must be an object");
  return {
    columns: objectArray(definition.columns, "columns").map(columnValue),
    ...(definition.filters === undefined ? {} : { filters: objectArray(definition.filters, "filters").map(filterValue) }),
    ...(definition.filterExpression === undefined ? {} : { filterExpression: reportFilterExpressionFromValue(definition.filterExpression, "Saved report filter expression") }),
    ...(definition.summaries === undefined ? {} : { summaries: objectArray(definition.summaries, "summaries").map(summaryValue) }),
    ...(definition.groups === undefined ? {} : { groups: objectArray(definition.groups, "groups").map(groupValue) }),
    ...(definition.charts === undefined ? {} : { charts: objectArray(definition.charts, "charts").map(chartValue) }),
    ...(definition.orderBy === undefined ? {} : { orderBy: requiredString(definition.orderBy, "Saved report orderBy must be a string") }),
    ...(definition.order === undefined ? {} : { order: reportOrderValue(definition.order) })
  };
}

function columnValue(value: Record<string, unknown>): ReportColumnDefinition {
  return {
    name: requiredString(value.name, "Saved report column name must be a string"),
    ...optionalStringField(value, "label"),
    ...optionalStringField(value, "field"),
    ...optionalFieldType(value),
    ...(value.formula === undefined ? {} : { formula: formulaValue(recordValue(value.formula, "Saved report formula must be an object")) })
  };
}

function filterValue(value: Record<string, unknown>): ReportFilterDefinition {
  return {
    name: requiredString(value.name, "Saved report filter name must be a string"),
    field: requiredString(value.field, "Saved report filter field must be a string"),
    ...optionalStringField(value, "label"),
    ...optionalFieldType(value),
    ...optionalStringField(value, "operator"),
    ...(value.required === undefined ? {} : { required: booleanValue(value.required, "Saved report filter required must be a boolean") }),
    ...(value.defaultValue === undefined ? {} : { defaultValue: reportFilterValue(value.defaultValue, "Saved report filter defaultValue must be scalar or a scalar array") })
  };
}

function summaryValue(value: Record<string, unknown>): ReportSummaryDefinition {
  return {
    name: requiredString(value.name, "Saved report summary name must be a string"),
    aggregate: requiredString(value.aggregate, "Saved report summary aggregate must be a string") as ReportSummaryDefinition["aggregate"],
    ...optionalStringField(value, "label"),
    ...optionalStringField(value, "field"),
    ...optionalFieldType(value),
    ...optionalStringField(value, "indicator")
  };
}

function groupValue(value: Record<string, unknown>): ReportGroupDefinition {
  return {
    name: requiredString(value.name, "Saved report group name must be a string"),
    field: requiredString(value.field, "Saved report group field must be a string"),
    summaries: objectArray(value.summaries, "group.summaries").map(summaryValue),
    ...optionalStringField(value, "label"),
    ...(value.maxRows === undefined ? {} : { maxRows: integerValue(value.maxRows, "Saved report group maxRows must be an integer") })
  };
}

function chartValue(value: Record<string, unknown>): ReportChartDefinition {
  return {
    name: requiredString(value.name, "Saved report chart name must be a string"),
    type: requiredString(value.type, "Saved report chart type must be a string") as ReportChartDefinition["type"],
    group: requiredString(value.group, "Saved report chart group must be a string"),
    summary: requiredString(value.summary, "Saved report chart summary must be a string"),
    ...optionalStringField(value, "label"),
    ...(value.maxPoints === undefined ? {} : { maxPoints: integerValue(value.maxPoints, "Saved report chart maxPoints must be an integer") }),
    ...(value.orderBy === undefined ? {} : { orderBy: requiredString(value.orderBy, "Saved report chart orderBy must be a string") as ReportChartOrderBy }),
    ...(value.order === undefined ? {} : { order: reportOrderValue(value.order) }),
    ...(value.colors === undefined ? {} : { colors: stringArray(value.colors, "Saved report chart colors must be strings") }),
    ...(value.showValues === undefined ? {} : { showValues: booleanValue(value.showValues, "Saved report chart showValues must be a boolean") }),
    ...optionalStringField(value, "xAxisLabel"),
    ...optionalStringField(value, "yAxisLabel")
  };
}

function formulaValue(value: Record<string, unknown>): NonNullable<ReportColumnDefinition["formula"]> {
  return formulaValueWithLabel(value, "Saved report formula", 1);
}

function formulaOperandValue(value: unknown, label: string, depth: number): ReportFormulaOperand {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (isRecord(value)) {
    return formulaValueWithLabel(value, label, depth);
  }
  throw badRequest(`${label} must be a string, finite number, or nested formula`);
}

function formulaValueWithLabel(
  value: Record<string, unknown>,
  label: string,
  depth: number
): NonNullable<ReportColumnDefinition["formula"]> {
  if (depth > REPORT_FORMULA_MAX_DEPTH) {
    throw badRequest(`${label} exceeds maximum formula depth of ${REPORT_FORMULA_MAX_DEPTH}`);
  }
  return {
    operator: requiredString(value.operator, `${label} operator must be a string`) as NonNullable<ReportColumnDefinition["formula"]>["operator"],
    left: formulaOperandValue(value.left, `${label} left`, depth + 1),
    right: formulaOperandValue(value.right, `${label} right`, depth + 1)
  };
}

function optionalStringField(value: Record<string, unknown>, key: string): Record<string, string> {
  if (value[key] === undefined) {
    return {};
  }
  return { [key]: requiredString(value[key], `Saved report ${key} must be a string`) };
}

function optionalFieldType(value: Record<string, unknown>): { readonly type?: FieldType } {
  if (value.type === undefined) {
    return {};
  }
  return { type: requiredString(value.type, "Saved report type must be a string") as FieldType };
}

function reportOrderValue(value: unknown): ReportOrder {
  if (value === "asc" || value === "desc") {
    return value;
  }
  throw badRequest("Saved report order must be asc or desc");
}

function objectArray(value: unknown, field: string): readonly Record<string, unknown>[] {
  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw badRequest(`Saved report definition '${field}' must be an array of objects`);
  }
  return value;
}

function stringArray(value: unknown, message: string): readonly string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw badRequest(message);
  }
  return value;
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string") {
    throw badRequest(message);
  }
  return value;
}

function booleanValue(value: unknown, message: string): boolean {
  if (typeof value !== "boolean") {
    throw badRequest(message);
  }
  return value;
}

function integerValue(value: unknown, message: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw badRequest(message);
  }
  return value;
}

function jsonPrimitiveValue(value: unknown, message: string): JsonPrimitive {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  throw badRequest(message);
}

function reportFilterValue(value: unknown, message: string): Exclude<ReportFilterDefinition["defaultValue"], undefined> {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value) && value.every((item) =>
    item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean"
  )) {
    return value;
  }
  throw badRequest(message);
}

function recordValue(value: unknown, message: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw badRequest(message);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
