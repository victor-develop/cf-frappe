import { Hono } from "hono";
import type { DashboardService } from "../../application/dashboard-service.js";
import type { ActorResolver } from "./actor.js";

export interface DashboardApiOptions {
  readonly dashboards: DashboardService;
  readonly actor: ActorResolver;
}

export function createDashboardApi(options: DashboardApiOptions): Hono {
  const app = new Hono();

  app.get("/api/meta/dashboards", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: await options.dashboards.listDashboards(actor) });
  });

  app.get("/api/meta/dashboards/:dashboard", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: await options.dashboards.getDashboard(actor, c.req.param("dashboard")) });
  });

  app.get("/api/dashboard/:dashboard/run", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: await options.dashboards.runDashboard(actor, c.req.param("dashboard")) });
  });

  return app;
}
