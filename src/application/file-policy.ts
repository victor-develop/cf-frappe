import { badRequest, conflict, FrameworkError } from "../core/errors.js";
import { DEFAULT_TENANT_ID, type DocumentData, type DocumentSnapshot, type JsonValue } from "../core/types.js";
import type {
  FileTransformOverlayPlacement,
  FileTransformOverlaySource,
  FileTransformOptions,
  FileTransformWatermarkPlacement
} from "../ports/file-transformer.js";
import {
  ensureR2CompatibleMultipartPartSizes,
  sortedUploadedMultipartParts
} from "../ports/multipart-file-storage.js";
import type {
  FileContent,
  FileObjectMetadata,
  MultipartFilePartContent,
  UploadedMultipartFilePart
} from "../ports/file-storage.js";
import type { FileScanResult } from "../ports/file-scanner.js";

const PREVIEWABLE_FILE_CONTENT_TYPES = new Set([
  "application/json",
  "application/pdf",
  "text/csv",
  "text/markdown",
  "text/plain"
]);

const MAX_FILE_RENDITIONS = 32;
const MAX_BULK_FILES = 100;

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

export function fileContentLength(body: FileContent): number {
  if (typeof body === "string") {
    return new TextEncoder().encode(body).byteLength;
  }
  if (body instanceof Blob) {
    return body.size;
  }
  if (ArrayBuffer.isView(body)) {
    return body.byteLength;
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

export interface BulkFileSelectionPolicyInput {
  readonly name: string;
  readonly expectedVersion?: number;
}

export function normalizeBulkFileSelections<TSelection extends BulkFileSelectionPolicyInput>(
  files: readonly TSelection[]
): readonly BulkFileSelectionPolicyInput[] {
  if (files.length === 0) {
    throw badRequest("At least one file must be selected");
  }
  if (files.length > MAX_BULK_FILES) {
    throw badRequest(`At most ${String(MAX_BULK_FILES)} files can be selected`);
  }
  const seen = new Set<string>();
  return files.map((file) => {
    const name = file.name.trim();
    if (name === "") {
      throw badRequest("File name is required");
    }
    if (seen.has(name)) {
      throw badRequest(`Duplicate file selection '${name}'`);
    }
    seen.add(name);
    if (file.expectedVersion !== undefined && !Number.isInteger(file.expectedVersion)) {
      throw badRequest("expectedVersion must be an integer");
    }
    return {
      name,
      ...(file.expectedVersion === undefined ? {} : { expectedVersion: file.expectedVersion })
    };
  });
}

export function ensureDirectUploadMatches(
  snapshot: DocumentSnapshot,
  object: FileObjectMetadata,
  label = "Direct upload"
): void {
  const expectedSize = snapshotNumberData(snapshot, "size");
  if (object.size !== expectedSize) {
    throw badRequest(`${label} object size mismatch`);
  }
  if (normalizeContentType(object.contentType) !== normalizeContentType(fileSnapshotStringData(snapshot, "content_type"))) {
    throw badRequest(`${label} object content type mismatch`);
  }
}

export function fileScanPatch(result: FileScanResult, checkedAt: string): DocumentData {
  return {
    scan_status: result.status,
    scan_checked_at: result.checkedAt ?? checkedAt,
    ...(result.engine === undefined || result.engine === "" ? {} : { scan_engine: result.engine }),
    ...(result.message === undefined || result.message === "" ? {} : { scan_message: result.message })
  };
}

export interface FileDocumentDataCommand {
  readonly filename: string;
  readonly key: string;
  readonly contentType: string;
  readonly size: number;
  readonly isPrivate: boolean;
  readonly uploadedBy: string;
  readonly uploadedAt: string;
  readonly storageState: "available" | "upload_pending";
  readonly attachedTo?: {
    readonly doctype: string;
    readonly name: string;
  };
  readonly directUploadExpiresAt?: string;
  readonly scannerConfigured?: boolean;
}

export function fileDocumentData(command: FileDocumentDataCommand): DocumentData {
  return {
    filename: command.filename,
    key: command.key,
    content_type: command.contentType,
    size: command.size,
    is_private: command.isPrivate,
    uploaded_by: command.uploadedBy,
    uploaded_at: command.uploadedAt,
    storage_state: command.storageState,
    ...(command.directUploadExpiresAt === undefined ? {} : { direct_upload_expires_at: command.directUploadExpiresAt }),
    ...(command.scannerConfigured === true ? { scan_status: "pending" } : {}),
    ...(command.attachedTo === undefined
      ? {}
      : {
          attached_to_doctype: command.attachedTo.doctype,
          attached_to_name: command.attachedTo.name
        })
  };
}

export function fileMultipartUploadDocumentData(data: DocumentData, uploadId: string): DocumentData {
  return {
    ...data,
    multipart_upload_id: uploadId
  };
}

export function fileUploadCompletedPatch(object: FileObjectMetadata, scanPatch: DocumentData = {}): DocumentData {
  return {
    storage_state: "available",
    etag: object.httpEtag ?? object.etag,
    ...scanPatch
  };
}

export function fileUploadScanFailedPatch(object: FileObjectMetadata, scanPatch: DocumentData = {}): DocumentData {
  return {
    storage_state: "scan_failed",
    etag: object.httpEtag ?? object.etag,
    ...scanPatch
  };
}

export function fileMultipartCompletionStartedPatch(): DocumentData {
  return { storage_state: "upload_completing" };
}

export function fileScanFailureError(result: FileScanResult, snapshot: DocumentSnapshot): FrameworkError {
  const message = fileSnapshotStringData(snapshot, "scan_message") || result.message;
  return new FrameworkError(
    "FILE_SCAN_FAILED",
    message ? `File scan failed: ${message}` : "File scan failed",
    { status: 422 }
  );
}

export function fileSnapshotStringData(snapshot: DocumentSnapshot, field: string): string {
  const value = snapshot.data[field];
  return typeof value === "string" ? value : "";
}

export function requireFileSnapshotString(snapshot: DocumentSnapshot, field: string): string {
  const value = fileSnapshotStringData(snapshot, field);
  if (!value) {
    throw badRequest(`${snapshot.doctype}/${snapshot.name} has no ${field}`);
  }
  return value;
}

export function ensureFileExpectedVersion(snapshot: DocumentSnapshot, expectedVersion: number | undefined): void {
  if (expectedVersion !== undefined && snapshot.version !== expectedVersion) {
    throw conflict(`Expected version ${expectedVersion}, found ${snapshot.version}`);
  }
}

export function ensureFileDeleteExpectedVersion(snapshot: DocumentSnapshot, expectedVersion: number | undefined): void {
  if (
    expectedVersion !== undefined &&
    snapshot.version !== expectedVersion &&
    snapshot.data.storage_state !== "delete_requested"
  ) {
    throw conflict(`Expected version ${expectedVersion}, found ${snapshot.version}`);
  }
}

export function ensureFileAvailableForDownload(snapshot: DocumentSnapshot): void {
  if (snapshot.data.storage_state === "upload_pending" || snapshot.data.storage_state === "upload_completing") {
    throw new FrameworkError("FILE_UPLOAD_PENDING", `${snapshot.doctype}/${snapshot.name} upload has not been finalized`, {
      status: 409
    });
  }
  if (snapshot.data.storage_state === "scan_failed") {
    throw new FrameworkError("FILE_SCAN_FAILED", `${snapshot.doctype}/${snapshot.name} did not pass file scanning`, {
      status: 409
    });
  }
  ensureFileNotDeleteRequested(snapshot);
}

export function ensureFileNotDeleteRequested(snapshot: DocumentSnapshot): void {
  if (snapshot.data.storage_state === "delete_requested") {
    throw new FrameworkError("DOCUMENT_DELETED", `${snapshot.doctype}/${snapshot.name} is pending deletion`, {
      status: 410
    });
  }
}

export function ensureFilePendingDirectUpload(snapshot: DocumentSnapshot): void {
  ensureFileNotDeleteRequested(snapshot);
  if (snapshot.data.storage_state !== "upload_pending") {
    throw badRequest(`${snapshot.doctype}/${snapshot.name} is not pending direct upload`);
  }
}

export function ensureFilePendingMultipartUpload(
  snapshot: DocumentSnapshot,
  allowedStates: readonly string[]
): void {
  ensureFileNotDeleteRequested(snapshot);
  if (
    typeof snapshot.data.storage_state !== "string" ||
    !allowedStates.includes(snapshot.data.storage_state) ||
    !fileSnapshotStringData(snapshot, "multipart_upload_id")
  ) {
    throw badRequest(`${snapshot.doctype}/${snapshot.name} is not pending multipart upload`);
  }
}

export function fileMultipartUploadId(snapshot: DocumentSnapshot): string {
  const uploadId = fileSnapshotStringData(snapshot, "multipart_upload_id");
  if (!uploadId) {
    throw badRequest(`${snapshot.doctype}/${snapshot.name} has no multipart upload`);
  }
  return uploadId;
}

export interface FileRenditionManifestEntry {
  readonly [key: string]: JsonValue;
  readonly id: string;
  readonly key: string;
  readonly status: "pending" | "available" | "failed";
  readonly options: DocumentData;
  readonly requested_at: string;
  readonly requested_by: string;
  readonly source_etag?: string;
  readonly overlay_file?: string;
  readonly overlay_key?: string;
  readonly overlay_etag?: string;
  readonly overlay_http_etag?: string;
  readonly content_type?: string;
  readonly size?: number;
  readonly etag?: string;
  readonly http_etag?: string;
  readonly generated_at?: string;
  readonly generated_by?: string;
  readonly failure_message?: string;
}

export interface FileRenditionView {
  readonly id: string;
  readonly key: string;
  readonly status: "pending" | "available" | "failed";
  readonly options: FileTransformOptions;
  readonly requestedAt: string;
  readonly requestedBy: string;
  readonly sourceEtag?: string;
  readonly overlayFile?: string;
  readonly overlayKey?: string;
  readonly overlayEtag?: string;
  readonly overlayHttpEtag?: string;
  readonly contentType?: string;
  readonly size?: number;
  readonly etag?: string;
  readonly httpEtag?: string;
  readonly generatedAt?: string;
  readonly generatedBy?: string;
  readonly failureMessage?: string;
}

export interface FileDashboardEntryView {
  readonly name: string;
  readonly filename: string;
  readonly contentType: string;
  readonly size: number;
  readonly isPrivate: boolean;
  readonly previewable: boolean;
  readonly storageState: string;
  readonly directUploadExpiresAt?: string;
  readonly scanStatus?: string;
  readonly scanCheckedAt?: string;
  readonly scanEngine?: string;
  readonly scanMessage?: string;
  readonly uploadedBy: string;
  readonly uploadedAt: string;
  readonly expectedVersion: number;
  readonly attachedTo?: {
    readonly doctype: string;
    readonly name: string;
  };
  readonly renditions?: readonly FileRenditionView[];
}

export function fileRenditions(snapshot: DocumentSnapshot): readonly FileRenditionManifestEntry[] {
  const value = snapshot.data.renditions;
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry): FileRenditionManifestEntry[] => {
    if (!isRenditionManifestEntry(entry)) {
      return [];
    }
    return [entry];
  });
}

