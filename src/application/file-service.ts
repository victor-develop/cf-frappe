import type { DocumentCommandExecutor } from "./document-service";
import { QueryService } from "./query-service";
import { badRequest, conflict, FrameworkError, notFound, permissionDenied, validationFailed } from "../core/errors";
import { FILE_DOCTYPE_NAME } from "../core/file-doctype";
import { can } from "../core/permissions";
import type { ModelRegistry } from "../core/registry";
import { validateDocumentData } from "../core/schema";
import { DEFAULT_TENANT_ID, type Actor, type DocumentData, type DocumentSnapshot } from "../core/types";
import type { Clock } from "../ports/clock";
import { systemClock } from "../ports/clock";
import type { FileContent, FileStorage, StoredFileObject } from "../ports/file-storage";
import type { IdGenerator } from "../ports/id-generator";
import { cryptoIdGenerator } from "../ports/id-generator";

export interface FileServiceOptions {
  readonly registry: ModelRegistry;
  readonly documents: DocumentCommandExecutor;
  readonly queries: QueryService;
  readonly storage: FileStorage;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
  readonly maxFileBytes?: number;
  readonly fileDoctype?: string;
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

export interface DeleteFileCommand extends DownloadFileCommand {
  readonly expectedVersion?: number;
  readonly metadata?: DocumentData;
}

export interface UploadedFile {
  readonly snapshot: DocumentSnapshot;
  readonly object: StoredFileObject["metadata"];
}

export interface DownloadedFile {
  readonly snapshot: DocumentSnapshot;
  readonly object: StoredFileObject;
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

  constructor(options: FileServiceOptions) {
    this.registry = options.registry;
    this.documents = options.documents;
    this.queries = options.queries;
    this.storage = options.storage;
    this.clock = options.clock ?? systemClock;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.maxFileBytes = options.maxFileBytes ?? 25 * 1024 * 1024;
    this.fileDoctype = options.fileDoctype ?? FILE_DOCTYPE_NAME;
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

    try {
      const snapshot = await this.documents.create({
        actor: command.actor,
        doctype: this.fileDoctype,
        name: fileName,
        tenantId,
        data: {
          ...data,
          etag: object.httpEtag ?? object.etag,
        },
        metadata: command.metadata ?? {}
      });
      return { snapshot, object };
    } catch (error) {
      await this.storage.delete(key).catch(() => undefined);
      throw error;
    }
  }

  async download(command: DownloadFileCommand): Promise<DownloadedFile> {
    const snapshot = await this.queries.getDocument(
      command.actor,
      this.fileDoctype,
      command.name,
      command.tenantId ?? command.actor.tenantId ?? DEFAULT_TENANT_ID
    );
    const key = stringField(snapshot, "key");
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
