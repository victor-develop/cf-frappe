import { badRequest, notFound, permissionDenied } from "../core/errors.js";
import { assertWebViewMatchesDocType, canReadWebView, type WebViewDefinition } from "../core/web-view.js";
import { isCanonicalWebPageRoute } from "../core/web-page.js";
import type { ModelRegistry } from "../core/registry.js";
import type {
  Actor,
  DocTypeDefinition,
  DocumentSnapshot,
  FieldDefinition,
  JsonValue,
  ListDocumentsFilter,
  ListFilterExpression,
  ListOrderDirection
} from "../core/types.js";
import type { QueryService } from "./query-service.js";

export interface WebViewResolvedField {
  readonly field: string;
  readonly label: string;
  readonly type: FieldDefinition["type"];
}

export interface WebViewMetadata {
  readonly view: WebViewDefinition;
  readonly doctype: string;
  readonly routeField: WebViewResolvedField;
  readonly titleField: WebViewResolvedField;
  readonly publishedField?: WebViewResolvedField;
  readonly fields: readonly WebViewResolvedField[];
}

export interface WebViewItem {
  readonly doctype: string;
  readonly name: string;
  readonly route: string;
  readonly title: string;
  readonly data: Readonly<Record<string, JsonValue | undefined>>;
}

export interface WebViewListResult {
  readonly view: WebViewDefinition;
  readonly items: readonly WebViewItem[];
  readonly total: number;
  readonly totalIsExact: boolean;
  readonly limit: number;
  readonly offset: number;
  readonly hasMore: boolean;
  readonly nextOffset?: number;
}

export interface WebViewServiceOptions {
  readonly registry: ModelRegistry;
  readonly queries: QueryService;
}

const DEFAULT_WEB_VIEW_LIMIT = 20;
const MAX_WEB_VIEW_LIMIT = 200;
const MAX_WEB_VIEW_SCAN_DOCUMENTS = 1_000;

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
    return {
      view: webView,
      doctype: doctype.name,
      routeField: resolveField(webView.routeField, doctype),
      titleField: resolveField(webView.titleField, doctype),
      ...(webView.publishedField === undefined ? {} : { publishedField: resolveField(webView.publishedField, doctype) }),
      fields: (webView.fields ?? []).map((field) => resolveField(field.field, doctype, field.label))
    };
  }

  async listItems(
    actor: Actor,
    webViewName: string,
    options: { readonly limit?: number; readonly offset?: number } = {}
  ): Promise<WebViewListResult> {
    const metadata = await this.getWebView(actor, webViewName);
    const limit = clampLimit(options.limit, metadata.view.pageSize ?? DEFAULT_WEB_VIEW_LIMIT);
    const offset = clampOffset(options.offset);
    const collected: WebViewItem[] = [];
    let visibleSeen = 0;
    let scanned = 0;
    let rawOffset = 0;
    let rawTotal = Number.POSITIVE_INFINITY;
    while (rawOffset < rawTotal && collected.length <= limit) {
      const remainingScan = MAX_WEB_VIEW_SCAN_DOCUMENTS - scanned;
      if (remainingScan <= 0) {
        throw badRequest(
          `Web view pagination scanned more than ${MAX_WEB_VIEW_SCAN_DOCUMENTS} documents; use a smaller offset or a more selective published field`
        );
      }
      const pageLimit = Math.min(Math.max(limit + 1, DEFAULT_WEB_VIEW_LIMIT), remainingScan);
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
        const item = itemFromDocument(metadata, document);
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
    const hasMore = collected.length > limit;
    const items = hasMore ? collected.slice(0, limit) : collected;
    const totalIsExact = !hasMore && rawOffset >= rawTotal;
    return {
      view: metadata.view,
      items,
      total: visibleSeen,
      totalIsExact,
      limit,
      offset,
      hasMore,
      ...(hasMore ? { nextOffset: offset + items.length } : {})
    };
  }

  async getItem(actor: Actor, webViewName: string, route: string): Promise<{ readonly view: WebViewDefinition; readonly item: WebViewItem }> {
    const metadata = await this.getWebView(actor, webViewName);
    if (!isCanonicalWebPageRoute(route)) {
      throw notFound(`Web view '${metadata.view.name}' route '${route}' was not found`);
    }
    const result = await this.queries.listDocuments(actor, metadata.doctype, {
      filters: [...webViewFilters(metadata), { field: metadata.routeField.field, value: route }],
      ...webViewFilterExpressionOption(metadata.view),
      ...webViewOrderOptions(metadata.view),
      limit: 1,
      maxLimit: 1
    });
    const document = result.data[0];
    if (document === undefined) {
      throw notFound(`Web view '${metadata.view.name}' route '${route}' was not found`);
    }
    const item = itemFromDocument(metadata, document);
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
      if (isPermissionDenied(error)) {
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

function resolveField(fieldName: string, doctype: DocTypeDefinition, label?: string): WebViewResolvedField {
  const field = doctype.fields.find((candidate) => candidate.name === fieldName);
  if (field === undefined) {
    throw new Error(`Registry accepted web view field '${fieldName}' without a matching field`);
  }
  return {
    field: field.name,
    label: label ?? field.label ?? field.name,
    type: field.type
  };
}

function publishedFilters(metadata: WebViewMetadata): readonly ListDocumentsFilter[] {
  return metadata.publishedField === undefined ? [] : [{ field: metadata.publishedField.field, value: true }];
}

function webViewFilters(metadata: WebViewMetadata): readonly ListDocumentsFilter[] {
  return [...(metadata.view.filters ?? []), ...publishedFilters(metadata)];
}

function webViewFilterExpressionOption(webView: WebViewDefinition): { readonly filterExpression?: ListFilterExpression } {
  return webView.filterExpression === undefined ? {} : { filterExpression: webView.filterExpression };
}

function webViewOrderOptions(webView: WebViewDefinition): { readonly orderBy?: string; readonly order?: ListOrderDirection } {
  return {
    ...(webView.orderBy === undefined ? {} : { orderBy: webView.orderBy }),
    ...(webView.order === undefined ? {} : { order: webView.order })
  };
}

function itemFromDocument(metadata: WebViewMetadata, document: DocumentSnapshot): WebViewItem | undefined {
  const routeValue = document.data[metadata.routeField.field];
  const titleValue = document.data[metadata.titleField.field];
  if (typeof routeValue !== "string" || !routeValue.trim()) {
    return undefined;
  }
  const route = routeValue;
  if (!isCanonicalWebPageRoute(route)) {
    return undefined;
  }
  const title = typeof titleValue === "string" && titleValue.trim() ? titleValue : document.name;
  const data: Record<string, JsonValue | undefined> = {};
  for (const field of metadata.fields) {
    data[field.field] = document.data[field.field];
  }
  return {
    doctype: metadata.doctype,
    name: document.name,
    route,
    title,
    data
  };
}

function clampLimit(input: number | undefined, configured: number): number {
  if (input === undefined) {
    return Math.min(configured, MAX_WEB_VIEW_LIMIT);
  }
  return Number.isInteger(input) && input > 0
    ? Math.min(input, configured, MAX_WEB_VIEW_LIMIT)
    : Math.min(configured, MAX_WEB_VIEW_LIMIT);
}

function clampOffset(input: number | undefined): number {
  if (input === undefined) {
    return 0;
  }
  return Number.isInteger(input) && input > 0 ? input : 0;
}

function isPermissionDenied(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "PERMISSION_DENIED";
}
