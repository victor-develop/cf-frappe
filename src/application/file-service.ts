import type { DocumentCommandExecutor } from "./document-service.js";
import { QueryService } from "./query-service.js";
import {
  badRequest,
  notFound,
  permissionDenied,
  type FrameworkErrorCode
} from "../core/errors.js";
import { FILE_DOCTYPE_NAME } from "../core/file-doctype.js";
import { can } from "../core/permissions.js";
import type { ModelRegistry } from "../core/registry.js";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocumentData,
  type DocumentSnapshot,
  type JsonValue
} from "../core/types.js";
import type { Clock } from "../ports/clock.js";
import { systemClock } from "../ports/clock.js";
import type { FileScanner, FileScanResult, FileScanSource } from "../ports/file-scanner.js";
import {
  normalizeFileTransformOptions,
  type FileTransformOverlaySource,
  type FileTransformer,
  type FileTransformOptions,
  type TransformedFileObject
} from "../ports/file-transformer.js";
import type {
  DirectFileUpload,
  FileContent,
  FileObjectMetadata,
  FileStorage,
  MultipartFilePartContent,
  MultipartFileUpload,
  StoredFileObject,
  UploadedMultipartFilePart
} from "../ports/file-storage.js";
import {
  availableFileRenditionForDownload,
  completeFileRendition,
  ensureFileSizeWithinLimit,
  ensureFileObjectTransformable,
  ensureValidFileScanResult,
  ensureFileAvailableForDownload,
  ensureFileCreateAllowed,
  ensureFileDeleteAllowed,
  ensureFileExpectedVersion,
  ensureFileNotDeleteRequested,
  ensureFilePendingDirectUpload,
  ensureFilePendingMultipartCompletion,
  ensureFilePendingMultipartPartUpload,
  ensureFileMetadataPatchProvided,
  ensureDirectUploadMatches,
  ensureMultipartCompletionMatchesManifest,
  ensureMultipartPartFitsReservation,
  fileBulkDeleteFailure,
  fileBulkFailure,
  fileContentLength,
  fileDashboardEntry,
  fileDashboardListFilters,
  fileDocumentData,
  fileMetadataPatch,
  fileMultipartCompletionStartedPatch,
  fileMultipartUploadDocumentData,
  fileMultipartUploadId,
  fileObjectKeysForDelete,
  fileObjectKeysForScanFailureCleanup,
  filePrimaryObjectKey,
  fileObjectSourceEtag,
  fileRenditionGenerationReservation,
  fileRenditionId,
  fileRenditionSnapshotPutObjectCommand,
  fileRenditionSnapshotManifestPatch,
  fileRenditionView,
  fileScanFailureError,
  fileScanTarget,
  fileUploadCompletedPatch,
  fileUploadCompletedDocumentData,
  fileUploadExpiresAt,
  fileUploadObjectCustomMetadata,
  fileUploadScanFailedDocumentData,
  fileUploadScanFailedPatch,
  fileTransformOverlaySource,
  fileTransformSource,
  fileSnapshotFilename,
  failedFileRenditionForError,
  isInfectedFileScanResult,
  multipartPartManifest,
  multipartPartManifestPatch,
  multipartPartSize,
  normalizeBulkFileSelections,
  normalizeFileDashboardFilters,
  normalizeFileDashboardLimit,
  normalizeFileSize,
  objectKey,
  optionalFileScanPatch,
  requireFileSnapshotString,
  reusableFileRenditionForGeneration,
  sanitizeFilename,
  shouldRequestFileDelete,
  shouldStartFileMultipartCompletion,
  type FileRenditionManifestEntry,
} from "./file-policy.js";
import type { IdGenerator } from "../ports/id-generator.js";
import { cryptoIdGenerator } from "../ports/id-generator.js";

export interface FileServiceOptions {
  readonly registry: ModelRegistry;
  readonly documents: DocumentCommandExecutor;
  readonly queries: QueryService;
  readonly storage: FileStorage;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  readonly maxFileBytes?: number;
  readonly fileDoctype?: string;
  readonly scanner?: FileScanner;
  readonly transformer?: FileTransformer;
}

export interface UploadFileCommand {
  readonly actor: Actor;
  readonly filename: string;
  readonly body: FileContent;
  readonly contentType?: string;
  readonly tenantId?: string;
  readonly isPrivate?: boolean;
  readonly attachedTo?: {
    readonly doctype: string;
    readonly name: string;
  };
  readonly metadata?: DocumentData;
}

export interface DownloadFileCommand {
  readonly actor: Actor;
  readonly name: string;
  readonly tenantId?: string;
}

export interface TransformFileCommand extends DownloadFileCommand {
  readonly options: FileTransformOptions;
}

export interface GenerateFileRenditionCommand extends TransformFileCommand {
  readonly metadata?: DocumentData;
}

export interface DownloadFileRenditionCommand extends DownloadFileCommand {
  readonly renditionId: string;
}

