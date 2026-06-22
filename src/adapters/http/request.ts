import { badRequest } from "../../core/errors";
import { LIST_FILTER_OPERATORS } from "../../core/list-view";
import type { DocumentData, ListDocumentsFilter, ListFilterOperator, MutableDocumentData } from "../../core/types";

const SENSITIVE_QUERY_KEYS = new Set(["token", "password", "secret", "api_key", "apikey", "key"]);

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

export function listFiltersFromUrl(url: URL): readonly ListDocumentsFilter[] {
  const filters: ListDocumentsFilter[] = [];
  url.searchParams.forEach((value, key) => {
    const parsed = parseFilterKey(key);
    if (!parsed || value === "") {
      return;
    }
    filters.push({
      field: parsed.field,
      ...(parsed.operator === "eq" ? {} : { operator: parsed.operator }),
      value
    });
  });
  return filters;
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

function parseFilterKey(key: string): { readonly field: string; readonly operator: ListFilterOperator } | null {
  if (!key.startsWith("filter_")) {
    return null;
  }
  const raw = key.slice("filter_".length);
  for (const operator of LIST_FILTER_OPERATORS.filter((item) => item !== "eq")) {
    const suffix = `__${operator}`;
    if (raw.endsWith(suffix)) {
      return { field: raw.slice(0, -suffix.length), operator };
    }
  }
  return { field: raw, operator: "eq" };
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
