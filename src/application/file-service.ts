import type { DocumentCommandExecutor } from "./document-service.js";
import { QueryService } from "./query-service.js";
import {
  badRequest,
  conflict,
  FrameworkError,
  notFound,
  permissionDenied,
  validationFailed,
  type FrameworkErrorCode
} from "../core/errors.js";
import { FILE_DOCTYPE_NAME } from "../core/file-doctype.js";
import { can } from "../core/permissions.js";
import type { ModelRegistry } from "../core/registry.js";
import { validateDocumentData } from "../core/schema.js";
import {
  DEFAULT_TENANT_ID,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type DocumentData,
  type DocumentSnapshot,
  type JsonValue
} from "../core/types.js";
import {
  ensureR2CompatibleMultipartPartSizes,
  sortedUploadedMultipartParts
} from "../ports/multipart-file-storage.js";
import type { Clock } from "../ports/clock.js";
import { systemClock } from "../ports/clock.js";
import type { FileScanner, FileScanResult, FileScanSource, FileScanTarget } from "../ports/file-scanner.js";
import {
  isTransformableFileContentType,
  normalizeFileTransformOptions,
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
}

export interface FileDashboard {
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

  async upload(command: UploadFileCommand): Promise<UploadedFile> {
    const filename = sanitizeFilename(command.filename);
    const size = byteLength(command.body);
    if (size > this.maxFileBytes) {
      throw badRequest(`File exceeds ${this.maxFileBytes} bytes`);
    }

    const contentType = command.contentType ?? "application/octet-stream";
    const tenantId = command.tenantId ?? command.actor.tenantId ?? DEFAULT_TENANT_ID;
    await this.validateAttachmentTarget(command.actor, tenantId, command.attachedTo);
    const fileName = this.ids.next("file_");
    const key = objectKey(tenantId, fileName, filename);
    const data: DocumentData = {
      filename,
      key,
      content_type: contentType,
      size,
      is_private: command.isPrivate ?? true,
      uploaded_by: command.actor.id,
      uploaded_at: this.clock.now(),
      storage_state: "available",
      ...(command.attachedTo
        ? {
            attached_to_doctype: command.attachedTo.doctype,
            attached_to_name: command.attachedTo.name
          }
        : {})
    };
    this.preflightCreate(command.actor, data);
    const object = await this.storage.put({
      key,
      body: command.body,
      contentType,
      filename,
      size,
      customMetadata: {
        tenantId,
        uploadedBy: command.actor.id
      }
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
      const scanPatch = scan ? fileScanPatch(scan, this.clock.now()) : {};
      if (scan?.status === "infected") {
        const snapshot = await this.documents.create({
          actor: command.actor,
          doctype: this.fileDoctype,
          name: fileName,
          tenantId,
          data: {
            ...data,
            storage_state: "scan_failed",
            etag: object.httpEtag ?? object.etag,
            ...scanPatch
          },
          eventType: "FileScanFailed",
          metadata: command.metadata ?? {}
        });
        throw fileScanFailed(scan, snapshot);
      }
      const snapshot = await this.documents.create({
        actor: command.actor,
        doctype: this.fileDoctype,
        name: fileName,
        tenantId,
        data: {
          ...data,
          etag: object.httpEtag ?? object.etag,
          ...scanPatch
        },
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
    if (size > this.maxFileBytes) {
      throw badRequest(`File exceeds ${this.maxFileBytes} bytes`);
    }

    const contentType = command.contentType ?? "application/octet-stream";
    const tenantId = command.tenantId ?? command.actor.tenantId ?? DEFAULT_TENANT_ID;
    await this.validateAttachmentTarget(command.actor, tenantId, command.attachedTo);
    const fileName = this.ids.next("file_");
    const key = objectKey(tenantId, fileName, filename);
    const expiresAt = addSeconds(this.clock.now(), normalizeDirectUploadExpiry(command.expiresInSeconds));
    const data: DocumentData = {
      filename,
      key,
      content_type: contentType,
      size,
      is_private: command.isPrivate ?? true,
      uploaded_by: command.actor.id,
      uploaded_at: this.clock.now(),
      storage_state: "upload_pending",
      direct_upload_expires_at: expiresAt,
      ...(this.scanner === undefined ? {} : { scan_status: "pending" }),
      ...(command.attachedTo
        ? {
            attached_to_doctype: command.attachedTo.doctype,
            attached_to_name: command.attachedTo.name
          }
        : {})
    };
    this.preflightCreate(command.actor, data);
    const upload = await this.storage.createDirectUpload({
      key,
      contentType,
      filename,
      size,
      expiresAt,
      customMetadata: {
        tenantId,
        uploadedBy: command.actor.id
      }
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
    if (current.data.storage_state === "delete_requested") {
      throw new FrameworkError("DOCUMENT_DELETED", `${this.fileDoctype}/${command.name} is pending deletion`, {
        status: 410
      });
    }
    if (current.data.storage_state !== "upload_pending") {
      throw badRequest(`${this.fileDoctype}/${command.name} is not pending direct upload`);
    }
    const object = await this.storage.head(stringField(current, "key"));
    if (!object) {
      throw notFound(`${this.fileDoctype}/${command.name} content was not found`);
    }
    ensureDirectUploadMatches(current, object);
    const scan = await this.scanObject({
      actor: command.actor,
      tenantId,
      filename: stringField(current, "filename"),
      source: "direct_upload",
      object
    });
    const scanPatch = scan ? fileScanPatch(scan, this.clock.now()) : {};
    if (scan?.status === "infected") {
      const snapshot = await this.documents.execute({
        actor: command.actor,
        doctype: this.fileDoctype,
        name: command.name,
        command: "failScan",
        input: {
          storage_state: "scan_failed",
          etag: object.httpEtag ?? object.etag,
          ...scanPatch
        },
        ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
        ...(command.expectedVersion === undefined ? {} : { expectedVersion: command.expectedVersion }),
        metadata: command.metadata ?? {}
      });
      await this.storage.delete(stringField(current, "key")).catch(() => undefined);
      throw fileScanFailed(scan, snapshot);
    }
    return this.documents.execute({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: command.name,
      command: "completeDirectUpload",
      input: {
        storage_state: "available",
        etag: object.httpEtag ?? object.etag,
        ...scanPatch
      },
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
    if (size > this.maxFileBytes) {
      throw badRequest(`File exceeds ${this.maxFileBytes} bytes`);
    }

    const contentType = command.contentType ?? "application/octet-stream";
    const tenantId = command.tenantId ?? command.actor.tenantId ?? DEFAULT_TENANT_ID;
    await this.validateAttachmentTarget(command.actor, tenantId, command.attachedTo);
    const fileName = this.ids.next("file_");
    const key = objectKey(tenantId, fileName, filename);
    const expiresAt = addSeconds(this.clock.now(), normalizeDirectUploadExpiry(command.expiresInSeconds));
    const baseData: DocumentData = {
      filename,
      key,
      content_type: contentType,
      size,
      is_private: command.isPrivate ?? true,
      uploaded_by: command.actor.id,
      uploaded_at: this.clock.now(),
      storage_state: "upload_pending",
      direct_upload_expires_at: expiresAt,
      ...(this.scanner === undefined ? {} : { scan_status: "pending" }),
      ...(command.attachedTo
        ? {
            attached_to_doctype: command.attachedTo.doctype,
            attached_to_name: command.attachedTo.name
          }
        : {})
    };
    this.preflightCreate(command.actor, baseData);
    const upload = await this.storage.multipartUploads.createMultipartUpload({
      key,
      contentType,
      filename,
      customMetadata: {
        tenantId,
        uploadedBy: command.actor.id
      }
    });
    try {
      const snapshot = await this.documents.create({
        actor: command.actor,
        doctype: this.fileDoctype,
        name: fileName,
        tenantId,
        data: {
          ...baseData,
          multipart_upload_id: upload.uploadId
        },
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
    const current = await this.multipartUploadSnapshot(command, ["upload_pending"]);
    const uploadId = this.multipartUploadId(current);
    const size = multipartPartSize(command.body, command.size);
    ensureMultipartPartFitsReservation(current, command.partNumber, size);
    const part = await multipartUploads.uploadMultipartPart({
      key: stringField(current, "key"),
      uploadId,
      partNumber: command.partNumber,
      body: command.body
    });
    const snapshot = await this.documents.execute({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: command.name,
      command: "recordMultipartPart",
      input: {
        multipart_parts: upsertMultipartPartManifest(multipartPartManifest(current), {
          partNumber: part.partNumber,
          etag: part.etag,
          size
        })
      },
      ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
      expectedVersion: current.version,
      metadata: command.metadata ?? {}
    });
    return { part, snapshot };
  }

  async completeMultipartUpload(command: CompleteMultipartUploadCommand): Promise<DocumentSnapshot> {
    const multipartUploads = this.requireMultipartUploads();
    const current = await this.multipartUploadSnapshot(command, ["upload_pending", "upload_completing"]);
    const key = stringField(current, "key");
    ensureMultipartCompletionMatchesManifest(current, command.parts);
    const completing = current.data.storage_state === "upload_completing"
      ? current
      : await this.documents.execute({
          actor: command.actor,
          doctype: this.fileDoctype,
          name: command.name,
          command: "beginMultipartUploadCompletion",
          input: { storage_state: "upload_completing" },
          ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
          ...(command.expectedVersion === undefined ? {} : { expectedVersion: command.expectedVersion }),
          metadata: command.metadata ?? {}
        });
    const object = await this.completedMultipartObject({
      multipartUploads,
      snapshot: completing,
      parts: command.parts
    });
    ensureDirectUploadMatches(completing, object, "Multipart upload");
    const scan = await this.scanObject({
      actor: command.actor,
      tenantId: command.tenantId ?? command.actor.tenantId ?? DEFAULT_TENANT_ID,
      filename: stringField(completing, "filename"),
      source: "multipart_upload",
      object
    });
    const scanPatch = scan ? fileScanPatch(scan, this.clock.now()) : {};
    if (scan?.status === "infected") {
      const snapshot = await this.documents.execute({
        actor: command.actor,
        doctype: this.fileDoctype,
        name: command.name,
        command: "failScan",
        input: {
          storage_state: "scan_failed",
          etag: object.httpEtag ?? object.etag,
          ...scanPatch
        },
        ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
        expectedVersion: completing.version,
        metadata: command.metadata ?? {}
      });
      await this.storage.delete(key).catch(() => undefined);
      throw fileScanFailed(scan, snapshot);
    }
    return this.documents.execute({
      actor: command.actor,
      doctype: this.fileDoctype,
      name: command.name,
      command: "completeMultipartUpload",
      input: {
        storage_state: "available",
        etag: object.httpEtag ?? object.etag,
        ...scanPatch
      },
      ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
      expectedVersion: completing.version,
      metadata: command.metadata ?? {}
    });
  }

  async abortMultipartUpload(command: AbortMultipartUploadCommand): Promise<DocumentSnapshot> {
    const multipartUploads = this.requireMultipartUploads();
    const current = await this.multipartUploadSnapshot(command, ["upload_pending"]);
    ensureExpectedVersion(current, command.expectedVersion);
    await multipartUploads.abortMultipartUpload({
      key: stringField(current, "key"),
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
    const limit = normalizeLimit(query.limit);
    const filters = {
      ...optionalTextFilter("attachedToDoctype", query.attachedToDoctype),
      ...optionalTextFilter("attachedToName", query.attachedToName),
      ...optionalTextFilter("filename", query.filename),
      ...optionalTextFilter("contentType", query.contentType),
      ...optionalTextFilter("uploadedBy", query.uploadedBy),
      ...optionalTextFilter("storageState", query.storageState),
      ...optionalTextFilter("scanStatus", query.scanStatus),
      ...(query.isPrivate === undefined ? {} : { isPrivate: query.isPrivate })
    };
    const listFilters = [
      ...(filters.attachedToDoctype === undefined
        ? []
        : [{ field: "attached_to_doctype", operator: "eq" as const, value: filters.attachedToDoctype }]),
      ...(filters.attachedToName === undefined
        ? []
        : [{ field: "attached_to_name", operator: "eq" as const, value: filters.attachedToName }]),
      ...(filters.filename === undefined
        ? []
        : [{ field: "filename", operator: "contains" as const, value: filters.filename }]),
      ...(filters.contentType === undefined
        ? []
        : [{ field: "content_type", operator: "contains" as const, value: filters.contentType }]),
      ...(filters.uploadedBy === undefined
        ? []
        : [{ field: "uploaded_by", operator: "eq" as const, value: filters.uploadedBy }]),
      ...(filters.storageState === undefined
        ? []
        : [{ field: "storage_state", operator: "eq" as const, value: filters.storageState }]),
      ...(filters.scanStatus === undefined
        ? []
        : [{ field: "scan_status", operator: "eq" as const, value: filters.scanStatus }]),
      ...(filters.isPrivate === undefined
        ? []
        : [{ field: "is_private", operator: "eq" as const, value: filters.isPrivate }])
    ];
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
    if (current.data.storage_state === "delete_requested") {
      throw new FrameworkError("DOCUMENT_DELETED", `${this.fileDoctype}/${command.name} is pending deletion`, {
        status: 410
      });
    }
    const patch: DocumentData = {
      ...(command.filename === undefined ? {} : { filename: sanitizeFilename(command.filename) }),
      ...(command.isPrivate === undefined ? {} : { is_private: command.isPrivate })
    };
    if (command.attachedTo !== undefined) {
      if (command.attachedTo === null) {
        patch.attached_to_doctype = "";
        patch.attached_to_name = "";
      } else {
        await this.validateAttachmentTarget(command.actor, tenantId, command.attachedTo);
        patch.attached_to_doctype = command.attachedTo.doctype;
        patch.attached_to_name = command.attachedTo.name;
      }
    }
    if (Object.keys(patch).length === 0) {
      throw badRequest("At least one file metadata field must be provided");
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
    const snapshot = await this.queries.getDocument(
      command.actor,
      this.fileDoctype,
      command.name,
      command.tenantId ?? command.actor.tenantId ?? DEFAULT_TENANT_ID
    );
    const key = stringField(snapshot, "key");
    if (snapshot.data.storage_state === "upload_pending" || snapshot.data.storage_state === "upload_completing") {
      throw new FrameworkError("FILE_UPLOAD_PENDING", `${this.fileDoctype}/${command.name} upload has not been finalized`, {
        status: 409
      });
    }
    if (snapshot.data.storage_state === "scan_failed") {
      throw new FrameworkError("FILE_SCAN_FAILED", `${this.fileDoctype}/${command.name} did not pass file scanning`, {
        status: 409
      });
    }
    if (snapshot.data.storage_state === "delete_requested") {
      throw new FrameworkError("DOCUMENT_DELETED", `${this.fileDoctype}/${command.name} is pending deletion`, {
        status: 410
      });
    }
    const object = await this.storage.get(key);
    if (!object) {
      throw notFound(`${this.fileDoctype}/${command.name} content was not found`);
    }
    return { snapshot, object };
  }

  async transform(command: TransformFileCommand): Promise<TransformedFile> {
    if (!this.transformer) {
      throw badRequest("File transforms are not configured");
    }
    const downloaded = await this.download(command);
    const options = normalizeFileTransformOptions(command.options);
    const contentType = downloaded.object.metadata.contentType ?? stringField(downloaded.snapshot, "content_type");
    if (!isTransformableFileContentType(contentType)) {
      throw badRequest(`File '${downloaded.snapshot.name}' cannot be transformed`);
    }
    const tenantId = command.tenantId ?? command.actor.tenantId ?? DEFAULT_TENANT_ID;
    const filename = stringField(downloaded.snapshot, "filename") || downloaded.snapshot.name;
    const transform = await this.transformer.transform({
      actorId: command.actor.id,
      tenantId,
      source: {
        key: downloaded.object.metadata.key,
        filename,
        contentType,
        size: downloaded.object.metadata.size,
        body: downloaded.object.body,
        etag: downloaded.object.metadata.etag,
        ...(downloaded.object.metadata.httpEtag === undefined
          ? {}
          : { httpEtag: downloaded.object.metadata.httpEtag })
      },
      options
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
      current.data.storage_state === "delete_requested"
        ? current
        : await this.documents.execute({
            actor: command.actor,
            doctype: this.fileDoctype,
            name: command.name,
            command: "requestDelete",
            input: {},
            ...(command.tenantId === undefined ? {} : { tenantId: command.tenantId }),
            expectedVersion: current.version,
            metadata: command.metadata ?? {}
          });
    await this.storage.delete(stringField(deleteRequested, "key"));
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
        failed.push(bulkDeleteFailure(selection.name, error));
      }
    }
    return { deleted, failed };
  }

  async bulkUpdateMetadata(command: BulkUpdateFileMetadataCommand): Promise<BulkUpdateFileMetadataResult> {
    const selections = normalizeBulkFileSelections(command.files);
    if (command.isPrivate === undefined && command.attachedTo === undefined) {
      throw badRequest("At least one file metadata field must be provided");
    }
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
        failed.push(bulkFileFailure(selection.name, error, "Bulk metadata update failed"));
      }
    }
    return { updated, failed };
  }

  private preflightCreate(actor: Actor, data: DocumentData): void {
    const doctype = this.registry.get(this.fileDoctype);
    if (!can(actor, doctype, "create")) {
      throw permissionDenied(`Actor '${actor.id}' cannot create ${this.fileDoctype}`);
    }
    const issues = validateDocumentData(doctype, data);
    if (issues.length > 0) {
      throw validationFailed(issues);
    }
  }

  private preflightDelete(actor: Actor, document: DocumentSnapshot, expectedVersion?: number): void {
    const doctype = this.registry.get(this.fileDoctype);
    if (!can(actor, doctype, "delete", document)) {
      throw permissionDenied(`Actor '${actor.id}' cannot delete ${this.fileDoctype}/${document.name}`);
    }
    if (
      expectedVersion !== undefined &&
      document.version !== expectedVersion &&
      document.data.storage_state !== "delete_requested"
    ) {
      throw conflict(`Expected version ${expectedVersion}, found ${document.version}`);
    }
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
    allowedStates: readonly string[]
  ): Promise<DocumentSnapshot> {
    const tenantId = command.tenantId ?? command.actor.tenantId ?? DEFAULT_TENANT_ID;
    const current = await this.queries.getDocument(command.actor, this.fileDoctype, command.name, tenantId);
    if (current.data.storage_state === "delete_requested") {
      throw new FrameworkError("DOCUMENT_DELETED", `${this.fileDoctype}/${command.name} is pending deletion`, {
        status: 410
      });
    }
    if (
      typeof current.data.storage_state !== "string" ||
      !allowedStates.includes(current.data.storage_state) ||
      !stringData(current, "multipart_upload_id")
    ) {
      throw badRequest(`${this.fileDoctype}/${command.name} is not pending multipart upload`);
    }
    const doctype = this.registry.get(this.fileDoctype);
    if (!can(command.actor, doctype, "metadata", current)) {
      throw permissionDenied(
        `Actor '${command.actor.id}' cannot execute multipart upload on ${this.fileDoctype}/${command.name}`
      );
    }
    return current;
  }

  private multipartUploadId(snapshot: DocumentSnapshot): string {
    const uploadId = stringData(snapshot, "multipart_upload_id");
    if (!uploadId) {
      throw badRequest(`${snapshot.doctype}/${snapshot.name} has no multipart upload`);
    }
    return uploadId;
  }

  private async completedMultipartObject(command: {
    readonly multipartUploads: NonNullable<FileStorage["multipartUploads"]>;
    readonly snapshot: DocumentSnapshot;
    readonly parts: readonly UploadedMultipartFilePart[];
  }): Promise<FileObjectMetadata> {
    const key = stringField(command.snapshot, "key");
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
    const target: FileScanTarget = {
      actorId: command.actor.id,
      tenantId: command.tenantId,
      key: command.object.key,
      filename: command.filename,
      contentType: command.object.contentType ?? "application/octet-stream",
      size: command.object.size,
      source: command.source,
      etag: command.object.etag,
      ...(command.object.httpEtag === undefined ? {} : { httpEtag: command.object.httpEtag })
    };
    const result = await this.scanner.scan(target);
    if (result.status !== "clean" && result.status !== "infected") {
      throw badRequest("File scanner returned an invalid status");
    }
    return result;
  }
}

function optionalTextFilter<TKey extends string>(key: TKey, value: string | undefined): { readonly [K in TKey]?: string } {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed === "" ? {} : { [key]: trimmed } as { readonly [K in TKey]: string };
}

const MAX_BULK_FILES = 100;

function normalizeBulkFileSelections(
  files: readonly BulkFileSelection[]
): readonly BulkFileSelection[] {
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

function bulkDeleteFailure(name: string, error: unknown): BulkDeleteFileFailure {
  return bulkFileFailure(name, error, "Bulk delete failed");
}

function bulkFileFailure(name: string, error: unknown, fallback: string): BulkDeleteFileFailure {
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

function fileDashboardEntry(snapshot: DocumentSnapshot): Omit<FileDashboardEntry, "editable" | "deletable"> {
  const attachedToDoctype = stringData(snapshot, "attached_to_doctype");
  const attachedToName = stringData(snapshot, "attached_to_name");
  const contentType = stringData(snapshot, "content_type");
  const storageState = stringData(snapshot, "storage_state") || "available";
  return {
    name: snapshot.name,
    filename: stringData(snapshot, "filename") || snapshot.name,
    contentType,
    size: numberData(snapshot, "size"),
    isPrivate: snapshot.data.is_private !== false,
    previewable: storageState === "available" && isPreviewableFileContentType(contentType),
    storageState,
    ...(stringData(snapshot, "direct_upload_expires_at")
      ? { directUploadExpiresAt: stringData(snapshot, "direct_upload_expires_at") }
      : {}),
    ...(stringData(snapshot, "scan_status") ? { scanStatus: stringData(snapshot, "scan_status") } : {}),
    ...(stringData(snapshot, "scan_checked_at") ? { scanCheckedAt: stringData(snapshot, "scan_checked_at") } : {}),
    ...(stringData(snapshot, "scan_engine") ? { scanEngine: stringData(snapshot, "scan_engine") } : {}),
    ...(stringData(snapshot, "scan_message") ? { scanMessage: stringData(snapshot, "scan_message") } : {}),
    uploadedBy: stringData(snapshot, "uploaded_by"),
    uploadedAt: stringData(snapshot, "uploaded_at"),
    expectedVersion: snapshot.version,
    ...(attachedToDoctype && attachedToName
      ? { attachedTo: { doctype: attachedToDoctype, name: attachedToName } }
      : {})
  };
}

const PREVIEWABLE_FILE_CONTENT_TYPES = new Set([
  "application/json",
  "application/pdf",
  "text/csv",
  "text/markdown",
  "text/plain"
]);

export function isPreviewableFileContentType(contentType: string): boolean {
  const normalized = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return PREVIEWABLE_FILE_CONTENT_TYPES.has(normalized) || (normalized.startsWith("image/") && normalized !== "image/svg+xml");
}

function stringData(snapshot: DocumentSnapshot, field: string): string {
  const value = snapshot.data[field];
  return typeof value === "string" ? value : "";
}

function numberData(snapshot: DocumentSnapshot, field: string): number {
  const value = snapshot.data[field];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return 50;
  }
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
    throw badRequest("File dashboard limit must be between 1 and 200");
  }
  return limit;
}

function byteLength(body: FileContent): number {
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

function normalizeFileSize(size: number): number {
  if (!Number.isInteger(size) || size < 0) {
    throw badRequest("size must be a non-negative integer");
  }
  return size;
}

function normalizeDirectUploadExpiry(expiresInSeconds: number | undefined): number {
  if (expiresInSeconds === undefined) {
    return 15 * 60;
  }
  if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 60 || expiresInSeconds > 7 * 24 * 60 * 60) {
    throw badRequest("expiresInSeconds must be between 60 and 604800 seconds");
  }
  return expiresInSeconds;
}

function addSeconds(isoTimestamp: string, seconds: number): string {
  const timestamp = Date.parse(isoTimestamp);
  if (!Number.isFinite(timestamp)) {
    throw badRequest("clock returned an invalid timestamp");
  }
  return new Date(timestamp + seconds * 1000).toISOString();
}

function ensureDirectUploadMatches(
  snapshot: DocumentSnapshot,
  object: FileObjectMetadata,
  label = "Direct upload"
): void {
  const expectedSize = numberData(snapshot, "size");
  if (object.size !== expectedSize) {
    throw badRequest(`${label} object size mismatch`);
  }
  if (normalizeContentType(object.contentType) !== normalizeContentType(stringData(snapshot, "content_type"))) {
    throw badRequest(`${label} object content type mismatch`);
  }
}

function fileScanPatch(result: FileScanResult, checkedAt: string): DocumentData {
  return {
    scan_status: result.status,
    scan_checked_at: result.checkedAt ?? checkedAt,
    ...(result.engine === undefined || result.engine === "" ? {} : { scan_engine: result.engine }),
    ...(result.message === undefined || result.message === "" ? {} : { scan_message: result.message })
  };
}

function fileScanFailed(result: FileScanResult, snapshot: DocumentSnapshot): FrameworkError {
  const message = typeof snapshot.data.scan_message === "string" && snapshot.data.scan_message
    ? snapshot.data.scan_message
    : result.message;
  return new FrameworkError(
    "FILE_SCAN_FAILED",
    message ? `File scan failed: ${message}` : "File scan failed",
    { status: 422 }
  );
}

function normalizeContentType(value: string | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

function sanitizeFilename(value: string): string {
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

function objectKey(tenantId: string, id: string, filename: string): string {
  const tenant = tenantId.replace(/[^A-Za-z0-9_-]+/g, "-") || DEFAULT_TENANT_ID;
  const key = `${tenant}/files/${id}-${filename}`;
  if (new TextEncoder().encode(key).byteLength > 1024) {
    throw badRequest("file key exceeds 1024 bytes");
  }
  return key;
}

function stringField(snapshot: DocumentSnapshot, field: string): string {
  const value = snapshot.data[field];
  if (typeof value !== "string" || !value) {
    throw badRequest(`${snapshot.doctype}/${snapshot.name} has no ${field}`);
  }
  return value;
}

function ensureExpectedVersion(snapshot: DocumentSnapshot, expectedVersion: number | undefined): void {
  if (expectedVersion !== undefined && snapshot.version !== expectedVersion) {
    throw conflict(`Expected version ${expectedVersion}, found ${snapshot.version}`);
  }
}

interface MultipartPartManifestEntry {
  readonly [key: string]: JsonValue;
  readonly partNumber: number;
  readonly etag: string;
  readonly size: number;
}

function multipartPartSize(body: MultipartFilePartContent, size: number | undefined): number {
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

function multipartPartManifest(snapshot: DocumentSnapshot): readonly MultipartPartManifestEntry[] {
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

function upsertMultipartPartManifest(
  manifest: readonly MultipartPartManifestEntry[],
  part: MultipartPartManifestEntry
): readonly MultipartPartManifestEntry[] {
  return [
    ...manifest.filter((entry) => entry.partNumber !== part.partNumber),
    part
  ].sort((left, right) => left.partNumber - right.partNumber);
}

function ensureMultipartPartFitsReservation(
  snapshot: DocumentSnapshot,
  partNumber: number,
  size: number
): void {
  const previousTotal = multipartPartManifest(snapshot)
    .filter((part) => part.partNumber !== partNumber)
    .reduce((total, part) => total + part.size, 0);
  if (previousTotal + size > numberData(snapshot, "size")) {
    throw badRequest("Multipart upload part exceeds reserved file size");
  }
}

function ensureMultipartCompletionMatchesManifest(
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
  if (totalSize !== numberData(snapshot, "size")) {
    throw badRequest("Multipart upload object size mismatch");
  }
}
