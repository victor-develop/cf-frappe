import { Hono } from "hono";
import type { JsonValue } from "../../core/types.js";
import type { WebViewItem, WebViewMetadata, WebViewResolvedField, WebViewService } from "../../application/web-view-service.js";
import type { ActorResolver } from "./actor.js";
import { parseOptionalInteger } from "./request.js";

export interface WebViewApiOptions {
  readonly webViews: WebViewService;
  readonly actor: ActorResolver;
}

export function createWebViewApi(options: WebViewApiOptions): Hono {
  const app = new Hono();

  app.get("/api/meta/web-views", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: await options.webViews.listWebViews(actor) });
  });

  app.get("/api/meta/web-views/:webView", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: await options.webViews.getWebView(actor, c.req.param("webView")) });
  });

  app.get("/api/web-view/:webView", async (c) => {
    const actor = await options.actor(c.req.raw);
    const limit = parseOptionalInteger(c.req.query("limit"));
    const result = await options.webViews.listItems(actor, c.req.param("webView"), {
      ...(limit === undefined ? {} : { limit })
    });
    return c.json({ data: result });
  });

  app.get("/api/web-view/:webView/:route", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: await options.webViews.getItem(actor, c.req.param("webView"), c.req.param("route")) });
  });

  app.get("/web/:webView", async (c) => {
    const actor = await options.actor(c.req.raw);
    const metadata = await options.webViews.getWebView(actor, c.req.param("webView"));
    const result = await options.webViews.listItems(actor, metadata.view.name);
    return html(renderWebViewList(metadata, result.items));
  });

  app.get("/web/:webView/:route", async (c) => {
    const actor = await options.actor(c.req.raw);
    const metadata = await options.webViews.getWebView(actor, c.req.param("webView"));
    const result = await options.webViews.getItem(actor, metadata.view.name, c.req.param("route"));
    return html(renderWebViewItem(metadata, result.item));
  });

  return app;
}

function renderWebViewList(metadata: WebViewMetadata, items: readonly WebViewItem[]): string {
  const title = metadata.view.label ?? metadata.view.name;
  const description = metadata.view.description ? `<p>${escapeHtml(metadata.view.description)}</p>` : "";
  const rows = items
    .map((item) => `<li><a href="/web/${encodeURIComponent(metadata.view.name)}/${encodeURIComponent(item.route)}">${escapeHtml(item.title)}</a></li>`)
    .join("");
  return page(title, `<main><h1>${escapeHtml(title)}</h1>${description}<ul>${rows || "<li>No published items.</li>"}</ul></main>`);
}

function renderWebViewItem(metadata: WebViewMetadata, item: WebViewItem): string {
  const rows = metadata.fields
    .map((field) => renderField(field, item.data[field.field]))
    .join("");
  return page(item.title, `<main><a href="/web/${encodeURIComponent(metadata.view.name)}">Back</a><h1>${escapeHtml(item.title)}</h1>${rows}</main>`);
}

function renderField(field: WebViewResolvedField, value: JsonValue | undefined): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  return `<section><h2>${escapeHtml(field.label)}</h2><p>${escapeHtml(formatValue(value))}</p></section>`;
}

function formatValue(value: JsonValue): string {
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function page(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>
body { margin: 0; font: 15px/1.55 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #f9fafb; }
main { width: min(760px, calc(100vw - 32px)); margin: 40px auto; }
h1 { margin: 0 0 16px; font-size: 32px; line-height: 1.2; }
h2 { margin: 24px 0 6px; font-size: 16px; }
p, li { color: #374151; }
ul { display: grid; gap: 12px; padding-left: 20px; }
a { color: #1d4ed8; }
</style></head><body>${body}</body></html>`;
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
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
