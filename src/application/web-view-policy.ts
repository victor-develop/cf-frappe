import { badRequest } from "../core/errors.js";
import { isCanonicalWebPageRoute } from "../core/web-page.js";
import { canReadWebView, type WebViewDefinition } from "../core/web-view.js";
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

export const DEFAULT_WEB_VIEW_LIMIT = 20;
export const MAX_WEB_VIEW_LIMIT = 200;
export const MAX_WEB_VIEW_SCAN_DOCUMENTS = 1_000;

export type WebViewReadAccessDecision =
  | { readonly status: "allow" }
  | { readonly status: "deny"; readonly message: string };

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

export type WebViewRouteRequestDecision =
  | { readonly status: "query" }
  | { readonly status: "not-found"; readonly message: string };

export type WebViewItemLookupDecision =
  | { readonly status: "found"; readonly item: WebViewItem }
  | { readonly status: "not-found"; readonly message: string }
  | { readonly status: "invalid"; readonly message: string };

export function planWebViewReadAccess(options: {
  readonly actor: Actor;
  readonly view: WebViewDefinition;
  readonly metadataReadable: boolean;
}): WebViewReadAccessDecision {
  if (!canReadWebView(options.actor, options.view) || !options.metadataReadable) {
    return {
      status: "deny",
      message: `Actor '${options.actor.id}' cannot read web view '${options.view.name}'`
    };
  }
  return { status: "allow" };
}

export function planWebViewRouteRequest(options: {
  readonly view: WebViewDefinition;
  readonly route: string;
}): WebViewRouteRequestDecision {
  return isCanonicalWebPageRoute(options.route)
    ? { status: "query" }
    : { status: "not-found", message: webViewRouteNotFoundMessage(options.view, options.route) };
}

export function planWebViewItemLookup(options: {
  readonly view: WebViewDefinition;
  readonly route: string;
  readonly documentName?: string;
  readonly item: WebViewItem | undefined;
}): WebViewItemLookupDecision {
  if (options.documentName === undefined) {
    return { status: "not-found", message: webViewRouteNotFoundMessage(options.view, options.route) };
  }
  if (options.item === undefined) {
    return {
      status: "invalid",
      message: `Web view '${options.view.name}' resolved '${options.documentName}' without a route value`
    };
  }
  return { status: "found", item: options.item };
}

export function resolveWebViewMetadata(
  view: WebViewDefinition,
  doctype: DocTypeDefinition
): WebViewMetadata {
  return {
    view,
    doctype: doctype.name,
    routeField: resolveWebViewField(view.routeField, doctype),
    titleField: resolveWebViewField(view.titleField, doctype),
    ...(view.publishedField === undefined ? {} : { publishedField: resolveWebViewField(view.publishedField, doctype) }),
    fields: (view.fields ?? []).map((field) => resolveWebViewField(field.field, doctype, field.label))
  };
}

export function resolveWebViewField(
  fieldName: string,
  doctype: DocTypeDefinition,
  label?: string
): WebViewResolvedField {
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

export function webViewFilters(metadata: WebViewMetadata): readonly ListDocumentsFilter[] {
  return [...(metadata.view.filters ?? []), ...webViewPublishedFilters(metadata)];
}

export function webViewRouteFilters(
  metadata: WebViewMetadata,
  route: string
): readonly ListDocumentsFilter[] {
  return [...webViewFilters(metadata), { field: metadata.routeField.field, value: route }];
}

export function webViewFilterExpressionOption(
  view: WebViewDefinition
): { readonly filterExpression?: ListFilterExpression } {
  return view.filterExpression === undefined ? {} : { filterExpression: view.filterExpression };
}

export function webViewOrderOptions(
  view: WebViewDefinition
): { readonly orderBy?: string; readonly order?: ListOrderDirection } {
  return {
    ...(view.orderBy === undefined ? {} : { orderBy: view.orderBy }),
    ...(view.order === undefined ? {} : { order: view.order })
  };
}

export function webViewItemFromDocument(
  metadata: WebViewMetadata,
  document: DocumentSnapshot
): WebViewItem | undefined {
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

export function clampWebViewLimit(input: number | undefined, configured: number): number {
  if (input === undefined) {
    return Math.min(configured, MAX_WEB_VIEW_LIMIT);
  }
  return Number.isInteger(input) && input > 0
    ? Math.min(input, configured, MAX_WEB_VIEW_LIMIT)
    : Math.min(configured, MAX_WEB_VIEW_LIMIT);
}

export function clampWebViewOffset(input: number | undefined): number {
  if (input === undefined) {
    return 0;
  }
  return Number.isInteger(input) && input > 0 ? input : 0;
}

export function webViewPageLimit(limit: number, scanned: number): number {
  const remainingScan = MAX_WEB_VIEW_SCAN_DOCUMENTS - scanned;
  if (remainingScan <= 0) {
    throw badRequest(
      `Web view pagination scanned more than ${MAX_WEB_VIEW_SCAN_DOCUMENTS} documents; use a smaller offset or a more selective published field`
    );
  }
  return Math.min(Math.max(limit + 1, DEFAULT_WEB_VIEW_LIMIT), remainingScan);
}

export function webViewListResult(options: {
  readonly metadata: WebViewMetadata;
  readonly collected: readonly WebViewItem[];
  readonly visibleSeen: number;
  readonly rawOffset: number;
  readonly rawTotal: number;
  readonly limit: number;
  readonly offset: number;
}): WebViewListResult {
  const hasMore = options.collected.length > options.limit;
  const items = hasMore ? options.collected.slice(0, options.limit) : options.collected;
  const totalIsExact = !hasMore && options.rawOffset >= options.rawTotal;
  return {
    view: options.metadata.view,
    items,
    total: options.visibleSeen,
    totalIsExact,
    limit: options.limit,
    offset: options.offset,
    hasMore,
    ...(hasMore ? { nextOffset: options.offset + items.length } : {})
  };
}

function webViewPublishedFilters(metadata: WebViewMetadata): readonly ListDocumentsFilter[] {
  return metadata.publishedField === undefined ? [] : [{ field: metadata.publishedField.field, value: true }];
}

function webViewRouteNotFoundMessage(view: WebViewDefinition, route: string): string {
  return `Web view '${view.name}' route '${route}' was not found`;
}
