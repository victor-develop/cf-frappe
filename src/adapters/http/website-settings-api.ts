import { Hono } from "hono";
import type { WebsiteSettingsService } from "../../application/website-settings-service.js";
import type { ActorResolver } from "./actor.js";

export interface WebsiteSettingsApiOptions {
  readonly websiteSettings: WebsiteSettingsService;
  readonly actor: ActorResolver;
}

export function createWebsiteSettingsApi(options: WebsiteSettingsApiOptions): Hono {
  const app = new Hono();

  app.get("/api/meta/website-settings", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: await options.websiteSettings.getWebsiteSettings(actor) });
  });

  app.get("/", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.redirect(await options.websiteSettings.getHomePageHref(actor), 302);
  });

  return app;
}
