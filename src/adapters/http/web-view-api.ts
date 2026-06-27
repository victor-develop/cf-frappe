import { Hono } from "hono";
import type { JsonValue } from "../../core/types.js";
import type {
  WebViewItem,
  WebViewListResult,
  WebViewMetadata,
  WebViewResolvedField,
  WebViewService
} from "../../application/web-view-service.js";
import type { ActorResolver } from "./actor.js";
import { parseOptionalInteger } from "./request.js";
import { escapeHtml, resolveWebsitePresentation, websitePage, type WebsitePresentation, type WebsiteSettingsReader } from "./website-rendering.js";

export interface WebViewApiOptions {
  readonly webViews: WebViewService;
  readonly websiteSettings?: WebsiteSettingsReader;
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
    const offset = parseOptionalInteger(c.req.query("offset"));
    const result = await options.webViews.listItems(actor, c.req.param("webView"), {
      ...(limit === undefined ? {} : { limit }),
      ...(offset === undefined ? {} : { offset })
    });
    return c.json({ data: result });
  });

  app.get("/api/web-view/:webView/:route{.+}", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: await options.webViews.getItem(actor, c.req.param("webView"), c.req.param("route")) });
  });

  app.get("/api/web-view/:webView/:route", async (c) => {
    const actor = await options.actor(c.req.raw);
    return c.json({ data: await options.webViews.getItem(actor, c.req.param("webView"), c.req.param("route")) });
  });

  app.get("/web/:webView", async (c) => {
    const actor = await options.actor(c.req.raw);
    const limit = parseOptionalInteger(c.req.query("limit"));
    const offset = parseOptionalInteger(c.req.query("offset"));
    const metadata = await options.webViews.getWebView(actor, c.req.param("webView"));
    const result = await options.webViews.listItems(actor, metadata.view.name, {
      ...(limit === undefined ? {} : { limit }),
      ...(offset === undefined ? {} : { offset })
    });
    return html(renderWebViewList(metadata, result, await resolveWebsitePresentation(options.websiteSettings, actor)));
  });

  app.get("/web/:webView/:route{.+}", async (c) => {
    const actor = await options.actor(c.req.raw);
    const metadata = await options.webViews.getWebView(actor, c.req.param("webView"));
    const result = await options.webViews.getItem(actor, metadata.view.name, c.req.param("route"));
    return html(renderWebViewItem(metadata, result.item, await resolveWebsitePresentation(options.websiteSettings, actor)));
  });

  app.get("/web/:webView/:route", async (c) => {
    const actor = await options.actor(c.req.raw);
    const metadata = await options.webViews.getWebView(actor, c.req.param("webView"));
    const result = await options.webViews.getItem(actor, metadata.view.name, c.req.param("route"));
    return html(renderWebViewItem(metadata, result.item, await resolveWebsitePresentation(options.websiteSettings, actor)));
  });

  return app;
}

function renderWebViewList(
  metadata: WebViewMetadata,
  result: WebViewListResult,
  presentation: WebsitePresentation
): string {
  const title = metadata.view.label ?? metadata.view.name;
  const description = metadata.view.description ? `<p>${escapeHtml(metadata.view.description)}</p>` : "";
  const rows = result.items
    .map((item) => `<li><a href="/web/${encodeURIComponent(metadata.view.name)}/${encodePath(item.route)}">${escapeHtml(item.title)}</a></li>`)
    .join("");
  const pagination = renderWebViewPagination(metadata.view.name, result);
  return websitePage(
    title,
    `<main><h1>${escapeHtml(title)}</h1>${description}<ul>${rows || "<li>No published items.</li>"}</ul>${pagination}</main>`,
    presentation
  );
}

function renderWebViewItem(
  metadata: WebViewMetadata,
  item: WebViewItem,
  presentation: WebsitePresentation
): string {
  const rows = metadata.fields
    .map((field) => renderField(field, item.data[field.field]))
    .join("");
  return websitePage(item.title, `<main><a href="/web/${encodeURIComponent(metadata.view.name)}">Back</a><h1>${escapeHtml(item.title)}</h1>${rows}</main>`, presentation);
}

function renderField(field: WebViewResolvedField, value: JsonValue | undefined): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  return `<section><h2>${escapeHtml(field.label)}</h2><p>${escapeHtml(formatValue(value))}</p></section>`;
}

function renderWebViewPagination(webViewName: string, result: WebViewListResult): string {
  const links: string[] = [];
  if (result.offset > 0) {
    links.push(`<a href="${escapeHtml(webViewListHref(webViewName, result.limit, Math.max(0, result.offset - result.limit)))}">Previous</a>`);
  }
  if (result.nextOffset !== undefined) {
    links.push(`<a href="${escapeHtml(webViewListHref(webViewName, result.limit, result.nextOffset))}">Next</a>`);
  }
  return links.length === 0 ? "" : `<nav aria-label="Web view pagination">${links.join(" ")}</nav>`;
}

function webViewListHref(webViewName: string, limit: number, offset: number): string {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  if (offset > 0) {
    params.set("offset", String(offset));
  }
  return `/web/${encodeURIComponent(webViewName)}?${params.toString()}`;
}

function formatValue(value: JsonValue): string {
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function encodePath(value: string): string {
  return value.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8"
    }
  });
}
