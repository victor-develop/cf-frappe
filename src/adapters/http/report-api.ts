import { Hono } from "hono";
import type { PrintSettingsService } from "../../application/print-settings-service.js";
import type { ReportService } from "../../application/report-service.js";
import { badRequest } from "../../core/errors.js";
import type { PrintPdfRenderer } from "../../ports/print-pdf-renderer.js";
import { defaultPrintLayoutFor, printPdfResponseBody, printPdfResponseHeaders, renderPrintPdfReport } from "../print/index.js";
import type { ActorResolver } from "./actor.js";
import { parseOptionalInteger } from "./request.js";
import { writeReportCsvHeaders } from "./report-export.js";
import { reportFilterExpressionFromUrl, reportFiltersFromUrl, reportOrderingFromUrl } from "../report-request.js";

export interface ReportApiOptions {
  readonly reports: ReportService;
  readonly printSettings?: PrintSettingsService;
  readonly pdfRenderer?: PrintPdfRenderer;
  readonly actor: ActorResolver;
}

export function createReportApi(options: ReportApiOptions): Hono {
  const app = new Hono();

  app.get("/api/meta/reports", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: options.reports.listReports(actor) });
  });

  app.get("/api/meta/reports/:report", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: options.reports.getReport(actor, c.req.param("report")) });
  });

  app.get("/api/report/:report/export.csv", async (c) => {
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const limit = parseOptionalInteger(c.req.query("limit"));
    const filterExpression = reportFilterExpressionFromUrl(url);
    const csv = await options.reports.exportReportCsv(actor, c.req.param("report"), {
      filters: reportFiltersFromUrl(url),
      ...(filterExpression === undefined ? {} : { filterExpression }),
      ...reportOrderingFromUrl(url),
      ...(limit !== undefined ? { limit } : {})
    });
    writeReportCsvHeaders(c, csv);
    return c.body(csv.body);
  });

  app.get("/api/report/:report/pdf", async (c) => {
    if (!options.pdfRenderer) {
      throw badRequest("PDF print rendering is not configured");
    }
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const limit = parseOptionalInteger(c.req.query("limit"));
    const offset = parseOptionalInteger(c.req.query("offset"));
    const filterExpression = reportFilterExpressionFromUrl(url);
    const result = await options.reports.runReport(actor, c.req.param("report"), {
      filters: reportFiltersFromUrl(url),
      ...(filterExpression === undefined ? {} : { filterExpression }),
      ...reportOrderingFromUrl(url),
      ...(limit !== undefined ? { limit } : {}),
      ...(offset !== undefined ? { offset } : {})
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

  app.get("/api/report/:report/run", async (c) => {
    const actor = await options.actor(c.req.raw);
    const url = new URL(c.req.url);
    const limit = parseOptionalInteger(c.req.query("limit"));
    const offset = parseOptionalInteger(c.req.query("offset"));
    const filterExpression = reportFilterExpressionFromUrl(url);
    const result = await options.reports.runReport(actor, c.req.param("report"), {
      filters: reportFiltersFromUrl(url),
      ...(filterExpression === undefined ? {} : { filterExpression }),
      ...reportOrderingFromUrl(url),
      ...(limit !== undefined ? { limit } : {}),
      ...(offset !== undefined ? { offset } : {})
    });
    return c.json(result);
  });

  return app;
}
