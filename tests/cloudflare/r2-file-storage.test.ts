import { R2FileStorage } from "../../src/cloudflare";
import { now } from "../helpers";

describe("R2FileStorage", () => {
  it("passes content metadata to R2 and returns object metadata", async () => {
    const calls: unknown[] = [];
    const bucket = fakeBucket({
      async put(key, value, options) {
        calls.push({ key, value, options });
        return fakeObject(key, 5, { contentType: "text/plain" });
      }
    });

    const metadata = await new R2FileStorage(bucket).put({
      key: "acme/files/file_1-hello.txt",
      body: "hello",
      contentType: "text/plain",
      filename: "hello.txt",
      size: 5,
      customMetadata: { tenantId: "acme" }
    });

    expect(calls).toEqual([
      {
        key: "acme/files/file_1-hello.txt",
        value: "hello",
        options: {
          httpMetadata: {
            contentType: "text/plain",
            contentDisposition: 'attachment; filename="hello.txt"'
          },
          customMetadata: { tenantId: "acme" }
        }
      }
    ]);
    expect(metadata).toMatchObject({
      key: "acme/files/file_1-hello.txt",
      size: 5,
      etag: "etag",
      httpEtag: '"etag"',
      uploadedAt: now,
      contentType: "text/plain"
    });
  });

  it("streams R2 object bodies on read", async () => {
    const bucket = fakeBucket({
      async get(key) {
        return fakeObjectBody(key, "hello");
      }
    });

    const object = await new R2FileStorage(bucket).get("acme/files/file_1-hello.txt");

    expect(object?.metadata).toMatchObject({ key: "acme/files/file_1-hello.txt", size: 5 });
    await expect(new Response(object?.body).text()).resolves.toBe("hello");
  });

  it("reads object metadata without downloading bodies", async () => {
    const calls: string[] = [];
    const bucket = fakeBucket({
      async head(key) {
        calls.push(key);
        return fakeObject(key, 10, { contentType: "application/pdf" });
      }
    });

    const metadata = await new R2FileStorage(bucket).head("acme/files/file_1-report.pdf");

    expect(calls).toEqual(["acme/files/file_1-report.pdf"]);
    expect(metadata).toMatchObject({
      key: "acme/files/file_1-report.pdf",
      size: 10,
      contentType: "application/pdf",
      httpEtag: '"etag"'
    });
  });

  it("delegates direct upload signing to an injected R2 signer", async () => {
    const calls: unknown[] = [];
    const bucket = fakeBucket({});
    const storage = new R2FileStorage(bucket, {
      directUploads: {
        async createUpload(command) {
          calls.push(command);
          return {
            method: "PUT",
            key: command.key,
            url: `https://signed.example/${encodeURIComponent(command.key)}`,
            headers: { "content-type": command.contentType },
            expiresAt: command.expiresAt
          };
        }
      }
    });

    const upload = await storage.createDirectUpload({
      key: "acme/files/file_1-browser.pdf",
      contentType: "application/pdf",
      filename: "browser.pdf",
      size: 12,
      expiresAt: "2026-01-01T00:15:00.000Z",
      customMetadata: { tenantId: "acme" }
    });

    expect(calls).toEqual([
      {
        key: "acme/files/file_1-browser.pdf",
        contentType: "application/pdf",
        filename: "browser.pdf",
        size: 12,
        expiresAt: "2026-01-01T00:15:00.000Z",
        customMetadata: { tenantId: "acme" }
      }
    ]);
    expect(upload).toEqual({
      method: "PUT",
      key: "acme/files/file_1-browser.pdf",
      url: "https://signed.example/acme%2Ffiles%2Ffile_1-browser.pdf",
      headers: { "content-type": "application/pdf" },
      expiresAt: "2026-01-01T00:15:00.000Z"
    });
  });

  it("requires an injected signer for direct R2 upload targets", async () => {
    await expect(
      new R2FileStorage(fakeBucket({})).createDirectUpload({
        key: "acme/files/file_1-browser.pdf",
        contentType: "application/pdf",
        filename: "browser.pdf",
        size: 12,
        expiresAt: "2026-01-01T00:15:00.000Z"
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "R2 direct uploads require a direct upload signer"
    });
  });

  it("creates R2 multipart uploads with content metadata", async () => {
    const calls: unknown[] = [];
    const bucket = fakeBucket({
      async createMultipartUpload(key, options) {
        calls.push({ key, options });
        return fakeMultipartUpload(key, "upload-1");
      }
    });

    const upload = await new R2FileStorage(bucket).multipartUploads.createMultipartUpload({
      key: "acme/files/file_1-video.mp4",
      contentType: "video/mp4",
      filename: "video.mp4",
      customMetadata: { tenantId: "acme" }
    });

    expect(calls).toEqual([
      {
        key: "acme/files/file_1-video.mp4",
        options: {
          httpMetadata: {
            contentType: "video/mp4",
            contentDisposition: 'attachment; filename="video.mp4"'
          },
          customMetadata: { tenantId: "acme" }
        }
      }
    ]);
    expect(upload).toEqual({
      key: "acme/files/file_1-video.mp4",
      uploadId: "upload-1"
    });
  });

  it("uploads R2 multipart parts through a resumed upload", async () => {
    const calls: unknown[] = [];
    const bucket = fakeBucket({
      resumeMultipartUpload(key, uploadId) {
        calls.push({ key, uploadId });
        return fakeMultipartUpload(key, uploadId, {
          async uploadPart(partNumber, value) {
            calls.push({ partNumber, value });
            return { partNumber, etag: "part-etag" };
          }
        });
      }
    });

    const stream = new Response("chunk").body as ReadableStream<Uint8Array>;

    const part = await new R2FileStorage(bucket).multipartUploads.uploadMultipartPart({
      key: "acme/files/file_1-video.mp4",
      uploadId: "upload-1",
      partNumber: 2,
      body: stream
    });

    expect(calls).toEqual([
      { key: "acme/files/file_1-video.mp4", uploadId: "upload-1" },
      { partNumber: 2, value: stream }
    ]);
    expect(part).toEqual({ partNumber: 2, etag: "part-etag" });
  });

  it("completes R2 multipart uploads and maps object metadata", async () => {
    const calls: unknown[] = [];
    const bucket = fakeBucket({
      resumeMultipartUpload(key, uploadId) {
        calls.push({ key, uploadId });
        return fakeMultipartUpload(key, uploadId, {
          async complete(parts) {
            calls.push({ parts });
            return fakeObject(key, 10, { contentType: "video/mp4" });
          }
        });
      }
    });

    const metadata = await new R2FileStorage(bucket).multipartUploads.completeMultipartUpload({
      key: "acme/files/file_1-video.mp4",
      uploadId: "upload-1",
      parts: [
        { partNumber: 2, etag: "two" },
        { partNumber: 1, etag: "one" }
      ]
    });

    expect(calls).toEqual([
      { key: "acme/files/file_1-video.mp4", uploadId: "upload-1" },
      {
        parts: [
          { partNumber: 1, etag: "one" },
          { partNumber: 2, etag: "two" }
        ]
      }
    ]);
    expect(metadata).toMatchObject({
      key: "acme/files/file_1-video.mp4",
      size: 10,
      etag: "etag",
      httpEtag: '"etag"',
      contentType: "video/mp4"
    });
  });

  it("aborts R2 multipart uploads through a resumed upload", async () => {
    const calls: unknown[] = [];
    const bucket = fakeBucket({
      resumeMultipartUpload(key, uploadId) {
        calls.push({ key, uploadId });
        return fakeMultipartUpload(key, uploadId, {
          async abort() {
            calls.push({ aborted: true });
          }
        });
      }
    });

    await new R2FileStorage(bucket).multipartUploads.abortMultipartUpload({
      key: "acme/files/file_1-video.mp4",
      uploadId: "upload-1"
    });

    expect(calls).toEqual([
      { key: "acme/files/file_1-video.mp4", uploadId: "upload-1" },
      { aborted: true }
    ]);
  });
});

function fakeBucket(overrides: Partial<R2Bucket>): R2Bucket {
  return {
    async head() {
      return null;
    },
    async get() {
      return null;
    },
    async put() {
      return fakeObject("key", 0);
    },
    async createMultipartUpload() {
      throw new Error("Not implemented");
    },
    resumeMultipartUpload() {
      throw new Error("Not implemented");
    },
    async delete() {},
    async list() {
      return { objects: [], delimitedPrefixes: [], truncated: false };
    },
    ...overrides
  } as R2Bucket;
}

function fakeObject(key: string, size: number, httpMetadata: R2HTTPMetadata = {}): R2Object {
  return {
    key,
    version: "1",
    size,
    etag: "etag",
    httpEtag: '"etag"',
    checksums: { toJSON: () => ({}) },
    uploaded: new Date(now),
    httpMetadata,
    customMetadata: {},
    storageClass: "Standard",
    writeHttpMetadata(headers: Headers) {
      if (httpMetadata.contentType) {
        headers.set("content-type", httpMetadata.contentType);
      }
    }
  } as unknown as R2Object;
}

function fakeObjectBody(key: string, body: string): R2ObjectBody {
  const response = new Response(body);
  return {
    ...fakeObject(key, 5, { contentType: "text/plain" }),
    body: response.body,
    bodyUsed: false,
    arrayBuffer: () => response.clone().arrayBuffer(),
    bytes: async () => new Uint8Array(await response.clone().arrayBuffer()),
    text: () => response.clone().text(),
    json: <T>() => response.clone().json() as Promise<T>,
    blob: () => response.clone().blob()
  } as unknown as R2ObjectBody;
}

function fakeMultipartUpload(
  key: string,
  uploadId: string,
  overrides: Partial<R2MultipartUpload> = {}
): R2MultipartUpload {
  return {
    key,
    uploadId,
    async uploadPart(partNumber) {
      return { partNumber, etag: `etag-${String(partNumber)}` };
    },
    async abort() {},
    async complete() {
      return fakeObject(key, 0);
    },
    ...overrides
  } as R2MultipartUpload;
}
