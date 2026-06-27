import { FrameworkError } from "./errors.js";
import { isListFilterGroup, normalizeListFilterExpression, normalizeListFilters, normalizeListOrder } from "./list-view.js";
import {
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocTypeDefinition,
  type FieldDefinition,
  type ListDocumentsFilter,
  type ListFilterExpression,
  type ListOrderDirection
} from "./types.js";

export interface WebViewFieldDefinition {
  readonly field: string;
  readonly label?: string;
}

export interface WebViewDefinition {
  readonly name: string;
  readonly label?: string;
  readonly module?: string;
  readonly description?: string;
  readonly roles?: readonly string[];
  readonly doctype: string;
  readonly routeField: string;
  readonly titleField: string;
  readonly publishedField?: string;
  readonly fields?: readonly WebViewFieldDefinition[];
  readonly filters?: readonly ListDocumentsFilter[];
  readonly filterExpression?: ListFilterExpression;
  readonly pageSize?: number;
  readonly orderBy?: string;
  readonly order?: ListOrderDirection;
}

export function defineWebView(definition: WebViewDefinition): WebViewDefinition {
  assertWebViewDefinition(definition);
  return Object.freeze({
    ...definition,
    ...(definition.roles === undefined ? {} : { roles: Object.freeze([...definition.roles]) }),
    ...(definition.fields === undefined ? {} : { fields: Object.freeze(definition.fields.map((field) => Object.freeze({ ...field }))) }),
    ...(definition.filters === undefined
      ? {}
      : { filters: Object.freeze(definition.filters.map(freezeWebViewFilter)) }),
    ...(definition.filterExpression === undefined
      ? {}
      : { filterExpression: freezeWebViewFilterExpression(definition.filterExpression) })
  });
}

export function assertWebViewDefinition(definition: WebViewDefinition): void {
  assertWebViewIdentifier(definition.name, "web view name");
  assertWebViewIdentifier(definition.doctype, `web view '${definition.name}' DocType`);
  assertWebViewIdentifier(definition.routeField, `web view '${definition.name}' route field`);
  assertWebViewIdentifier(definition.titleField, `web view '${definition.name}' title field`);
  if (definition.publishedField !== undefined) {
    assertWebViewIdentifier(definition.publishedField, `web view '${definition.name}' published field`);
  }
  if (definition.pageSize !== undefined && (!Number.isInteger(definition.pageSize) || definition.pageSize <= 0)) {
    throw new FrameworkError("WEB_VIEW_INVALID", `Web view '${definition.name}' page size must be a positive integer`, {
      status: 400
    });
  }
  if (definition.orderBy !== undefined) {
    assertWebViewIdentifier(definition.orderBy, `web view '${definition.name}' orderBy field`);
  }
  const seen = new Set<string>();
  for (const field of definition.fields ?? []) {
    assertWebViewIdentifier(field.field, `web view '${definition.name}' field`);
    if (seen.has(field.field)) {
      throw new FrameworkError("WEB_VIEW_INVALID", `Web view '${definition.name}' has duplicate field '${field.field}'`, {
        status: 400
      });
    }
    seen.add(field.field);
  }
  if (definition.filterExpression !== undefined) {
    assertWebViewFilterExpressionShape(definition.name, definition.filterExpression);
  }
}

export function assertWebViewMatchesDocType(webView: WebViewDefinition, doctype: DocTypeDefinition): void {
  if (webView.doctype !== doctype.name) {
    throw new FrameworkError(
      "WEB_VIEW_INVALID",
      `Web view '${webView.name}' references DocType '${webView.doctype}' but was checked against '${doctype.name}'`,
      { status: 400 }
    );
  }
  assertRouteField(webView, doctype, webView.routeField, doctype.fields.find((field) => field.name === webView.routeField));
  assertDisplayField(webView, doctype, webView.titleField, doctype.fields.find((field) => field.name === webView.titleField));
  if (webView.publishedField !== undefined) {
    assertPublishedField(
      webView,
      doctype,
      webView.publishedField,
      doctype.fields.find((field) => field.name === webView.publishedField)
    );
  }
  normalizeListOrder(doctype, webView.orderBy, webView.order, { errorCode: "WEB_VIEW_INVALID" });
  assertFilterFieldsVisible(webView, doctype);
  normalizeListFilters(doctype, webView.filters ?? [], { errorCode: "WEB_VIEW_INVALID" });
  if (webView.filterExpression !== undefined) {
    normalizeListFilterExpression(doctype, webView.filterExpression, { errorCode: "WEB_VIEW_INVALID" });
  }
  for (const field of webView.fields ?? []) {
    assertDisplayField(webView, doctype, field.field, doctype.fields.find((candidate) => candidate.name === field.field));
  }
}

export function canReadWebView(actor: Actor, webView: WebViewDefinition): boolean {
  if (actor.roles.includes(SYSTEM_MANAGER_ROLE)) {
    return true;
  }
  return webView.roles === undefined || webView.roles.some((role) => actor.roles.includes(role));
}

