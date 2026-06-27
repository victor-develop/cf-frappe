import { notFound, permissionDenied } from "../core/errors.js";
import { assertWebViewMatchesDocType, canReadWebView, type WebViewDefinition } from "../core/web-view.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Actor, DocTypeDefinition, DocumentSnapshot, FieldDefinition, JsonValue, ListDocumentsFilter } from "../core/types.js";
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
  readonly limit: number;
}

export interface WebViewServiceOptions {
  readonly registry: ModelRegistry;
  readonly queries: QueryService;
}

const DEFAULT_WEB_VIEW_LIMIT = 20;

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
    options: { readonly limit?: number } = {}
  ): Promise<WebViewListResult> {
    const metadata = await this.getWebView(actor, webViewName);
    const limit = clampLimit(options.limit, metadata.view.pageSize ?? DEFAULT_WEB_VIEW_LIMIT);
    const result = await this.queries.listDocuments(actor, metadata.doctype, {
      filters: publishedFilters(metadata),
      limit,
      maxLimit: limit
    });
    const items = result.data.flatMap((document) => itemFromDocument(metadata, document) ?? []);
    return {
      view: metadata.view,
      items,
      total: items.length,
      limit
    };
  }

  async getItem(actor: Actor, webViewName: string, route: string): Promise<{ readonly view: WebViewDefinition; readonly item: WebViewItem }> {
    const metadata = await this.getWebView(actor, webViewName);
    const result = await this.queries.listDocuments(actor, metadata.doctype, {
      filters: [...publishedFilters(metadata), { field: metadata.routeField.field, value: route }],
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

function itemFromDocument(metadata: WebViewMetadata, document: DocumentSnapshot): WebViewItem | undefined {
  const routeValue = document.data[metadata.routeField.field];
  const titleValue = document.data[metadata.titleField.field];
  if (typeof routeValue !== "string" || !routeValue.trim()) {
    return undefined;
  }
  const route = routeValue;
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
    return configured;
  }
  return Number.isInteger(input) && input > 0 ? Math.min(input, configured) : configured;
}

function isPermissionDenied(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "PERMISSION_DENIED";
}
