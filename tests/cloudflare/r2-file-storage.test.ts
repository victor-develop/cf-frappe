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
