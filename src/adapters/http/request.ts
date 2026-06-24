import { badRequest } from "../../core/errors.js";
import {
  LIST_FILTER_OPERATORS,
  MAX_LIST_FILTER_EXPRESSION_DEPTH,
  MAX_LIST_FILTER_EXPRESSION_NODES,
  isListFilterGroupMatch,
  isListFilterOperator,
  isListMembershipOperator,
  isListOrderDirection,
  isListPresenceOperator,
  isListRangeOperator
} from "../../core/list-view.js";
import type {
  DocumentData,
  JsonPrimitive,
  ListFilterExpression,
  ListFilterValue,
  ListDocumentsFilter,
  ListDocumentsQuery,
  ListFilterOperator,
  MutableDocumentData
} from "../../core/types.js";

const SENSITIVE_QUERY_KEYS = new Set(["token", "password", "secret", "api_key", "apikey", "key"]);
const FILTER_EXPRESSION_QUERY_KEY = "filter_expression";

export function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw badRequest("Expected integer query parameter");
  }
  return parsed;
}

export function requestMetadata(request: Request): DocumentData {
  return {
    method: request.method,
    url: redactedRequestUrl(request.url)
  };
}

export interface ListFiltersFromUrlOptions {
  readonly fields?: readonly string[];
}

export function listFiltersFromUrl(url: URL, options: ListFiltersFromUrlOptions = {}): readonly ListDocumentsFilter[] {
  const filters: Array<ListDocumentsFilter | PendingArrayFilter> = [];
  const arrayFilters = new Map<string, PendingArrayFilter>();
  const emptyFilterKeys = new Set(url.searchParams.getAll("empty_filter"));
  const fields = new Set(options.fields ?? []);
  url.searchParams.forEach((value, key) => {
    if (key === FILTER_EXPRESSION_QUERY_KEY) {
      return;
    }
    const parsed = parseFilterKey(key, fields);
    if (!parsed || (value === "" && !emptyFilterKeys.has(key))) {
      return;
    }
    if (isListMembershipOperator(parsed.operator) || isListRangeOperator(parsed.operator)) {
      const existing = arrayFilters.get(key);
      if (existing) {
        existing.values.push(value);
        return;
      }
      const filter = { field: parsed.field, operator: parsed.operator, values: [value] };
      arrayFilters.set(key, filter);
      filters.push(filter);
      return;
    }
    filters.push({
      field: parsed.field,
      ...(parsed.operator === "eq" ? {} : { operator: parsed.operator }),
      value
    });
  });
  return filters.map((filter) =>
    "values" in filter
      ? { field: filter.field, operator: filter.operator, value: filter.values }
      : filter
  );
}

export function listFilterExpressionFromUrl(url: URL): ListFilterExpression | undefined {
  const raw = nonEmptyQueryValue(url.searchParams.get(FILTER_EXPRESSION_QUERY_KEY));
  if (raw === undefined) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw badRequest("Filter expression must be valid JSON");
  }
  return listFilterExpressionFromValue(value, "Filter expression");
}

export function listFilterExpressionFromValue(
  value: unknown,
  label = "Filter expression"
): ListFilterExpression {
  return listFilterExpressionNodeFromValue(value, label, 1, { remaining: MAX_LIST_FILTER_EXPRESSION_NODES });
}

function listFilterExpressionNodeFromValue(
  value: unknown,
  label: string,
  depth: number,
  budget: ListFilterExpressionParseBudget
): ListFilterExpression {
  budget.remaining -= 1;
  if (budget.remaining < 0) {
    throw badRequest(
      `List filter expression cannot exceed ${MAX_LIST_FILTER_EXPRESSION_DEPTH} levels or ${MAX_LIST_FILTER_EXPRESSION_NODES} nodes`
    );
  }
  if (!isRecord(value)) {
    throw badRequest(`${label} must be an object`);
  }
  if ("field" in value) {
    return listFilterPredicateFromValue(value, label);
  }
  if (depth > MAX_LIST_FILTER_EXPRESSION_DEPTH) {
    throw badRequest(`List filter expression cannot exceed ${MAX_LIST_FILTER_EXPRESSION_DEPTH} levels`);
  }
  if (value.kind !== undefined && value.kind !== "group") {
    throw badRequest(`${label} kind must be group`);
  }
  if (!isListFilterGroupMatch(value.match)) {
    throw badRequest(`${label} match must be all or any`);
  }
  if (!Array.isArray(value.filters)) {
    throw badRequest(`${label} filters must be an array`);
  }
  return {
    kind: "group",
    match: value.match,
    filters: value.filters.map((item) =>
      listFilterExpressionNodeFromValue(item, `${label} group filter`, depth + 1, budget)
    )
  };
}

export function listFiltersFromValue(value: unknown, label = "Saved filter"): readonly ListDocumentsFilter[] {
  if (!Array.isArray(value)) {
    throw badRequest(`${label} filters must be an array`);
  }
  return value.map((item) => {
    if (!isRecord(item)) {
      throw badRequest(`${label} entries must be objects`);
    }
    return listFilterPredicateFromValue(item, label);
  });
}

