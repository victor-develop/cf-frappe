import { InMemoryFileStorage, MIN_MULTIPART_FILE_PART_BYTES } from "../../src";

describe("InMemoryFileStorage", () => {
  it("assembles uploaded multipart parts by part number", async () => {
    const storage = new InMemoryFileStorage();
    const firstBody = new Uint8Array(MIN_MULTIPART_FILE_PART_BYTES).fill(97);
    const upload = await storage.multipartUploads.createMultipartUpload({
      key: "acme/files/file_object-video.mp4",
      contentType: "video/mp4",
      filename: "video.mp4",
      customMetadata: { tenantId: "acme", uploadedBy: "owner@example.com" }
    });

    const second = await storage.multipartUploads.uploadMultipartPart({
      key: upload.key,
      uploadId: upload.uploadId,
      partNumber: 2,
      body: "bar"
    });
    const first = await storage.multipartUploads.uploadMultipartPart({
      key: upload.key,
      uploadId: upload.uploadId,
      partNumber: 1,
      body: new Response(firstBody).body as ReadableStream<Uint8Array>
    });

    const metadata = await storage.multipartUploads.completeMultipartUpload({
      key: upload.key,
      uploadId: upload.uploadId,
      parts: [second, first]
    });

    expect(metadata).toMatchObject({
      key: "acme/files/file_object-video.mp4",
      size: MIN_MULTIPART_FILE_PART_BYTES + 3,
      contentType: "video/mp4",
      filename: "video.mp4",
      customMetadata: { tenantId: "acme", uploadedBy: "owner@example.com" }
    });
    const bytes = new Uint8Array(await new Response((await storage.get(upload.key))?.body).arrayBuffer());
    expect(bytes[0]).toBe(97);
    expect(bytes[MIN_MULTIPART_FILE_PART_BYTES - 1]).toBe(97);
    expect(new TextDecoder().decode(bytes.slice(MIN_MULTIPART_FILE_PART_BYTES))).toBe("bar");
    await expect(
      storage.multipartUploads.uploadMultipartPart({
        key: upload.key,
        uploadId: upload.uploadId,
        partNumber: 3,
        body: "baz"
      })
    ).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
  });

  it("rejects invalid multipart part numbers", async () => {
    const storage = new InMemoryFileStorage();
    const upload = await storage.multipartUploads.createMultipartUpload({
      key: "acme/files/file_object-big.bin",
      contentType: "application/octet-stream",
      filename: "big.bin"
    });

    await expect(
      storage.multipartUploads.uploadMultipartPart({
        key: upload.key,
        uploadId: upload.uploadId,
        partNumber: 0,
        body: "bad"
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Multipart upload partNumber must be an integer from 1 to 10000"
    });
    await expect(
      storage.multipartUploads.uploadMultipartPart({
        key: upload.key,
        uploadId: upload.uploadId,
        partNumber: 10001,
        body: "bad"
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Multipart upload partNumber must be an integer from 1 to 10000"
    });
  });

  it("rejects multipart uploads with undersized non-final parts", async () => {
    const storage = new InMemoryFileStorage();
    const upload = await storage.multipartUploads.createMultipartUpload({
      key: "acme/files/file_object-too-small.bin",
      contentType: "application/octet-stream",
      filename: "too-small.bin"
    });
    const first = await storage.multipartUploads.uploadMultipartPart({
      key: upload.key,
      uploadId: upload.uploadId,
      partNumber: 1,
      body: "tiny"
    });
    const second = await storage.multipartUploads.uploadMultipartPart({
      key: upload.key,
      uploadId: upload.uploadId,
      partNumber: 2,
      body: "last"
    });

    await expect(
      storage.multipartUploads.completeMultipartUpload({
        key: upload.key,
        uploadId: upload.uploadId,
        parts: [first, second]
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: `Multipart upload parts before the final part must be at least ${String(MIN_MULTIPART_FILE_PART_BYTES)} bytes`
    });
    await expect(storage.head(upload.key)).resolves.toBeNull();
  });

  it("aborts pending multipart uploads without storing an object", async () => {
    const storage = new InMemoryFileStorage();
    const upload = await storage.multipartUploads.createMultipartUpload({
      key: "acme/files/file_object-cancelled.bin",
      contentType: "application/octet-stream",
      filename: "cancelled.bin"
    });
    const part = await storage.multipartUploads.uploadMultipartPart({
      key: upload.key,
      uploadId: upload.uploadId,
      partNumber: 1,
      body: "bye"
    });

    await storage.multipartUploads.abortMultipartUpload({ key: upload.key, uploadId: upload.uploadId });

    await expect(
      storage.multipartUploads.completeMultipartUpload({
        key: upload.key,
        uploadId: upload.uploadId,
        parts: [part]
      })
    ).rejects.toMatchObject({ code: "DOCUMENT_NOT_FOUND" });
    await expect(storage.head(upload.key)).resolves.toBeNull();
  });
});
