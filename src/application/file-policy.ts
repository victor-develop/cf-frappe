import { badRequest } from "../core/errors.js";
import { DEFAULT_TENANT_ID, type DocumentSnapshot, type JsonValue } from "../core/types.js";
import type { FileTransformOptions } from "../ports/file-transformer.js";
import {
  ensureR2CompatibleMultipartPartSizes,
  sortedUploadedMultipartParts
} from "../ports/multipart-file-storage.js";
import type { MultipartFilePartContent, UploadedMultipartFilePart } from "../ports/file-storage.js";

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

export interface MultipartPartManifestEntry {
  readonly [key: string]: JsonValue;
  readonly partNumber: number;
  readonly etag: string;
  readonly size: number;
}

export function multipartPartSize(body: MultipartFilePartContent, size: number | undefined): number {
  if (size !== undefined) {
    return normalizeFileSize(size);
  }
  if (typeof body === "string") {
    return new TextEncoder().encode(body).byteLength;
  }
  if (body instanceof Blob) {
    return body.size;
  }
  if (ArrayBuffer.isView(body)) {
    return body.byteLength;
  }
  if (body instanceof ReadableStream) {
    throw badRequest("Multipart upload part size is required for streamed bodies");
  }
  return body.byteLength;
}

export function multipartPartManifest(snapshot: DocumentSnapshot): readonly MultipartPartManifestEntry[] {
  const value = snapshot.data.multipart_parts;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): MultipartPartManifestEntry[] => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return [];
    }
    const part = entry as Record<string, unknown>;
    return typeof part.partNumber === "number" &&
      Number.isInteger(part.partNumber) &&
      typeof part.etag === "string" &&
      typeof part.size === "number" &&
      Number.isInteger(part.size)
      ? [{ partNumber: part.partNumber, etag: part.etag, size: part.size }]
      : [];
  });
}

export function upsertMultipartPartManifest(
  manifest: readonly MultipartPartManifestEntry[],
  part: MultipartPartManifestEntry
): readonly MultipartPartManifestEntry[] {
  return [
    ...manifest.filter((entry) => entry.partNumber !== part.partNumber),
    part
  ].sort((left, right) => left.partNumber - right.partNumber);
}

export function ensureMultipartPartFitsReservation(
  snapshot: DocumentSnapshot,
  partNumber: number,
  size: number
): void {
  const previousTotal = multipartPartManifest(snapshot)
    .filter((part) => part.partNumber !== partNumber)
    .reduce((total, part) => total + part.size, 0);
  if (previousTotal + size > snapshotNumberData(snapshot, "size")) {
    throw badRequest("Multipart upload part exceeds reserved file size");
  }
}

export function ensureMultipartCompletionMatchesManifest(
  snapshot: DocumentSnapshot,
  completedParts: readonly UploadedMultipartFilePart[]
): void {
  const orderedParts = sortedUploadedMultipartParts(completedParts);
  const manifest = multipartPartManifest(snapshot);
  const manifestByPart = new Map(manifest.map((part) => [part.partNumber, part]));
  let totalSize = 0;
  for (const completed of orderedParts) {
    const recorded = manifestByPart.get(completed.partNumber);
    if (!recorded || recorded.etag !== completed.etag) {
      throw badRequest(`Multipart upload part ${String(completed.partNumber)} was not uploaded`);
    }
    totalSize += recorded.size;
  }
  ensureR2CompatibleMultipartPartSizes(orderedParts.map((part) => manifestByPart.get(part.partNumber)?.size ?? 0));
  if (totalSize !== snapshotNumberData(snapshot, "size")) {
    throw badRequest("Multipart upload object size mismatch");
  }
}

function ensureFileObjectKeyFits(key: string, message: string): void {
  if (new TextEncoder().encode(key).byteLength > 1024) {
    throw badRequest(message);
  }
}

function snapshotNumberData(snapshot: DocumentSnapshot, field: string): number {
  const value = snapshot.data[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
