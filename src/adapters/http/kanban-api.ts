import { Hono } from "hono";
import type { KanbanService } from "../../application/kanban-service.js";
import type { ActorResolver } from "./actor.js";

export interface KanbanApiOptions {
  readonly kanbans: KanbanService;
  readonly actor: ActorResolver;
}

export function createKanbanApi(options: KanbanApiOptions): Hono {
  const app = new Hono();

  app.get("/api/meta/kanbans", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: await options.kanbans.listKanbans(actor) });
  });

  app.get("/api/meta/kanbans/:kanban", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: await options.kanbans.getKanban(actor, c.req.param("kanban")) });
  });

  app.get("/api/kanban/:kanban/run", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: await options.kanbans.runKanban(actor, c.req.param("kanban")) });
  });

  return app;
}