function assertRouteField(
  webView: WebViewDefinition,
  doctype: DocTypeDefinition,
  fieldName: string,
  field: FieldDefinition | undefined
): void {
  const resolved = assertReadableField(webView, doctype, fieldName, field);
  if (resolved.type !== "text" && resolved.type !== "select") {
    throw new FrameworkError(
      "WEB_VIEW_INVALID",
      `Web view '${webView.name}' route field '${fieldName}' must be text or select`,
      { status: 400 }
    );
  }
}

function assertPublishedField(
  webView: WebViewDefinition,
  doctype: DocTypeDefinition,
  fieldName: string,
  field: FieldDefinition | undefined
): void {
  const resolved = assertReadableField(webView, doctype, fieldName, field);
  if (resolved.type !== "boolean") {
    throw new FrameworkError(
      "WEB_VIEW_INVALID",
      `Web view '${webView.name}' published field '${fieldName}' must be boolean`,
      { status: 400 }
    );
  }
}

function assertDisplayField(
  webView: WebViewDefinition,
  doctype: DocTypeDefinition,
  fieldName: string,
  field: FieldDefinition | undefined
): void {
  assertReadableField(webView, doctype, fieldName, field);
}

function assertFilterFieldsVisible(webView: WebViewDefinition, doctype: DocTypeDefinition): void {
  for (const filter of webView.filters ?? []) {
    assertFilterFieldVisible(webView, doctype, filter.field, "filter");
  }
  if (webView.filterExpression !== undefined) {
    assertFilterExpressionFieldsVisible(webView, doctype, webView.filterExpression);
  }
}

function assertFilterExpressionFieldsVisible(
  webView: WebViewDefinition,
  doctype: DocTypeDefinition,
  expression: ListFilterExpression
): void {
  if (isListFilterGroup(expression)) {
    for (const filter of expression.filters) {
      assertFilterExpressionFieldsVisible(webView, doctype, filter);
    }
    return;
  }
  if (typeof expression.field === "string") {
    assertFilterFieldVisible(webView, doctype, expression.field, "filter expression");
  }
}

function assertFilterFieldVisible(
  webView: WebViewDefinition,
  doctype: DocTypeDefinition,
  fieldName: string,
  label: "filter" | "filter expression"
): void {
  const field = doctype.fields.find((candidate) => candidate.name === fieldName);
  if (field?.hidden) {
    throw new FrameworkError(
      "WEB_VIEW_INVALID",
      `Web view '${webView.name}' ${label} field '${fieldName}' must not be hidden`,
      { status: 400 }
    );
  }
}

function assertReadableField(
  webView: WebViewDefinition,
  doctype: DocTypeDefinition,
  fieldName: string,
  field: FieldDefinition | undefined
): FieldDefinition {
  if (!field) {
    throw new FrameworkError(
      "WEB_VIEW_INVALID",
      `Web view '${webView.name}' references unknown field '${fieldName}' on DocType '${doctype.name}'`,
      { status: 400 }
    );
  }
  if (field.hidden) {
    throw new FrameworkError(
      "WEB_VIEW_INVALID",
      `Web view '${webView.name}' field '${fieldName}' must not be hidden`,
      { status: 400 }
    );
  }
  if (field.type === "table") {
    throw new FrameworkError(
      "WEB_VIEW_INVALID",
      `Web view '${webView.name}' field '${fieldName}' cannot be a table field`,
      { status: 400 }
    );
  }
  return field;
}

function assertWebViewIdentifier(value: string, label: string): void {
  if (!value.trim()) {
    throw new FrameworkError("WEB_VIEW_INVALID", `${label} is required`, { status: 400 });
  }
}

function assertWebViewFilterExpressionShape(webViewName: string, expression: unknown): asserts expression is ListFilterExpression {
  if (!isRecord(expression)) {
    throw new FrameworkError("WEB_VIEW_INVALID", `Web view '${webViewName}' filter expression must be an object`, {
      status: 400
    });
  }
  if (expression.kind === "group") {
    if (expression.match !== "all" && expression.match !== "any") {
      throw new FrameworkError("WEB_VIEW_INVALID", "List filter group match must be all or any", { status: 400 });
    }
    if (!Array.isArray(expression.filters) || expression.filters.length === 0) {
      throw new FrameworkError("WEB_VIEW_INVALID", "List filter group must include at least one filter", {
        status: 400
      });
    }
    for (const filter of expression.filters) {
      assertWebViewFilterExpressionShape(webViewName, filter);
    }
    return;
  }
  if (typeof expression.field !== "string") {
    throw new FrameworkError("WEB_VIEW_INVALID", "Filter field must be a string", { status: 400 });
  }
}

function freezeWebViewFilter(filter: ListDocumentsFilter): ListDocumentsFilter {
  return Object.freeze({
    ...filter,
    value: Array.isArray(filter.value) ? Object.freeze([...filter.value]) : filter.value
  });
}

function freezeWebViewFilterExpression(expression: ListFilterExpression): ListFilterExpression {
  if (isListFilterGroup(expression)) {
    return Object.freeze({
      ...expression,
      filters: Object.freeze(expression.filters.map(freezeWebViewFilterExpression))
    });
  }
  return freezeWebViewFilter(expression);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