export interface PrepareDirectUploadCommand {
  readonly actor: Actor;
  readonly filename: string;
  readonly size: number;
  readonly contentType?: string;
  readonly tenantId?: string;
  readonly isPrivate?: boolean;
  readonly attachedTo?: {
    readonly doctype: string;
    readonly name: string;
  };
  readonly expiresInSeconds?: number;
  readonly metadata?: DocumentData;
}

export interface CompleteDirectUploadCommand extends DownloadFileCommand {
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface PrepareMultipartUploadCommand extends PrepareDirectUploadCommand {}

export interface UploadMultipartPartCommand extends DownloadFileCommand {
  readonly partNumber: number;
  readonly body: MultipartFilePartContent;
  readonly size?: number;
  readonly metadata?: DocumentData;
}

export interface CompleteMultipartUploadCommand extends DownloadFileCommand {
  readonly parts: readonly UploadedMultipartFilePart[];
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface AbortMultipartUploadCommand extends DownloadFileCommand {
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface DeleteFileCommand extends DownloadFileCommand {
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface BulkFileSelection {
  readonly name: string;
  readonly expectedVersion?: number;
}

export type BulkDeleteFileSelection = BulkFileSelection;

export interface BulkDeleteFilesCommand {
  readonly actor: Actor;
  readonly files: readonly BulkFileSelection[];
  readonly tenantId?: string;
  readonly metadata?: DocumentData;
}

export interface BulkUpdateFileMetadataCommand {
  readonly actor: Actor;
  readonly files: readonly BulkFileSelection[];
  readonly tenantId?: string;
  readonly isPrivate?: boolean;
  readonly attachedTo?:
    | {
        readonly doctype: string;
        readonly name: string;
      }
    | null;
  readonly metadata?: DocumentData;
}

export interface BulkDeletedFile {
  readonly name: string;
  readonly snapshot: DocumentSnapshot;
}

export interface BulkUpdatedFile {
  readonly name: string;
  readonly snapshot: DocumentSnapshot;
}

export interface BulkDeleteFileFailure {
  readonly name: string;
  readonly code: FrameworkErrorCode | "UNKNOWN";
  readonly message: string;
  readonly status: number;
}

export type BulkUpdateFileMetadataFailure = BulkDeleteFileFailure;

export interface BulkDeleteFilesResult {
  readonly deleted: readonly BulkDeletedFile[];
  readonly failed: readonly BulkDeleteFileFailure[];
}

export interface BulkUpdateFileMetadataResult {
  readonly updated: readonly BulkUpdatedFile[];
  readonly failed: readonly BulkUpdateFileMetadataFailure[];
}

export interface UpdateFileMetadataCommand extends DownloadFileCommand {
  readonly filename?: string;
  readonly isPrivate?: boolean;
  readonly attachedTo?:
    | {
        readonly doctype: string;
        readonly name: string;
      }
    | null;
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface UploadedFile {
  readonly snapshot: DocumentSnapshot;
  readonly object: StoredFileObject["metadata"];
}

export interface PreparedDirectUpload {
  readonly snapshot: DocumentSnapshot;
  readonly upload: DirectFileUpload;
}

export interface PreparedMultipartUpload {
  readonly snapshot: DocumentSnapshot;
  readonly upload: MultipartFileUpload;
}

export interface UploadedMultipartPartResult {
  readonly part: UploadedMultipartFilePart;
  readonly snapshot: DocumentSnapshot;
}

export interface DownloadedFile {
  readonly snapshot: DocumentSnapshot;
  readonly object: StoredFileObject;
}

export interface TransformedFile {
  readonly snapshot: DocumentSnapshot;
  readonly object: StoredFileObject["metadata"];
  readonly transform: TransformedFileObject;
}

export interface FileRendition {
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

export interface GeneratedFileRendition {
  readonly snapshot: DocumentSnapshot;
  readonly rendition: FileRendition;
  readonly created: boolean;
}

export interface DownloadedFileRendition {
  readonly snapshot: DocumentSnapshot;
  readonly rendition: FileRendition;
  readonly object: StoredFileObject;
}

export interface FileDashboardQuery {
  readonly attachedToDoctype?: string;
  readonly attachedToName?: string;
  readonly filename?: string;
  readonly contentType?: string;
  readonly uploadedBy?: string;
  readonly storageState?: string;
  readonly scanStatus?: string;
  readonly isPrivate?: boolean;
  readonly limit?: number;
}

export interface FileDashboardEntry {
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
  readonly editable: boolean;
  readonly deletable: boolean;
  readonly attachedTo?: {
    readonly doctype: string;
    readonly name: string;
  };
  readonly renditions?: readonly FileRendition[];
}

export interface FileDashboard {
  readonly canUpload: boolean;
  readonly directUpload: boolean;
  readonly maxUploadBytes: number;
  readonly files: readonly FileDashboardEntry[];
  readonly limit: number;
  readonly filters: {
    readonly attachedToDoctype?: string;
    readonly attachedToName?: string;
    readonly filename?: string;
    readonly contentType?: string;
    readonly uploadedBy?: string;
    readonly storageState?: string;
    readonly scanStatus?: string;
    readonly isPrivate?: boolean;
  };
}

export class FileService {
  private readonly registry: ModelRegistry;
  private readonly documents: DocumentCommandExecutor;
  private readonly queries: QueryService;
  private readonly storage: FileStorage;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly maxFileBytes: number;
  private readonly fileDoctype: string;
  private readonly scanner: FileScanner | undefined;
  private readonly transformer: FileTransformer | undefined;

  constructor(options: FileServiceOptions) {
    this.registry = options.registry;
    this.documents = options.documents;
    this.queries = options.queries;
    this.storage = options.storage;
    this.clock = options.clock ?? systemClock;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.maxFileBytes = options.maxFileBytes ?? 25 * 1024 * 1024;
    this.fileDoctype = options.fileDoctype ?? FILE_DOCTYPE_NAME;
    this.scanner = options.scanner;
    this.transformer = options.transformer;
  }

  get maxUploadBytes(): number {
    return this.maxFileBytes;
  }

  async upload(command: UploadFileCommand): Promise<UploadedFile> {
    const filename = sanitizeFilename(command.filename);
    const size = fileContentLength(command.body);
    ensureFileSizeWithinLimit(size, this.maxFileBytes);

    const contentType = command.contentType ?? "application/octet-stream";
    const tenantId = command.tenantId ?? command.actor.tenantId ?? DEFAULT_TENANT_ID;
    await this.validateAttachmentTarget(command.actor, tenantId, command.attachedTo);
    const fileName = this.ids.next("file_");
    const key = objectKey(tenantId, fileName, filename);
    const data = fileDocumentData({
      filename,
      key,
      contentType,
      size,
      isPrivate: command.isPrivate ?? true,
      uploadedBy: command.actor.id,
      uploadedAt: this.clock.now(),
      storageState: "available",
      ...(command.attachedTo === undefined ? {} : { attachedTo: command.attachedTo })
    });
    this.preflightCreate(command.actor, data);
    const object = await this.storage.put({
      key,
      body: command.body,
      contentType,
      filename,
      size,
      customMetadata: fileUploadObjectCustomMetadata({ tenantId, uploadedBy: command.actor.id })
    });
    let scan: FileScanResult | undefined;
    try {
      scan = await this.scanObject({
        actor: command.actor,
        tenantId,
        filename,
        source: "buffered_upload",
        object
      });
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }

    try {
      const scanPatch = optionalFileScanPatch(scan, this.clock.now());
      if (isInfectedFileScanResult(scan)) {
        const snapshot = await this.documents.create({
          actor: command.actor,
          doctype: this.fileDoctype,
          name: fileName,
          tenantId,
          data: fileUploadScanFailedDocumentData(data, object, scanPatch),
          eventType: "FileScanFailed",
          metadata: command.metadata ?? {}
        });
        throw fileScanFailureError(scan, snapshot);
      }
      const snapshot = await this.documents.create({
        actor: command.actor,
        doctype: this.fileDoctype,
        name: fileName,
        tenantId,
        data: fileUploadCompletedDocumentData(data, object, scanPatch),
        metadata: command.metadata ?? {}
      });
      return { snapshot, object };
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
  }

  async prepareDirectUpload(command: PrepareDirectUploadCommand): Promise<PreparedDirectUpload> {
    if (!this.storage.createDirectUpload) {
      throw badRequest("Direct uploads are not supported by this file storage");
    }
    const filename = sanitizeFilename(command.filename);
    const size = normalizeFileSize(command.size);
    ensureFileSizeWithinLimit(size, this.maxFileBytes);

    const contentType = command.contentType ?? "application/octet-stream";
    const tenantId = command.tenantId ?? command.actor.tenantId ?? DEFAULT_TENANT_ID;
    await this.validateAttachmentTarget(command.actor, tenantId, command.attachedTo);
    const fileName = this.ids.next("file_");
    const key = objectKey(tenantId, fileName, filename);
    const expiresAt = fileUploadExpiresAt(this.clock.now(), command.expiresInSeconds);
    const data = fileDocumentData({
      filename,
      key,
      contentType,
      size,
      isPrivate: command.isPrivate ?? true,
      uploadedBy: command.actor.id,
      uploadedAt: this.clock.now(),
      storageState: "upload_pending",
      directUploadExpiresAt: expiresAt,
      scannerConfigured: this.scanner !== undefined,
      ...(command.attachedTo === undefined ? {} : { attachedTo: command.attachedTo })
    });
    this.preflightCreate(command.actor, data);
    const upload = await this.storage.createDirectUpload({
      key,
      contentType,
      filename,
      size,
      expiresAt,
      customMetadata: fileUploadObjectCustomMetadata({ tenantId, uploadedBy: command.actor.id })
    });
    const snapshot = await this.documents.create({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: fileName,
      tenantId,
      data,
      eventType: "FileDirectUploadReserved",
      metadata: command.metadata ?? {}
    });
    return { snapshot, upload };
  }

  async completeDirectUpload(command: CompleteDirectUploadCommand): Promise<DocumentSnapshot> {
    const tenantId = command.tenantId ?? command.actor.tenantId ?? DEFAULT_TENANT_ID;
    const current = await this.queries.getDocument(command.actor, this.fileDoctype, command.name, tenantId);
    ensureFilePendingDirectUpload(current);
    const object = await this.storage.head(filePrimaryObjectKey(current));
    if (!object) {
      throw notFound(`${this.fileDoctype}/${command.name} content was not found`);
    }
    ensureDirectUploadMatches(current, object);
    const scan = await this.scanObject({
      actor: command.actor,
      tenantId,
      filename: fileSnapshotFilename(current),
      source: "direct_upload",
      object
    });
    const scanPatch = optionalFileScanPatch(scan, this.clock.now());
    if (isInfectedFileScanResult(scan)) {
      const snapshot = await this.documents.execute({
        actor: command.actor,
        doctype: this.fileDoctype,
        name: command.name,
        command: "failScan",
        input: fileUploadScanFailedPatch(object, scanPatch),
        ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
        ...(command.expectedVersion === undefined ? {} : { expectedVersion: command.expectedVersion }),
        metadata: command.metadata ?? {}
      });
      await this.deleteFileObjectsForScanFailure(current);
      throw fileScanFailureError(scan, snapshot);
    }
    return this.documents.execute({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: command.name,
      command: "completeDirectUpload",
      input: fileUploadCompletedPatch(object, scanPatch),
      ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
      ...(command.expectedVersion === undefined ? {} : { expectedVersion: command.expectedVersion }),
      metadata: command.metadata ?? {}
    });
  }

  async prepareMultipartUpload(command: PrepareMultipartUploadCommand): Promise<PreparedMultipartUpload> {
    if (!this.storage.multipartUploads) {
      throw badRequest("Multipart uploads are not supported by this file storage");
    }
    const filename = sanitizeFilename(command.filename);
    const size = normalizeFileSize(command.size);
    ensureFileSizeWithinLimit(size, this.maxFileBytes);

    const contentType = command.contentType ?? "application/octet-stream";
    const tenantId = command.tenantId ?? command.actor.tenantId ?? DEFAULT_TENANT_ID;
    await this.validateAttachmentTarget(command.actor, tenantId, command.attachedTo);
    const fileName = this.ids.next("file_");
    const key = objectKey(tenantId, fileName, filename);
    const expiresAt = fileUploadExpiresAt(this.clock.now(), command.expiresInSeconds);
    const baseData = fileDocumentData({
      filename,
      key,
      contentType,
      size,
      isPrivate: command.isPrivate ?? true,
      uploadedBy: command.actor.id,
      uploadedAt: this.clock.now(),
      storageState: "upload_pending",
      directUploadExpiresAt: expiresAt,
      scannerConfigured: this.scanner !== undefined,
      ...(command.attachedTo === undefined ? {} : { attachedTo: command.attachedTo })
    });
    this.preflightCreate(command.actor, baseData);
    const upload = await this.storage.multipartUploads.createMultipartUpload({
      key,
      contentType,
      filename,
      customMetadata: fileUploadObjectCustomMetadata({ tenantId, uploadedBy: command.actor.id })
    });
    try {
      const snapshot = await this.documents.create({
        actor: command.actor,
        doctype: this.fileDoctype,
        name: fileName,
        tenantId,
        data: fileMultipartUploadDocumentData(baseData, upload.uploadId),
        eventType: "FileMultipartUploadReserved",
        metadata: command.metadata ?? {}
      });
      return { snapshot, upload };
    } catch (error) {
      await this.storage.multipartUploads.abortMultipartUpload({ key, uploadId: upload.uploadId }).catch(() => undefined);
      throw error;
    }
  }

  async uploadMultipartPart(command: UploadMultipartPartCommand): Promise<UploadedMultipartPartResult> {
    const multipartUploads = this.requireMultipartUploads();
    const current = await this.multipartUploadSnapshot(command, ensureFilePendingMultipartPartUpload);
    const uploadId = this.multipartUploadId(current);
    const size = multipartPartSize(command.body, command.size);
    ensureMultipartPartFitsReservation(current, command.partNumber, size);
    const part = await multipartUploads.uploadMultipartPart({
      key: filePrimaryObjectKey(current),
      uploadId,
      partNumber: command.partNumber,
      body: command.body
    });
    const snapshot = await this.documents.execute({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: command.name,
      command: "recordMultipartPart",
      input: multipartPartManifestPatch(multipartPartManifest(current), {
        partNumber: part.partNumber,
        etag: part.etag,
        size
      }),
      ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
      expectedVersion: current.version,
      metadata: command.metadata ?? {}
    });
    return { part, snapshot };
  }

  async completeMultipartUpload(command: CompleteMultipartUploadCommand): Promise<DocumentSnapshot> {
    const multipartUploads = this.requireMultipartUploads();
    const current = await this.multipartUploadSnapshot(command, ensureFilePendingMultipartCompletion);
    ensureMultipartCompletionMatchesManifest(current, command.parts);
    const completing = shouldStartFileMultipartCompletion(current)
      ? await this.documents.execute({
          actor: command.actor,
          doctype: this.fileDoctype,
          name: command.name,
          command: "beginMultipartUploadCompletion",
          input: fileMultipartCompletionStartedPatch(),
          ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
          ...(command.expectedVersion === undefined ? {} : { expectedVersion: command.expectedVersion }),
          metadata: command.metadata ?? {}
        })
      : current;
    const object = await this.completedMultipartObject({
      multipartUploads,
      snapshot: completing,
      parts: command.parts
    });
    ensureDirectUploadMatches(completing, object, "Multipart upload");
    const scan = await this.scanObject({
      actor: command.actor,
      tenantId: command.tenantId ?? command.actor.tenantId ?? DEFAULT_TENANT_ID,
      filename: fileSnapshotFilename(completing),
      source: "multipart_upload",
      object
    });
    const scanPatch = optionalFileScanPatch(scan, this.clock.now());
    if (isInfectedFileScanResult(scan)) {
      const snapshot = await this.documents.execute({
        actor: command.actor,
        doctype: this.fileDoctype,
        name: command.name,
        command: "failScan",
        input: fileUploadScanFailedPatch(object, scanPatch),
        ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
        expectedVersion: completing.version,
        metadata: command.metadata ?? {}
      });
      await this.deleteFileObjectsForScanFailure(completing);
      throw fileScanFailureError(scan, snapshot);
    }
    return this.documents.execute({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: command.name,
      command: "completeMultipartUpload",
      input: fileUploadCompletedPatch(object, scanPatch),
      ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
      expectedVersion: completing.version,
      metadata: command.metadata ?? {}
    });
  }

  async abortMultipartUpload(command: AbortMultipartUploadCommand): Promise<DocumentSnapshot> {
    const multipartUploads = this.requireMultipartUploads();
    const current = await this.multipartUploadSnapshot(command, ensureFilePendingMultipartPartUpload);
    ensureFileExpectedVersion(current, command.expectedVersion);
    await multipartUploads.abortMultipartUpload({
      key: filePrimaryObjectKey(current),
      uploadId: this.multipartUploadId(current)
    });
    return this.documents.delete({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: command.name,
      ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
      expectedVersion: current.version,
      metadata: command.metadata ?? {}
    });
  }

  async dashboard(actor: Actor, query: FileDashboardQuery = {}): Promise<FileDashboard> {
    const limit = normalizeFileDashboardLimit(query.limit);
    const filters = normalizeFileDashboardFilters(query);
    const listFilters = fileDashboardListFilters(filters);
    const doctype = this.registry.get(this.fileDoctype);
    const files: FileDashboardEntry[] = [];
    const tenantId = actor.tenantId ?? DEFAULT_TENANT_ID;
    const systemActor: Actor = { id: "__file_dashboard__", roles: [SYSTEM_MANAGER_ROLE], tenantId };
    const batchLimit = Math.max(limit, 50);
    let offset = 0;
    let total = 0;
    do {
      const result = await this.queries.listDocuments(systemActor, this.fileDoctype, {
        tenantId,
        filters: listFilters,
        limit: batchLimit,
        offset
      });
      total = result.total;
      const readable = await Promise.all(
        result.data.map(async (snapshot) => ({
          snapshot,
          readable: await this.queries.canReadDocument(actor, doctype, snapshot)
        }))
      );
      files.push(
        ...readable
          .filter((entry) => entry.readable)
          .map(({ snapshot }) => ({
            ...fileDashboardEntry(snapshot),
            editable: can(actor, doctype, "metadata", snapshot),
            deletable: can(actor, doctype, "delete", snapshot)
          }))
      );
      offset += batchLimit;
    } while (files.length < limit && offset < total);
    return {
      canUpload: can(actor, doctype, "create"),
      directUpload: typeof this.storage.createDirectUpload === "function",
      maxUploadBytes: this.maxFileBytes,
      files: files.slice(0, limit),
      limit,
      filters
    };
  }

  async get(actor: Actor, name: string, tenantId?: string): Promise<FileDashboardEntry> {
    const snapshot = await this.queries.getDocument(
      actor,
      this.fileDoctype,
      name,
      tenantId ?? actor.tenantId ?? DEFAULT_TENANT_ID
    );
    const doctype = this.registry.get(this.fileDoctype);
    return {
      ...fileDashboardEntry(snapshot),
      editable: can(actor, doctype, "metadata", snapshot),
      deletable: can(actor, doctype, "delete", snapshot)
    };
  }

  async updateMetadata(command: UpdateFileMetadataCommand): Promise<DocumentSnapshot> {
    const tenantId = command.tenantId ?? command.actor.tenantId ?? DEFAULT_TENANT_ID;
    const current = await this.queries.getDocument(command.actor, this.fileDoctype, command.name, tenantId);
    const doctype = this.registry.get(this.fileDoctype);
    if (!can(command.actor, doctype, "metadata", current)) {
      throw permissionDenied(
        `Actor '${command.actor.id}' cannot execute updateMetadata on ${this.fileDoctype}/${command.name}`
      );
    }
    ensureFileNotDeleteRequested(current);
    const patch = fileMetadataPatch(command);
    if (command.attachedTo !== undefined) {
      if (command.attachedTo !== null) {
        await this.validateAttachmentTarget(command.actor, tenantId, command.attachedTo);
      }
    }
    return this.documents.execute({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: command.name,
      command: "updateMetadata",
      input: patch,
      ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
      ...(command.expectedVersion === undefined ? {} : { expectedVersion: command.expectedVersion }),
      metadata: command.metadata ?? {}
    });
  }

  async download(command: DownloadFileCommand): Promise<DownloadedFile> {
    const snapshot = await this.availableFileSnapshot(command);
    const key = filePrimaryObjectKey(snapshot);
    const object = await this.storage.get(key);
    if (!object) {
      throw notFound(`${this.fileDoctype}/${command.name} content was not found`);
    }
    return { snapshot, object };
  }

  async generateRendition(command: GenerateFileRenditionCommand): Promise<GeneratedFileRendition> {
    if (!this.transformer) {
      throw badRequest("File transforms are not configured");
    }
    const downloaded = await this.download(command);
    const options = normalizeFileTransformOptions(command.options);
    ensureFileObjectTransformable(downloaded.snapshot, downloaded.object.metadata, `File '${downloaded.snapshot.name}'`);
    const doctype = this.registry.get(this.fileDoctype);
    if (!can(command.actor, doctype, "rendition", downloaded.snapshot)) {
      throw permissionDenied(
        `Actor '${command.actor.id}' cannot generate renditions for ${this.fileDoctype}/${command.name}`
      );
    }
    this.validateTransformOptions(options);
    const tenantId = command.tenantId ?? command.actor.tenantId ?? DEFAULT_TENANT_ID;
    const overlay = await this.resolveTransformOverlay({
      actor: command.actor,
      tenantId,
      options
    });
    const sourceEtag = fileObjectSourceEtag(downloaded.object.metadata);
    const renditionId = await fileRenditionId(options);
    const existing = reusableFileRenditionForGeneration(downloaded.snapshot, renditionId, sourceEtag, overlay);
    if (existing && await this.storage.head(existing.key)) {
      return {
        snapshot: downloaded.snapshot,
        rendition: fileRenditionView(existing),
        created: false
      };
    }

    const reservation = fileRenditionGenerationReservation({
      snapshot: downloaded.snapshot,
      tenantId,
      id: renditionId,
      attemptId: this.ids.next("rendition_"),
      sourceEtag,
      ...(overlay === undefined ? {} : { overlay }),
      options,
      requestedAt: this.clock.now(),
      requestedBy: command.actor.id
    });
    const { pending } = reservation;
    await this.documents.execute({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: command.name,
      command: "reserveRendition",
      input: reservation.patch,
      ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
      expectedVersion: downloaded.snapshot.version,
      metadata: command.metadata ?? {}
    });

    let object: FileObjectMetadata | undefined;
    try {
      const transform = await this.transformDownloadedFile({
        actor: command.actor,
        tenantId,
        downloaded,
        options,
        ...(overlay === undefined ? {} : { overlay })
      });
      object = await this.storage.put(
        fileRenditionSnapshotPutObjectCommand({
          pending,
          transform,
          source: downloaded.snapshot,
          tenantId,
          sourceEtag,
          renditionId
        })
      );
      const completed = completeFileRendition({
        pending,
        object,
        generatedAt: this.clock.now(),
        generatedBy: command.actor.id
      });
      const snapshot = await this.recordRenditionManifest({
        source: command,
        command: "completeRendition",
        rendition: completed
      });
      return {
        snapshot,
        rendition: fileRenditionView(completed),
        created: true
      };
    } catch (error) {
      if (object) {
        await this.storage.delete(object.key).catch(() => undefined);
      }
      await this.recordRenditionManifest({
        source: command,
        command: "failRendition",
        rendition: failedFileRenditionForError({
          pending,
          error
        })
      }).catch(() => undefined);
      throw error;
    }
  }

  async downloadRendition(command: DownloadFileRenditionCommand): Promise<DownloadedFileRendition> {
    const snapshot = await this.availableFileSnapshot(command);
    const rendition = availableFileRenditionForDownload(snapshot, command.renditionId);
    const object = await this.storage.get(rendition.key);
    if (!object) {
      throw notFound(`${this.fileDoctype}/${command.name} rendition '${command.renditionId}' content was not found`);
    }
    return {
      snapshot,
      rendition: fileRenditionView(rendition),
      object
    };
  }

  async transform(command: TransformFileCommand): Promise<TransformedFile> {
    if (!this.transformer) {
      throw badRequest("File transforms are not configured");
    }
    const downloaded = await this.download(command);
    const options = normalizeFileTransformOptions(command.options);
    ensureFileObjectTransformable(downloaded.snapshot, downloaded.object.metadata, `File '${downloaded.snapshot.name}'`);
    const tenantId = command.tenantId ?? command.actor.tenantId ?? DEFAULT_TENANT_ID;
    this.validateTransformOptions(options);
    const overlay = await this.resolveTransformOverlay({
      actor: command.actor,
      tenantId,
      options
    });
    const transform = await this.transformDownloadedFile({
      actor: command.actor,
      tenantId,
      downloaded,
      options,
      ...(overlay === undefined ? {} : { overlay })
    });
    return {
      snapshot: downloaded.snapshot,
      object: downloaded.object.metadata,
      transform
    };
  }

  async delete(command: DeleteFileCommand): Promise<DocumentSnapshot> {
    const current = await this.queries.getDocument(
      command.actor,
      this.fileDoctype,
      command.name,
      command.tenantId ?? command.actor.tenantId ?? DEFAULT_TENANT_ID
    );
    this.preflightDelete(command.actor, current, command.expectedVersion);
    const deleteRequested =
      shouldRequestFileDelete(current)
        ? await this.documents.execute({
            actor: command.actor,
            doctype: this.fileDoctype,
            name: command.name,
            command: "requestDelete",
            input: {},
            ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
            expectedVersion: current.version,
            metadata: command.metadata ?? {}
          })
        : current;
    await this.deleteFileObjects(deleteRequested);
    const snapshot = await this.documents.delete({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: command.name,
      ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
      expectedVersion: deleteRequested.version,
      metadata: command.metadata ?? {}
    });
    return snapshot;
  }

  async bulkDelete(command: BulkDeleteFilesCommand): Promise<BulkDeleteFilesResult> {
    const selections = normalizeBulkFileSelections(command.files);
    const deleted: BulkDeletedFile[] = [];
    const failed: BulkDeleteFileFailure[] = [];
    for (const selection of selections) {
      try {
        const snapshot = await this.delete({
          actor: command.actor,
          name: selection.name,
          ...(selection.expectedVersion === undefined ? {} : { expectedVersion: selection.expectedVersion }),
          ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
          metadata: command.metadata ?? {}
        });
        deleted.push({ name: selection.name, snapshot });
      } catch (error) {
        failed.push(fileBulkDeleteFailure(selection.name, error));
      }
    }
    return { deleted, failed };
  }

  async bulkUpdateMetadata(command: BulkUpdateFileMetadataCommand): Promise<BulkUpdateFileMetadataResult> {
    const selections = normalizeBulkFileSelections(command.files);
    ensureFileMetadataPatchProvided(command);
    const updated: BulkUpdatedFile[] = [];
    const failed: BulkUpdateFileMetadataFailure[] = [];
    for (const selection of selections) {
      try {
        const snapshot = await this.updateMetadata({
          actor: command.actor,
          name: selection.name,
          ...(command.isPrivate === undefined ? {} : { isPrivate: command.isPrivate }),
          ...(command.attachedTo === undefined ? {} : { attachedTo: command.attachedTo }),
          ...(selection.expectedVersion === undefined ? {} : { expectedVersion: selection.expectedVersion }),
          ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
          metadata: command.metadata ?? {}
        });
        updated.push({ name: selection.name, snapshot });
      } catch (error) {
        failed.push(fileBulkFailure(selection.name, error, "Bulk metadata update failed"));
      }
    }
    return { updated, failed };
  }

  private preflightCreate(actor: Actor, data: DocumentData): void {
    const doctype = this.registry.get(this.fileDoctype);
    ensureFileCreateAllowed({
      actor,
      doctype,
      fileDoctype: this.fileDoctype,
      data
    });
  }

  private async availableFileSnapshot(command: DownloadFileCommand): Promise<DocumentSnapshot> {
    const snapshot = await this.queries.getDocument(
      command.actor,
      this.fileDoctype,
      command.name,
      command.tenantId ?? command.actor.tenantId ?? DEFAULT_TENANT_ID
    );
    ensureFileAvailableForDownload(snapshot);
    return snapshot;
  }

  private async transformDownloadedFile(command: {
    readonly actor: Actor;
    readonly tenantId: string;
    readonly downloaded: DownloadedFile;
    readonly options: FileTransformOptions;
    readonly overlay?: FileTransformOverlaySource;
  }): Promise<TransformedFileObject> {
    if (!this.transformer) {
      throw badRequest("File transforms are not configured");
    }
    return this.transformer.transform({
      actorId: command.actor.id,
      tenantId: command.tenantId,
      source: fileTransformSource(command.downloaded.snapshot, command.downloaded.object),
      options: command.options,
      ...(command.overlay === undefined ? {} : { overlay: command.overlay })
    });
  }

  private validateTransformOptions(options: FileTransformOptions): void {
    this.transformer?.validateOptions?.(options);
  }

  private async resolveTransformOverlay(command: {
    readonly actor: Actor;
    readonly tenantId: string;
    readonly options: FileTransformOptions;
  }): Promise<FileTransformOverlaySource | undefined> {
    const overlay = command.options.overlay;
    if (overlay === undefined) {
      return undefined;
    }
    const snapshot = await this.availableFileSnapshot({
      actor: command.actor,
      name: overlay.file,
      tenantId: command.tenantId
    });
    const key = filePrimaryObjectKey(snapshot);
    const object = await this.storage.get(key);
    if (!object) {
      throw notFound(`${this.fileDoctype}/${overlay.file} content was not found`);
    }
    return fileTransformOverlaySource(snapshot, object, overlay);
  }

  private async recordRenditionManifest(command: {
    readonly source: GenerateFileRenditionCommand;
    readonly command: "completeRendition" | "failRendition";
    readonly rendition: FileRenditionManifestEntry;
  }): Promise<DocumentSnapshot> {
    const latest = await this.queries.getDocument(
      command.source.actor,
      this.fileDoctype,
      command.source.name,
      command.source.tenantId ?? command.source.actor.tenantId ?? DEFAULT_TENANT_ID
    );
    return this.documents.execute({
      actor: command.source.actor,
      doctype: this.fileDoctype,
      name: command.source.name,
      command: command.command,
      input: fileRenditionSnapshotManifestPatch(latest, command.rendition),
      ...(command.source.tenantId === undefined ? {} : { tenantId: command.source.tenantId }),
      expectedVersion: latest.version,
      metadata: command.source.metadata ?? {}
    });
  }

  private async deleteFileObjects(snapshot: DocumentSnapshot): Promise<void> {
    for (const key of fileObjectKeysForDelete(snapshot)) {
      await this.storage.delete(key);
    }
  }

  private async deleteFileObjectsForScanFailure(snapshot: DocumentSnapshot): Promise<void> {
    for (const key of fileObjectKeysForScanFailureCleanup(snapshot)) {
      await this.storage.delete(key).catch(() => undefined);
    }
  }

  private preflightDelete(actor: Actor, document: DocumentSnapshot, expectedVersion?: number): void {
    const doctype = this.registry.get(this.fileDoctype);
    ensureFileDeleteAllowed({
      actor,
      doctype,
      fileDoctype: this.fileDoctype,
      snapshot: document,
      ...(expectedVersion === undefined ? {} : { expectedVersion })
    });
  }

  private async validateAttachmentTarget(
    actor: Actor,
    tenantId: string,
    attachedTo: UploadFileCommand["attachedTo"] | undefined
  ): Promise<void> {
    if (!attachedTo) {
      return;
    }
    await this.queries.getDocument(actor, attachedTo.doctype, attachedTo.name, tenantId);
  }

  private requireMultipartUploads(): NonNullable<FileStorage["multipartUploads"]> {
    if (!this.storage.multipartUploads) {
      throw badRequest("Multipart uploads are not supported by this file storage");
    }
    return this.storage.multipartUploads;
  }

  private async multipartUploadSnapshot(
    command: DownloadFileCommand,
    ensurePendingMultipartUpload: (snapshot: DocumentSnapshot) => void
  ): Promise<DocumentSnapshot> {
    const tenantId = command.tenantId ?? command.actor.tenantId ?? DEFAULT_TENANT_ID;
    const current = await this.queries.getDocument(command.actor, this.fileDoctype, command.name, tenantId);
    ensurePendingMultipartUpload(current);
    const doctype = this.registry.get(this.fileDoctype);
    if (!can(command.actor, doctype, "metadata", current)) {
      throw permissionDenied(
        `Actor '${command.actor.id}' cannot execute multipart upload on ${this.fileDoctype}/${command.name}`
      );
    }
    return current;
  }

  private multipartUploadId(snapshot: DocumentSnapshot): string {
    return fileMultipartUploadId(snapshot);
  }

  private async completedMultipartObject(command: {
    readonly multipartUploads: NonNullable<FileStorage["multipartUploads"]>;
    readonly snapshot: DocumentSnapshot;
    readonly parts: readonly UploadedMultipartFilePart[];
  }): Promise<FileObjectMetadata> {
    const key = filePrimaryObjectKey(command.snapshot);
    const existing = await this.storage.head(key);
    if (existing) {
      return existing;
    }
    return command.multipartUploads.completeMultipartUpload({
      key,
      uploadId: this.multipartUploadId(command.snapshot),
      parts: command.parts
    });
  }

  private async scanObject(command: {
    readonly actor: Actor;
    readonly tenantId: string;
    readonly filename: string;
    readonly source: FileScanSource;
    readonly object: FileObjectMetadata;
  }): Promise<FileScanResult | undefined> {
    if (!this.scanner) {
      return undefined;
    }
    const result = await this.scanner.scan(fileScanTarget({
      actorId: command.actor.id,
      tenantId: command.tenantId,
      filename: command.filename,
      source: command.source,
      object: command.object
    }));
    ensureValidFileScanResult(result);
    return result;
  }
}
