import { Hono } from "hono";
import type { AnalyticsExportService } from "../../application/analytics-export-service.js";
import type { ActorResolver } from "./actor.js";

export interface AnalyticsApiOptions {
  readonly analyticsExports: AnalyticsExportService;
  readonly actor: ActorResolver;
}

/**
 * Admin endpoints for the analytics export (issue #16): how fresh each exported
 * DocType's copy is, and a way to re-export one after its projection was
 * rewritten in place (a rebuild or repair). Both are scoped to the actor's
 * tenant and need an admin role.
 */
export function createAnalyticsApi(options: AnalyticsApiOptions): Hono {
  const app = new Hono();

  app.get("/api/analytics/exports", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: await options.analyticsExports.status(actor) });
  });

  app.post("/api/analytics/exports/:doctype/reset", async (c) => {
    const actor = await options.actor(c.req.raw);
    const doctype = c.req.param("doctype");
    await options.analyticsExports.reset(actor, doctype);
    return c.json({ data: { doctype, reset: true } });
  });

  return app;
}
