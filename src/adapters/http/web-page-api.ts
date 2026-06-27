import { Hono } from "hono";
import type { WebPageDefinition, WebPageSectionDefinition } from "../../core/web-page.js";
import type { WebPageService } from "../../application/web-page-service.js";
import type { ActorResolver } from "./actor.js";
import { escapeHtml, resolveWebsitePresentation, websitePage, type WebsitePresentation, type WebsiteSettingsReader } from "./website-rendering.js";

export interface WebPageApiOptions {
  readonly webPages: WebPageService;
  readonly websiteSettings?: WebsiteSettingsReader;
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
    return html(renderWebPage(options.webPages.getWebPageByRoute(actor, c.req.param("route")), resolveWebsitePresentation(options.websiteSettings, actor)));
  });

  app.get("/page/:route", async (c) => {
    const actor = await options.actor(c.req.raw);
    return html(renderWebPage(options.webPages.getWebPageByRoute(actor, c.req.param("route")), resolveWebsitePresentation(options.websiteSettings, actor)));
  });

  return app;
}

function renderWebPage(pageDefinition: WebPageDefinition, presentation: WebsitePresentation): string {
  const description = pageDefinition.description === undefined ? "" : `<p>${escapeHtml(pageDefinition.description)}</p>`;
  return websitePage(
    pageDefinition.title,
    `<main><h1>${escapeHtml(pageDefinition.title)}</h1>${description}${pageDefinition.sections.map(renderSection).join("")}</main>`,
    presentation
  );
}

function renderSection(section: WebPageSectionDefinition): string {
  const heading = section.heading === undefined ? "" : `<h2>${escapeHtml(section.heading)}</h2>`;
  return `<section>${heading}<p>${escapeHtml(section.body)}</p></section>`;
}

function html(body: string): Response {
  return new Response(body, {
    headers: {
      "content-type": "text/html; charset=utf-8"
    }
  });
}
