/** Low-level URL/query primitives shared by every core client module. */

export type QueryPrimitive = string | number | boolean;
export type QueryValue = QueryPrimitive | readonly (QueryPrimitive | null | undefined)[] | null | undefined;
export type QueryParams = Record<string, QueryValue>;
export type MutableQueryParams = Record<string, QueryValue>;

export function encodePart(value: unknown): string {
  return encodeURIComponent(String(value));
}

export function encodePath(value: unknown): string {
  return String(value).split("/").map(encodePart).join("/");
}

export function withQuery(path: string, params: QueryParams | undefined): string {
  const query = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null) {
          query.append(key, String(item));
        }
      });
    } else if (value !== undefined && value !== null) {
      query.set(key, String(value as QueryPrimitive));
    }
  });
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

export function setParam(params: MutableQueryParams, key: string, value: QueryValue): void {
  if (value !== undefined && value !== null) {
    params[key] = value;
  }
}

export function appendParam(params: MutableQueryParams, key: string, value: QueryPrimitive): void {
  const current = params[key];
  if (current === undefined) {
    params[key] = value;
  } else if (Array.isArray(current)) {
    (current as (QueryPrimitive | null | undefined)[]).push(value);
  } else {
    params[key] = [current as QueryPrimitive, value];
  }
}

export function setFormParam(params: URLSearchParams, key: string, value: unknown): void {
  if (value !== undefined && value !== null) {
    params.set(key, String(value));
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/** Primitive path builders needed below the http layer (kept here to avoid module cycles). */

export function resourcePath(doctype: string, name?: string): string {
  return `/api/resource/${encodePart(doctype)}${name === undefined ? "" : `/${encodePart(name)}`}`;
}

export function deskPath(doctype: string): string {
  return `/desk/${encodePart(doctype)}`;
}

export function filePath(name: string, action?: string): string {
  return `/api/files/${encodePart(name)}${action === undefined ? "" : `/${action}`}`;
}
