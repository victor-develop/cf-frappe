import { Hono } from "hono";
import type { DataPatchAdminPort } from "../../application/data-patch-service.js";
import type { ActorResolver } from "./actor.js";

export interface DataPatchApiOptions {
  readonly dataPatches: DataPatchAdminPort;
  readonly actor: ActorResolver;
}

export function createDataPatchApi(options: DataPatchApiOptions): Hono {
  const app = new Hono();

  app.get("/api/data-patches", async (c) => {
    const actor = await options.actor(c.req.raw);
    const data = await options.dataPatches.dashboard(actor);
    return c.json({ data });
  });

  app.post("/api/data-patches/apply", async (c) => {
    const actor = await options.actor(c.req.raw);
    const data = await options.dataPatches.apply(actor);
    return c.json({ data }, 201);
  });

  return app;
}
