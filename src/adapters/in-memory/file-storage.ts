import {
  type AbortMultipartFileUploadCommand,
  type CompleteMultipartFileUploadCommand,
  type CreateDirectFileUploadCommand,
  type CreateMultipartFileUploadCommand,
  type DirectFileUpload,
  type FileContent,
  type FileObjectMetadata,
  type FileStorage,
  type MultipartFilePartContent,
  type MultipartFileStorage,
  type MultipartFileUpload,
  type PutFileObjectCommand,
  type StoredFileObject,
  type UploadMultipartFilePartCommand,
  type UploadedMultipartFilePart
} from "../../ports/file-storage.js";
import {
  ensureMultipartPartNumber,
  ensureR2CompatibleMultipartPartSizes,
  sortedUploadedMultipartParts
} from "../../ports/multipart-file-storage.js";
import { badRequest, notFound } from "../../core/errors.js";
import { cloneJsonValue, isJsonValue } from "../../core/json.js";
import type { DocumentData } from "../../core/types.js";

interface StoredEntry {
  readonly bytes: Uint8Array;
  readonly metadata: FileObjectMetadata;
}

interface MultipartEntry {
  readonly key: string;
  readonly contentType: string;
  readonly filename: string;
  readonly customMetadata: DocumentData;
  readonly parts: Map<number, { readonly bytes: Uint8Array; readonly etag: string }>;
}

export class InMemoryFileStorage implements FileStorage {
  private readonly objects = new Map<string, StoredEntry>();
  private readonly multipartUploadEntries = new Map<string, MultipartEntry>();
  readonly multipartUploads: MultipartFileStorage = this;
  private nextMultipartUploadSequence = 1;

  async put(command: PutFileObjectCommand): Promise<FileObjectMetadata> {
    const bytes = new Uint8Array(await toArrayBuffer(command.body));
    const size = command.size ?? bytes.byteLength;
    const etag = `"memory-${command.key}-${bytes.byteLength}"`;
    const metadata: FileObjectMetadata = {
      key: command.key,
      size,
      etag,
      httpEtag: etag,
      uploadedAt: new Date(0).toISOString(),
      contentType: command.contentType,
      filename: command.filename,
      customMetadata: cloneCustomMetadata(command.customMetadata ?? {})
    };
    this.objects.set(command.key, { bytes, metadata: cloneFileObjectMetadata(metadata) });
    return cloneFileObjectMetadata(metadata);
  }

  async head(key: string): Promise<FileObjectMetadata | null> {
    const metadata = this.objects.get(key)?.metadata;
    return metadata ? cloneFileObjectMetadata(metadata) : null;
  }

  async get(key: string): Promise<StoredFileObject | null> {
    const entry = this.objects.get(key);
    if (!entry) {
      return null;
    }
    return {
      metadata: cloneFileObjectMetadata(entry.metadata),
      body: new Response(entry.bytes.slice().buffer).body as ReadableStream<Uint8Array>
    };
  }

  async createDirectUpload(command: CreateDirectFileUploadCommand): Promise<DirectFileUpload> {
    return {
      method: "PUT",
      key: command.key,
      url: `memory://file-storage/${encodeURIComponent(command.key)}`,
      headers: {
        "content-type": command.contentType,
        "content-length": String(command.size)
      },
      expiresAt: command.expiresAt
    };
  }

  async createMultipartUpload(command: CreateMultipartFileUploadCommand): Promise<MultipartFileUpload> {
    const uploadId = `memory-multipart-${String(this.nextMultipartUploadSequence)}`;
    this.nextMultipartUploadSequence += 1;
    this.multipartUploadEntries.set(uploadId, {
      key: command.key,
      contentType: command.contentType,
      filename: command.filename,
      customMetadata: cloneCustomMetadata(command.customMetadata ?? {}),
      parts: new Map()
    });
    return { key: command.key, uploadId };
  }

  async uploadMultipartPart(command: UploadMultipartFilePartCommand): Promise<UploadedMultipartFilePart> {
    ensureMultipartPartNumber(command.partNumber);
    const upload = this.multipartUpload(command.key, command.uploadId);
    const bytes = new Uint8Array(await toArrayBuffer(command.body));
    const etag = `"memory-${command.uploadId}-part-${command.partNumber}-${bytes.byteLength}-${checksum(bytes)}"`;
    upload.parts.set(command.partNumber, { bytes, etag });
    return { partNumber: command.partNumber, etag };
  }

  async completeMultipartUpload(command: CompleteMultipartFileUploadCommand): Promise<FileObjectMetadata> {
    const upload = this.multipartUpload(command.key, command.uploadId);
    const ordered = sortedUploadedMultipartParts(command.parts);
    const chunks = ordered.map((part) => {
      const stored = upload.parts.get(part.partNumber);
      if (!stored || stored.etag !== part.etag) {
        throw notFound(`Multipart upload part ${String(part.partNumber)} was not found`);
      }
      return stored.bytes;
    });
    ensureR2CompatibleMultipartPartSizes(chunks.map((chunk) => chunk.byteLength));
    const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const etag = `"memory-${command.key}-multipart-${size}"`;
    const metadata: FileObjectMetadata = {
      key: command.key,
      size,
      etag,
      httpEtag: etag,
      uploadedAt: new Date(0).toISOString(),
      contentType: upload.contentType,
      filename: upload.filename,
      customMetadata: cloneCustomMetadata(upload.customMetadata)
    };
    this.objects.set(command.key, { bytes, metadata: cloneFileObjectMetadata(metadata) });
    this.multipartUploadEntries.delete(command.uploadId);
    return cloneFileObjectMetadata(metadata);
  }

  async abortMultipartUpload(command: AbortMultipartFileUploadCommand): Promise<void> {
    this.multipartUpload(command.key, command.uploadId);
    this.multipartUploadEntries.delete(command.uploadId);
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }

  private multipartUpload(key: string, uploadId: string): MultipartEntry {
    const upload = this.multipartUploadEntries.get(uploadId);
    if (!upload || upload.key !== key) {
      throw notFound(`Multipart upload '${uploadId}' was not found`);
    }
    return upload;
  }
}

function cloneFileObjectMetadata(metadata: FileObjectMetadata): FileObjectMetadata {
  return {
    ...metadata,
    customMetadata: cloneCustomMetadata(metadata.customMetadata)
  };
}

function cloneCustomMetadata(metadata: DocumentData | Readonly<Record<string, string>>): DocumentData {
  if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata) || !isJsonValue(metadata)) {
    throw badRequest("File object customMetadata must be a JSON object");
  }
  return cloneJsonValue(metadata) as DocumentData;
}

async function toArrayBuffer(body: FileContent | MultipartFilePartContent): Promise<ArrayBuffer> {
  if (typeof body === "string") {
    return viewToArrayBuffer(new TextEncoder().encode(body));
  }
  if (body instanceof Blob) {
    return await body.arrayBuffer();
  }
  if (body instanceof ReadableStream) {
    return await streamToArrayBuffer(body);
  }
  if (ArrayBuffer.isView(body)) {
    return viewToArrayBuffer(body);
  }
  return body.slice(0);
}

async function streamToArrayBuffer(stream: ReadableStream<Uint8Array>): Promise<ArrayBuffer> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    chunks.push(result.value);
    size += result.value.byteLength;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

function viewToArrayBuffer(view: ArrayBufferView): ArrayBuffer {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function checksum(bytes: Uint8Array): string {
  return bytes.reduce((value, byte) => (value + byte) % 65_535, 0).toString(16);
}