export function fileDashboardEntry(snapshot: DocumentSnapshot): FileDashboardEntryView {
  const attachedToDoctype = fileSnapshotStringData(snapshot, "attached_to_doctype");
  const attachedToName = fileSnapshotStringData(snapshot, "attached_to_name");
  const contentType = fileSnapshotStringData(snapshot, "content_type");
  const storageState = fileSnapshotStringData(snapshot, "storage_state") || "available";
  const renditions = fileRenditions(snapshot).map(fileRenditionView);
  return {
    name: snapshot.name,
    filename: fileSnapshotStringData(snapshot, "filename") || snapshot.name,
    contentType,
    size: snapshotNumberData(snapshot, "size"),
    isPrivate: snapshot.data.is_private !== false,
    previewable: storageState === "available" && isPreviewableFileContentType(contentType),
    storageState,
    ...(fileSnapshotStringData(snapshot, "direct_upload_expires_at")
      ? { directUploadExpiresAt: fileSnapshotStringData(snapshot, "direct_upload_expires_at") }
      : {}),
    ...(fileSnapshotStringData(snapshot, "scan_status") ? { scanStatus: fileSnapshotStringData(snapshot, "scan_status") } : {}),
    ...(fileSnapshotStringData(snapshot, "scan_checked_at")
      ? { scanCheckedAt: fileSnapshotStringData(snapshot, "scan_checked_at") }
      : {}),
    ...(fileSnapshotStringData(snapshot, "scan_engine") ? { scanEngine: fileSnapshotStringData(snapshot, "scan_engine") } : {}),
    ...(fileSnapshotStringData(snapshot, "scan_message") ? { scanMessage: fileSnapshotStringData(snapshot, "scan_message") } : {}),
    uploadedBy: fileSnapshotStringData(snapshot, "uploaded_by"),
    uploadedAt: fileSnapshotStringData(snapshot, "uploaded_at"),
    expectedVersion: snapshot.version,
    ...(renditions.length === 0 ? {} : { renditions }),
    ...(attachedToDoctype && attachedToName
      ? { attachedTo: { doctype: attachedToDoctype, name: attachedToName } }
      : {})
  };
}

