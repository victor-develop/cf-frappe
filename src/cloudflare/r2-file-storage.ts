import type {
  CreateDirectFileUploadCommand,
  DirectFileUpload,
  FileObjectMetadata,
  FileStorage,
  PutFileObjectCommand,
  StoredFileObject
} from "../ports/file-storage.js";
import { badRequest } from "../core/errors.js";
import type { DocumentData, JsonValue } from "../core/types.js";

export interface R2DirectUploadSigner {
  createUpload(command: CreateDirectFileUploadCommand): Promise<DirectFileUpload>;
}

export interface R2FileStorageOptions {
  readonly directUploads?: R2DirectUploadSigner;
}

export class R2FileStorage implements FileStorage {
  private readonly bucket: R2Bucket;
  private readonly directUploads: R2DirectUploadSigner | undefined;

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
