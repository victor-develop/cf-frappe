import type { DocumentCommandExecutor } from "./document-service.js";
import { QueryService } from "./query-service.js";
import {
  type FrameworkErrorCode
} from "../core/errors.js";
import { FILE_DOCTYPE_NAME } from "../core/file-doctype.js";
import type { ModelRegistry } from "../core/registry.js";
import {
  type Actor,
  type DocumentData,
  type DocumentSnapshot
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
  ensureFileMetadataUpdateAllowed,
  ensureFileMultipartUploadAllowed,
  ensureFilePendingDirectUpload,
  ensureFilePendingMultipartCompletion,
  ensureFilePendingMultipartPartUpload,
  ensureFileRenditionGenerationAllowed,
  ensureFileMetadataPatchProvided,
  ensureDirectUploadMatches,
  ensureMultipartCompletionMatchesManifest,
  ensureMultipartPartFitsReservation,
  fileAttachmentTargetForValidation,
  requireDirectFileUploadCreator,
  requireFileObjectMetadata,
  requireFileTransformer,
  requireMultipartFileUploads,
  requireStoredFileObject,
  requireStoredFileRenditionObject,
  fileBulkDeletedEntry,
  fileCompletedRenditionManifestCommandName,
  fileCompletedMultipartObjectPlan,
  fileBufferedUploadDocumentCreateCommand,
  fileBulkDeleteEntryCommand,
  fileBulkDeleteFailure,
  fileBulkDeleteResult,
  fileBulkMetadataUpdateFailure,
  fileBulkMetadataUpdateEntryCommand,
  fileBulkMetadataUpdateResult,
  fileBulkUpdatedEntry,
  fileBufferedUploadPutObjectCommand,
  fileCommandTenantId,
  fileContentLength,
  fileDashboardBatchLimit,
  fileDashboardEntryWithPermissions,
  fileDashboardListQuery,
  fileDashboardListFilters,
  fileDashboardResult,
  fileDownloadedResult,
  fileReadableDashboardCandidate,
  fileReadableDashboardEntries,
  fileDashboardSystemActor,
  fileBufferedUploadDocumentData,
  fileDeleteRequestedExecuteCommand,
  fileDeleteRequestedDocumentCommand,
  fileDeletedExecuteCommand,
  fileDeletedDocumentCommand,
  fileDownloadedRenditionResult,
  fileDocumentCreateCommand,
  fileDirectUploadDocumentCreateCommand,
  fileGeneratedRenditionResult,
  fileMetadataUpdateExecuteCommand,
  fileMetadataUpdateDocumentCommand,
  fileMultipartAbortCommand,
  fileMultipartCompletionStartedExecuteCommand,
  fileMultipartCompletionStartedDocumentCommand,
  fileMultipartCompletionCommand,
  fileMultipartPartRecordedExecuteCommand,
  fileMultipartPartRecordedDocumentCommand,
  fileMultipartPartUploadCommand,
  fileMultipartUploadDocumentCreateCommand,
  fileMultipartUploadId,
  fileObjectKeysForDelete,
  fileObjectKeysForScanFailureCleanup,
  filePrimaryObjectKey,
  fileObjectSourceEtag,
  filePreparedDirectUploadResult,
  filePreparedMultipartUploadResult,
  fileRenditionGenerationReservation,
  fileGeneratedRenditionFailureCleanupKey,
  fileGeneratedRenditionReuseStoragePlan,
  fileRenditionId,
  fileRenditionManifestExecuteCommand,
  fileRenditionReservationExecuteCommand,
  fileRenditionReservationDocumentCommand,
  fileFailedRenditionManifestRecord,
  fileRenditionSnapshotPutObjectCommand,
  fileScanFailureError,
  fileScanTarget,
  fileExpectedVersionCommandOption,
  fileUploadDocumentDataCommand,
  fileUploadCompletionDocumentCommand,
  fileUploadCompletionExecuteCommand,
  fileUploadContentType,
  fileUploadExpiresAt,
  fileDirectUploadReservationCommand,
  filePendingUploadDocumentDataCommand,
  filePendingUploadDocumentData,
  fileMultipartUploadAbortCommand,
  fileMultipartUploadReservationCommand,
  fileTransformOverlayCommandOption,
  fileTransformOverlayResolutionPlan,
  fileTransformObjectCommand,
  fileTransformOverlaySource,
  fileTransformedFileResult,
  fileUploadedMultipartPartResult,
  fileUploadedResult,
  fileSnapshotFilename,
  ignoreFileCleanupFailure,
  isInfectedFileScanResult,
  multipartPartSize,
  normalizeBulkFileSelections,
  normalizeFileDashboardFilters,
  normalizeFileDashboardLimit,
  normalizeFileSize,
  nextFileDashboardOffset,
  objectKey,
  optionalFileScanPatch,
  sanitizeFilename,
  shouldContinueFileDashboardScan,
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

    const contentType = fileUploadContentType(command.contentType);
    const tenantId = fileCommandTenantId(command.actor, command.tenantId);
    await this.validateAttachmentTarget(command.actor, tenantId, command.attachedTo);
    const fileName = this.ids.next("file_");
    const key = objectKey(tenantId, fileName, filename);
    const data = fileBufferedUploadDocumentData(fileUploadDocumentDataCommand({
      filename,
      key,
      contentType,
      size,
      isPrivate: command.isPrivate,
      uploadedBy: command.actor.id,
      uploadedAt: this.clock.now(),
      attachedTo: command.attachedTo
    }));
    this.preflightCreate(command.actor, data);
    const object = await this.storage.put(fileBufferedUploadPutObjectCommand({
      key,
      body: command.body,
      contentType,
      filename,
      size,
      tenantId,
      uploadedBy: command.actor.id
    }));
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
      await this.storage.delete(key).catch(ignoreFileCleanupFailure);
      throw error;
    }

    try {
      const scanPatch = optionalFileScanPatch(scan, this.clock.now());
      const create = fileBufferedUploadDocumentCreateCommand({
        data,
        object,
        scanPatch,
        infected: isInfectedFileScanResult(scan)
      });
      if (isInfectedFileScanResult(scan)) {
        const snapshot = await this.documents.create(fileDocumentCreateCommand({
          actor: command.actor,
          doctype: this.fileDoctype,
          name: fileName,
          tenantId,
          metadata: command.metadata,
          create
        }));
        throw fileScanFailureError(scan, snapshot);
      }
      const snapshot = await this.documents.create(fileDocumentCreateCommand({
        actor: command.actor,
        doctype: this.fileDoctype,
        name: fileName,
        tenantId,
        metadata: command.metadata,
        create
      }));
      return fileUploadedResult({ snapshot, object });
    } catch (error) {
      await this.storage.delete(key).catch(ignoreFileCleanupFailure);
      throw error;
    }
  }

  async prepareDirectUpload(command: PrepareDirectUploadCommand): Promise<PreparedDirectUpload> {
    const createDirectUpload = requireDirectFileUploadCreator(this.storage.createDirectUpload);
    const filename = sanitizeFilename(command.filename);
    const size = normalizeFileSize(command.size);
    ensureFileSizeWithinLimit(size, this.maxFileBytes);

    const contentType = fileUploadContentType(command.contentType);
    const tenantId = fileCommandTenantId(command.actor, command.tenantId);
    await this.validateAttachmentTarget(command.actor, tenantId, command.attachedTo);
    const fileName = this.ids.next("file_");
    const key = objectKey(tenantId, fileName, filename);
    const expiresAt = fileUploadExpiresAt(this.clock.now(), command.expiresInSeconds);
    const uploadData = filePendingUploadDocumentDataCommand({
      filename,
      key,
      contentType,
      size,
      isPrivate: command.isPrivate,
      uploadedBy: command.actor.id,
      uploadedAt: this.clock.now(),
      directUploadExpiresAt: expiresAt,
      scannerConfigured: this.scanner !== undefined,
      attachedTo: command.attachedTo
    });
    const create = fileDirectUploadDocumentCreateCommand(uploadData);
    this.preflightCreate(command.actor, create.data);
    const upload = await createDirectUpload(fileDirectUploadReservationCommand({
      key,
      contentType,
      filename,
      size,
      expiresAt,
      tenantId,
      uploadedBy: command.actor.id
    }));
    const snapshot = await this.documents.create(fileDocumentCreateCommand({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: fileName,
      tenantId,
      metadata: command.metadata,
      create
    }));
    return filePreparedDirectUploadResult({ snapshot, upload });
  }

  async completeDirectUpload(command: CompleteDirectUploadCommand): Promise<DocumentSnapshot> {
    const tenantId = fileCommandTenantId(command.actor, command.tenantId);
    const current = await this.queries.getDocument(command.actor, this.fileDoctype, command.name, tenantId);
    ensureFilePendingDirectUpload(current);
    const object = requireFileObjectMetadata(
      await this.storage.head(filePrimaryObjectKey(current)),
      this.fileDoctype,
      command.name
    );
    ensureDirectUploadMatches(current, object);
    const scan = await this.scanObject({
      actor: command.actor,
      tenantId,
      filename: fileSnapshotFilename(current),
      source: "direct_upload",
      object
    });
    const scanPatch = optionalFileScanPatch(scan, this.clock.now());
    const completion = fileUploadCompletionDocumentCommand({
      uploadCommand: "completeDirectUpload",
      object,
      scanPatch,
      infected: isInfectedFileScanResult(scan),
      ...fileExpectedVersionCommandOption(command.expectedVersion)
    });
    if (isInfectedFileScanResult(scan)) {
      const snapshot = await this.documents.execute(fileUploadCompletionExecuteCommand({
        actor: command.actor,
        doctype: this.fileDoctype,
        name: command.name,
        tenantId: command.tenantId,
        metadata: command.metadata,
        completion
      }));
      await this.deleteFileObjectsForScanFailure(current);
      throw fileScanFailureError(scan, snapshot);
    }
    return this.documents.execute(fileUploadCompletionExecuteCommand({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: command.name,
      tenantId: command.tenantId,
      metadata: command.metadata,
      completion
    }));
  }

  async prepareMultipartUpload(command: PrepareMultipartUploadCommand): Promise<PreparedMultipartUpload> {
    const multipartUploads = requireMultipartFileUploads(this.storage.multipartUploads);
    const filename = sanitizeFilename(command.filename);
    const size = normalizeFileSize(command.size);
    ensureFileSizeWithinLimit(size, this.maxFileBytes);

    const contentType = fileUploadContentType(command.contentType);
    const tenantId = fileCommandTenantId(command.actor, command.tenantId);
    await this.validateAttachmentTarget(command.actor, tenantId, command.attachedTo);
    const fileName = this.ids.next("file_");
    const key = objectKey(tenantId, fileName, filename);
    const expiresAt = fileUploadExpiresAt(this.clock.now(), command.expiresInSeconds);
    const uploadData = filePendingUploadDocumentDataCommand({
      filename,
      key,
      contentType,
      size,
      isPrivate: command.isPrivate,
      uploadedBy: command.actor.id,
      uploadedAt: this.clock.now(),
      directUploadExpiresAt: expiresAt,
      scannerConfigured: this.scanner !== undefined,
      attachedTo: command.attachedTo
    });
    this.preflightCreate(command.actor, filePendingUploadDocumentData(uploadData));
    const upload = await multipartUploads.createMultipartUpload(fileMultipartUploadReservationCommand({
      key,
      contentType,
      filename,
      tenantId,
      uploadedBy: command.actor.id
    }));
    try {
      const create = fileMultipartUploadDocumentCreateCommand({
        upload: uploadData,
        uploadId: upload.uploadId
      });
      const snapshot = await this.documents.create(fileDocumentCreateCommand({
        actor: command.actor,
        doctype: this.fileDoctype,
        name: fileName,
        tenantId,
        metadata: command.metadata,
        create
      }));
      return filePreparedMultipartUploadResult({ snapshot, upload });
    } catch (error) {
      await multipartUploads.abortMultipartUpload(fileMultipartUploadAbortCommand({
        key,
        uploadId: upload.uploadId
      })).catch(ignoreFileCleanupFailure);
      throw error;
    }
  }

  async uploadMultipartPart(command: UploadMultipartPartCommand): Promise<UploadedMultipartPartResult> {
    const multipartUploads = this.requireMultipartUploads();
    const current = await this.multipartUploadSnapshot(command, ensureFilePendingMultipartPartUpload);
    const uploadId = this.multipartUploadId(current);
    const size = multipartPartSize(command.body, command.size);
    ensureMultipartPartFitsReservation(current, command.partNumber, size);
    const part = await multipartUploads.uploadMultipartPart(fileMultipartPartUploadCommand({
      snapshot: current,
      uploadId,
      partNumber: command.partNumber,
      body: command.body
    }));
    const recorded = fileMultipartPartRecordedDocumentCommand({
      snapshot: current,
      part,
      size
    });
    const snapshot = await this.documents.execute(fileMultipartPartRecordedExecuteCommand({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: command.name,
      tenantId: command.tenantId,
      metadata: command.metadata,
      recorded
    }));
    return fileUploadedMultipartPartResult({ part, snapshot });
  }

  async completeMultipartUpload(command: CompleteMultipartUploadCommand): Promise<DocumentSnapshot> {
    const multipartUploads = this.requireMultipartUploads();
    const current = await this.multipartUploadSnapshot(command, ensureFilePendingMultipartCompletion);
    ensureMultipartCompletionMatchesManifest(current, command.parts);
    const completionStart = fileMultipartCompletionStartedDocumentCommand({
      snapshot: current,
      ...fileExpectedVersionCommandOption(command.expectedVersion)
    });
    const completing = completionStart
      ? await this.documents.execute(fileMultipartCompletionStartedExecuteCommand({
          actor: command.actor,
          doctype: this.fileDoctype,
          name: command.name,
          tenantId: command.tenantId,
          metadata: command.metadata,
          completionStart
        }))
      : current;
    const object = await this.completedMultipartObject({
      multipartUploads,
      snapshot: completing,
      parts: command.parts
    });
    ensureDirectUploadMatches(completing, object, "Multipart upload");
    const scan = await this.scanObject({
      actor: command.actor,
      tenantId: fileCommandTenantId(command.actor, command.tenantId),
      filename: fileSnapshotFilename(completing),
      source: "multipart_upload",
      object
    });
    const scanPatch = optionalFileScanPatch(scan, this.clock.now());
    const completion = fileUploadCompletionDocumentCommand({
      uploadCommand: "completeMultipartUpload",
      object,
      scanPatch,
      infected: isInfectedFileScanResult(scan),
      expectedVersion: completing.version
    });
    if (isInfectedFileScanResult(scan)) {
      const snapshot = await this.documents.execute(fileUploadCompletionExecuteCommand({
        actor: command.actor,
        doctype: this.fileDoctype,
        name: command.name,
        tenantId: command.tenantId,
        metadata: command.metadata,
        completion
      }));
      await this.deleteFileObjectsForScanFailure(completing);
      throw fileScanFailureError(scan, snapshot);
    }
    return this.documents.execute(fileUploadCompletionExecuteCommand({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: command.name,
      tenantId: command.tenantId,
      metadata: command.metadata,
      completion
    }));
  }

  async abortMultipartUpload(command: AbortMultipartUploadCommand): Promise<DocumentSnapshot> {
    const multipartUploads = this.requireMultipartUploads();
    const current = await this.multipartUploadSnapshot(command, ensureFilePendingMultipartPartUpload);
    ensureFileExpectedVersion(current, command.expectedVersion);
    await multipartUploads.abortMultipartUpload(fileMultipartAbortCommand({
      snapshot: current,
      uploadId: this.multipartUploadId(current)
    }));
    const deleted = fileDeletedDocumentCommand(current);
    return this.documents.delete(fileDeletedExecuteCommand({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: command.name,
      tenantId: command.tenantId,
      metadata: command.metadata,
      deleted
    }));
  }

  async dashboard(actor: Actor, query: FileDashboardQuery = {}): Promise<FileDashboard> {
    const limit = normalizeFileDashboardLimit(query.limit);
    const filters = normalizeFileDashboardFilters(query);
    const listFilters = fileDashboardListFilters(filters);
    const doctype = this.registry.get(this.fileDoctype);
    const files: FileDashboardEntry[] = [];
    const tenantId = fileCommandTenantId(actor, undefined);
    const systemActor = fileDashboardSystemActor(tenantId);
    const batchLimit = fileDashboardBatchLimit(limit);
    let offset = 0;
    let total = 0;
    do {
      const result = await this.queries.listDocuments(systemActor, this.fileDoctype, fileDashboardListQuery({
        tenantId,
        filters: listFilters,
        limit: batchLimit,
        offset
      }));
      total = result.total;
      const readable = await Promise.all(
        result.data.map(async (snapshot) => fileReadableDashboardCandidate({
          snapshot,
          readable: await this.queries.canReadDocument(actor, doctype, snapshot)
        }))
      );
      files.push(...fileReadableDashboardEntries({ actor, doctype, readable }));
      offset = nextFileDashboardOffset(offset, batchLimit);
    } while (shouldContinueFileDashboardScan({
      visibleFiles: files.length,
      limit,
      offset,
      total
    }));
    return fileDashboardResult({
      actor,
      doctype,
      storage: this.storage,
      maxUploadBytes: this.maxFileBytes,
      files,
      limit,
      filters
    });
  }

  async get(actor: Actor, name: string, tenantId?: string): Promise<FileDashboardEntry> {
    const snapshot = await this.queries.getDocument(
      actor,
      this.fileDoctype,
      name,
      fileCommandTenantId(actor, tenantId)
    );
    const doctype = this.registry.get(this.fileDoctype);
    return fileDashboardEntryWithPermissions({ actor, doctype, snapshot });
  }

  async updateMetadata(command: UpdateFileMetadataCommand): Promise<DocumentSnapshot> {
    const tenantId = fileCommandTenantId(command.actor, command.tenantId);
    const current = await this.queries.getDocument(command.actor, this.fileDoctype, command.name, tenantId);
    const doctype = this.registry.get(this.fileDoctype);
    ensureFileMetadataUpdateAllowed({
      actor: command.actor,
      doctype,
      fileDoctype: this.fileDoctype,
      snapshot: current
    });
    const update = fileMetadataUpdateDocumentCommand(command);
    const attachmentTarget = fileAttachmentTargetForValidation(command.attachedTo);
    if (attachmentTarget) {
      await this.validateAttachmentTarget(command.actor, tenantId, attachmentTarget);
    }
    return this.documents.execute(fileMetadataUpdateExecuteCommand({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: command.name,
      tenantId: command.tenantId,
      metadata: command.metadata,
      update
    }));
  }

  async download(command: DownloadFileCommand): Promise<DownloadedFile> {
    const snapshot = await this.availableFileSnapshot(command);
    const key = filePrimaryObjectKey(snapshot);
    const object = requireStoredFileObject(await this.storage.get(key), this.fileDoctype, command.name);
    return fileDownloadedResult({ snapshot, object });
  }

  async generateRendition(command: GenerateFileRenditionCommand): Promise<GeneratedFileRendition> {
    const transformer = requireFileTransformer(this.transformer);
    const downloaded = await this.download(command);
    const options = normalizeFileTransformOptions(command.options);
    ensureFileObjectTransformable(downloaded.snapshot, downloaded.object.metadata, `File '${downloaded.snapshot.name}'`);
    const doctype = this.registry.get(this.fileDoctype);
    ensureFileRenditionGenerationAllowed({
      actor: command.actor,
      doctype,
      fileDoctype: this.fileDoctype,
      snapshot: downloaded.snapshot
    });
    this.validateTransformOptions(options);
    const tenantId = fileCommandTenantId(command.actor, command.tenantId);
    const overlay = await this.resolveTransformOverlay({
      actor: command.actor,
      tenantId,
      options
    });
    const sourceEtag = fileObjectSourceEtag(downloaded.object.metadata);
    const renditionId = await fileRenditionId(options);
    const reuse = fileGeneratedRenditionReuseStoragePlan({
      snapshot: downloaded.snapshot,
      renditionId,
      sourceEtag,
      ...fileTransformOverlayCommandOption(overlay)
    });
    if (reuse.kind === "check" && await this.storage.head(reuse.key)) {
      return fileGeneratedRenditionResult({
        snapshot: downloaded.snapshot,
        rendition: reuse.rendition,
        created: false
      });
    }

    const reservation = fileRenditionGenerationReservation({
      snapshot: downloaded.snapshot,
      tenantId,
      id: renditionId,
      attemptId: this.ids.next("rendition_"),
      sourceEtag,
      ...fileTransformOverlayCommandOption(overlay),
      options,
      requestedAt: this.clock.now(),
      requestedBy: command.actor.id
    });
    const { pending } = reservation;
    const reservationCommand = fileRenditionReservationDocumentCommand({
      snapshot: downloaded.snapshot,
      reservation
    });
    await this.documents.execute(fileRenditionReservationExecuteCommand({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: command.name,
      tenantId: command.tenantId,
      metadata: command.metadata,
      reservation: reservationCommand
    }));

    let object: FileObjectMetadata | undefined;
    try {
      const transform = await this.transformDownloadedFile({
        transformer,
        actor: command.actor,
        tenantId,
        downloaded,
        options,
        ...fileTransformOverlayCommandOption(overlay)
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
        command: fileCompletedRenditionManifestCommandName(),
        rendition: completed
      });
      return fileGeneratedRenditionResult({
        snapshot,
        rendition: completed,
        created: true
      });
    } catch (error) {
      const cleanupKey = fileGeneratedRenditionFailureCleanupKey(object);
      if (cleanupKey) {
        await this.storage.delete(cleanupKey).catch(ignoreFileCleanupFailure);
      }
      const failed = fileFailedRenditionManifestRecord({
        pending,
        error
      });
      await this.recordRenditionManifest({
        source: command,
        command: failed.command,
        rendition: failed.rendition
      }).catch(() => undefined);
      throw error;
    }
  }

  async downloadRendition(command: DownloadFileRenditionCommand): Promise<DownloadedFileRendition> {
    const snapshot = await this.availableFileSnapshot(command);
    const rendition = availableFileRenditionForDownload(snapshot, command.renditionId);
    const object = requireStoredFileRenditionObject(
      await this.storage.get(rendition.key),
      this.fileDoctype,
      command.name,
      command.renditionId
    );
    return fileDownloadedRenditionResult({
      snapshot,
      rendition,
      object
    });
  }

  async transform(command: TransformFileCommand): Promise<TransformedFile> {
    const transformer = requireFileTransformer(this.transformer);
    const downloaded = await this.download(command);
    const options = normalizeFileTransformOptions(command.options);
    ensureFileObjectTransformable(downloaded.snapshot, downloaded.object.metadata, `File '${downloaded.snapshot.name}'`);
    const tenantId = fileCommandTenantId(command.actor, command.tenantId);
    this.validateTransformOptions(options);
    const overlay = await this.resolveTransformOverlay({
      actor: command.actor,
      tenantId,
      options
    });
    const transform = await this.transformDownloadedFile({
      transformer,
      actor: command.actor,
      tenantId,
      downloaded,
      options,
      ...fileTransformOverlayCommandOption(overlay)
    });
    return fileTransformedFileResult({
      snapshot: downloaded.snapshot,
      object: downloaded.object,
      transform
    });
  }

  async delete(command: DeleteFileCommand): Promise<DocumentSnapshot> {
    const current = await this.queries.getDocument(
      command.actor,
      this.fileDoctype,
      command.name,
      fileCommandTenantId(command.actor, command.tenantId)
    );
    this.preflightDelete(command.actor, current, command.expectedVersion);
    const deleteRequest = fileDeleteRequestedDocumentCommand(current);
    const deleteRequested =
      deleteRequest
        ? await this.documents.execute(fileDeleteRequestedExecuteCommand({
            actor: command.actor,
            doctype: this.fileDoctype,
            name: command.name,
            tenantId: command.tenantId,
            metadata: command.metadata,
            deleteRequest
          }))
        : current;
    await this.deleteFileObjects(deleteRequested);
    const deleted = fileDeletedDocumentCommand(deleteRequested);
    const snapshot = await this.documents.delete(fileDeletedExecuteCommand({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: command.name,
      tenantId: command.tenantId,
      metadata: command.metadata,
      deleted
    }));
    return snapshot;
  }

  async bulkDelete(command: BulkDeleteFilesCommand): Promise<BulkDeleteFilesResult> {
    const selections = normalizeBulkFileSelections(command.files);
    const deleted: BulkDeletedFile[] = [];
    const failed: BulkDeleteFileFailure[] = [];
    for (const selection of selections) {
      try {
        const snapshot = await this.delete(fileBulkDeleteEntryCommand({
          actor: command.actor,
          tenantId: command.tenantId,
          metadata: command.metadata,
          selection
        }));
        deleted.push(fileBulkDeletedEntry({ name: selection.name, snapshot }));
      } catch (error) {
        failed.push(fileBulkDeleteFailure(selection.name, error));
      }
    }
    return fileBulkDeleteResult({ deleted, failed });
  }

  async bulkUpdateMetadata(command: BulkUpdateFileMetadataCommand): Promise<BulkUpdateFileMetadataResult> {
    const selections = normalizeBulkFileSelections(command.files);
    ensureFileMetadataPatchProvided(command);
    const updated: BulkUpdatedFile[] = [];
    const failed: BulkUpdateFileMetadataFailure[] = [];
    for (const selection of selections) {
      try {
        const snapshot = await this.updateMetadata(fileBulkMetadataUpdateEntryCommand({
          actor: command.actor,
          tenantId: command.tenantId,
          metadata: command.metadata,
          selection,
          patch: command
        }));
        updated.push(fileBulkUpdatedEntry({ name: selection.name, snapshot }));
      } catch (error) {
        failed.push(fileBulkMetadataUpdateFailure(selection.name, error));
      }
    }
    return fileBulkMetadataUpdateResult({ updated, failed });
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
      fileCommandTenantId(command.actor, command.tenantId)
    );
    ensureFileAvailableForDownload(snapshot);
    return snapshot;
  }

  private async transformDownloadedFile(command: {
    readonly transformer: FileTransformer;
    readonly actor: Actor;
    readonly tenantId: string;
    readonly downloaded: DownloadedFile;
    readonly options: FileTransformOptions;
    readonly overlay?: FileTransformOverlaySource;
  }): Promise<TransformedFileObject> {
    return command.transformer.transform(fileTransformObjectCommand({
      actorId: command.actor.id,
      tenantId: command.tenantId,
      snapshot: command.downloaded.snapshot,
      object: command.downloaded.object,
      options: command.options,
      ...fileTransformOverlayCommandOption(command.overlay)
    }));
  }

  private validateTransformOptions(options: FileTransformOptions): void {
    this.transformer?.validateOptions?.(options);
  }

  private async resolveTransformOverlay(command: {
    readonly actor: Actor;
    readonly tenantId: string;
    readonly options: FileTransformOptions;
  }): Promise<FileTransformOverlaySource | undefined> {
    const plan = fileTransformOverlayResolutionPlan(command.options);
    if (plan.kind === "none") {
      return undefined;
    }
    const snapshot = await this.availableFileSnapshot({
      actor: command.actor,
      name: plan.overlay.file,
      tenantId: command.tenantId
    });
    const key = filePrimaryObjectKey(snapshot);
    const object = requireStoredFileObject(await this.storage.get(key), this.fileDoctype, plan.overlay.file);
    return fileTransformOverlaySource(snapshot, object, plan.overlay);
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
      fileCommandTenantId(command.source.actor, command.source.tenantId)
    );
    return this.documents.execute(fileRenditionManifestExecuteCommand({
      actor: command.source.actor,
      doctype: this.fileDoctype,
      name: command.source.name,
      tenantId: command.source.tenantId,
      metadata: command.source.metadata,
      snapshot: latest,
      command: command.command,
      rendition: command.rendition
    }));
  }

  private async deleteFileObjects(snapshot: DocumentSnapshot): Promise<void> {
    for (const key of fileObjectKeysForDelete(snapshot)) {
      await this.storage.delete(key);
    }
  }

  private async deleteFileObjectsForScanFailure(snapshot: DocumentSnapshot): Promise<void> {
    for (const key of fileObjectKeysForScanFailureCleanup(snapshot)) {
      await this.storage.delete(key).catch(ignoreFileCleanupFailure);
    }
  }

  private preflightDelete(actor: Actor, document: DocumentSnapshot, expectedVersion?: number): void {
    const doctype = this.registry.get(this.fileDoctype);
    ensureFileDeleteAllowed({
      actor,
      doctype,
      fileDoctype: this.fileDoctype,
      snapshot: document,
      ...fileExpectedVersionCommandOption(expectedVersion)
    });
  }

  private async validateAttachmentTarget(
    actor: Actor,
    tenantId: string,
    attachedTo: UploadFileCommand["attachedTo"] | undefined
  ): Promise<void> {
    const attachmentTarget = fileAttachmentTargetForValidation(attachedTo);
    if (!attachmentTarget) {
      return;
    }
    await this.queries.getDocument(actor, attachmentTarget.doctype, attachmentTarget.name, tenantId);
  }

  private requireMultipartUploads(): NonNullable<FileStorage["multipartUploads"]> {
    return requireMultipartFileUploads(this.storage.multipartUploads);
  }

  private async multipartUploadSnapshot(
    command: DownloadFileCommand,
    ensurePendingMultipartUpload: (snapshot: DocumentSnapshot) => void
  ): Promise<DocumentSnapshot> {
    const tenantId = fileCommandTenantId(command.actor, command.tenantId);
    const current = await this.queries.getDocument(command.actor, this.fileDoctype, command.name, tenantId);
    const doctype = this.registry.get(this.fileDoctype);
    ensureFileMultipartUploadAllowed({
      actor: command.actor,
      doctype,
      fileDoctype: this.fileDoctype,
      snapshot: current,
      ensurePendingMultipartUpload
    });
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
    const plan = fileCompletedMultipartObjectPlan({
      snapshot: command.snapshot,
      uploadId: this.multipartUploadId(command.snapshot),
      parts: command.parts,
      existing: await this.storage.head(key)
    });
    if (plan.kind === "reuse") {
      return plan.object;
    }
    return command.multipartUploads.completeMultipartUpload(plan.command);
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
