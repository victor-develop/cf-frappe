import type { DocumentData } from "../core/types.js";

export const MAX_MULTIPART_FILE_PARTS = 10_000;
export const MIN_MULTIPART_FILE_PART_BYTES = 5 * 1024 * 1024;

export type FileContent = ArrayBuffer | ArrayBufferView | string | Blob;
export type MultipartFilePartContent = FileContent | ReadableStream<Uint8Array>;

export interface PutFileObjectCommand {
  readonly key: string;
  readonly body: FileContent;
  readonly contentType: string;
  readonly filename: string;
  readonly size: number;
  readonly customMetadata?: Readonly<Record<string, string>>;
}

export interface CreateDirectFileUploadCommand {
  readonly key: string;
  readonly contentType: string;
  readonly filename: string;
  readonly size: number;
  readonly expiresAt: string;
  readonly customMetadata?: Readonly<Record<string, string>>;
}

export interface CreateMultipartFileUploadCommand {
  readonly key: string;
  readonly contentType: string;
  readonly filename: string;
  readonly customMetadata?: Readonly<Record<string, string>>;
}

export interface UploadMultipartFilePartCommand {
  readonly key: string;
  readonly uploadId: string;
  readonly partNumber: number;
  readonly body: MultipartFilePartContent;
}

export interface CompleteMultipartFileUploadCommand {
  readonly key: string;
  readonly uploadId: string;
  readonly parts: readonly UploadedMultipartFilePart[];
}

export interface AbortMultipartFileUploadCommand {
  readonly key: string;
  readonly uploadId: string;
}

export interface DirectFileUpload {
  readonly method: "PUT" | "POST";
  readonly key: string;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly expiresAt: string;
}

export interface MultipartFileUpload {
  readonly key: string;
  readonly uploadId: string;
}

export interface UploadedMultipartFilePart {
  readonly partNumber: number;
  readonly etag: string;
}

export interface FileObjectMetadata {
  readonly key: string;
  readonly size: number;
  readonly etag: string;
  readonly httpEtag?: string;
  readonly uploadedAt: string;
  readonly contentType?: string;
  readonly filename?: string;
  readonly customMetadata: DocumentData;
}

export interface StoredFileObject {
  readonly metadata: FileObjectMetadata;
  readonly body: ReadableStream<Uint8Array>;
}

export interface FileStorage {
  put(command: PutFileObjectCommand): Promise<FileObjectMetadata>;
  head(key: string): Promise<FileObjectMetadata | null>;
  get(key: string): Promise<StoredFileObject | null>;
  createDirectUpload?(command: CreateDirectFileUploadCommand): Promise<DirectFileUpload>;
  readonly multipartUploads?: MultipartFileStorage;
  delete(key: string): Promise<void>;
}

export interface MultipartFileStorage {
  createMultipartUpload(command: CreateMultipartFileUploadCommand): Promise<MultipartFileUpload>;
  uploadMultipartPart(command: UploadMultipartFilePartCommand): Promise<UploadedMultipartFilePart>;
  completeMultipartUpload(command: CompleteMultipartFileUploadCommand): Promise<FileObjectMetadata>;
  abortMultipartUpload(command: AbortMultipartFileUploadCommand): Promise<void>;
}

export function isValidMultipartFilePartNumber(partNumber: number): boolean {
  return Number.isInteger(partNumber) && partNumber >= 1 && partNumber <= MAX_MULTIPART_FILE_PARTS;
}
