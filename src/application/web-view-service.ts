import { notFound, permissionDenied } from "../core/errors.js";
import { assertWebViewMatchesDocType, canReadWebView, type WebViewDefinition } from "../core/web-view.js";
import { isCanonicalWebPageRoute } from "../core/web-page.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Actor, DocTypeDefinition } from "../core/types.js";
import type { QueryService } from "./query-service.js";
import { isPermissionDeniedError } from "./access-policy.js";
import {
  clampWebViewLimit,
  clampWebViewOffset,
  DEFAULT_WEB_VIEW_LIMIT,
  resolveWebViewMetadata,
  webViewFilterExpressionOption,
  webViewFilters,
  webViewItemFromDocument,
  webViewListResult,
  webViewOrderOptions,
  webViewPageLimit,
  webViewRouteFilters,
  type WebViewItem,
  type WebViewListResult,
  type WebViewMetadata
} from "./web-view-policy.js";

export type { WebViewItem, WebViewListResult, WebViewMetadata, WebViewResolvedField } from "./web-view-policy.js";

export interface WebViewServiceOptions {
  readonly registry: ModelRegistry;
  readonly queries: QueryService;
}

export class WebViewService {
  private readonly registry: ModelRegistry;
  private readonly queries: QueryService;

  constructor(options: WebViewServiceOptions) {
    this.registry = options.registry;
    this.queries = options.queries;
  }

  async listWebViews(actor: Actor): Promise<readonly WebViewDefinition[]> {
    const readable: WebViewDefinition[] = [];
    for (const webView of this.registry.listWebViews()) {
      if (await this.canAccessWebView(actor, webView)) {
        readable.push(webView);
      }
    }
    return readable;
  }

  async getWebView(actor: Actor, webViewName: string): Promise<WebViewMetadata> {
    const webView = this.registry.getWebView(webViewName);
    if (!canReadWebView(actor, webView)) {
      throw permissionDenied(`Actor '${actor.id}' cannot read web view '${webView.name}'`);
    }
    const doctype = await this.readMetaFor(actor, webView);
    return resolveWebViewMetadata(webView, doctype);
  }

  async listItems(
    actor: Actor,
    webViewName: string,
    options: { readonly limit?: number; readonly offset?: number } = {}
  ): Promise<WebViewListResult> {
    const metadata = await this.getWebView(actor, webViewName);
    const limit = clampWebViewLimit(options.limit, metadata.view.pageSize ?? DEFAULT_WEB_VIEW_LIMIT);
    const offset = clampWebViewOffset(options.offset);
    const collected: WebViewItem[] = [];
    let visibleSeen = 0;
    let scanned = 0;
    let rawOffset = 0;
    let rawTotal = Number.POSITIVE_INFINITY;
    while (rawOffset < rawTotal && collected.length <= limit) {
      const pageLimit = webViewPageLimit(limit, scanned);
      const result = await this.queries.listDocuments(actor, metadata.doctype, {
        filters: webViewFilters(metadata),
        ...webViewFilterExpressionOption(metadata.view),
        ...webViewOrderOptions(metadata.view),
        limit: pageLimit,
        offset: rawOffset,
        maxLimit: pageLimit
      });
      rawTotal = result.total;
      rawOffset = result.offset + result.limit;
      scanned += result.limit;
      for (const document of result.data) {
        const item = webViewItemFromDocument(metadata, document);
        if (item === undefined) {
          continue;
        }
        if (visibleSeen >= offset) {
          collected.push(item);
          visibleSeen += 1;
          if (collected.length > limit) {
            break;
          }
          continue;
        }
        visibleSeen += 1;
      }
    }
    return webViewListResult({ metadata, collected, visibleSeen, rawOffset, rawTotal, limit, offset });
  }

  async getItem(actor: Actor, webViewName: string, route: string): Promise<{ readonly view: WebViewDefinition; readonly item: WebViewItem }> {
    const metadata = await this.getWebView(actor, webViewName);
    if (!isCanonicalWebPageRoute(route)) {
      throw notFound(`Web view '${metadata.view.name}' route '${route}' was not found`);
    }
    const result = await this.queries.listDocuments(actor, metadata.doctype, {
      filters: webViewRouteFilters(metadata, route),
      ...webViewFilterExpressionOption(metadata.view),
      ...webViewOrderOptions(metadata.view),
      limit: 1,
      maxLimit: 1
    });
    const document = result.data[0];
    if (document === undefined) {
      throw notFound(`Web view '${metadata.view.name}' route '${route}' was not found`);
    }
    const item = webViewItemFromDocument(metadata, document);
    if (item === undefined) {
      throw new Error(`Web view '${metadata.view.name}' resolved '${document.name}' without a route value`);
    }
    return {
      view: metadata.view,
      item
    };
  }

  private async canAccessWebView(actor: Actor, webView: WebViewDefinition): Promise<boolean> {
    if (!canReadWebView(actor, webView)) {
      return false;
    }
    try {
      await this.readMetaFor(actor, webView);
      return true;
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        return false;
      }
      throw error;
    }
  }

  private async readMetaFor(actor: Actor, webView: WebViewDefinition): Promise<DocTypeDefinition> {
    const doctype = await this.queries.getEffectiveMeta(actor, webView.doctype);
    assertWebViewMatchesDocType(webView, doctype);
    return doctype;
  }
}
