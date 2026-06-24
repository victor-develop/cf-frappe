import { Hono } from "hono";
import type { PrintService } from "../../application/print-service.js";
import { badRequest } from "../../core/errors.js";
import type { PrintPdfRenderer } from "../../ports/print-pdf-renderer.js";
import { printPdfResponseBody, printPdfResponseHeaders, renderPrintDocument, renderPrintPdfDocument } from "../print/index.js";
import type { ActorResolver } from "./actor.js";

export interface PrintApiOptions {
  readonly prints: PrintService;
  readonly pdfRenderer?: PrintPdfRenderer;
  readonly actor: ActorResolver;
}

export function createPrintApi(options: PrintApiOptions): Hono {
  const app = new Hono();

  app.get("/api/meta/print-formats", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = c.req.query("doctype");
    return c.json({ data: options.prints.listPrintFormats(actor, doctype) });
  });

  app.get("/api/meta/print-formats/:format", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: options.prints.getPrintFormat(actor, c.req.param("format")) });
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
