import type { DocumentData } from "../core/types.js";

export type FileContent = ArrayBuffer | ArrayBufferView | string | Blob;

export interface PutFileObjectCommand {
  readonly key: string;
  readonly body: FileContent;
  readonly contentType: string;
  readonly filename: string;
  readonly size: number;
  readonly customMetadata?: Readonly<Record<string, string>>;
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
  get(key: string): Promise<StoredFileObject | null>;
  delete(key: string): Promise<void>;
}