export function normalizeFileDashboardLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 50;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw badRequest("File dashboard limit must be between 1 and 200");
  }
  return limit;
}

export function fileRenditionView(entry: FileRenditionManifestEntry): FileRenditionView {
  return {
    id: entry.id,
    key: entry.key,
    status: entry.status,
    options: fileTransformOptionsFromData(entry.options),
    requestedAt: entry.requested_at,
    requestedBy: entry.requested_by,
    ...(entry.source_etag === undefined ? {} : { sourceEtag: entry.source_etag }),
    ...(entry.overlay_file === undefined ? {} : { overlayFile: entry.overlay_file }),
    ...(entry.overlay_key === undefined ? {} : { overlayKey: entry.overlay_key }),
    ...(entry.overlay_etag === undefined ? {} : { overlayEtag: entry.overlay_etag }),
    ...(entry.overlay_http_etag === undefined ? {} : { overlayHttpEtag: entry.overlay_http_etag }),
    ...(entry.content_type === undefined ? {} : { contentType: entry.content_type }),
    ...(entry.size === undefined ? {} : { size: entry.size }),
    ...(entry.etag === undefined ? {} : { etag: entry.etag }),
    ...(entry.http_etag === undefined ? {} : { httpEtag: entry.http_etag }),
    ...(entry.generated_at === undefined ? {} : { generatedAt: entry.generated_at }),
    ...(entry.generated_by === undefined ? {} : { generatedBy: entry.generated_by }),
    ...(entry.failure_message === undefined ? {} : { failureMessage: entry.failure_message })
  };
}

