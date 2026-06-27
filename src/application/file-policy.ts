import { badRequest } from "../core/errors.js";
import { DEFAULT_TENANT_ID } from "../core/types.js";
import type { FileTransformOptions } from "../ports/file-transformer.js";

const PREVIEWABLE_FILE_CONTENT_TYPES = new Set([
  "application/json",
  "application/pdf",
  "text/csv",
  "text/markdown",
  "text/plain"
]);

export function normalizeContentType(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function isPreviewableFileContentType(contentType: string): boolean {
  const normalized = normalizeContentType(contentType.split(";")[0]);
  return PREVIEWABLE_FILE_CONTENT_TYPES.has(normalized) || (normalized.startsWith("image/") && normalized !== "image/svg+xml");
}

export function normalizeFileSize(size: number): number {
  if (!Number.isInteger(size) || size < 0) {
    throw badRequest("size must be a non-negative integer");
  }
  return size;
}

export function normalizeDirectUploadExpiry(expiresInSeconds: number | undefined): number {
  if (expiresInSeconds === undefined) {
    return 15 * 60;
  }
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 7 * 24 * 60 * 60) {
    throw badRequest("expiresInSeconds must be between 60 and 604800 seconds");
  }
  return expiresInSeconds;
}

export function sanitizeFilename(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw badRequest("filename is required");
  }
  const safe = trimmed
    .replace(/[\\/\u0000-\u001f\u007f]+/g, "-")
    .replace(/\.\.+/g, ".")
    .replace(/^-+|-+$/g, "");
  if (!safe || safe === "." || safe === "..") {
    throw badRequest("filename is invalid");
  }
  return safe.slice(0, 255);
}

export function objectKey(tenantId: string, id: string, filename: string): string {
  const tenant = tenantId.replace(/[^A-Za-z0-9_-]+/g, "-") || DEFAULT_TENANT_ID;
  const key = `${tenant}/files/${id}-${filename}`;
  ensureFileObjectKeyFits(key, "file key exceeds 1024 bytes");
  return key;
}

export function expectedRenditionContentType(sourceContentType: string, options: FileTransformOptions): string {
  if (options.format === "jpeg") {
    return "image/jpeg";
  }
  if (options.format) {
    return `image/${options.format}`;
  }
  return normalizeContentType(sourceContentType) || "application/octet-stream";
}

export function renditionObjectKey(
  tenantId: string,
  fileName: string,
  renditionId: string,
  attemptId: string,
  contentType: string
): string {
  const tenant = tenantId.replace(/[^A-Za-z0-9_-]+/g, "-") || DEFAULT_TENANT_ID;
  const safeFileName = fileName.replace(/[^A-Za-z0-9_-]+/g, "-") || "file";
  const safeAttemptId = attemptId.replace(/[^A-Za-z0-9_-]+/g, "-") || "attempt";
  const key = `${tenant}/file-renditions/${safeFileName}/${renditionId}-${safeAttemptId}.${fileContentTypeExtension(contentType)}`;
  ensureFileObjectKeyFits(key, "file rendition key exceeds 1024 bytes");
  return key;
}

export function fileRenditionFilename(filename: string, renditionId: string, contentType: string): string {
  return `${filename}.${renditionId}.${fileContentTypeExtension(contentType)}`.slice(0, 255);
}

export function fileContentTypeExtension(contentType: string): string {
  const normalized = normalizeContentType(contentType);
  if (normalized === "image/jpeg") {
    return "jpg";
  }
  if (normalized === "image/png") {
    return "png";
  }
  if (normalized === "image/webp") {
    return "webp";
  }
  if (normalized === "image/avif") {
    return "avif";
  }
  return "bin";
}

function ensureFileObjectKeyFits(key: string, message: string): void {
  if (new TextEncoder().encode(key).byteLength > 1024) {
    throw badRequest(message);
  }
}
