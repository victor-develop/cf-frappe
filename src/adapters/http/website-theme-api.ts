import { Hono } from "hono";
import type { WebsiteThemeService } from "../../application/website-theme-service.js";

export interface WebsiteThemeApiOptions {
  readonly websiteThemes: WebsiteThemeService;
}

export function createWebsiteThemeApi(options: WebsiteThemeApiOptions): Hono {
  const app = new Hono();

  app.get("/api/meta/website-themes", (c) => c.json({ data: options.websiteThemes.listWebsiteThemes() }));

  app.get("/api/meta/website-themes/:theme", (c) =>
    c.json({ data: options.websiteThemes.getWebsiteTheme(c.req.param("theme")) })
  );

  return app;
}