export function fileTransformOptionsFromData(data: DocumentData): FileTransformOptions {
  const fit = typeof data.fit === "string" ? data.fit as NonNullable<FileTransformOptions["fit"]> : undefined;
  const format = typeof data.format === "string" ? data.format as NonNullable<FileTransformOptions["format"]> : undefined;
  const watermark = fileTransformWatermarkFromData(data.watermark);
  const overlay = fileTransformOverlayFromData(data.overlay);
  return {
    ...(typeof data.width === "number" ? { width: data.width } : {}),
    ...(typeof data.height === "number" ? { height: data.height } : {}),
    ...(fit === undefined ? {} : { fit }),
    ...(format === undefined ? {} : { format }),
    ...(typeof data.quality === "number" ? { quality: data.quality } : {}),
    ...(watermark === undefined ? {} : { watermark }),
    ...(overlay === undefined ? {} : { overlay })
  };
}

export function pendingFileRendition(command: {
  readonly snapshot: DocumentSnapshot;
  readonly tenantId: string;
  readonly id: string;
  readonly attemptId: string;
  readonly sourceEtag: string;
  readonly overlay?: FileTransformOverlaySource;
  readonly options: FileTransformOptions;
  readonly requestedAt: string;
  readonly requestedBy: string;
}): FileRenditionManifestEntry {
  const contentType = expectedRenditionContentType(fileSnapshotStringData(command.snapshot, "content_type"), command.options);
  return {
    id: command.id,
    key: renditionObjectKey(command.tenantId, command.snapshot.name, command.id, command.attemptId, contentType),
    status: "pending",
    options: fileTransformOptionsData(command.options),
    requested_at: command.requestedAt,
    requested_by: command.requestedBy,
    source_etag: command.sourceEtag,
    ...overlayRenditionSourceData(command.overlay)
  };
}

