import { Hono } from "hono";
import type { DocumentCommandExecutor } from "../../application/document-service";
import { QueryService } from "../../application/query-service";
import type { ModelRegistry } from "../../core/registry";
import { badRequest } from "../../core/errors";
import type { DocumentData, MutableDocumentData } from "../../core/types";
import type { ActorResolver } from "./actor";
import { toErrorResponse } from "./errors";

export interface ResourceApiOptions {
  readonly registry: ModelRegistry;
  readonly documents: DocumentCommandExecutor;
  readonly queries: QueryService;
  readonly actor: ActorResolver;
  readonly maxJsonBytes?: number;
}

export function createResourceApi(options: ResourceApiOptions): Hono {
  const app = new Hono();
  const resolveActor = options.actor;
  const maxJsonBytes = options.maxJsonBytes ?? 1_048_576;

  app.onError((error, c) => toErrorResponse(error, c));
  app.notFound((c) =>
    c.json(
      {
        error: {
          code: "NOT_FOUND",
          message: "Route not found"
        }
      },
      404
    )
  );

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/api/meta/doctypes", async (c) => {
    const actor = await resolveActor(c.req.raw);
    return c.json({ data: options.queries.listDoctypes(actor) });
  });

  app.get("/api/meta/doctypes/:doctype", async (c) => {
    const actor = await resolveActor(c.req.raw);
    return c.json({ data: options.queries.getMeta(actor, c.req.param("doctype")) });
  });

  app.get("/api/resource/:doctype", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const limit = parseOptionalInteger(c.req.query("limit"));
    const offset = parseOptionalInteger(c.req.query("offset"));
    const data = await options.queries.listDocuments(actor, c.req.param("doctype"), {
      ...(limit !== undefined ? { limit } : {}),
      ...(offset !== undefined ? { offset } : {})
    });
    return c.json(data);
  });

  app.post("/api/resource/:doctype", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { maxJsonBytes });
    const documentData = withoutKeys(body, ["name", "expectedVersion"]);
    const name = stringValue(body.name);
    const snapshot = await options.documents.create({
      actor,
      doctype: c.req.param("doctype"),
      data: documentData,
      ...(name !== undefined ? { name } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot }, 201);
  });

  app.get("/api/resource/:doctype/:name", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const data = await options.queries.getDocument(actor, c.req.param("doctype"), c.req.param("name"));
    return c.json({ data });
  });

  app.put("/api/resource/:doctype/:name", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { maxJsonBytes });
    const patch = withoutKeys(body, ["expectedVersion"]);
    const expectedVersion = numberValue(body.expectedVersion);
    const snapshot = await options.documents.update({
      actor,
      doctype: c.req.param("doctype"),
      name: c.req.param("name"),
      patch,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot });
  });

  app.post("/api/resource/:doctype/:name/transition/:action", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const expectedVersion = numberValue(body.expectedVersion);
    const snapshot = await options.documents.transition({
      actor,
      doctype: c.req.param("doctype"),
      name: c.req.param("name"),
      action: c.req.param("action"),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot });
  });

  app.post("/api/resource/:doctype/:name/command/:command", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const input = withoutKeys(body, ["expectedVersion"]);
    const expectedVersion = numberValue(body.expectedVersion);
    const snapshot = await options.documents.execute({
      actor,
      doctype: c.req.param("doctype"),
      name: c.req.param("name"),
      command: c.req.param("command"),
      input,
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot });
  });

  app.delete("/api/resource/:doctype/:name", async (c) => {
    const actor = await resolveActor(c.req.raw);
    const body = await readJson(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const expectedVersion = numberValue(body.expectedVersion);
    const snapshot = await options.documents.delete({
      actor,
      doctype: c.req.param("doctype"),
      name: c.req.param("name"),
      ...(expectedVersion !== undefined ? { expectedVersion } : {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot });
  });

  return app;
}

async function readJson(
  request: Request,
  options: { readonly allowEmpty?: boolean; readonly maxJsonBytes: number }
): Promise<MutableDocumentData> {
  const contentLength = request.headers.get("content-length");
  if (contentLength && Number(contentLength) > options.maxJsonBytes) {
    throw badRequest(`JSON body exceeds ${options.maxJsonBytes} bytes`);
  }
  const text = await readBoundedText(request, options.maxJsonBytes);
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

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw badRequest("Expected integer query parameter");
  }
  return parsed;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw badRequest("expectedVersion must be an integer");
  }
  return value;
}

function requestMetadata(request: Request): DocumentData {
  return {
    method: request.method,
    url: request.url
  };
}

function withoutKeys(data: MutableDocumentData, keys: readonly string[]): MutableDocumentData {
  const blocked = new Set(keys);
  return Object.fromEntries(Object.entries(data).filter(([key]) => !blocked.has(key))) as MutableDocumentData;
}

async function readBoundedText(request: Request, maxBytes: number): Promise<string> {
  if (!request.body) {
    return "";
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
      throw badRequest(`JSON body exceeds ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
