import {
  type AbortMultipartFileUploadCommand,
  type CompleteMultipartFileUploadCommand,
  type CreateDirectFileUploadCommand,
  type CreateMultipartFileUploadCommand,
  type DirectFileUpload,
  type FileObjectMetadata,
  type FileStorage,
  type MultipartFileStorage,
  type MultipartFileUpload,
  type PutFileObjectCommand,
  type StoredFileObject,
  type UploadedMultipartFilePart,
  type UploadMultipartFilePartCommand
} from "../ports/file-storage.js";
import { ensureMultipartPartNumber, sortedUploadedMultipartParts } from "../ports/multipart-file-storage.js";
import { FrameworkError, notFound } from "../core/errors.js";
import type { DocumentData, JsonValue } from "../core/types.js";

export interface R2DirectUploadSigner {
  createUpload(command: CreateDirectFileUploadCommand): Promise<DirectFileUpload>;
}

export interface R2FileStorageOptions {
  readonly directUploads?: R2DirectUploadSigner;
}

export class R2FileStorage implements FileStorage {
  private readonly bucket: R2Bucket;
  readonly createDirectUpload?: (command: CreateDirectFileUploadCommand) => Promise<DirectFileUpload>;
  readonly multipartUploads: MultipartFileStorage = this;

  constructor(bucket: R2Bucket, options: R2FileStorageOptions = {}) {
    this.bucket = bucket;
    const directUploads = options.directUploads;
    if (directUploads) {
      this.createDirectUpload = (command) => directUploads.createUpload(command);
    }
  }

  async put(command: PutFileObjectCommand): Promise<FileObjectMetadata> {
    const object = await this.bucket.put(command.key, command.body, {
      httpMetadata: {
        contentType: command.contentType,
        contentDisposition: contentDisposition(command.filename)
      },
      customMetadata: command.customMetadata ?? {}
    });
    return metadataFromR2Object(object);
  }

  async head(key: string): Promise<FileObjectMetadata | null> {
    const object = await this.bucket.head(key);
    return object ? metadataFromR2Object(object) : null;
  }

  async get(key: string): Promise<StoredFileObject | null> {
    const object = await this.bucket.get(key);
    if (!object) {
      return null;
    }
    return {
      metadata: metadataFromR2Object(object),
      body: object.body as ReadableStream<Uint8Array>
    };
  }

  async createMultipartUpload(command: CreateMultipartFileUploadCommand): Promise<MultipartFileUpload> {
    const upload = await this.bucket.createMultipartUpload(command.key, {
      httpMetadata: {
        contentType: command.contentType,
        contentDisposition: contentDisposition(command.filename)
      },
      customMetadata: command.customMetadata ?? {}
    });
    return { key: upload.key, uploadId: upload.uploadId };
  }

  async uploadMultipartPart(command: UploadMultipartFilePartCommand): Promise<UploadedMultipartFilePart> {
    ensureMultipartPartNumber(command.partNumber);
    const upload = this.bucket.resumeMultipartUpload(command.key, command.uploadId);
    const part = await r2MultipartOperation(command, "upload part", () =>
      upload.uploadPart(command.partNumber, command.body)
    );
    return { partNumber: part.partNumber, etag: part.etag };
  }

  async completeMultipartUpload(command: CompleteMultipartFileUploadCommand): Promise<FileObjectMetadata> {
    const parts = sortedUploadedMultipartParts(command.parts).map((part) => ({
      partNumber: part.partNumber,
      etag: part.etag
    }));
    const upload = this.bucket.resumeMultipartUpload(command.key, command.uploadId);
    return metadataFromR2Object(await r2MultipartOperation(command, "complete", () => upload.complete(parts)));
  }

  async abortMultipartUpload(command: AbortMultipartFileUploadCommand): Promise<void> {
    await r2MultipartOperation(command, "abort", () =>
      this.bucket.resumeMultipartUpload(command.key, command.uploadId).abort()
    );
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}

async function r2MultipartOperation<T>(
  command: { readonly key: string; readonly uploadId: string },
  action: string,
  operation: () => Promise<T>
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof FrameworkError) {
      throw error;
    }
    if (isMissingMultipartUploadError(error)) {
      throw notFound(`Multipart upload '${command.uploadId}' was not found`);
    }
    throw new FrameworkError(
      "FILE_STORAGE_ERROR",
      `R2 multipart upload ${action} failed for '${command.key}': ${errorMessage(error)}`,
      { status: 502 }
    );
  }
}

function isMissingMultipartUploadError(error: unknown): boolean {
  const text = `${errorName(error)} ${errorMessage(error)}`.toLowerCase();
  return (
    text.includes("not found") ||
    text.includes("does not exist") ||
    text.includes("no such upload") ||
    text.includes("expired") ||
    text.includes("aborted")
  );
}

function errorName(error: unknown): string {
  return typeof error === "object" && error !== null && "name" in error && typeof error.name === "string"
    ? error.name
    : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function metadataFromR2Object(object: R2Object): FileObjectMetadata {
  return {
    key: object.key,
    size: object.size,
    etag: object.etag,
    httpEtag: object.httpEtag,
    uploadedAt: object.uploaded.toISOString(),
    ...(object.httpMetadata?.contentType === undefined ? {} : { contentType: object.httpMetadata.contentType }),
    customMetadata: documentDataFromMetadata(object.customMetadata ?? {})
  };
}

function documentDataFromMetadata(metadata: Readonly<Record<string, string>>): DocumentData {
  return Object.fromEntries(Object.entries(metadata).filter(([, value]) => isJsonValue(value))) as DocumentData;
}

function isJsonValue(value: string): value is string & JsonValue {
  return typeof value === "string";
}

function contentDisposition(filename: string): string {
  const escaped = filename.replace(/["\\]/g, "_");
  return `attachment; filename="${escaped}"`;
}
