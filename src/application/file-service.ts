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
  ensureFileSizeWithinLimit,
  ensureFileObjectTransformable,
  ensureValidFileScanResult,
  ensureFileAvailableForDownload,
  ensureFileCreateAllowed,
  ensureFileDeleteAllowed,
  ensureFileMetadataUpdateAllowed,
  ensureFileMultipartUploadAllowed,
  ensureFilePendingDirectUpload,
  ensureFilePendingMultipartCompletion,
  ensureFilePendingMultipartPartUpload,
  ensureFileRenditionGenerationAllowed,
  ensureFileMetadataPatchProvided,
  ensureDirectUploadMatches,
  ensureMultipartCompletionMatchesManifest,
  fileAttachmentValidationPlan,
  fileBufferedUploadFailureCleanupPlan,
  requireDirectFileUploadCreator,
  requireFileObjectMetadata,
  requireFileTransformer,
  requireMultipartFileUploads,
  requireStoredFileObject,
  requireStoredFileRenditionObject,
  fileCompletedRenditionManifestRecord,
  fileCompletedMultipartObjectHeadReadPlan,
  fileCompletedMultipartObjectPlan,
  fileCompletedMultipartObjectReadPlan,
  fileDirectUploadObjectHeadReadPlan,
  fileBulkDeleteDeletedOutcome,
  fileBulkDeleteEntryCommand,
  fileBulkDeleteFailedOutcome,
  fileBulkDeleteOutcomeResult,
  fileBulkMetadataFailedOutcome,
  fileBulkMetadataOutcomeResult,
  fileBulkMetadataUpdatedOutcome,
  fileBulkMetadataUpdateEntryCommand,
  ignoreFileRenditionFailureRecoveryFailure,
  fileBufferedUploadCreatePlan,
  fileBufferedUploadStoragePlan,
  fileCommandTenantId,
  fileContentLength,
  fileDashboardEntryWithPermissions,
  fileDashboardListQuery,
  fileDashboardResult,
  fileDashboardScanPlan,
  fileDownloadedResult,
  fileReadableDashboardCandidate,
  fileReadableDashboardEntries,
  fileDownloadedObjectReadPlan,
  fileDownloadedTransformObjectCommand,
  fileDeleteRequestedExecuteCommand,
  fileDeleteRequestedDocumentCommand,
  fileDeleteRequestedSnapshot,
  fileDeletedExecuteCommand,
  fileDeleteFinalizationPlan,
  fileResolvedTransformOverlaySource,
  fileDownloadedRenditionObjectReadPlan,
  fileDownloadedRenditionResult,
  fileDocumentCreateCommand,
  fileDirectUploadReservationPlan,
  fileGeneratedRenditionCompletionResult,
  fileMetadataUpdateExecuteCommand,
  fileMetadataUpdateDocumentCommand,
  fileMultipartAbortPlan,
  fileMultipartCompletionStartedExecuteCommand,
  fileMultipartCompletionStartedDocumentCommand,
  fileMultipartCompletionSnapshot,
  fileMultipartCompletionCommand,
  fileMultipartPartRecordedExecuteCommand,
  fileMultipartPartRecordedDocumentCommand,
  fileMultipartPartUploadPlan,
  fileMultipartUploadDocumentCreateCommand,
  fileMultipartUploadReservationPlan,
  fileMultipartUploadId,
  fileMultipartUploadReservationCleanupPlan,
  fileObjectSourceEtag,
  filePreparedDirectUploadResult,
  filePreparedMultipartUploadResult,
  fileGeneratedRenditionReservationPlan,
  fileGeneratedRenditionFailurePlan,
  fileGeneratedRenditionReuseDecision,
  fileGeneratedRenditionReuseHeadReadPlan,
  fileGeneratedRenditionReuseObjectExists,
  fileGeneratedRenditionReuseStoragePlan,
  fileRenditionId,
  fileRenditionManifestExecuteCommand,
  fileRenditionReservationExecuteCommand,
  fileGeneratedRenditionStoragePutCommand,
  fileObjectScanPlan,
  fileScanFailureError,
  fileUploadScanFailureDecision,
  fileExpectedVersionCommandOption,
  fileUploadCompletionExecuteCommand,
  fileUploadCompletionPlan,
  fileUploadContentType,
  fileUploadExpiresAt,
  fileTransformOverlayCommandOption,
  fileTransformOverlayDocumentReadPlan,
  fileTransformOverlayObjectReadPlan,
  fileTransformedFileResult,
  fileUploadedMultipartPartResult,
  fileUploadedResult,
  fileSnapshotFilename,
  ignoreFileCleanupFailure,
  normalizeBulkFileSelections,
  normalizeFileSize,
  nextFileDashboardOffset,
  objectKey,
  sanitizeFilename,
  shouldContinueFileDashboardScan,
  type FileBulkDeleteOutcome,
  type FileBulkMetadataUpdateOutcome,
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
    const upload = fileBufferedUploadStoragePlan({
      filename,
      key,
      body: command.body,
      contentType,
      size,
      tenantId,
      isPrivate: command.isPrivate,
      uploadedBy: command.actor.id,
      uploadedAt: this.clock.now(),
      attachedTo: command.attachedTo
    });
    this.preflightCreate(command.actor, upload.data);
    const object = await this.storage.put(upload.put);
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
      await this.deleteFileObjectsIgnoringFailures(fileBufferedUploadFailureCleanupPlan({ key }));
      throw error;
    }

    let uploadFailureCleanup: { readonly deleteKeys: readonly string[] } | undefined;
    try {
      const plan = fileBufferedUploadCreatePlan({
        data: upload.data,
        object,
        scan,
        checkedAt: this.clock.now()
      });
      const snapshot = await this.documents.create(fileDocumentCreateCommand({
        actor: command.actor,
        doctype: this.fileDoctype,
        name: fileName,
        tenantId,
        metadata: command.metadata,
        create: plan.create
      }));
      const scanFailure = fileUploadScanFailureDecision({ snapshot, infected: plan.infected, scan });
      if (scanFailure.kind === "fail") {
        uploadFailureCleanup = scanFailure.cleanup;
        throw fileScanFailureError(scanFailure.failure, snapshot);
      }
      return fileUploadedResult({ snapshot, object });
    } catch (error) {
      await this.deleteFileObjectsIgnoringFailures(uploadFailureCleanup ?? fileBufferedUploadFailureCleanupPlan({ key }));
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
    const plan = fileDirectUploadReservationPlan({
      filename,
      key,
      contentType,
      size,
      expiresAt,
      tenantId,
      isPrivate: command.isPrivate,
      uploadedBy: command.actor.id,
      uploadedAt: this.clock.now(),
      scannerConfigured: this.scanner !== undefined,
      attachedTo: command.attachedTo
    });
    this.preflightCreate(command.actor, plan.create.data);
    const upload = await createDirectUpload(plan.reservation);
    const snapshot = await this.documents.create(fileDocumentCreateCommand({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: fileName,
      tenantId,
      metadata: command.metadata,
      create: plan.create
    }));
    return filePreparedDirectUploadResult({ snapshot, upload });
  }

  async completeDirectUpload(command: CompleteDirectUploadCommand): Promise<DocumentSnapshot> {
    const tenantId = fileCommandTenantId(command.actor, command.tenantId);
    const current = await this.queries.getDocument(command.actor, this.fileDoctype, command.name, tenantId);
    ensureFilePendingDirectUpload(current);
    const head = fileDirectUploadObjectHeadReadPlan(current);
    const object = requireFileObjectMetadata(
      await this.storage.head(head.key),
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
    const plan = fileUploadCompletionPlan({
      uploadCommand: "completeDirectUpload",
      object,
      scan,
      checkedAt: this.clock.now(),
      ...fileExpectedVersionCommandOption(command.expectedVersion)
    });
    const scanFailure = fileUploadScanFailureDecision({ snapshot: current, infected: plan.infected, scan });
    if (scanFailure.kind === "fail") {
      const snapshot = await this.documents.execute(fileUploadCompletionExecuteCommand({
        actor: command.actor,
        doctype: this.fileDoctype,
        name: command.name,
        tenantId: command.tenantId,
        metadata: command.metadata,
        completion: plan.completion
      }));
      await this.deleteFileObjectsIgnoringFailures(scanFailure.cleanup);
      throw fileScanFailureError(scanFailure.failure, snapshot);
    }
    return this.documents.execute(fileUploadCompletionExecuteCommand({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: command.name,
      tenantId: command.tenantId,
      metadata: command.metadata,
      completion: plan.completion
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
    const reservation = fileMultipartUploadReservationPlan({
      filename,
      key,
      contentType,
      size,
      expiresAt,
      tenantId,
      isPrivate: command.isPrivate,
      uploadedBy: command.actor.id,
      uploadedAt: this.clock.now(),
      scannerConfigured: this.scanner !== undefined,
      attachedTo: command.attachedTo
    });
    this.preflightCreate(command.actor, reservation.data);
    const upload = await multipartUploads.createMultipartUpload(reservation.reservation);
    try {
      const create = fileMultipartUploadDocumentCreateCommand({
        upload: reservation.upload,
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
      const cleanup = fileMultipartUploadReservationCleanupPlan({
        key,
        uploadId: upload.uploadId
      });
      await multipartUploads.abortMultipartUpload(cleanup.abort).catch(ignoreFileCleanupFailure);
      throw error;
    }
  }

  async uploadMultipartPart(command: UploadMultipartPartCommand): Promise<UploadedMultipartPartResult> {
    const multipartUploads = this.requireMultipartUploads();
    const current = await this.multipartUploadSnapshot(command, ensureFilePendingMultipartPartUpload);
    const upload = fileMultipartPartUploadPlan({
      snapshot: current,
      partNumber: command.partNumber,
      body: command.body,
      size: command.size
    });
    const part = await multipartUploads.uploadMultipartPart(upload.command);
    const recorded = fileMultipartPartRecordedDocumentCommand({
      snapshot: current,
      part,
      size: upload.size
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
    const started = completionStart
      ? await this.documents.execute(fileMultipartCompletionStartedExecuteCommand({
          actor: command.actor,
          doctype: this.fileDoctype,
          name: command.name,
          tenantId: command.tenantId,
          metadata: command.metadata,
          completionStart
        }))
      : undefined;
    const completing = fileMultipartCompletionSnapshot({ current, started });
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
    const plan = fileUploadCompletionPlan({
      uploadCommand: "completeMultipartUpload",
      object,
      scan,
      checkedAt: this.clock.now(),
      expectedVersion: completing.version
    });
    const scanFailure = fileUploadScanFailureDecision({ snapshot: completing, infected: plan.infected, scan });
    if (scanFailure.kind === "fail") {
      const snapshot = await this.documents.execute(fileUploadCompletionExecuteCommand({
        actor: command.actor,
        doctype: this.fileDoctype,
        name: command.name,
        tenantId: command.tenantId,
        metadata: command.metadata,
        completion: plan.completion
      }));
      await this.deleteFileObjectsIgnoringFailures(scanFailure.cleanup);
      throw fileScanFailureError(scanFailure.failure, snapshot);
    }
    return this.documents.execute(fileUploadCompletionExecuteCommand({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: command.name,
      tenantId: command.tenantId,
      metadata: command.metadata,
      completion: plan.completion
    }));
  }

  async abortMultipartUpload(command: AbortMultipartUploadCommand): Promise<DocumentSnapshot> {
    const multipartUploads = this.requireMultipartUploads();
    const current = await this.multipartUploadSnapshot(command, ensureFilePendingMultipartPartUpload);
    const plan = fileMultipartAbortPlan({
      snapshot: current,
      expectedVersion: command.expectedVersion
    });
    await multipartUploads.abortMultipartUpload(plan.abort);
    return this.documents.delete(fileDeletedExecuteCommand({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: command.name,
      tenantId: command.tenantId,
      metadata: command.metadata,
      deleted: plan.deleted
    }));
  }

  async dashboard(actor: Actor, query: FileDashboardQuery = {}): Promise<FileDashboard> {
    const scan = fileDashboardScanPlan({ actor, query });
    const doctype = this.registry.get(this.fileDoctype);
    const files: FileDashboardEntry[] = [];
    let offset = scan.offset;
    let total = 0;
    do {
      const result = await this.queries.listDocuments(scan.systemActor, this.fileDoctype, fileDashboardListQuery({
        tenantId: scan.tenantId,
        filters: scan.listFilters,
        limit: scan.batchLimit,
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
      offset = nextFileDashboardOffset(offset, scan.batchLimit);
    } while (shouldContinueFileDashboardScan({
      visibleFiles: files.length,
      limit: scan.limit,
      offset,
      total
    }));
    return fileDashboardResult({
      actor,
      doctype,
      storage: this.storage,
      maxUploadBytes: this.maxFileBytes,
      files,
      limit: scan.limit,
      filters: scan.filters
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
    await this.validateAttachmentTarget(command.actor, tenantId, command.attachedTo);
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
    const read = fileDownloadedObjectReadPlan(snapshot);
    const object = requireStoredFileObject(await this.storage.get(read.key), this.fileDoctype, command.name);
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
    const reuseHead = fileGeneratedRenditionReuseHeadReadPlan(reuse);
    const reuseObject = reuseHead.kind === "head" ? await this.storage.head(reuseHead.key) : undefined;
    const reuseDecision = fileGeneratedRenditionReuseDecision({
      snapshot: downloaded.snapshot,
      reuse,
      objectExists: fileGeneratedRenditionReuseObjectExists({
        head: reuseHead,
        object: reuseObject
      })
    });
    if (reuseDecision.kind === "reuse") {
      return reuseDecision.result;
    }

    const reservation = fileGeneratedRenditionReservationPlan({
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
    await this.documents.execute(fileRenditionReservationExecuteCommand({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: command.name,
      tenantId: command.tenantId,
      metadata: command.metadata,
      reservation: reservation.documentCommand
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
        fileGeneratedRenditionStoragePutCommand({
          pending,
          transform,
          source: downloaded.snapshot,
          tenantId,
          sourceEtag,
          renditionId
        })
      );
      const completed = fileCompletedRenditionManifestRecord({
        pending,
        object,
        generatedAt: this.clock.now(),
        generatedBy: command.actor.id
      });
      const snapshot = await this.recordRenditionManifest({
        source: command,
        command: completed.command,
        rendition: completed.rendition
      });
      return fileGeneratedRenditionCompletionResult({
        snapshot,
        completed
      });
    } catch (error) {
      const failure = fileGeneratedRenditionFailurePlan({
        pending,
        object,
        error
      });
      await this.deleteFileObjectsIgnoringFailures(failure.cleanup);
      await this.recordRenditionManifest({
        source: command,
        command: failure.failed.command,
        rendition: failure.failed.rendition
      }).catch(ignoreFileRenditionFailureRecoveryFailure);
      throw error;
    }
  }

  async downloadRendition(command: DownloadFileRenditionCommand): Promise<DownloadedFileRendition> {
    const snapshot = await this.availableFileSnapshot(command);
    const rendition = availableFileRenditionForDownload(snapshot, command.renditionId);
    const read = fileDownloadedRenditionObjectReadPlan(rendition);
    const object = requireStoredFileRenditionObject(
      await this.storage.get(read.key),
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
    const requested =
      deleteRequest
        ? await this.documents.execute(fileDeleteRequestedExecuteCommand({
            actor: command.actor,
            doctype: this.fileDoctype,
            name: command.name,
            tenantId: command.tenantId,
            metadata: command.metadata,
            deleteRequest
          }))
        : undefined;
    const deleteRequested = fileDeleteRequestedSnapshot({ current, requested });
    const finalization = fileDeleteFinalizationPlan(deleteRequested);
    await this.deleteFileObjects(finalization.cleanup);
    const snapshot = await this.documents.delete(fileDeletedExecuteCommand({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: command.name,
      tenantId: command.tenantId,
      metadata: command.metadata,
      deleted: finalization.deleted
    }));
    return snapshot;
  }

  async bulkDelete(command: BulkDeleteFilesCommand): Promise<BulkDeleteFilesResult> {
    const selections = normalizeBulkFileSelections(command.files);
    const outcomes: FileBulkDeleteOutcome[] = [];
    for (const selection of selections) {
      try {
        const snapshot = await this.delete(fileBulkDeleteEntryCommand({
          actor: command.actor,
          tenantId: command.tenantId,
          metadata: command.metadata,
          selection
        }));
        outcomes.push(fileBulkDeleteDeletedOutcome({ selection, snapshot }));
      } catch (error) {
        outcomes.push(fileBulkDeleteFailedOutcome({ selection, error }));
      }
    }
    return fileBulkDeleteOutcomeResult(outcomes);
  }

  async bulkUpdateMetadata(command: BulkUpdateFileMetadataCommand): Promise<BulkUpdateFileMetadataResult> {
    const selections = normalizeBulkFileSelections(command.files);
    ensureFileMetadataPatchProvided(command);
    const outcomes: FileBulkMetadataUpdateOutcome[] = [];
    for (const selection of selections) {
      try {
        const snapshot = await this.updateMetadata(fileBulkMetadataUpdateEntryCommand({
          actor: command.actor,
          tenantId: command.tenantId,
          metadata: command.metadata,
          selection,
          patch: command
        }));
        outcomes.push(fileBulkMetadataUpdatedOutcome({ selection, snapshot }));
      } catch (error) {
        outcomes.push(fileBulkMetadataFailedOutcome({ selection, error }));
      }
    }
    return fileBulkMetadataOutcomeResult(outcomes);
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
    return command.transformer.transform(fileDownloadedTransformObjectCommand({
      actor: command.actor,
      tenantId: command.tenantId,
      downloaded: command.downloaded,
      options: command.options,
      overlay: command.overlay
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
    const documentRead = fileTransformOverlayDocumentReadPlan(command);
    if (documentRead.kind === "none") {
      return undefined;
    }
    const snapshot = await this.availableFileSnapshot({
      actor: documentRead.actor,
      name: documentRead.name,
      tenantId: documentRead.tenantId
    });
    const read = fileTransformOverlayObjectReadPlan({
      snapshot,
      overlay: documentRead.overlay
    });
    const object = requireStoredFileObject(await this.storage.get(read.key), this.fileDoctype, read.file);
    return fileResolvedTransformOverlaySource({ snapshot, object, plan: read });
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

  private async deleteFileObjects(plan: { readonly deleteKeys: readonly string[] }): Promise<void> {
    for (const key of plan.deleteKeys) {
      await this.storage.delete(key);
    }
  }

  private async deleteFileObjectsIgnoringFailures(plan: { readonly deleteKeys: readonly string[] }): Promise<void> {
    for (const key of plan.deleteKeys) {
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
    attachedTo: UploadFileCommand["attachedTo"] | null | undefined
  ): Promise<void> {
    const plan = fileAttachmentValidationPlan({ actor, tenantId, attachedTo });
    if (plan.kind === "skip") {
      return;
    }
    await this.queries.getDocument(plan.actor, plan.target.doctype, plan.target.name, plan.tenantId);
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
    const read = fileCompletedMultipartObjectReadPlan(command.snapshot);
    const head = fileCompletedMultipartObjectHeadReadPlan(read);
    const plan = fileCompletedMultipartObjectPlan({
      snapshot: command.snapshot,
      uploadId: read.uploadId,
      parts: command.parts,
      existing: await this.storage.head(head.key)
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
    const plan = fileObjectScanPlan({
      scannerConfigured: this.scanner !== undefined,
      actor: command.actor,
      tenantId: command.tenantId,
      filename: command.filename,
      source: command.source,
      object: command.object
    });
    if (plan.kind === "skip") {
      return undefined;
    }
    const result = await this.scanner!.scan(plan.target);
    ensureValidFileScanResult(result);
    return result;
  }
}
