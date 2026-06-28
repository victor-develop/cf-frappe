import { badRequest, conflict, FrameworkError, notFound, permissionDenied, validationFailed } from "../core/errors.js";
import { can } from "../core/permissions.js";
import { validateDocumentData } from "../core/schema.js";
import {
  DEFAULT_TENANT_ID,
  type Actor,
  type DocTypeDefinition,
  type DocumentData,
  type DocumentSnapshot,
  type JsonValue,
  type ListDocumentsFilter
} from "../core/types.js";
import type {
  FileTransformSource,
  FileTransformOverlayPlacement,
  FileTransformOverlaySource,
  FileTransformer,
  FileTransformOptions,
  TransformFileObjectCommand,
  TransformedFileObject,
  FileTransformWatermarkPlacement
} from "../ports/file-transformer.js";
import { isTransformableFileContentType } from "../ports/file-transformer.js";
import {
  ensureR2CompatibleMultipartPartSizes,
  sortedUploadedMultipartParts
} from "../ports/multipart-file-storage.js";
import type {
  AbortMultipartFileUploadCommand,
  CompleteMultipartFileUploadCommand,
  CreateDirectFileUploadCommand,
  CreateMultipartFileUploadCommand,
  FileContent,
  FileObjectMetadata,
  FileStorage,
  MultipartFileStorage,
  MultipartFilePartContent,
  PutFileObjectCommand,
  StoredFileObject,
  UploadMultipartFilePartCommand,
  UploadedMultipartFilePart
} from "../ports/file-storage.js";
import type { FileScanResult, FileScanSource, FileScanTarget } from "../ports/file-scanner.js";

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

export function fileCommandTenantId(actor: Pick<Actor, "tenantId">, tenantId: string | undefined): string {
  return tenantId ?? actor.tenantId ?? DEFAULT_TENANT_ID;
}

export function fileTenantCommandOption(tenantId: string | undefined): { readonly tenantId?: string } {
  return tenantId === undefined ? {} : { tenantId };
}

export function fileExpectedVersionCommandOption(
  expectedVersion: number | undefined
): { readonly expectedVersion?: number } {
  return expectedVersion === undefined ? {} : { expectedVersion };
}

export function fileAttachedToCommandOption<TAttachedTo>(
  attachedTo: TAttachedTo | undefined
): { readonly attachedTo?: TAttachedTo } {
  return attachedTo === undefined ? {} : { attachedTo };
}

export function fileIsPrivateCommandOption(isPrivate: boolean | undefined): { readonly isPrivate?: boolean } {
  return isPrivate === undefined ? {} : { isPrivate };
}

export function fileTransformOverlayCommandOption(
  overlay: FileTransformOverlaySource | undefined
): { readonly overlay?: FileTransformOverlaySource } {
  return overlay === undefined ? {} : { overlay };
}

export function fileCommandMetadata(metadata: DocumentData | undefined): DocumentData {
  return metadata ?? {};
}

export function fileUploadContentType(contentType: string | undefined): string {
  return contentType ?? "application/octet-stream";
}

export function fileUploadIsPrivate(isPrivate: boolean | undefined): boolean {
  return isPrivate ?? true;
}

export function isPreviewableFileContentType(contentType: string): boolean {
  const normalized = normalizeContentType(contentType.split(";")[0]);
  return PREVIEWABLE_FILE_CONTENT_TYPES.has(normalized) || (normalized.startsWith("image/") && normalized !== "image/svg+xml");
}

export function ensureFileContentTypeTransformable(contentType: string, fileLabel: string): void {
  if (!isTransformableFileContentType(contentType)) {
    throw badRequest(`${fileLabel} cannot be transformed`);
  }
}

export function requireFileTransformer(transformer: FileTransformer | undefined): FileTransformer {
  if (!transformer) {
    throw badRequest("File transforms are not configured");
  }
  return transformer;
}

export function requireDirectFileUploadCreator(
  createDirectUpload: FileStorage["createDirectUpload"] | undefined
): NonNullable<FileStorage["createDirectUpload"]> {
  if (!createDirectUpload) {
    throw badRequest("Direct uploads are not supported by this file storage");
  }
  return createDirectUpload;
}

export function requireMultipartFileUploads(
  multipartUploads: FileStorage["multipartUploads"] | undefined
): MultipartFileStorage {
  if (!multipartUploads) {
    throw badRequest("Multipart uploads are not supported by this file storage");
  }
  return multipartUploads;
}

export function requireFileObjectMetadata(
  object: FileObjectMetadata | null | undefined,
  fileDoctype: string,
  fileName: string
): FileObjectMetadata {
  if (!object) {
    throw notFound(`${fileDoctype}/${fileName} content was not found`);
  }
  return object;
}

export function requireStoredFileObject(
  object: StoredFileObject | null | undefined,
  fileDoctype: string,
  fileName: string
): StoredFileObject {
  if (!object) {
    throw notFound(`${fileDoctype}/${fileName} content was not found`);
  }
  return object;
}

export function requireStoredFileRenditionObject(
  object: StoredFileObject | null | undefined,
  fileDoctype: string,
  fileName: string,
  renditionId: string
): StoredFileObject {
  if (!object) {
    throw notFound(`${fileDoctype}/${fileName} rendition '${renditionId}' content was not found`);
  }
  return object;
}

export function fileObjectContentType(snapshot: DocumentSnapshot, object: FileObjectMetadata): string {
  return object.contentType ?? requireFileSnapshotString(snapshot, "content_type");
}

export function fileObjectSourceEtag(object: FileObjectMetadata): string {
  return object.httpEtag ?? object.etag;
}

