import { Hono } from "hono";
import type { FileService, UpdateFileMetadataCommand } from "../../application/file-service.js";
import { badRequest } from "../../core/errors.js";
import type { ActorResolver } from "./actor.js";
import { parseOptionalInteger, readBoundedBytes, readJsonObject, requestMetadata } from "./request.js";

export interface FileApiOptions {
  readonly files: FileService;
  readonly actor: ActorResolver;
  readonly maxFileBytes?: number;
  readonly maxJsonBytes?: number;
}

export function createFileApi(options: FileApiOptions): Hono {
  const app = new Hono();
  const maxFileBytes = options.maxFileBytes ?? 25 * 1024 * 1024;
  const maxJsonBytes = options.maxJsonBytes ?? 1_048_576;

  app.get("/api/files", async (c) => {
    const actor = await options.actor(c.req.raw);
    const limit = parseOptionalInteger(c.req.query("limit"));
    const attachedToDoctype = c.req.query("attached_to_doctype");
    const attachedToName = c.req.query("attached_to_name");
    const dashboard = await options.files.dashboard(actor, {
      ...(attachedToDoctype === undefined ? {} : { attachedToDoctype }),
      ...(attachedToName === undefined ? {} : { attachedToName }),
      ...(limit === undefined ? {} : { limit })
    });
    return c.json({ data: dashboard });
  });

  app.post("/api/files", async (c) => {
    const actor = await options.actor(c.req.raw);
    const filename = c.req.query("filename") ?? c.req.raw.headers.get("x-cf-frappe-filename");
    if (!filename) {
      throw badRequest("filename is required");
    }
    const body = await readBoundedBytes(c.req.raw, maxFileBytes, `File exceeds ${maxFileBytes} bytes`);
    const uploaded = await options.files.upload({
      actor,
      filename,
      body,
      contentType: c.req.raw.headers.get("content-type") ?? "application/octet-stream",
      isPrivate: booleanQuery(c.req.query("is_private"), true),
      ...(attachedTo(c.req.query("attached_to_doctype"), c.req.query("attached_to_name")) ?? {}),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: uploaded.snapshot, object: uploaded.object }, 201);
  });

  app.patch("/api/files/:name", async (c) => {
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const patch = fileMetadataPatch(body);
    const snapshot = await options.files.updateMetadata({
      actor,
      name: c.req.param("name"),
      ...(patch.filename === undefined ? {} : { filename: patch.filename }),
      ...(patch.isPrivate === undefined ? {} : { isPrivate: patch.isPrivate }),
      ...(Object.hasOwn(patch, "attachedTo") ? { attachedTo: patch.attachedTo ?? null } : {}),
      ...(patch.expectedVersion === undefined ? {} : { expectedVersion: patch.expectedVersion }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot });
  });

  app.get("/api/files/:name/content", async (c) => {
    const actor = await options.actor(c.req.raw);
    const downloaded = await options.files.download({
      actor,
      name: c.req.param("name")
    });
    const headers = new Headers();
    headers.set("content-type", downloaded.object.metadata.contentType ?? "application/octet-stream");
    headers.set("content-length", String(downloaded.object.metadata.size));
    if (downloaded.object.metadata.httpEtag) {
      headers.set("etag", downloaded.object.metadata.httpEtag);
    }
    const filenameValue = downloaded.snapshot.data.filename;
    const filename = typeof filenameValue === "string" ? filenameValue : downloaded.snapshot.name;
    headers.set("content-disposition", `attachment; filename="${filename.replace(/["\\]/g, "_")}"`);
    return new Response(downloaded.object.body, { headers });
  });

  app.delete("/api/files/:name", async (c) => {
    const actor = await options.actor(c.req.raw);
    const expectedVersion = parseOptionalInteger(c.req.query("expectedVersion"));
    const snapshot = await options.files.delete({
      actor,
      name: c.req.param("name"),
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot });
  });

  return app;
}

function attachedTo(
  doctype: string | undefined,
  name: string | undefined
): Pick<Parameters<FileService["upload"]>[0], "attachedTo"> | undefined {
  if (doctype === undefined && name === undefined) {
    return undefined;
  }
  if (!doctype || !name) {
    throw badRequest("attached_to_doctype and attached_to_name must be provided together");
  }
  return { attachedTo: { doctype, name } };
}

function booleanQuery(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (value === "1" || value.toLowerCase() === "true") {
    return true;
  }
  if (value === "0" || value.toLowerCase() === "false") {
    return false;
  }
  throw badRequest("Expected boolean query parameter");
}

type MutableFileMetadataPatch = {
  filename?: string;
  isPrivate?: boolean;
  attachedTo?: UpdateFileMetadataCommand["attachedTo"];
  expectedVersion?: number;
};

function fileMetadataPatch(body: Record<string, unknown>): MutableFileMetadataPatch {
  const unknown = Object.keys(body).filter(
    (key) =>
      ![
        "filename",
        "isPrivate",
        "is_private",
        "attachedTo",
        "attached_to_doctype",
        "attached_to_name",
        "expectedVersion"
      ].includes(key)
  );
  if (unknown.length > 0) {
    throw badRequest(`Unknown file metadata field '${unknown[0]}'`);
  }
  const patch: MutableFileMetadataPatch = {};
  if (body.filename !== undefined) {
    if (typeof body.filename !== "string") {
      throw badRequest("filename must be a string");
    }
    patch.filename = body.filename;
  }
  const hasIsPrivate = body.isPrivate !== undefined;
  const hasSnakeIsPrivate = body.is_private !== undefined;
  if (hasIsPrivate && hasSnakeIsPrivate) {
    throw badRequest("Provide only one of isPrivate or is_private");
  }
  const isPrivate = hasIsPrivate ? body.isPrivate : body.is_private;
  if (isPrivate !== undefined) {
    if (typeof isPrivate !== "boolean") {
      throw badRequest("is_private must be a boolean");
    }
    patch.isPrivate = isPrivate;
  }
  if (body.expectedVersion !== undefined) {
    if (typeof body.expectedVersion !== "number" || !Number.isInteger(body.expectedVersion)) {
      throw badRequest("expectedVersion must be an integer");
    }
    patch.expectedVersion = body.expectedVersion;
  }
  const hasAttachedTo = body.attachedTo !== undefined;
  const hasSnakeAttachment = body.attached_to_doctype !== undefined || body.attached_to_name !== undefined;
  if (hasAttachedTo && hasSnakeAttachment) {
    throw badRequest("Provide either attachedTo or attached_to_doctype/attached_to_name");
  }
  if (hasAttachedTo) {
    patch.attachedTo = parseAttachedToObject(body.attachedTo);
  } else if (hasSnakeAttachment) {
    patch.attachedTo = parseAttachedToFields(body.attached_to_doctype, body.attached_to_name);
  }
  return patch;
}

function parseAttachedToObject(value: unknown): UpdateFileMetadataCommand["attachedTo"] {
  if (value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw badRequest("attachedTo must be an object or null");
  }
  const candidate = value as { readonly doctype?: unknown; readonly name?: unknown };
  return parseAttachedToFields(candidate.doctype, candidate.name);
}

function parseAttachedToFields(doctype: unknown, name: unknown): UpdateFileMetadataCommand["attachedTo"] {
  if ((doctype === null || doctype === "") && (name === null || name === "")) {
    return null;
  }
  if (typeof doctype !== "string" || typeof name !== "string" || !doctype || !name) {
    throw badRequest("attached_to_doctype and attached_to_name must be provided together");
  }
  return { doctype, name };
}
