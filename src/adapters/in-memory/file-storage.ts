import type {
  FileContent,
  FileObjectMetadata,
  FileStorage,
  PutFileObjectCommand,
  StoredFileObject
} from "../../ports/file-storage";

interface StoredEntry {
  readonly bytes: Uint8Array;
  readonly metadata: FileObjectMetadata;
}

export class InMemoryFileStorage implements FileStorage {
  private readonly objects = new Map<string, StoredEntry>();

  async put(command: PutFileObjectCommand): Promise<FileObjectMetadata> {
    const bytes = new Uint8Array(await toArrayBuffer(command.body));
    const etag = `"memory-${command.key}-${bytes.byteLength}"`;
    const metadata: FileObjectMetadata = {
      key: command.key,
      size: command.size,
      etag,
      httpEtag: etag,
      uploadedAt: new Date(0).toISOString(),
      contentType: command.contentType,
      filename: command.filename,
      customMetadata: command.customMetadata ?? {}
    };
    this.objects.set(command.key, { bytes, metadata });
    return metadata;
  }

  async get(key: string): Promise<StoredFileObject | null> {
    const entry = this.objects.get(key);
    if (!entry) {
      return null;
    }
    return {
      metadata: entry.metadata,
      body: new Response(entry.bytes.slice().buffer).body as ReadableStream<Uint8Array>
    };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  has(key: string): boolean {
    return this.objects.has(key);
  }
}

async function toArrayBuffer(body: FileContent): Promise<ArrayBuffer> {
  if (typeof body === "string") {
    return viewToArrayBuffer(new TextEncoder().encode(body));
  }
  if (body instanceof Blob) {
    return await body.arrayBuffer();
  }
  if (ArrayBuffer.isView(body)) {
    return viewToArrayBuffer(body);
  }
  return body.slice(0);
}

function viewToArrayBuffer(view: ArrayBufferView): ArrayBuffer {
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
