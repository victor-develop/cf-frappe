import { Hono } from "hono";
import type { FileService } from "../../application/file-service";
import { badRequest } from "../../core/errors";
import type { ActorResolver } from "./actor";
import { parseOptionalInteger, readBoundedBytes, requestMetadata } from "./request";

export interface FileApiOptions {
  readonly files: FileService;
  readonly actor: ActorResolver;
  readonly maxFileBytes?: number;
}

export function createFileApi(options: FileApiOptions): Hono {
  const app = new Hono();
  const maxFileBytes = options.maxFileBytes ?? 25 * 1024 * 1024;

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
