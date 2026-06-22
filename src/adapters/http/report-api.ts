import { Hono } from "hono";
import type { ReportFilters, ReportService } from "../../application/report-service";
import type { JsonPrimitive } from "../../core/types";
import type { ActorResolver } from "./actor";
import { parseOptionalInteger } from "./request";
import { writeReportCsvHeaders } from "./report-export";

export interface ReportApiOptions {
  readonly reports: ReportService;
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
    const limit = parseOptionalInteger(c.req.query("limit"));
    const csv = await options.reports.exportReportCsv(actor, c.req.param("report"), {
      filters: reportFiltersFromUrl(new URL(c.req.url)),
      ...(limit !== undefined ? { limit } : {})
    });
    writeReportCsvHeaders(c, csv);
    return c.body(csv.body);
  });

  app.get("/api/report/:report/run", async (c) => {
    const actor = await options.actor(c.req.raw);
    const limit = parseOptionalInteger(c.req.query("limit"));
    const offset = parseOptionalInteger(c.req.query("offset"));
    const result = await options.reports.runReport(actor, c.req.param("report"), {
      filters: reportFiltersFromUrl(new URL(c.req.url)),
      ...(limit !== undefined ? { limit } : {}),
      ...(offset !== undefined ? { offset } : {})
    });
    return c.json(result);
  });

  return app;
}

function reportFiltersFromUrl(url: URL): ReportFilters {
  const filters: Record<string, JsonPrimitive> = {};
  url.searchParams.forEach((value, key) => {
    if (key.startsWith("filter_")) {
      filters[key.slice("filter_".length)] = value;
    }
  });
  return filters;
}
