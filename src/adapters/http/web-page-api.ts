import { Hono } from "hono";
import type { WebPageDefinition, WebPageSectionDefinition } from "../../core/web-page.js";
import type { WebPageService } from "../../application/web-page-service.js";
import type { ActorResolver } from "./actor.js";

export interface WebPageApiOptions {
  readonly webPages: WebPageService;
  readonly actor: ActorResolver;
}

export function createWebPageApi(options: WebPageApiOptions): Hono {
  const app = new Hono();

  app.get("/api/meta/web-pages", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: options.webPages.listWebPages(actor) });
  });

  app.get("/api/meta/web-pages/:webPage", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: options.webPages.getWebPage(actor, c.req.param("webPage")) });
  });

  app.get("/page/:route{.+}", async (c) => {
    const actor = await options.actor(c.req.raw);
    return html(renderWebPage(options.webPages.getWebPageByRoute(actor, c.req.param("route"))));
  });

  app.get("/page/:route", async (c) => {
    const actor = await options.actor(c.req.raw);
    return html(renderWebPage(options.webPages.getWebPageByRoute(actor, c.req.param("route"))));
  });

  return app;
}

function renderWebPage(pageDefinition: WebPageDefinition): string {
  const description = pageDefinition.description === undefined ? "" : `<p>${escapeHtml(pageDefinition.description)}</p>`;
  return page(pageDefinition.title, `<main><h1>${escapeHtml(pageDefinition.title)}</h1>${description}${pageDefinition.sections.map(renderSection).join("")}</main>`);
}

function renderSection(section: WebPageSectionDefinition): string {
  const heading = section.heading === undefined ? "" : `<h2>${escapeHtml(section.heading)}</h2>`;
  return `<section>${heading}<p>${escapeHtml(section.body)}</p></section>`;
}

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
body { margin: 0; font: 15px/1.6 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #f9fafb; }
main { width: min(760px, calc(100vw - 32px)); margin: 40px auto; }
h1 { margin: 0 0 16px; font-size: 34px; line-height: 1.15; }
h2 { margin: 28px 0 8px; font-size: 18px; }
p { color: #374151; white-space: pre-wrap; }
</style></head><body>${body}</body></html>`;
}

function html(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8"
    }
  });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
