import { Hono } from "hono";
import type { PrintSettingsService } from "../../application/print-settings-service.js";
import type { PrintService } from "../../application/print-service.js";
import { badRequest } from "../../core/errors.js";
import type { PrintPdfRenderer } from "../../ports/print-pdf-renderer.js";
import { printPdfResponseBody, printPdfResponseHeaders, renderPrintDocument, renderPrintPdfDocument } from "../print/index.js";
import type { ActorResolver } from "./actor.js";
import { readJsonObject, requestMetadata } from "./request.js";

export interface PrintApiOptions {
  readonly prints: PrintService;
  readonly printSettings?: PrintSettingsService;
  readonly pdfRenderer?: PrintPdfRenderer;
  readonly actor: ActorResolver;
  readonly maxJsonBytes?: number;
}

export function createPrintApi(options: PrintApiOptions): Hono {
  const app = new Hono();
  const maxJsonBytes = options.maxJsonBytes ?? 1_048_576;

  app.get("/api/meta/print-formats", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = c.req.query("doctype");
    return c.json({ data: options.prints.listPrintFormats(actor, doctype) });
  });

  app.get("/api/meta/print-formats/:format", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: options.prints.getPrintFormat(actor, c.req.param("format")) });
  });

  app.get("/api/meta/print-letterheads", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: options.prints.listPrintLetterheads(actor) });
  });

  app.get("/api/meta/print-letterheads/:letterhead", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: options.prints.getPrintLetterhead(actor, c.req.param("letterhead")) });
  });

  app.get("/api/print-settings", async (c) => {
    if (!options.printSettings) {
      throw badRequest("Print settings are not configured");
    }
    const actor = await options.actor(c.req.raw);
    return c.json({ data: await options.printSettings.get(actor, c.req.query("tenant")) });
  });

  app.put("/api/print-settings", async (c) => {
    if (!options.printSettings) {
      throw badRequest("Print settings are not configured");
    }
    const actor = await options.actor(c.req.raw);
    const tenantId = c.req.query("tenant");
    options.printSettings.authorizeAdministration(actor, tenantId);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const data = await options.printSettings.change({
      actor,
      settings: withoutKeys(body, ["expectedVersion"]),
      ...(body.expectedVersion === undefined ? {} : { expectedVersion: integerValue(body.expectedVersion, "expectedVersion") }),
      ...(tenantId === undefined ? {} : { tenantId }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data });
  });

  app.get("/api/print/:format/:name/pdf", async (c) => {
    if (!options.pdfRenderer) {
      throw badRequest("PDF print rendering is not configured");
    }
    const actor = await options.actor(c.req.raw);
    const view = await options.prints.printDocument(actor, c.req.param("format"), c.req.param("name"));
    const pdf = await renderPrintPdfDocument({ actor, renderer: options.pdfRenderer, view });
    return new Response(printPdfResponseBody(pdf.body), { headers: printPdfResponseHeaders(pdf) });
  });

  app.get("/api/print/:format/:name", async (c) => {
    const actor = await options.actor(c.req.raw);
    const view = await options.prints.printDocument(actor, c.req.param("format"), c.req.param("name"));
    return c.html(renderPrintDocument(view));
  });

  return app;
}

function withoutKeys<T extends Record<string, unknown>>(input: T, keys: readonly string[]): Record<string, unknown> {
  const excluded = new Set(keys);
  return Object.fromEntries(Object.entries(input).filter(([key]) => !excluded.has(key)));
}

function integerValue(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw badRequest(`${field} must be an integer`);
  }
  return value;
}
