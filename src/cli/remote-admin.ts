export interface RemoteHeaderLiteral {
  readonly kind: "literal";
  readonly name: string;
  readonly value: string;
}

export interface RemoteHeaderEnv {
  readonly kind: "env";
  readonly name: string;
  readonly envName: string;
}

export type RemoteHeaderOption = RemoteHeaderLiteral | RemoteHeaderEnv;

export interface RemoteAdminIo {
  readonly env?: (name: string) => string | undefined;
  readonly fetch?: typeof fetch;
}

type RemoteAdminErrorConstructor<TError extends Error> = new (message: string) => TError;

export async function requestRemoteAdmin<TData, TError extends Error>(
  target: { readonly url: string; readonly headers: readonly RemoteHeaderOption[] },
  io: RemoteAdminIo,
  request: {
    readonly body?: Record<string, unknown>;
    readonly method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
    readonly path: string;
    readonly query?: URLSearchParams;
  },
  options: {
    readonly error: RemoteAdminErrorConstructor<TError>;
    readonly fetchLabel: string;
    readonly resourceLabel: string;
    readonly urlLabel: string;
  }
): Promise<TData> {
  const payload = await requestRemoteAdminPayload<Record<string, unknown>, TError>(target, io, request, options);
  const data = payload.data;
  if (!isRecord(data)) {
    throw new options.error(`${options.resourceLabel} response did not include a data object`);
  }
  return data as TData;
}

export async function requestRemoteAdminPayload<TPayload, TError extends Error>(
  target: { readonly url: string; readonly headers: readonly RemoteHeaderOption[] },
  io: RemoteAdminIo,
  request: {
    readonly body?: Record<string, unknown>;
    readonly method: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
    readonly path: string;
    readonly query?: URLSearchParams;
  },
  options: {
    readonly error: RemoteAdminErrorConstructor<TError>;
    readonly fetchLabel: string;
    readonly resourceLabel: string;
    readonly urlLabel: string;
  }
): Promise<TPayload> {
  const runFetch = io.fetch ?? globalThis.fetch;
  if (typeof runFetch !== "function") {
    throw new options.error(`No fetch implementation is available for ${options.fetchLabel}`);
  }
  const headers = resolveRemoteHeaders(target.headers, io.env, options.error);
  headers.set("accept", "application/json");
  const init: RequestInit = {
    method: request.method,
    headers
  };
  if (request.body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(request.body);
  }
  const response = await runFetch(remoteAdminApiUrl(target.url, request.path, request.query, options), init);
  const payload = await readRemoteJsonResponse(response, options);
  if (!response.ok) {
    throw new options.error(
      `${options.resourceLabel} request failed (${response.status}): ${remoteErrorMessage(payload)}`
    );
  }
  return payload as TPayload;
}

function resolveRemoteHeaders<TError extends Error>(
  options: readonly RemoteHeaderOption[],
  readEnv: ((name: string) => string | undefined) | undefined,
  ErrorClass: RemoteAdminErrorConstructor<TError>
): Headers {
  const headers = new Headers();
  for (const option of options) {
    if (option.kind === "literal") {
      headers.set(option.name, option.value);
      continue;
    }
    const value = readEnv?.(option.envName);
    if (value === undefined || value === "") {
      throw new ErrorClass(`Environment variable '${option.envName}' is not set for header '${option.name}'`);
    }
    headers.set(option.name, value);
  }
  return headers;
}

function remoteAdminApiUrl<TError extends Error>(
  baseUrl: string,
  path: string,
  query: URLSearchParams | undefined,
  options: { readonly error: RemoteAdminErrorConstructor<TError>; readonly urlLabel: string }
): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new options.error(`${options.urlLabel} URL '${baseUrl}' is not a valid absolute URL`);
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
  url.search = query === undefined ? "" : query.toString();
  url.hash = "";
  return url.toString();
}

async function readRemoteJsonResponse<TError extends Error>(
  response: Response,
  options: { readonly error: RemoteAdminErrorConstructor<TError>; readonly resourceLabel: string }
): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return {};
  }
  try {
    const payload = JSON.parse(text) as unknown;
    return isRecord(payload) ? payload : {};
  } catch {
    throw new options.error(`${options.resourceLabel} response was not valid JSON (${response.status})`);
  }
}

function remoteErrorMessage(payload: Record<string, unknown>): string {
  const error = payload.error;
  if (!isRecord(error)) {
    return "remote endpoint returned an error";
  }
  const code = typeof error.code === "string" ? error.code : "ERROR";
  const message = typeof error.message === "string" ? error.message : "remote endpoint returned an error";
  return `${code}: ${message}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