export function failedFileRendition(command: {
  readonly pending: FileRenditionManifestEntry;
  readonly message: string;
}): FileRenditionManifestEntry {
  return {
    ...command.pending,
    status: "failed",
    failure_message: command.message.slice(0, 500)
  };
}

export function completeFileRendition(command: {
  readonly pending: FileRenditionManifestEntry;
  readonly object: FileObjectMetadata;
  readonly generatedAt: string;
  readonly generatedBy: string;
}): FileRenditionManifestEntry {
  return {
    ...command.pending,
    status: "available",
    content_type: command.object.contentType ?? "application/octet-stream",
    size: command.object.size,
    etag: command.object.etag,
    ...(command.object.httpEtag === undefined ? {} : { http_etag: command.object.httpEtag }),
    generated_at: command.generatedAt,
    generated_by: command.generatedBy
  };
}

export function fileTransformOptionsData(options: FileTransformOptions): DocumentData {
  return {
    ...(options.width === undefined ? {} : { width: options.width }),
    ...(options.height === undefined ? {} : { height: options.height }),
    ...(options.fit === undefined ? {} : { fit: options.fit }),
    ...(options.format === undefined ? {} : { format: options.format }),
    ...(options.quality === undefined ? {} : { quality: options.quality }),
    ...(options.watermark === undefined ? {} : { watermark: fileTransformWatermarkData(options.watermark) }),
    ...(options.overlay === undefined ? {} : { overlay: fileTransformOverlayData(options.overlay) })
  };
}

export function renditionSourcesMatch(
  rendition: FileRenditionManifestEntry,
  sourceEtag: string,
  overlay: FileTransformOverlaySource | undefined
): boolean {
  if (optionalString(rendition.source_etag) !== sourceEtag) {
    return false;
  }
  if (overlay === undefined) {
    return (
      rendition.overlay_file === undefined &&
      rendition.overlay_key === undefined &&
      rendition.overlay_etag === undefined &&
      rendition.overlay_http_etag === undefined
    );
  }
  return (
    optionalString(rendition.overlay_file) === overlay.file &&
    optionalString(rendition.overlay_key) === overlay.key &&
    optionalString(rendition.overlay_etag) === overlay.etag &&
    optionalString(rendition.overlay_http_etag) === overlay.httpEtag
  );
}

export async function fileRenditionId(options: FileTransformOptions): Promise<string> {
  return (await Promise.all([
    ...(options.width === undefined ? [] : [`w${String(options.width)}`]),
    ...(options.height === undefined ? [] : [`h${String(options.height)}`]),
    ...(options.fit === undefined ? [] : [`fit-${options.fit}`]),
    ...(options.format === undefined ? [] : [`f-${options.format}`]),
    ...(options.quality === undefined ? [] : [`q${String(options.quality)}`]),
    ...(options.watermark === undefined ? [] : [watermarkOptionsToken(options)]),
    ...(options.overlay === undefined ? [] : [overlayOptionsToken(options)])
  ])).join("-");
}

