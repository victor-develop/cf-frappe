import { Hono } from "hono";
import type { WebPageDefinition, WebPageSectionDefinition } from "../../core/web-page.js";
import type { WebPageService } from "../../application/web-page-service.js";
import type { WebsiteSettingsService } from "../../application/website-settings-service.js";
import type { WebsiteThemeDefinition } from "../../core/website-theme.js";
import type { Actor } from "../../core/types.js";
import type { ActorResolver } from "./actor.js";

export interface WebPageApiOptions {
  readonly webPages: WebPageService;
  readonly websiteSettings?: Pick<WebsiteSettingsService, "getWebsiteSettings">;
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
    return html(renderWebPage(options.webPages.getWebPageByRoute(actor, c.req.param("route")), resolveTheme(options.websiteSettings, actor)));
  });

  app.get("/page/:route", async (c) => {
    const actor = await options.actor(c.req.raw);
    return html(renderWebPage(options.webPages.getWebPageByRoute(actor, c.req.param("route")), resolveTheme(options.websiteSettings, actor)));
  });

  return app;
}

function renderWebPage(pageDefinition: WebPageDefinition, theme: WebsiteThemeDefinition | undefined): string {
  const description = pageDefinition.description === undefined ? "" : `<p>${escapeHtml(pageDefinition.description)}</p>`;
  return page(
    pageDefinition.title,
    `<main><h1>${escapeHtml(pageDefinition.title)}</h1>${description}${pageDefinition.sections.map(renderSection).join("")}</main>`,
    theme
  );
}

function renderSection(section: WebPageSectionDefinition): string {
  const heading = section.heading === undefined ? "" : `<h2>${escapeHtml(section.heading)}</h2>`;
  return `<section>${heading}<p>${escapeHtml(section.body)}</p></section>`;
}

function page(title: string, body: string, theme: WebsiteThemeDefinition | undefined): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
${themeCss(theme)}body { margin: 0; font: 15px/1.6 var(--cf-frappe-font-family); color: var(--cf-frappe-text); background: var(--cf-frappe-background); }
main { width: min(760px, calc(100vw - 32px)); margin: 40px auto; }
h1 { margin: 0 0 16px; font-size: 34px; line-height: 1.15; color: var(--cf-frappe-heading); }
h2 { margin: 28px 0 8px; font-size: 18px; color: var(--cf-frappe-heading); }
p { color: var(--cf-frappe-muted-text); white-space: pre-wrap; }
a { color: var(--cf-frappe-link); }
</style></head><body>${body}</body></html>`;
}

function resolveTheme(
  settings: Pick<WebsiteSettingsService, "getWebsiteSettings"> | undefined,
  actor: Actor
): WebsiteThemeDefinition | undefined {
  try {
    return settings?.getWebsiteSettings(actor).theme;
  } catch (error) {
    if (isExpectedSettingsMiss(error)) {
      return undefined;
    }
    throw error;
  }
}

function themeCss(theme: WebsiteThemeDefinition | undefined): string {
  const tokens = theme?.tokens;
  return `:root {
  --cf-frappe-font-family: ${theme?.fontFamily ?? 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'};
  --cf-frappe-primary: ${tokens?.primaryColor ?? "#2563eb"};
  --cf-frappe-background: ${tokens?.backgroundColor ?? "#f9fafb"};
  --cf-frappe-surface: ${tokens?.surfaceColor ?? "#ffffff"};
  --cf-frappe-text: ${tokens?.textColor ?? "#111827"};
  --cf-frappe-muted-text: ${tokens?.mutedTextColor ?? "#374151"};
  --cf-frappe-heading: ${tokens?.headingColor ?? tokens?.textColor ?? "#111827"};
  --cf-frappe-link: ${tokens?.linkColor ?? tokens?.primaryColor ?? "#2563eb"};
}
`;
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

function isExpectedSettingsMiss(error: unknown): boolean {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "WEBSITE_SETTINGS_NOT_FOUND" || error.code === "PERMISSION_DENIED");
}
