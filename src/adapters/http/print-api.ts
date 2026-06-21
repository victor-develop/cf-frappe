import { Hono } from "hono";
import type { PrintService } from "../../application/print-service";
import { renderPrintDocument } from "../print";
import type { ActorResolver } from "./actor";

export interface PrintApiOptions {
  readonly prints: PrintService;
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

  app.get("/api/print/:format/:name", async (c) => {
    const actor = await options.actor(c.req.raw);
    const view = await options.prints.printDocument(actor, c.req.param("format"), c.req.param("name"));
    return c.html(renderPrintDocument(view));
  });

  return app;
}
