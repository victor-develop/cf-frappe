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
import { badRequest } from "../core/errors.js";
import type { DocumentData, JsonValue } from "../core/types.js";
import { ensureMultipartPartNumber, sortedUploadedMultipartParts } from "../adapters/multipart-file-storage.js";

export interface R2DirectUploadSigner {
  createUpload(command: CreateDirectFileUploadCommand): Promise<DirectFileUpload>;
}

export interface R2FileStorageOptions {
  readonly directUploads?: R2DirectUploadSigner;
}

export class R2FileStorage implements FileStorage {
  private readonly bucket: R2Bucket;
  private readonly directUploads: R2DirectUploadSigner | undefined;
  readonly multipartUploads: MultipartFileStorage = this;

  constructor(bucket: R2Bucket, options: R2FileStorageOptions = {}) {
    this.bucket = bucket;
    this.directUploads = options.directUploads;
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

  async createDirectUpload(command: CreateDirectFileUploadCommand): Promise<DirectFileUpload> {
    if (!this.directUploads) {
      throw badRequest("R2 direct uploads require a direct upload signer");
    }
    return await this.directUploads.createUpload(command);
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
    const part = await upload.uploadPart(command.partNumber, command.body);
    return { partNumber: part.partNumber, etag: part.etag };
  }

  async completeMultipartUpload(command: CompleteMultipartFileUploadCommand): Promise<FileObjectMetadata> {
    const parts = sortedUploadedMultipartParts(command.parts).map((part) => ({
      partNumber: part.partNumber,
      etag: part.etag
    }));
    const upload = this.bucket.resumeMultipartUpload(command.key, command.uploadId);
    return metadataFromR2Object(await upload.complete(parts));
  }

  async abortMultipartUpload(command: AbortMultipartFileUploadCommand): Promise<void> {
    await this.bucket.resumeMultipartUpload(command.key, command.uploadId).abort();
  }

  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
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