export function ensureFileObjectTransformable(
  snapshot: DocumentSnapshot,
  object: FileObjectMetadata,
  fileLabel: string
): void {
  ensureFileContentTypeTransformable(fileObjectContentType(snapshot, object), fileLabel);
}

export function normalizeFileSize(size: number): number {
  if (!Number.isInteger(size) || size < 0) {
    throw badRequest("size must be a non-negative integer");
  }
  return size;
}

export function ensureFileSizeWithinLimit(size: number, maxFileBytes: number): void {
  if (size > maxFileBytes) {
    throw badRequest(`File exceeds ${String(maxFileBytes)} bytes`);
  }
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

export function fileUploadExpiresAt(now: string, expiresInSeconds: number | undefined): string {
  const timestamp = Date.parse(now);
  if (!Number.isFinite(timestamp)) {
    throw badRequest("clock returned an invalid timestamp");
  }
  return new Date(timestamp + normalizeDirectUploadExpiry(expiresInSeconds) * 1000).toISOString();
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

export function multipartPartManifestPatch(
  manifest: readonly MultipartPartManifestEntry[],
  part: MultipartPartManifestEntry
): DocumentData {
  return {
    multipart_parts: upsertMultipartPartManifest(manifest, part)
  };
}

export interface FileMultipartPartRecordedDocumentCommand {
  readonly command: "recordMultipartPart";
  readonly input: DocumentData;
  readonly expectedVersion: number;
}

export function fileMultipartPartRecordedDocumentCommand(command: {
  readonly snapshot: DocumentSnapshot;
  readonly part: UploadedMultipartFilePart;
  readonly size: number;
}): FileMultipartPartRecordedDocumentCommand {
  return {
    command: "recordMultipartPart",
    input: multipartPartManifestPatch(multipartPartManifest(command.snapshot), {
      partNumber: command.part.partNumber,
      etag: command.part.etag,
      size: command.size
    }),
    expectedVersion: command.snapshot.version
  };
}

export interface FileMultipartPartRecordedExecuteCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly command: "recordMultipartPart";
  readonly input: DocumentData;
  readonly tenantId?: string;
  readonly expectedVersion: number;
  readonly metadata: DocumentData;
}

export function fileMultipartPartRecordedExecuteCommand(command: {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly tenantId?: string | undefined;
  readonly metadata?: DocumentData | undefined;
  readonly recorded: FileMultipartPartRecordedDocumentCommand;
}): FileMultipartPartRecordedExecuteCommand {
  return {
    actor: command.actor,
    doctype: command.doctype,
    name: command.name,
    command: command.recorded.command,
    input: command.recorded.input,
    ...fileTenantCommandOption(command.tenantId),
    expectedVersion: command.recorded.expectedVersion,
    metadata: fileCommandMetadata(command.metadata)
  };
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

export interface FileBulkDeleteEntryCommand {
  readonly actor: Actor;
  readonly name: string;
  readonly tenantId?: string;
  readonly expectedVersion?: number;
  readonly metadata: DocumentData;
}

export function fileBulkDeleteEntryCommand(command: {
  readonly actor: Actor;
  readonly tenantId?: string | undefined;
  readonly metadata?: DocumentData | undefined;
  readonly selection: BulkFileSelectionPolicyInput;
}): FileBulkDeleteEntryCommand {
  return {
    actor: command.actor,
    name: command.selection.name,
    ...fileExpectedVersionCommandOption(command.selection.expectedVersion),
    ...fileTenantCommandOption(command.tenantId),
    metadata: fileCommandMetadata(command.metadata)
  };
}

export function fileBulkFailure(name: string, error: unknown, fallback: string): {
  readonly name: string;
  readonly code: FrameworkError["code"] | "UNKNOWN";
  readonly message: string;
  readonly status: number;
} {
  if (error instanceof FrameworkError) {
    return {
      name,
      code: error.code,
      message: error.message,
      status: error.status
    };
  }
  return {
    name,
    code: "UNKNOWN",
    message: error instanceof Error ? error.message : fallback,
    status: 500
  };
}

export function fileBulkDeleteFailure(name: string, error: unknown): ReturnType<typeof fileBulkFailure> {
  return fileBulkFailure(name, error, "Bulk delete failed");
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

export function optionalFileScanPatch(result: FileScanResult | undefined, checkedAt: string): DocumentData {
  return result === undefined ? {} : fileScanPatch(result, checkedAt);
}

export function isInfectedFileScanResult(
  result: FileScanResult | undefined
): result is FileScanResult & { readonly status: "infected" } {
  return result?.status === "infected";
}

export function fileScanTarget(command: {
  readonly actorId: string;
  readonly tenantId: string;
  readonly filename: string;
  readonly source: FileScanSource;
  readonly object: FileObjectMetadata;
}): FileScanTarget {
  return {
    actorId: command.actorId,
    tenantId: command.tenantId,
    key: command.object.key,
    filename: command.filename,
    contentType: command.object.contentType ?? "application/octet-stream",
    size: command.object.size,
    source: command.source,
    etag: command.object.etag,
    ...(command.object.httpEtag === undefined ? {} : { httpEtag: command.object.httpEtag })
  };
}

export function fileUploadObjectCustomMetadata(command: {
  readonly tenantId: string;
  readonly uploadedBy: string;
}): Readonly<Record<string, string>> {
  return {
    tenantId: command.tenantId,
    uploadedBy: command.uploadedBy
  };
}

export function fileBufferedUploadPutObjectCommand(command: {
  readonly key: string;
  readonly body: FileContent;
  readonly contentType: string;
  readonly filename: string;
  readonly size: number;
  readonly tenantId: string;
  readonly uploadedBy: string;
}): PutFileObjectCommand {
  return {
    key: command.key,
    body: command.body,
    contentType: command.contentType,
    filename: command.filename,
    size: command.size,
    customMetadata: fileUploadObjectCustomMetadata({
      tenantId: command.tenantId,
      uploadedBy: command.uploadedBy
    })
  };
}

export function fileDirectUploadReservationCommand(command: {
  readonly key: string;
  readonly contentType: string;
  readonly filename: string;
  readonly size: number;
  readonly expiresAt: string;
  readonly tenantId: string;
  readonly uploadedBy: string;
}): CreateDirectFileUploadCommand {
  return {
    key: command.key,
    contentType: command.contentType,
    filename: command.filename,
    size: command.size,
    expiresAt: command.expiresAt,
    customMetadata: fileUploadObjectCustomMetadata({
      tenantId: command.tenantId,
      uploadedBy: command.uploadedBy
    })
  };
}

export function fileMultipartUploadReservationCommand(command: {
  readonly key: string;
  readonly contentType: string;
  readonly filename: string;
  readonly tenantId: string;
  readonly uploadedBy: string;
}): CreateMultipartFileUploadCommand {
  return {
    key: command.key,
    contentType: command.contentType,
    filename: command.filename,
    customMetadata: fileUploadObjectCustomMetadata({
      tenantId: command.tenantId,
      uploadedBy: command.uploadedBy
    })
  };
}

export function fileMultipartPartUploadCommand(command: {
  readonly snapshot: DocumentSnapshot;
  readonly uploadId: string;
  readonly partNumber: number;
  readonly body: MultipartFilePartContent;
}): UploadMultipartFilePartCommand {
  return {
    key: filePrimaryObjectKey(command.snapshot),
    uploadId: command.uploadId,
    partNumber: command.partNumber,
    body: command.body
  };
}

export function fileMultipartCompletionCommand(command: {
  readonly snapshot: DocumentSnapshot;
  readonly uploadId: string;
  readonly parts: readonly UploadedMultipartFilePart[];
}): CompleteMultipartFileUploadCommand {
  return {
    key: filePrimaryObjectKey(command.snapshot),
    uploadId: command.uploadId,
    parts: command.parts
  };
}

export function fileMultipartAbortCommand(command: {
  readonly snapshot: DocumentSnapshot;
  readonly uploadId: string;
}): AbortMultipartFileUploadCommand {
  return fileMultipartUploadAbortCommand({
    key: filePrimaryObjectKey(command.snapshot),
    uploadId: command.uploadId
  });
}

export function fileMultipartUploadAbortCommand(command: {
  readonly key: string;
  readonly uploadId: string;
}): AbortMultipartFileUploadCommand {
  return {
    key: command.key,
    uploadId: command.uploadId
  };
}

export function fileRenditionObjectCustomMetadata(command: {
  readonly tenantId: string;
  readonly sourceFile: string;
  readonly sourceEtag: string;
  readonly renditionId: string;
}): Readonly<Record<string, string>> {
  return {
    tenantId: command.tenantId,
    sourceFile: command.sourceFile,
    sourceEtag: command.sourceEtag,
    renditionId: command.renditionId
  };
}

export function fileRenditionPutObjectCommand(command: {
  readonly pending: FileRenditionManifestEntry;
  readonly transform: TransformedFileObject;
  readonly sourceFilename: string;
  readonly tenantId: string;
  readonly sourceFile: string;
  readonly sourceEtag: string;
  readonly renditionId: string;
}): PutFileObjectCommand {
  return {
    key: command.pending.key,
    body: command.transform.body,
    contentType: command.transform.contentType,
    filename: fileRenditionFilename(command.sourceFilename, command.renditionId, command.transform.contentType),
    ...(command.transform.contentLength === undefined ? {} : { size: command.transform.contentLength }),
    customMetadata: fileRenditionObjectCustomMetadata({
      tenantId: command.tenantId,
      sourceFile: command.sourceFile,
      sourceEtag: command.sourceEtag,
      renditionId: command.renditionId
    })
  };
}

export function fileRenditionSnapshotPutObjectCommand(command: {
  readonly pending: FileRenditionManifestEntry;
  readonly transform: TransformedFileObject;
  readonly source: DocumentSnapshot;
  readonly tenantId: string;
  readonly sourceEtag: string;
  readonly renditionId: string;
}): PutFileObjectCommand {
  return fileRenditionPutObjectCommand({
    pending: command.pending,
    transform: command.transform,
    sourceFilename: fileSnapshotFilename(command.source),
    tenantId: command.tenantId,
    sourceFile: command.source.name,
    sourceEtag: command.sourceEtag,
    renditionId: command.renditionId
  });
}

export function fileTransformObjectCommand(command: {
  readonly actorId: string;
  readonly tenantId: string;
  readonly snapshot: DocumentSnapshot;
  readonly object: StoredFileObject;
  readonly options: FileTransformOptions;
  readonly overlay?: FileTransformOverlaySource;
}): TransformFileObjectCommand {
  return {
    actorId: command.actorId,
    tenantId: command.tenantId,
    source: fileTransformSource(command.snapshot, command.object),
    options: command.options,
    ...fileTransformOverlayCommandOption(command.overlay)
  };
}

export function ensureValidFileScanResult(result: FileScanResult): void {
  if (result.status !== "clean" && result.status !== "infected") {
    throw badRequest("File scanner returned an invalid status");
  }
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

export interface FileUploadDocumentDataCommand {
  readonly filename: string;
  readonly key: string;
  readonly contentType: string;
  readonly size: number;
  readonly isPrivate?: boolean;
  readonly uploadedBy: string;
  readonly uploadedAt: string;
  readonly attachedTo?: {
    readonly doctype: string;
    readonly name: string;
  };
}

export interface FilePendingUploadDocumentDataCommand extends FileUploadDocumentDataCommand {
  readonly directUploadExpiresAt: string;
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

export function fileBufferedUploadDocumentData(command: FileUploadDocumentDataCommand): DocumentData {
  return fileDocumentData({
    ...command,
    isPrivate: fileUploadIsPrivate(command.isPrivate),
    storageState: "available"
  });
}

export function filePendingUploadDocumentData(command: FilePendingUploadDocumentDataCommand): DocumentData {
  return fileDocumentData({
    ...command,
    isPrivate: fileUploadIsPrivate(command.isPrivate),
    storageState: "upload_pending"
  });
}

export interface FileDirectUploadDocumentCreateCommand {
  readonly data: DocumentData;
  readonly eventType: "FileDirectUploadReserved";
}

export function fileDirectUploadDocumentCreateCommand(
  command: FilePendingUploadDocumentDataCommand
): FileDirectUploadDocumentCreateCommand {
  return {
    data: filePendingUploadDocumentData(command),
    eventType: "FileDirectUploadReserved"
  };
}

export function fileMultipartUploadDocumentData(data: DocumentData, uploadId: string): DocumentData {
  return {
    ...data,
    multipart_upload_id: uploadId
  };
}

export interface FileMultipartUploadDocumentCreateCommand {
  readonly data: DocumentData;
  readonly eventType: "FileMultipartUploadReserved";
}

export function fileMultipartUploadDocumentCreateCommand(command: {
  readonly upload: FilePendingUploadDocumentDataCommand;
  readonly uploadId: string;
}): FileMultipartUploadDocumentCreateCommand {
  return {
    data: fileMultipartUploadDocumentData(filePendingUploadDocumentData(command.upload), command.uploadId),
    eventType: "FileMultipartUploadReserved"
  };
}

export function fileUploadCompletedPatch(object: FileObjectMetadata, scanPatch: DocumentData = {}): DocumentData {
  return {
    storage_state: "available",
    etag: object.httpEtag ?? object.etag,
    ...scanPatch
  };
}

export function fileUploadCompletedDocumentData(
  data: DocumentData,
  object: FileObjectMetadata,
  scanPatch: DocumentData = {}
): DocumentData {
  return {
    ...data,
    ...fileUploadCompletedPatch(object, scanPatch)
  };
}

export function fileUploadScanFailedPatch(object: FileObjectMetadata, scanPatch: DocumentData = {}): DocumentData {
  return {
    storage_state: "scan_failed",
    etag: object.httpEtag ?? object.etag,
    ...scanPatch
  };
}

export function fileUploadScanFailedDocumentData(
  data: DocumentData,
  object: FileObjectMetadata,
  scanPatch: DocumentData = {}
): DocumentData {
  return {
    ...data,
    ...fileUploadScanFailedPatch(object, scanPatch)
  };
}

export interface FileBufferedUploadDocumentCreateCommand {
  readonly data: DocumentData;
  readonly eventType?: "FileScanFailed";
}

export function fileBufferedUploadDocumentCreateCommand(command: {
  readonly data: DocumentData;
  readonly object: FileObjectMetadata;
  readonly scanPatch?: DocumentData;
  readonly infected?: boolean;
}): FileBufferedUploadDocumentCreateCommand {
  if (command.infected === true) {
    return {
      data: fileUploadScanFailedDocumentData(command.data, command.object, command.scanPatch),
      eventType: "FileScanFailed"
    };
  }
  return {
    data: fileUploadCompletedDocumentData(command.data, command.object, command.scanPatch)
  };
}

export type FileUploadCompletionDocumentCommandName =
  | "completeDirectUpload"
  | "completeMultipartUpload"
  | "failScan";

export interface FileUploadCompletionDocumentCommand {
  readonly command: FileUploadCompletionDocumentCommandName;
  readonly input: DocumentData;
  readonly expectedVersion?: number;
}

export function fileUploadCompletionDocumentCommand(command: {
  readonly uploadCommand: Exclude<FileUploadCompletionDocumentCommandName, "failScan">;
  readonly object: FileObjectMetadata;
  readonly scanPatch?: DocumentData;
  readonly infected?: boolean;
  readonly expectedVersion?: number;
}): FileUploadCompletionDocumentCommand {
  if (command.infected === true) {
    return {
      command: "failScan",
      input: fileUploadScanFailedPatch(command.object, command.scanPatch),
      ...fileExpectedVersionCommandOption(command.expectedVersion)
    };
  }
  return {
    command: command.uploadCommand,
    input: fileUploadCompletedPatch(command.object, command.scanPatch),
    ...fileExpectedVersionCommandOption(command.expectedVersion)
  };
}

export interface FileUploadCompletionExecuteCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly command: FileUploadCompletionDocumentCommandName;
  readonly input: DocumentData;
  readonly tenantId?: string;
  readonly expectedVersion?: number;
  readonly metadata: DocumentData;
}

export function fileUploadCompletionExecuteCommand(command: {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly tenantId?: string | undefined;
  readonly metadata?: DocumentData | undefined;
  readonly completion: FileUploadCompletionDocumentCommand;
}): FileUploadCompletionExecuteCommand {
  return {
    actor: command.actor,
    doctype: command.doctype,
    name: command.name,
    command: command.completion.command,
    input: command.completion.input,
    ...fileTenantCommandOption(command.tenantId),
    ...fileExpectedVersionCommandOption(command.completion.expectedVersion),
    metadata: fileCommandMetadata(command.metadata)
  };
}

export function fileMultipartCompletionStartedPatch(): DocumentData {
  return { storage_state: "upload_completing" };
}

export function shouldStartFileMultipartCompletion(snapshot: DocumentSnapshot): boolean {
  return !isFileMultipartCompletionStarted(snapshot);
}

export interface FileMultipartCompletionStartedDocumentCommand {
  readonly command: "beginMultipartUploadCompletion";
  readonly input: DocumentData;
  readonly expectedVersion?: number;
}

export function fileMultipartCompletionStartedDocumentCommand(command: {
  readonly snapshot: DocumentSnapshot;
  readonly expectedVersion?: number;
}): FileMultipartCompletionStartedDocumentCommand | undefined {
  if (!shouldStartFileMultipartCompletion(command.snapshot)) {
    return undefined;
  }
  return {
    command: "beginMultipartUploadCompletion",
    input: fileMultipartCompletionStartedPatch(),
    ...fileExpectedVersionCommandOption(command.expectedVersion)
  };
}

export interface FileMultipartCompletionStartedExecuteCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly command: "beginMultipartUploadCompletion";
  readonly input: DocumentData;
  readonly tenantId?: string;
  readonly expectedVersion?: number;
  readonly metadata: DocumentData;
}

export function fileMultipartCompletionStartedExecuteCommand(command: {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly tenantId?: string | undefined;
  readonly metadata?: DocumentData | undefined;
  readonly completionStart: FileMultipartCompletionStartedDocumentCommand;
}): FileMultipartCompletionStartedExecuteCommand {
  return {
    actor: command.actor,
    doctype: command.doctype,
    name: command.name,
    command: command.completionStart.command,
    input: command.completionStart.input,
    ...fileTenantCommandOption(command.tenantId),
    ...fileExpectedVersionCommandOption(command.completionStart.expectedVersion),
    metadata: fileCommandMetadata(command.metadata)
  };
}

export interface FileMetadataPatchCommand {
  readonly filename?: string;
  readonly isPrivate?: boolean;
  readonly attachedTo?:
    | {
        readonly doctype: string;
        readonly name: string;
      }
    | null;
}

export function ensureFileMetadataPatchProvided(command: FileMetadataPatchCommand): void {
  if (command.filename === undefined && command.isPrivate === undefined && command.attachedTo === undefined) {
    throw badRequest("At least one file metadata field must be provided");
  }
}

export function fileMetadataPatch(command: FileMetadataPatchCommand): DocumentData {
  ensureFileMetadataPatchProvided(command);
  const patch: DocumentData = {
    ...(command.filename === undefined ? {} : { filename: sanitizeFilename(command.filename) }),
    ...(command.isPrivate === undefined ? {} : { is_private: command.isPrivate })
  };
  if (command.attachedTo !== undefined) {
    if (command.attachedTo === null) {
      patch.attached_to_doctype = "";
      patch.attached_to_name = "";
    } else {
      patch.attached_to_doctype = command.attachedTo.doctype;
      patch.attached_to_name = command.attachedTo.name;
    }
  }
  return patch;
}

export interface FileMetadataUpdateDocumentCommand {
  readonly command: "updateMetadata";
  readonly input: DocumentData;
  readonly expectedVersion?: number;
}

export function fileMetadataUpdateDocumentCommand(
  command: FileMetadataPatchCommand & { readonly expectedVersion?: number }
): FileMetadataUpdateDocumentCommand {
  return {
    command: "updateMetadata",
    input: fileMetadataPatch(command),
    ...fileExpectedVersionCommandOption(command.expectedVersion)
  };
}

export interface FileMetadataUpdateExecuteCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly command: "updateMetadata";
  readonly input: DocumentData;
  readonly tenantId?: string;
  readonly expectedVersion?: number;
  readonly metadata: DocumentData;
}

export function fileMetadataUpdateExecuteCommand(command: {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly tenantId?: string | undefined;
  readonly metadata?: DocumentData | undefined;
  readonly update: FileMetadataUpdateDocumentCommand;
}): FileMetadataUpdateExecuteCommand {
  return {
    actor: command.actor,
    doctype: command.doctype,
    name: command.name,
    command: command.update.command,
    input: command.update.input,
    ...fileTenantCommandOption(command.tenantId),
    ...fileExpectedVersionCommandOption(command.update.expectedVersion),
    metadata: fileCommandMetadata(command.metadata)
  };
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

export function ensureFileCreateAllowed(command: {
  readonly actor: Actor;
  readonly doctype: DocTypeDefinition;
  readonly fileDoctype: string;
  readonly data: DocumentData;
}): void {
  if (!can(command.actor, command.doctype, "create")) {
    throw permissionDenied(`Actor '${command.actor.id}' cannot create ${command.fileDoctype}`);
  }
  const issues = validateDocumentData(command.doctype, command.data);
  if (issues.length > 0) {
    throw validationFailed(issues);
  }
}

export function ensureFileDeleteExpectedVersion(snapshot: DocumentSnapshot, expectedVersion: number | undefined): void {
  if (
    expectedVersion !== undefined &&
    snapshot.version !== expectedVersion &&
    !isFileDeleteRequested(snapshot)
  ) {
    throw conflict(`Expected version ${expectedVersion}, found ${snapshot.version}`);
  }
}

export function ensureFileDeleteAllowed(command: {
  readonly actor: Actor;
  readonly doctype: DocTypeDefinition;
  readonly fileDoctype: string;
  readonly snapshot: DocumentSnapshot;
  readonly expectedVersion?: number;
}): void {
  if (!can(command.actor, command.doctype, "delete", command.snapshot)) {
    throw permissionDenied(`Actor '${command.actor.id}' cannot delete ${command.fileDoctype}/${command.snapshot.name}`);
  }
  ensureFileDeleteExpectedVersion(command.snapshot, command.expectedVersion);
}

export function ensureFileMetadataUpdateAllowed(command: {
  readonly actor: Actor;
  readonly doctype: DocTypeDefinition;
  readonly fileDoctype: string;
  readonly snapshot: DocumentSnapshot;
}): void {
  if (!can(command.actor, command.doctype, "metadata", command.snapshot)) {
    throw permissionDenied(
      `Actor '${command.actor.id}' cannot execute updateMetadata on ${command.fileDoctype}/${command.snapshot.name}`
    );
  }
  ensureFileNotDeleteRequested(command.snapshot);
}

export function ensureFileRenditionGenerationAllowed(command: {
  readonly actor: Actor;
  readonly doctype: DocTypeDefinition;
  readonly fileDoctype: string;
  readonly snapshot: DocumentSnapshot;
}): void {
  if (!can(command.actor, command.doctype, "rendition", command.snapshot)) {
    throw permissionDenied(
      `Actor '${command.actor.id}' cannot generate renditions for ${command.fileDoctype}/${command.snapshot.name}`
    );
  }
}

export function ensureFileMultipartUploadAllowed(command: {
  readonly actor: Actor;
  readonly doctype: DocTypeDefinition;
  readonly fileDoctype: string;
  readonly snapshot: DocumentSnapshot;
  readonly ensurePendingMultipartUpload: (snapshot: DocumentSnapshot) => void;
}): void {
  command.ensurePendingMultipartUpload(command.snapshot);
  if (!can(command.actor, command.doctype, "metadata", command.snapshot)) {
    throw permissionDenied(
      `Actor '${command.actor.id}' cannot execute multipart upload on ${command.fileDoctype}/${command.snapshot.name}`
    );
  }
}

export function ensureFileAvailableForDownload(snapshot: DocumentSnapshot): void {
  if (isFileUploadPending(snapshot) || isFileMultipartCompletionStarted(snapshot)) {
    throw new FrameworkError("FILE_UPLOAD_PENDING", `${snapshot.doctype}/${snapshot.name} upload has not been finalized`, {
      status: 409
    });
  }
  if (isFileScanFailed(snapshot)) {
    throw new FrameworkError("FILE_SCAN_FAILED", `${snapshot.doctype}/${snapshot.name} did not pass file scanning`, {
      status: 409
    });
  }
  ensureFileNotDeleteRequested(snapshot);
}

export function ensureFileNotDeleteRequested(snapshot: DocumentSnapshot): void {
  if (isFileDeleteRequested(snapshot)) {
    throw new FrameworkError("DOCUMENT_DELETED", `${snapshot.doctype}/${snapshot.name} is pending deletion`, {
      status: 410
    });
  }
}

export function isFileDeleteRequested(snapshot: DocumentSnapshot): boolean {
  return snapshot.data.storage_state === "delete_requested";
}

export function shouldRequestFileDelete(snapshot: DocumentSnapshot): boolean {
  return !isFileDeleteRequested(snapshot);
}

export interface FileDeleteRequestedDocumentCommand {
  readonly command: "requestDelete";
  readonly input: DocumentData;
  readonly expectedVersion: number;
}

export function fileDeleteRequestedDocumentCommand(
  snapshot: DocumentSnapshot
): FileDeleteRequestedDocumentCommand | undefined {
  if (!shouldRequestFileDelete(snapshot)) {
    return undefined;
  }
  return {
    command: "requestDelete",
    input: {},
    expectedVersion: snapshot.version
  };
}

export interface FileDeleteRequestedExecuteCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly command: "requestDelete";
  readonly input: DocumentData;
  readonly tenantId?: string;
  readonly expectedVersion: number;
  readonly metadata: DocumentData;
}

export function fileDeleteRequestedExecuteCommand(command: {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly tenantId?: string | undefined;
  readonly metadata?: DocumentData | undefined;
  readonly deleteRequest: FileDeleteRequestedDocumentCommand;
}): FileDeleteRequestedExecuteCommand {
  return {
    actor: command.actor,
    doctype: command.doctype,
    name: command.name,
    command: command.deleteRequest.command,
    input: command.deleteRequest.input,
    ...fileTenantCommandOption(command.tenantId),
    expectedVersion: command.deleteRequest.expectedVersion,
    metadata: fileCommandMetadata(command.metadata)
  };
}

export interface FileDeletedDocumentCommand {
  readonly expectedVersion: number;
}

export function fileDeletedDocumentCommand(snapshot: DocumentSnapshot): FileDeletedDocumentCommand {
  return {
    expectedVersion: snapshot.version
  };
}

export interface FileDeletedExecuteCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly tenantId?: string;
  readonly expectedVersion: number;
  readonly metadata: DocumentData;
}

export function fileDeletedExecuteCommand(command: {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly tenantId?: string | undefined;
  readonly metadata?: DocumentData | undefined;
  readonly deleted: FileDeletedDocumentCommand;
}): FileDeletedExecuteCommand {
  return {
    actor: command.actor,
    doctype: command.doctype,
    name: command.name,
    ...fileTenantCommandOption(command.tenantId),
    expectedVersion: command.deleted.expectedVersion,
    metadata: fileCommandMetadata(command.metadata)
  };
}

export function isFileMultipartCompletionStarted(snapshot: DocumentSnapshot): boolean {
  return snapshot.data.storage_state === "upload_completing";
}

export function isFileUploadPending(snapshot: DocumentSnapshot): boolean {
  return snapshot.data.storage_state === "upload_pending";
}

export function isFileScanFailed(snapshot: DocumentSnapshot): boolean {
  return snapshot.data.storage_state === "scan_failed";
}

export function ensureFilePendingDirectUpload(snapshot: DocumentSnapshot): void {
  ensureFileNotDeleteRequested(snapshot);
  if (!isFileUploadPending(snapshot)) {
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

export function ensureFilePendingMultipartPartUpload(snapshot: DocumentSnapshot): void {
  ensureFilePendingMultipartUpload(snapshot, ["upload_pending"]);
}

export function ensureFilePendingMultipartCompletion(snapshot: DocumentSnapshot): void {
  ensureFilePendingMultipartUpload(snapshot, ["upload_pending", "upload_completing"]);
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

export interface FileDashboardFilterQuery {
  readonly attachedToDoctype?: string;
  readonly attachedToName?: string;
  readonly filename?: string;
  readonly contentType?: string;
  readonly uploadedBy?: string;
  readonly storageState?: string;
  readonly scanStatus?: string;
  readonly isPrivate?: boolean;
}

export interface FileDashboardFilters {
  readonly attachedToDoctype?: string;
  readonly attachedToName?: string;
  readonly filename?: string;
  readonly contentType?: string;
  readonly uploadedBy?: string;
  readonly storageState?: string;
  readonly scanStatus?: string;
  readonly isPrivate?: boolean;
}

export function normalizeFileDashboardFilters(query: FileDashboardFilterQuery): FileDashboardFilters {
  return {
    ...optionalTextFilter("attachedToDoctype", query.attachedToDoctype),
    ...optionalTextFilter("attachedToName", query.attachedToName),
    ...optionalTextFilter("filename", query.filename),
    ...optionalTextFilter("contentType", query.contentType),
    ...optionalTextFilter("uploadedBy", query.uploadedBy),
    ...optionalTextFilter("storageState", query.storageState),
    ...optionalTextFilter("scanStatus", query.scanStatus),
    ...(query.isPrivate === undefined ? {} : { isPrivate: query.isPrivate })
  };
}

export function fileDashboardListFilters(filters: FileDashboardFilters): readonly ListDocumentsFilter[] {
  return [
    ...fileTextListFilter("attached_to_doctype", "eq", filters.attachedToDoctype),
    ...fileTextListFilter("attached_to_name", "eq", filters.attachedToName),
    ...fileTextListFilter("filename", "contains", filters.filename),
    ...fileTextListFilter("content_type", "contains", filters.contentType),
    ...fileTextListFilter("uploaded_by", "eq", filters.uploadedBy),
    ...fileTextListFilter("storage_state", "eq", filters.storageState),
    ...fileTextListFilter("scan_status", "eq", filters.scanStatus),
    ...(filters.isPrivate === undefined
      ? []
      : [{ field: "is_private", operator: "eq" as const, value: filters.isPrivate }])
  ];
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

export function fileDashboardEntryWithPermissions(command: {
  readonly actor: Actor;
  readonly doctype: DocTypeDefinition;
  readonly snapshot: DocumentSnapshot;
}): FileDashboardEntryView & { readonly editable: boolean; readonly deletable: boolean } {
  return {
    ...fileDashboardEntry(command.snapshot),
    editable: can(command.actor, command.doctype, "metadata", command.snapshot),
    deletable: can(command.actor, command.doctype, "delete", command.snapshot)
  };
}

export function canUploadFile(actor: Actor, doctype: DocTypeDefinition): boolean {
  return can(actor, doctype, "create");
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

export function availableFileRenditionForDownload(
  snapshot: DocumentSnapshot,
  renditionId: string
): FileRenditionManifestEntry {
  const rendition = fileRenditions(snapshot).find((entry) => entry.id === renditionId);
  if (!rendition || rendition.status !== "available") {
    throw notFound(`${snapshot.doctype}/${snapshot.name} rendition '${renditionId}' was not found`);
  }
  return rendition;
}

export function filePrimaryObjectKey(snapshot: DocumentSnapshot): string {
  return requireFileSnapshotString(snapshot, "key");
}

export function fileSnapshotFilename(snapshot: DocumentSnapshot): string {
  return requireFileSnapshotString(snapshot, "filename");
}

export function fileObjectKeysForDelete(snapshot: DocumentSnapshot): readonly string[] {
  return [
    ...new Set([
      filePrimaryObjectKey(snapshot),
      ...fileRenditions(snapshot).map((rendition) => rendition.key)
    ])
  ];
}

export function fileObjectKeysForScanFailureCleanup(snapshot: DocumentSnapshot): readonly string[] {
  return [filePrimaryObjectKey(snapshot)];
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

export function fileTransformSource(snapshot: DocumentSnapshot, object: StoredFileObject): FileTransformSource {
  return {
    key: object.metadata.key,
    filename: fileSnapshotFilename(snapshot),
    contentType: fileObjectContentType(snapshot, object.metadata),
    size: object.metadata.size,
    body: object.body,
    etag: object.metadata.etag,
    ...(object.metadata.httpEtag === undefined ? {} : { httpEtag: object.metadata.httpEtag })
  };
}

export function fileTransformOverlaySource(
  snapshot: DocumentSnapshot,
  object: StoredFileObject,
  overlay: NonNullable<FileTransformOptions["overlay"]>
): FileTransformOverlaySource {
  const source = fileTransformSource(snapshot, object);
  ensureFileContentTypeTransformable(source.contentType, `File overlay '${overlay.file}'`);
  return {
    file: overlay.file,
    ...source,
    ...(overlay.placement === undefined ? {} : { placement: overlay.placement }),
    ...(overlay.opacity === undefined ? {} : { opacity: overlay.opacity }),
    ...(overlay.width === undefined ? {} : { width: overlay.width }),
    ...(overlay.height === undefined ? {} : { height: overlay.height })
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

export function failedFileRenditionForError(command: {
  readonly pending: FileRenditionManifestEntry;
  readonly error: unknown;
}): FileRenditionManifestEntry {
  return failedFileRendition({
    pending: command.pending,
    message: command.error instanceof Error ? command.error.message : String(command.error)
  });
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

export function availableFileRenditionForSource(
  renditions: readonly FileRenditionManifestEntry[],
  renditionId: string,
  sourceEtag: string,
  overlay: FileTransformOverlaySource | undefined
): FileRenditionManifestEntry | undefined {
  return renditions.find((rendition) =>
    rendition.id === renditionId &&
    rendition.status === "available" &&
    renditionSourcesMatch(rendition, sourceEtag, overlay)
  );
}

export function reusableFileRenditionForGeneration(
  snapshot: DocumentSnapshot,
  renditionId: string,
  sourceEtag: string,
  overlay: FileTransformOverlaySource | undefined
): FileRenditionManifestEntry | undefined {
  return availableFileRenditionForSource(fileRenditions(snapshot), renditionId, sourceEtag, overlay);
}

export function ensureNoPendingFileRenditionForSource(
  renditions: readonly FileRenditionManifestEntry[],
  renditionId: string,
  sourceEtag: string,
  overlay: FileTransformOverlaySource | undefined
): void {
  const pending = renditions.find((rendition) =>
    rendition.id === renditionId &&
    rendition.status === "pending" &&
    renditionSourcesMatch(rendition, sourceEtag, overlay)
  );
  if (pending) {
    throw conflict(`File rendition '${renditionId}' is already being generated`);
  }
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

export function fileRenditionManifestPatch(
  manifest: readonly FileRenditionManifestEntry[],
  rendition: FileRenditionManifestEntry
): DocumentData {
  return {
    renditions: upsertFileRenditionManifest(manifest, rendition)
  };
}

export function fileRenditionSnapshotManifestPatch(
  snapshot: DocumentSnapshot,
  rendition: FileRenditionManifestEntry
): DocumentData {
  return fileRenditionManifestPatch(fileRenditions(snapshot), rendition);
}

export type FileRenditionManifestDocumentCommandName = "completeRendition" | "failRendition";

export function fileCompletedRenditionManifestCommandName(): FileRenditionManifestDocumentCommandName {
  return "completeRendition";
}

export function fileFailedRenditionManifestCommandName(): FileRenditionManifestDocumentCommandName {
  return "failRendition";
}

export interface FileRenditionManifestDocumentCommand {
  readonly command: FileRenditionManifestDocumentCommandName;
  readonly input: DocumentData;
  readonly expectedVersion: number;
}

export function fileRenditionManifestDocumentCommand(command: {
  readonly snapshot: DocumentSnapshot;
  readonly command: FileRenditionManifestDocumentCommandName;
  readonly rendition: FileRenditionManifestEntry;
}): FileRenditionManifestDocumentCommand {
  return {
    command: command.command,
    input: fileRenditionSnapshotManifestPatch(command.snapshot, command.rendition),
    expectedVersion: command.snapshot.version
  };
}

export interface FileRenditionManifestExecuteCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly command: FileRenditionManifestDocumentCommandName;
  readonly input: DocumentData;
  readonly tenantId?: string;
  readonly expectedVersion: number;
  readonly metadata: DocumentData;
}

export function fileRenditionManifestExecuteCommand(command: {
  readonly actor: Actor;
  readonly doctype: string;
  readonly name: string;
  readonly tenantId?: string | undefined;
  readonly metadata?: DocumentData | undefined;
  readonly snapshot: DocumentSnapshot;
  readonly command: FileRenditionManifestDocumentCommandName;
  readonly rendition: FileRenditionManifestEntry;
}): FileRenditionManifestExecuteCommand {
  const documentCommand = fileRenditionManifestDocumentCommand({
    snapshot: command.snapshot,
    command: command.command,
    rendition: command.rendition
  });
  return {
    actor: command.actor,
    doctype: command.doctype,
    name: command.name,
    command: documentCommand.command,
    input: documentCommand.input,
    ...fileTenantCommandOption(command.tenantId),
    expectedVersion: documentCommand.expectedVersion,
    metadata: fileCommandMetadata(command.metadata)
  };
}

export interface FileRenditionGenerationReservation {
  readonly pending: FileRenditionManifestEntry;
  readonly patch: DocumentData;
}

export function fileRenditionGenerationReservation(command: {
  readonly snapshot: DocumentSnapshot;
  readonly tenantId: string;
  readonly id: string;
  readonly attemptId: string;
  readonly sourceEtag: string;
  readonly overlay?: FileTransformOverlaySource;
  readonly options: FileTransformOptions;
  readonly requestedAt: string;
  readonly requestedBy: string;
}): FileRenditionGenerationReservation {
  const manifest = fileRenditions(command.snapshot);
  ensureNoPendingFileRenditionForSource(manifest, command.id, command.sourceEtag, command.overlay);
  const pending = pendingFileRendition(command);
  return {
    pending,
    patch: fileRenditionManifestPatch(manifest, pending)
  };
}

export interface FileRenditionReservationDocumentCommand {
  readonly command: "reserveRendition";
  readonly input: DocumentData;
  readonly expectedVersion: number;
}

export function fileRenditionReservationDocumentCommand(command: {
  readonly snapshot: DocumentSnapshot;
  readonly reservation: FileRenditionGenerationReservation;
}): FileRenditionReservationDocumentCommand {
  return {
    command: "reserveRendition",
    input: command.reservation.patch,
    expectedVersion: command.snapshot.version
  };
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

function optionalTextFilter<TKey extends string>(key: TKey, value: string | undefined): { readonly [K in TKey]?: string } {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? {} : { [key]: trimmed } as { readonly [K in TKey]: string };
}

function fileTextListFilter(
  field: string,
  operator: "eq" | "contains",
  value: string | undefined
): readonly ListDocumentsFilter[] {
  return value === undefined ? [] : [{ field, operator, value }];
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