export function listOrderFromUrl(url: URL): Pick<ListDocumentsQuery, "orderBy" | "order"> {
  const orderBy = nonEmptyQueryValue(url.searchParams.get("order_by"));
  const order = nonEmptyQueryValue(url.searchParams.get("order"));
  return {
    ...(orderBy === undefined ? {} : { orderBy }),
    ...(order === undefined ? {} : { order: parseListOrder(order) })
  };
}

export async function readBoundedText(request: Request, maxBytes: number, errorMessage: string): Promise<string> {
  const bytes = await readBoundedBytes(request, maxBytes, errorMessage);
  return new TextDecoder().decode(bytes);
}

export async function readJsonObject(
  request: Request,
  options: { readonly allowEmpty?: boolean; readonly maxJsonBytes: number }
): Promise<MutableDocumentData> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > options.maxJsonBytes) {
    throw badRequest(`JSON body exceeds ${options.maxJsonBytes} bytes`);
  }
  const text = await readBoundedText(request, options.maxJsonBytes, `JSON body exceeds ${options.maxJsonBytes} bytes`);
  if (!text.trim()) {
    if (options.allowEmpty) {
      return {};
    }
    throw badRequest("Request body must be JSON");
  }
  if (new TextEncoder().encode(text).byteLength > options.maxJsonBytes) {
    throw badRequest(`JSON body exceeds ${options.maxJsonBytes} bytes`);
  }
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw badRequest("Request body contains malformed JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest("JSON body must be an object");
  }
  return value as MutableDocumentData;
}

export async function readBoundedBytes(
  request: Request,
  maxBytes: number,
  errorMessage: string
): Promise<ArrayBuffer> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    throw badRequest(errorMessage);
  }
  if (!request.body) {
    return new ArrayBuffer(0);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw badRequest(errorMessage);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

function parseFilterKey(
  key: string,
  fields: ReadonlySet<string>
): { readonly field: string; readonly operator: ListFilterOperator } | null {
  if (!key.startsWith("filter_")) {
    return null;
  }
  const raw = key.slice("filter_".length);
  if (fields.has(raw)) {
    return { field: raw, operator: "eq" };
  }
  const explicitEqSuffix = "__eq";
  if (raw.endsWith(explicitEqSuffix)) {
    return { field: raw.slice(0, -explicitEqSuffix.length), operator: "eq" };
  }
  for (const operator of LIST_FILTER_OPERATORS.filter((item) => item !== "eq")) {
    const suffix = `__${operator}`;
    if (raw.endsWith(suffix)) {
      return { field: raw.slice(0, -suffix.length), operator };
    }
  }
  return { field: raw, operator: "eq" };
}

interface PendingArrayFilter {
  readonly field: string;
  readonly operator: "in" | "not_in" | "between" | "not_between";
  readonly values: string[];
}

interface ListFilterExpressionParseBudget {
  remaining: number;
}

function listFilterPredicateFromValue(value: unknown, label: string): ListDocumentsFilter {
  if (!isRecord(value)) {
    throw badRequest(`${label} must be an object`);
  }
  const field = value.field;
  const operator = value.operator;
  const filterValue = value.value;
  if (typeof field !== "string") {
    throw badRequest(`${label} field must be a string`);
  }
  if (operator !== undefined && !isListFilterOperator(operator)) {
    throw badRequest(`${label} operator is invalid`);
  }
  const normalizedOperator = operator ?? "eq";
  return {
    field,
    ...(normalizedOperator === "eq" ? {} : { operator: normalizedOperator }),
    value: listFilterValueFromUnknown(filterValue, normalizedOperator, label)
  };
}

function listFilterValueFromUnknown(
  value: unknown,
  operator: ListFilterOperator,
  label: string
): ListFilterValue {
  if (isListMembershipOperator(operator)) {
    if (!Array.isArray(value) || value.length === 0 || !value.every(isJsonPrimitive)) {
      throw badRequest(`${label} membership value must be a non-empty scalar array`);
    }
    return value;
  }
  if (isListRangeOperator(operator)) {
    if (!Array.isArray(value) || value.length !== 2 || !value.every(isJsonPrimitive)) {
      throw badRequest(`${label} range value must be a two-item scalar array`);
    }
    return value;
  }
  if (isListPresenceOperator(operator)) {
    if (value !== "set" && value !== "not set") {
      throw badRequest(`${label} presence value must be set or not set`);
    }
    return value;
  }
  if (!isJsonPrimitive(value)) {
    throw badRequest(`${label} value must be scalar`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function parseListOrder(value: string): NonNullable<ListDocumentsQuery["order"]> {
  if (isListOrderDirection(value)) {
    return value;
  }
  throw badRequest("List order must be asc or desc");
}

function nonEmptyQueryValue(value: string | null): string | undefined {
  return value === null || value === "" ? undefined : value;
}

function redactedRequestUrl(value: string): string {
  const url = new URL(value);
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) {
      url.searchParams.set(key, "[redacted]");
    }
  }
  return url.toString();
}
