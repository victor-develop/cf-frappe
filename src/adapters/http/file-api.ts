import { Hono } from "hono";
import {
  isPreviewableFileContentType,
  type FileService,
  type UpdateFileMetadataCommand
} from "../../application/file-service.js";
import type {
  FileTransformFit,
  FileTransformFormat,
  FileTransformOptions,
  FileTransformWatermarkPlacement
} from "../../ports/file-transformer.js";
import { badRequest } from "../../core/errors.js";
import { fileContentHeaders, fileRenditionContentHeaders, transformedFileContentHeaders } from "../file-content.js";
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
    const filename = c.req.query("filename");
    const contentType = c.req.query("content_type");
    const uploadedBy = c.req.query("uploaded_by");
    const storageState = c.req.query("storage_state");
    const scanStatus = c.req.query("scan_status");
    const isPrivate = optionalBooleanQuery(c.req.query("is_private"));
    const dashboard = await options.files.dashboard(actor, {
      ...(attachedToDoctype === undefined ? {} : { attachedToDoctype }),
      ...(attachedToName === undefined ? {} : { attachedToName }),
      ...(filename === undefined ? {} : { filename }),
      ...(contentType === undefined ? {} : { contentType }),
      ...(uploadedBy === undefined ? {} : { uploadedBy }),
      ...(storageState === undefined ? {} : { storageState }),
      ...(scanStatus === undefined ? {} : { scanStatus }),
      ...(isPrivate === undefined ? {} : { isPrivate }),
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

  app.post("/api/files/direct-upload", async (c) => {
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const input = uploadReservationInput(body, "direct upload");
    const prepared = await options.files.prepareDirectUpload({
      actor,
      filename: input.filename,
      size: input.size,
      ...(input.contentType === undefined ? {} : { contentType: input.contentType }),
      ...(input.isPrivate === undefined ? {} : { isPrivate: input.isPrivate }),
      ...(input.attachedTo === undefined ? {} : { attachedTo: input.attachedTo }),
      ...(input.expiresInSeconds === undefined ? {} : { expiresInSeconds: input.expiresInSeconds }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: prepared.snapshot, upload: prepared.upload }, 201);
  });

  app.post("/api/files/multipart-upload", async (c) => {
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const input = uploadReservationInput(body, "multipart upload");
    const prepared = await options.files.prepareMultipartUpload({
      actor,
      filename: input.filename,
      size: input.size,
      ...(input.contentType === undefined ? {} : { contentType: input.contentType }),
      ...(input.isPrivate === undefined ? {} : { isPrivate: input.isPrivate }),
      ...(input.attachedTo === undefined ? {} : { attachedTo: input.attachedTo }),
      ...(input.expiresInSeconds === undefined ? {} : { expiresInSeconds: input.expiresInSeconds }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: prepared.snapshot, upload: prepared.upload }, 201);
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
    return new Response(downloaded.object.body, { headers: fileContentHeaders(downloaded, "attachment") });
  });

  app.get("/api/files/:name/preview", async (c) => {
    const actor = await options.actor(c.req.raw);
    const downloaded = await options.files.download({
      actor,
      name: c.req.param("name")
    });
    const contentType = downloaded.object.metadata.contentType ?? "application/octet-stream";
    if (!isPreviewableFileContentType(contentType)) {
      throw badRequest(`File '${downloaded.snapshot.name}' cannot be previewed`);
    }
    return new Response(downloaded.object.body, { headers: fileContentHeaders(downloaded, "inline") });
  });

  app.get("/api/files/:name/transform", async (c) => {
    const actor = await options.actor(c.req.raw);
    const transformed = await options.files.transform({
      actor,
      name: c.req.param("name"),
      options: fileTransformQuery(c.req.raw)
    });
    return new Response(transformed.transform.body, { headers: transformedFileContentHeaders(transformed) });
  });

  app.post("/api/files/:name/renditions", async (c) => {
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const generated = await options.files.generateRendition({
      actor,
      name: c.req.param("name"),
      options: fileTransformBody(body, "file rendition"),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json(
      {
        data: generated.snapshot,
        rendition: generated.rendition,
        created: generated.created
      },
      generated.created ? 201 : 200
    );
  });

  app.get("/api/files/:name/renditions/:renditionId/content", async (c) => {
    const actor = await options.actor(c.req.raw);
    const downloaded = await options.files.downloadRendition({
      actor,
      name: c.req.param("name"),
      renditionId: c.req.param("renditionId")
    });
    return new Response(downloaded.object.body, { headers: fileRenditionContentHeaders(downloaded) });
  });

  app.post("/api/files/delete", async (c) => {
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const input = bulkDeleteInput(body);
    const result = await options.files.bulkDelete({
      actor,
      files: input.files,
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: result });
  });

  app.post("/api/files/bulk-metadata", async (c) => {
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const input = bulkMetadataInput(body);
    const result = await options.files.bulkUpdateMetadata({
      actor,
      files: input.files,
      ...(input.isPrivate === undefined ? {} : { isPrivate: input.isPrivate }),
      ...(input.attachedTo === undefined ? {} : { attachedTo: input.attachedTo }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: result });
  });

  app.post("/api/files/:name/complete-upload", async (c) => {
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const expectedVersion = expectedVersionBody(body);
    const snapshot = await options.files.completeDirectUpload({
      actor,
      name: c.req.param("name"),
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot });
  });

  app.put("/api/files/:name/multipart-parts/:partNumber", async (c) => {
    const actor = await options.actor(c.req.raw);
    const partSize = multipartPartSizeHeader(c.req.raw.headers);
    const uploaded = await options.files.uploadMultipartPart({
      actor,
      name: c.req.param("name"),
      partNumber: pathInteger(c.req.param("partNumber"), "partNumber"),
      body: c.req.raw.body ?? new Uint8Array(),
      ...(partSize === undefined ? {} : { size: partSize }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ part: uploaded.part, data: uploaded.snapshot });
  });

  app.post("/api/files/:name/complete-multipart-upload", async (c) => {
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { maxJsonBytes });
    const input = multipartCompletionInput(body);
    const snapshot = await options.files.completeMultipartUpload({
      actor,
      name: c.req.param("name"),
      parts: input.parts,
      ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot });
  });

  app.post("/api/files/:name/abort-multipart-upload", async (c) => {
    const actor = await options.actor(c.req.raw);
    const body = await readJsonObject(c.req.raw, { allowEmpty: true, maxJsonBytes });
    const expectedVersion = expectedVersionBody(body);
    const snapshot = await options.files.abortMultipartUpload({
      actor,
      name: c.req.param("name"),
      ...(expectedVersion === undefined ? {} : { expectedVersion }),
      metadata: requestMetadata(c.req.raw)
    });
    return c.json({ data: snapshot });
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
  return parseBooleanQuery(value);
}

function optionalBooleanQuery(value: string | undefined): boolean | undefined {
  return value === undefined || value === "" ? undefined : parseBooleanQuery(value);
}

function parseBooleanQuery(value: string): boolean {
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

type DirectUploadInput = {
  readonly filename: string;
  readonly size: number;
  readonly contentType?: string;
  readonly isPrivate?: boolean;
  readonly attachedTo?: Exclude<UpdateFileMetadataCommand["attachedTo"], null>;
  readonly expiresInSeconds?: number;
};

type MultipartCompletionInput = {
  readonly parts: readonly { readonly partNumber: number; readonly etag: string }[];
  readonly expectedVersion?: number;
};

type BulkDeleteInput = {
  readonly files: readonly { readonly name: string; readonly expectedVersion?: number }[];
};

type BulkMetadataInput = BulkDeleteInput & {
  readonly isPrivate?: boolean;
  readonly attachedTo?: UpdateFileMetadataCommand["attachedTo"];
};

function bulkDeleteInput(body: Record<string, unknown>): BulkDeleteInput {
  const unknown = Object.keys(body).filter((key) => key !== "files");
  if (unknown.length > 0) {
    throw badRequest(`Unknown bulk file delete field '${unknown[0]}'`);
  }
  if (!Array.isArray(body.files)) {
    throw badRequest("files must be an array");
  }
  return {
    files: body.files.map((item, index) => bulkFileSelectionInput(item, index, "delete"))
  };
}

function bulkMetadataInput(body: Record<string, unknown>): BulkMetadataInput {
  const unknown = Object.keys(body).filter(
    (key) =>
      ![
        "files",
        "isPrivate",
        "is_private",
        "attachedTo",
        "attached_to_doctype",
        "attached_to_name"
      ].includes(key)
  );
  if (unknown.length > 0) {
    throw badRequest(`Unknown bulk file metadata field '${unknown[0]}'`);
  }
  if (!Array.isArray(body.files)) {
    throw badRequest("files must be an array");
  }
  const hasIsPrivate = body.isPrivate !== undefined;
  const hasSnakeIsPrivate = body.is_private !== undefined;
  if (hasIsPrivate && hasSnakeIsPrivate) {
    throw badRequest("Provide only one of isPrivate or is_private");
  }
  const isPrivate = hasIsPrivate ? body.isPrivate : body.is_private;
  if (isPrivate !== undefined && typeof isPrivate !== "boolean") {
    throw badRequest("is_private must be a boolean");
  }
  const hasAttachedTo = body.attachedTo !== undefined;
  const hasSnakeAttachment = body.attached_to_doctype !== undefined || body.attached_to_name !== undefined;
  if (hasAttachedTo && hasSnakeAttachment) {
    throw badRequest("Provide either attachedTo or attached_to_doctype/attached_to_name");
  }
  const attachedTo = hasAttachedTo
    ? parseAttachedToObject(body.attachedTo)
    : hasSnakeAttachment
      ? parseAttachedToFields(body.attached_to_doctype, body.attached_to_name)
      : undefined;
  return {
    files: body.files.map((item, index) => bulkFileSelectionInput(item, index, "metadata")),
    ...(isPrivate === undefined ? {} : { isPrivate }),
    ...(attachedTo === undefined ? {} : { attachedTo })
  };
}

function bulkFileSelectionInput(
  value: unknown,
  index: number,
  operation: "delete" | "metadata"
): { readonly name: string; readonly expectedVersion?: number } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest(`files[${String(index)}] must be an object`);
  }
  const item = value as Record<string, unknown>;
  const unknown = Object.keys(item).filter((key) => !["name", "expectedVersion"].includes(key));
  if (unknown.length > 0) {
    throw badRequest(`Unknown bulk file ${operation} field 'files[${String(index)}].${unknown[0]}'`);
  }
  if (typeof item.name !== "string") {
    throw badRequest(`files[${String(index)}].name must be a string`);
  }
  if (item.expectedVersion !== undefined) {
    if (typeof item.expectedVersion !== "number" || !Number.isInteger(item.expectedVersion)) {
      throw badRequest(`files[${String(index)}].expectedVersion must be an integer`);
    }
    return { name: item.name, expectedVersion: item.expectedVersion };
  }
  return { name: item.name };
}

function uploadReservationInput(body: Record<string, unknown>, operation: "direct upload" | "multipart upload"): DirectUploadInput {
  const unknown = Object.keys(body).filter(
    (key) =>
      ![
        "filename",
        "size",
        "contentType",
        "content_type",
        "isPrivate",
        "is_private",
        "attachedTo",
        "attached_to_doctype",
        "attached_to_name",
        "expiresInSeconds"
      ].includes(key)
  );
  if (unknown.length > 0) {
    throw badRequest(`Unknown ${operation} field '${unknown[0]}'`);
  }
  if (typeof body.filename !== "string") {
    throw badRequest("filename must be a string");
  }
  if (typeof body.size !== "number" || !Number.isInteger(body.size) || body.size < 0) {
    throw badRequest("size must be a non-negative integer");
  }
  const hasContentType = body.contentType !== undefined;
  const hasSnakeContentType = body.content_type !== undefined;
  if (hasContentType && hasSnakeContentType) {
    throw badRequest("Provide only one of contentType or content_type");
  }
  const contentType = hasContentType ? body.contentType : body.content_type;
  if (contentType !== undefined && typeof contentType !== "string") {
    throw badRequest("content_type must be a string");
  }
  const hasIsPrivate = body.isPrivate !== undefined;
  const hasSnakeIsPrivate = body.is_private !== undefined;
  if (hasIsPrivate && hasSnakeIsPrivate) {
    throw badRequest("Provide only one of isPrivate or is_private");
  }
  const isPrivate = hasIsPrivate ? body.isPrivate : body.is_private;
  if (isPrivate !== undefined && typeof isPrivate !== "boolean") {
    throw badRequest("is_private must be a boolean");
  }
  if (
    body.expiresInSeconds !== undefined &&
    (typeof body.expiresInSeconds !== "number" || !Number.isInteger(body.expiresInSeconds))
  ) {
    throw badRequest("expiresInSeconds must be an integer");
  }
  const hasAttachedTo = body.attachedTo !== undefined;
  const hasSnakeAttachment = body.attached_to_doctype !== undefined || body.attached_to_name !== undefined;
  if (hasAttachedTo && hasSnakeAttachment) {
    throw badRequest("Provide either attachedTo or attached_to_doctype/attached_to_name");
  }
  const parsedAttachedTo = hasAttachedTo
    ? parseAttachedToObject(body.attachedTo)
    : hasSnakeAttachment
      ? parseAttachedToFields(body.attached_to_doctype, body.attached_to_name)
      : undefined;
  if (parsedAttachedTo === null) {
    throw badRequest("attachedTo must be an object when reserving a direct upload");
  }
  return {
    filename: body.filename,
    size: body.size,
    ...(contentType === undefined ? {} : { contentType }),
    ...(isPrivate === undefined ? {} : { isPrivate }),
    ...(parsedAttachedTo === undefined ? {} : { attachedTo: parsedAttachedTo }),
    ...(body.expiresInSeconds === undefined ? {} : { expiresInSeconds: body.expiresInSeconds })
  };
}

function multipartCompletionInput(body: Record<string, unknown>): MultipartCompletionInput {
  const unknown = Object.keys(body).filter((key) => !["parts", "expectedVersion"].includes(key));
  if (unknown.length > 0) {
    throw badRequest(`Unknown multipart upload completion field '${unknown[0]}'`);
  }
  if (!Array.isArray(body.parts)) {
    throw badRequest("parts must be an array");
  }
  const expectedVersion = expectedVersionBody({ expectedVersion: body.expectedVersion });
  return {
    parts: body.parts.map((part, index) => multipartPartInput(part, index)),
    ...(expectedVersion === undefined ? {} : { expectedVersion })
  };
}

function multipartPartInput(value: unknown, index: number): { readonly partNumber: number; readonly etag: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw badRequest(`parts[${String(index)}] must be an object`);
  }
  const part = value as Record<string, unknown>;
  const unknown = Object.keys(part).filter((key) => !["partNumber", "etag"].includes(key));
  if (unknown.length > 0) {
    throw badRequest(`Unknown multipart upload completion field 'parts[${String(index)}].${unknown[0]}'`);
  }
  if (typeof part.partNumber !== "number" || !Number.isInteger(part.partNumber)) {
    throw badRequest(`parts[${String(index)}].partNumber must be an integer`);
  }
  if (typeof part.etag !== "string") {
    throw badRequest(`parts[${String(index)}].etag must be a string`);
  }
  return { partNumber: part.partNumber, etag: part.etag };
}

function expectedVersionBody(body: Record<string, unknown>): number | undefined {
  const unknown = Object.keys(body).filter((key) => key !== "expectedVersion");
  if (unknown.length > 0) {
    throw badRequest(`Unknown direct upload completion field '${unknown[0]}'`);
  }
  if (body.expectedVersion === undefined) {
    return undefined;
  }
  if (typeof body.expectedVersion !== "number" || !Number.isInteger(body.expectedVersion)) {
    throw badRequest("expectedVersion must be an integer");
  }
  return body.expectedVersion;
}

function pathInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw badRequest(`${label} must be an integer`);
  }
  return parsed;
}

function multipartPartSizeHeader(headers: Headers): number | undefined {
  const value = headers.get("x-cf-frappe-part-size") ?? headers.get("content-length");
  if (value === null) {
    return undefined;
  }
  const size = Number(value);
  if (!Number.isInteger(size) || size < 0) {
    throw badRequest("multipart part size must be a non-negative integer");
  }
  return size;
}

function fileTransformQuery(request: Request): FileTransformOptions {
  const params = new URL(request.url).searchParams;
  const allowed = new Set([
    "width",
    "height",
    "fit",
    "format",
    "quality",
    "watermark",
    "watermarkPlacement",
    "watermarkOpacity",
    "watermarkColor",
    "watermarkFontSize"
  ]);
  const unknown = [...new Set([...params.keys()].filter((key) => !allowed.has(key)))];
  if (unknown.length > 0) {
    throw badRequest(`Unknown file transform query parameter '${unknown[0]}'`);
  }
  return {
    ...optionalTransformInteger(params, "width"),
    ...optionalTransformInteger(params, "height"),
    ...optionalTransformFit(params),
    ...optionalTransformFormat(params),
    ...optionalTransformInteger(params, "quality"),
    ...optionalTransformWatermark(params)
  };
}

function fileTransformBody(body: Record<string, unknown>, label: string): FileTransformOptions {
  const allowed = new Set(["width", "height", "fit", "format", "quality", "watermark"]);
  const unknown = Object.keys(body).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw badRequest(`Unknown ${label} field '${unknown[0]}'`);
  }
  return {
    ...optionalTransformBodyInteger(body, "width"),
    ...optionalTransformBodyInteger(body, "height"),
    ...optionalTransformBodyFit(body),
    ...optionalTransformBodyFormat(body),
    ...optionalTransformBodyInteger(body, "quality"),
    ...optionalTransformBodyWatermark(body)
  };
}

function optionalTransformBodyInteger<TKey extends "width" | "height" | "quality">(
  body: Record<string, unknown>,
  key: TKey
): { readonly [K in TKey]?: number } {
  const value = body[key];
  if (value === undefined || value === null || value === "") {
    return {};
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw badRequest(`${key} must be an integer`);
  }
  return { [key]: value } as { readonly [K in TKey]: number };
}

function optionalTransformBodyFit(body: Record<string, unknown>): Pick<FileTransformOptions, "fit"> {
  const value = body.fit;
  if (value === undefined || value === null || value === "") {
    return {};
  }
  if (typeof value !== "string") {
    throw badRequest("fit must be a string");
  }
  return { fit: value as FileTransformFit };
}

function optionalTransformBodyFormat(body: Record<string, unknown>): Pick<FileTransformOptions, "format"> {
  const value = body.format;
  if (value === undefined || value === null || value === "") {
    return {};
  }
  if (typeof value !== "string") {
    throw badRequest("format must be a string");
  }
  return { format: value as FileTransformFormat };
}

function optionalTransformBodyWatermark(body: Record<string, unknown>): Pick<FileTransformOptions, "watermark"> {
  const value = body.watermark;
  if (value === undefined || value === null) {
    return {};
  }
  if (typeof value !== "string") {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const watermark = value as Record<string, unknown>;
      const unknown = Object.keys(watermark).filter(
        (key) => !["text", "placement", "opacity", "color", "fontSize"].includes(key)
      );
      if (unknown.length > 0) {
        throw badRequest(`Unknown watermark field '${unknown[0]}'`);
      }
      const text = watermark.text;
      if (typeof text !== "string") {
        throw badRequest("watermark.text must be a string");
      }
      return {
        watermark: {
          text,
          ...(watermark.placement === undefined
            ? {}
            : { placement: stringWatermarkField(watermark.placement, "watermark.placement") as FileTransformWatermarkPlacement }),
          ...(watermark.opacity === undefined ? {} : { opacity: integerWatermarkField(watermark.opacity, "watermark.opacity") }),
          ...(watermark.color === undefined ? {} : { color: stringWatermarkField(watermark.color, "watermark.color") }),
          ...(watermark.fontSize === undefined ? {} : { fontSize: integerWatermarkField(watermark.fontSize, "watermark.fontSize") })
        }
      };
    }
    throw badRequest("watermark must be a string or object with text");
  }
  return { watermark: { text: value } };
}

function optionalTransformInteger<TKey extends "width" | "height" | "quality">(
  params: URLSearchParams,
  key: TKey
): { readonly [K in TKey]?: number } {
  const value = params.get(key);
  if (value === null || value === "") {
    return {};
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw badRequest(`${key} must be an integer`);
  }
  return { [key]: parsed } as { readonly [K in TKey]: number };
}

function optionalTransformFit(params: URLSearchParams): Pick<FileTransformOptions, "fit"> {
  const value = params.get("fit");
  if (value === null || value === "") {
    return {};
  }
  return { fit: value as FileTransformFit };
}

function optionalTransformFormat(params: URLSearchParams): Pick<FileTransformOptions, "format"> {
  const value = params.get("format");
  if (value === null || value === "") {
    return {};
  }
  return { format: value as FileTransformFormat };
}

function optionalTransformWatermark(params: URLSearchParams): Pick<FileTransformOptions, "watermark"> {
  const watermarkKeys = ["watermark", "watermarkPlacement", "watermarkOpacity", "watermarkColor", "watermarkFontSize"];
  const hasWatermarkValue = watermarkKeys.some((key) => params.get(key) !== null && params.get(key) !== "");
  if (!hasWatermarkValue) {
    return {};
  }
  return {
    watermark: {
      text: params.get("watermark") ?? "",
      ...optionalTransformWatermarkPlacement(params),
      ...optionalTransformWatermarkInteger(params, "watermarkOpacity", "opacity"),
      ...optionalTransformWatermarkColor(params),
      ...optionalTransformWatermarkInteger(params, "watermarkFontSize", "fontSize")
    }
  };
}

function optionalTransformWatermarkPlacement(
  params: URLSearchParams
): Pick<NonNullable<FileTransformOptions["watermark"]>, "placement"> {
  const value = params.get("watermarkPlacement");
  if (value === null || value === "") {
    return {};
  }
  return { placement: value as FileTransformWatermarkPlacement };
}

function optionalTransformWatermarkColor(
  params: URLSearchParams
): Pick<NonNullable<FileTransformOptions["watermark"]>, "color"> {
  const value = params.get("watermarkColor");
  if (value === null || value === "") {
    return {};
  }
  return { color: value };
}

function optionalTransformWatermarkInteger<TKey extends "opacity" | "fontSize">(
  params: URLSearchParams,
  sourceKey: string,
  targetKey: TKey
): { readonly [K in TKey]?: number } {
  const value = params.get(sourceKey);
  if (value === null || value === "") {
    return {};
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw badRequest(`${sourceKey} must be an integer`);
  }
  return { [targetKey]: parsed } as { readonly [K in TKey]: number };
}

function stringWatermarkField(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw badRequest(`${field} must be a string`);
  }
  return value;
}

function integerWatermarkField(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw badRequest(`${field} must be an integer`);
  }
  return value;
}

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