export function upsertFileRenditionManifest(
  manifest: readonly FileRenditionManifestEntry[],
  rendition: FileRenditionManifestEntry
): readonly FileRenditionManifestEntry[] {
  const replacing = manifest.some((entry) => entry.id === rendition.id);
  if (!replacing && manifest.length >= MAX_FILE_RENDITIONS) {
    throw badRequest(`At most ${String(MAX_FILE_RENDITIONS)} renditions can be stored per file`);
  }
  return [
    ...manifest.filter((entry) => entry.id !== rendition.id),
    rendition
  ].sort((left, right) => left.id.localeCompare(right.id));
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

function isRenditionManifestEntry(value: JsonValue): value is FileRenditionManifestEntry {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const entry = value as Record<string, JsonValue | undefined>;
  return (
    typeof entry.id === "string" &&
    typeof entry.key === "string" &&
    (entry.status === "pending" || entry.status === "available" || entry.status === "failed") &&
    isDocumentData(entry.options) &&
    typeof entry.requested_at === "string" &&
    typeof entry.requested_by === "string" &&
    optionalJsonString(entry.source_etag) &&
    optionalJsonString(entry.overlay_file) &&
    optionalJsonString(entry.overlay_key) &&
    optionalJsonString(entry.overlay_etag) &&
    optionalJsonString(entry.overlay_http_etag) &&
    optionalJsonString(entry.content_type) &&
    optionalJsonInteger(entry.size) &&
    optionalJsonString(entry.etag) &&
    optionalJsonString(entry.http_etag) &&
    optionalJsonString(entry.generated_at) &&
    optionalJsonString(entry.generated_by) &&
    optionalJsonString(entry.failure_message)
  );
}

function isDocumentData(value: JsonValue | undefined): value is DocumentData {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalJsonString(value: JsonValue | undefined): boolean {
  return value === undefined || typeof value === "string";
}

function optionalJsonInteger(value: JsonValue | undefined): boolean {
  return value === undefined || (typeof value === "number" && Number.isInteger(value) && value >= 0);
}

function fileTransformWatermarkFromData(value: JsonValue | undefined): FileTransformOptions["watermark"] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const data = value as Record<string, JsonValue>;
  const text = data.text;
  if (typeof text !== "string") {
    return undefined;
  }
  return {
    text,
    ...(typeof data.placement === "string" ? { placement: data.placement as FileTransformWatermarkPlacement } : {}),
    ...(typeof data.opacity === "number" ? { opacity: data.opacity } : {}),
    ...(typeof data.color === "string" ? { color: data.color } : {}),
    ...(typeof data.fontSize === "number" ? { fontSize: data.fontSize } : {})
  };
}

function fileTransformOverlayFromData(value: JsonValue | undefined): FileTransformOptions["overlay"] | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const data = value as Record<string, JsonValue>;
  const file = data.file;
  if (typeof file !== "string") {
    return undefined;
  }
  return {
    file,
    ...(typeof data.placement === "string" ? { placement: data.placement as FileTransformOverlayPlacement } : {}),
    ...(typeof data.opacity === "number" ? { opacity: data.opacity } : {}),
    ...(typeof data.width === "number" ? { width: data.width } : {}),
    ...(typeof data.height === "number" ? { height: data.height } : {})
  };
}

function fileTransformWatermarkData(watermark: NonNullable<FileTransformOptions["watermark"]>): DocumentData {
  return {
    text: watermark.text,
    ...(watermark.placement === undefined ? {} : { placement: watermark.placement }),
    ...(watermark.opacity === undefined ? {} : { opacity: watermark.opacity }),
    ...(watermark.color === undefined ? {} : { color: watermark.color }),
    ...(watermark.fontSize === undefined ? {} : { fontSize: watermark.fontSize })
  };
}

function fileTransformOverlayData(overlay: NonNullable<FileTransformOptions["overlay"]>): DocumentData {
  return {
    file: overlay.file,
    ...(overlay.placement === undefined ? {} : { placement: overlay.placement }),
    ...(overlay.opacity === undefined ? {} : { opacity: overlay.opacity }),
    ...(overlay.width === undefined ? {} : { width: overlay.width }),
    ...(overlay.height === undefined ? {} : { height: overlay.height })
  };
}

function overlayRenditionSourceData(overlay: FileTransformOverlaySource | undefined): DocumentData {
  if (overlay === undefined) {
    return {};
  }
  return {
    overlay_file: overlay.file,
    overlay_key: overlay.key,
    ...(overlay.etag === undefined ? {} : { overlay_etag: overlay.etag }),
    ...(overlay.httpEtag === undefined ? {} : { overlay_http_etag: overlay.httpEtag })
  };
}

async function watermarkOptionsToken(options: FileTransformOptions): Promise<string> {
  const text = options.watermark?.text ?? "";
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "") || "text";
  return `wm-${slug}-${await sha256Hex(canonicalFileTransformOptions(options))}`;
}

async function overlayOptionsToken(options: FileTransformOptions): Promise<string> {
  const file = options.overlay?.file ?? "";
  const slug = file
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "") || "file";
  return `ov-${slug}-${await sha256Hex(canonicalFileTransformOptions(options))}`;
}

function canonicalFileTransformOptions(options: FileTransformOptions): string {
  return JSON.stringify(fileTransformOptionsData(options));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
