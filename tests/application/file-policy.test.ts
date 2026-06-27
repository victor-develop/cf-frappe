import {
  completeFileRendition,
  ensureMultipartCompletionMatchesManifest,
  ensureMultipartPartFitsReservation,
  expectedRenditionContentType,
  failedFileRendition,
  fileContentTypeExtension,
  fileRenditionId,
  fileRenditionFilename,
  fileRenditions,
  fileRenditionView,
  fileTransformOptionsData,
  fileTransformOptionsFromData,
  isPreviewableFileContentType,
  MIN_MULTIPART_FILE_PART_BYTES,
  multipartPartManifest,
  multipartPartSize,
  normalizeContentType,
  normalizeDirectUploadExpiry,
  normalizeFileSize,
  objectKey,
  pendingFileRendition,
  renditionObjectKey,
  renditionSourcesMatch,
  sanitizeFilename,
  upsertFileRenditionManifest,
  upsertMultipartPartManifest
} from "../../src";
import type { DocumentSnapshot, FileRenditionManifestEntry, FileTransformOverlaySource } from "../../src";

describe("file policy", () => {
  it("normalizes content types for comparison", () => {
    expect(normalizeContentType(" Application/PDF ; charset=utf-8 ")).toBe("application/pdf ; charset=utf-8");
    expect(normalizeContentType(undefined)).toBe("");
  });

  it("marks only browser-safe content types as previewable", () => {
    expect(isPreviewableFileContentType("text/plain; charset=utf-8")).toBe(true);
    expect(isPreviewableFileContentType("IMAGE/PNG")).toBe(true);
    expect(isPreviewableFileContentType("image/svg+xml")).toBe(false);
    expect(isPreviewableFileContentType("text/html")).toBe(false);
  });

  it("normalizes declared file sizes", () => {
    expect(normalizeFileSize(0)).toBe(0);
    expect(normalizeFileSize(42)).toBe(42);
    expect(() => normalizeFileSize(-1)).toThrow("size must be a non-negative integer");
    expect(() => normalizeFileSize(1.5)).toThrow("size must be a non-negative integer");
  });

  it("normalizes direct upload expiry windows", () => {
    expect(normalizeDirectUploadExpiry(undefined)).toBe(900);
    expect(normalizeDirectUploadExpiry(60)).toBe(60);
    expect(normalizeDirectUploadExpiry(604800)).toBe(604800);
    expect(() => normalizeDirectUploadExpiry(59)).toThrow("expiresInSeconds must be between 60 and 604800 seconds");
    expect(() => normalizeDirectUploadExpiry(604801)).toThrow("expiresInSeconds must be between 60 and 604800 seconds");
  });

  it("sanitizes filenames without leaking path separators", () => {
    expect(sanitizeFilename(" folder/invoice/final.pdf ")).toBe("folder-invoice-final.pdf");
    expect(sanitizeFilename("a".repeat(300))).toHaveLength(255);
    expect(() => sanitizeFilename("   ")).toThrow("filename is required");
    expect(() => sanitizeFilename("../")).toThrow("filename is invalid");
  });

  it("builds bounded storage object keys", () => {
    expect(objectKey("tenant/acme", "file_1", "invoice.pdf")).toBe("tenant-acme/files/file_1-invoice.pdf");
    expect(objectKey("", "file_1", "invoice.pdf")).toBe("default/files/file_1-invoice.pdf");
    expect(() => objectKey("acme", "file_1", `${"x".repeat(1024)}.pdf`)).toThrow("file key exceeds 1024 bytes");
  });

  it("plans rendition content types and download filenames", () => {
    expect(expectedRenditionContentType(" Image/PNG ", {})).toBe("image/png");
    expect(expectedRenditionContentType("image/png", { format: "jpeg" })).toBe("image/jpeg");
    expect(expectedRenditionContentType("", {})).toBe("application/octet-stream");
    expect(fileContentTypeExtension("image/jpeg")).toBe("jpg");
    expect(fileContentTypeExtension("application/pdf")).toBe("bin");
    expect(fileRenditionFilename("photo", "thumb", "image/webp")).toBe("photo.thumb.webp");
  });

  it("builds bounded rendition object keys", () => {
    expect(renditionObjectKey("tenant/acme", "file name", "thumb", "attempt/1", "image/avif")).toBe(
      "tenant-acme/file-renditions/file-name/thumb-attempt-1.avif"
    );
    expect(renditionObjectKey("", "", "thumb", "", "image/png")).toBe(
      "default/file-renditions/file/thumb-attempt.png"
    );
    expect(() => renditionObjectKey("acme", "file", "x".repeat(1024), "attempt", "image/png")).toThrow(
      "file rendition key exceeds 1024 bytes"
    );
  });

  it("calculates multipart part sizes without consuming stream bodies", () => {
    expect(multipartPartSize("hello", undefined)).toBe(5);
    expect(multipartPartSize(new Uint8Array([1, 2, 3]), undefined)).toBe(3);
    expect(multipartPartSize(new ReadableStream(), 9)).toBe(9);
    expect(() => multipartPartSize(new ReadableStream(), undefined)).toThrow(
      "Multipart upload part size is required for streamed bodies"
    );
  });

  it("reads and upserts multipart manifests deterministically", () => {
    const snapshot = fileSnapshot({
      multipart_parts: [
        { partNumber: 2, etag: "two", size: 2 },
        { partNumber: "bad", etag: "bad", size: 1 },
        null,
        { partNumber: 1, etag: "one", size: 1 }
      ]
    });

    expect(multipartPartManifest(snapshot)).toEqual([
      { partNumber: 2, etag: "two", size: 2 },
      { partNumber: 1, etag: "one", size: 1 }
    ]);
    expect(
      upsertMultipartPartManifest(multipartPartManifest(snapshot), { partNumber: 2, etag: "two-new", size: 4 })
    ).toEqual([
      { partNumber: 1, etag: "one", size: 1 },
      { partNumber: 2, etag: "two-new", size: 4 }
    ]);
  });

  it("rejects multipart parts that exceed the reserved file size", () => {
    const snapshot = fileSnapshot({
      size: 10,
      multipart_parts: [{ partNumber: 1, etag: "one", size: 4 }]
    });

    expect(() => ensureMultipartPartFitsReservation(snapshot, 2, 6)).not.toThrow();
    expect(() => ensureMultipartPartFitsReservation(snapshot, 2, 7)).toThrow(
      "Multipart upload part exceeds reserved file size"
    );
    expect(() => ensureMultipartPartFitsReservation(snapshot, 1, 10)).not.toThrow();
  });

  it("validates multipart completion against recorded manifest parts", () => {
    const snapshot = fileSnapshot({
      size: MIN_MULTIPART_FILE_PART_BYTES + 3,
      multipart_parts: [
        { partNumber: 1, etag: "one", size: MIN_MULTIPART_FILE_PART_BYTES },
        { partNumber: 2, etag: "two", size: 3 }
      ]
    });

    expect(() =>
      ensureMultipartCompletionMatchesManifest(snapshot, [
        { partNumber: 2, etag: "two" },
        { partNumber: 1, etag: "one" }
      ])
    ).not.toThrow();
    expect(() =>
      ensureMultipartCompletionMatchesManifest(snapshot, [
        { partNumber: 1, etag: "one" },
        { partNumber: 2, etag: "wrong" }
      ])
    ).toThrow("Multipart upload part 2 was not uploaded");
    expect(() => ensureMultipartCompletionMatchesManifest({ ...snapshot, data: { ...snapshot.data, size: 1 } }, [
      { partNumber: 1, etag: "one" },
      { partNumber: 2, etag: "two" }
    ])).toThrow("Multipart upload object size mismatch");
  });

  it("rejects multipart completion that violates R2 part-size rules", () => {
    const snapshot = fileSnapshot({
      size: MIN_MULTIPART_FILE_PART_BYTES * 2 + 2,
      multipart_parts: [
        { partNumber: 1, etag: "one", size: MIN_MULTIPART_FILE_PART_BYTES },
        { partNumber: 2, etag: "two", size: MIN_MULTIPART_FILE_PART_BYTES + 1 },
        { partNumber: 3, etag: "three", size: 1 }
      ]
    });

    expect(() =>
      ensureMultipartCompletionMatchesManifest(snapshot, [
        { partNumber: 1, etag: "one" },
        { partNumber: 2, etag: "two" },
        { partNumber: 3, etag: "three" }
      ])
    ).toThrow("Multipart upload parts before the final part must be the same size");
  });

  it("round-trips file transform options through document data", () => {
    const options = {
      width: 128,
      height: 96,
      fit: "cover" as const,
      format: "webp" as const,
      quality: 80,
      watermark: {
        text: "Draft Copy",
        placement: "bottom-right" as const,
        opacity: 0.4,
        color: "#fff",
        fontSize: 16
      },
      overlay: {
        file: "file_overlay",
        placement: "center" as const,
        opacity: 0.8,
        width: 32,
        height: 32
      }
    };

    expect(fileTransformOptionsFromData(fileTransformOptionsData(options))).toEqual(options);
  });

  it("reads rendition manifests and projects browser-safe views", () => {
    const entry = renditionEntry("thumb", {
      status: "available",
      options: { width: 64, watermark: { text: "Review" } },
      source_etag: "source-1",
      overlay_file: "file_overlay",
      overlay_key: "acme/files/file_overlay-badge.png",
      overlay_etag: "overlay-1",
      overlay_http_etag: '"overlay-http"',
      content_type: "image/webp",
      size: 42,
      etag: "rendition-1",
      http_etag: '"rendition-http"',
      generated_at: "2026-06-28T01:00:00.000Z",
      generated_by: "owner@example.com"
    });
    const snapshot = fileSnapshot({
      renditions: [
        entry,
        { id: "bad", key: "bad", status: "available", options: [], requested_at: "now", requested_by: "owner" },
        { ...entry, id: "negative-size", size: -1 }
      ]
    });

    expect(fileRenditions(snapshot)).toEqual([entry]);
    expect(fileRenditionView(entry)).toEqual({
      id: "thumb",
      key: "acme/file-renditions/file/thumb.webp",
      status: "available",
      options: { width: 64, watermark: { text: "Review" } },
      requestedAt: "2026-06-28T00:00:00.000Z",
      requestedBy: "owner@example.com",
      sourceEtag: "source-1",
      overlayFile: "file_overlay",
      overlayKey: "acme/files/file_overlay-badge.png",
      overlayEtag: "overlay-1",
      overlayHttpEtag: '"overlay-http"',
      contentType: "image/webp",
      size: 42,
      etag: "rendition-1",
      httpEtag: '"rendition-http"',
      generatedAt: "2026-06-28T01:00:00.000Z",
      generatedBy: "owner@example.com"
    });
  });

  it("plans pending, failed, and completed file renditions", () => {
    const pending = pendingFileRendition({
      snapshot: fileSnapshot({ content_type: "image/png" }),
      tenantId: "acme",
      id: "w64-f-webp",
      attemptId: "attempt/1",
      sourceEtag: "source-1",
      overlay: overlaySource({ etag: "overlay-1", httpEtag: '"overlay-http"' }),
      options: { width: 64, format: "webp" },
      requestedAt: "2026-06-28T00:00:00.000Z",
      requestedBy: "owner@example.com"
    });

    expect(pending).toMatchObject({
      id: "w64-f-webp",
      key: "acme/file-renditions/file_multipart/w64-f-webp-attempt-1.webp",
      status: "pending",
      options: { width: 64, format: "webp" },
      source_etag: "source-1",
      overlay_file: "file_overlay",
      overlay_key: "acme/files/file_overlay-badge.png",
      overlay_etag: "overlay-1",
      overlay_http_etag: '"overlay-http"'
    });
    expect(failedFileRendition({ pending, message: "x".repeat(600) })).toMatchObject({
      status: "failed",
      failure_message: "x".repeat(500)
    });
    expect(
      completeFileRendition({
        pending,
        object: {
          key: pending.key,
          size: 99,
          etag: "object-1",
          httpEtag: '"object-http"',
          uploadedAt: "2026-06-28T01:00:00.000Z",
          contentType: "image/webp",
          customMetadata: {}
        },
        generatedAt: "2026-06-28T01:00:00.000Z",
        generatedBy: "owner@example.com"
      })
    ).toMatchObject({
      status: "available",
      content_type: "image/webp",
      size: 99,
      etag: "object-1",
      http_etag: '"object-http"',
      generated_at: "2026-06-28T01:00:00.000Z",
      generated_by: "owner@example.com"
    });
  });

  it("matches rendition source and overlay identity", () => {
    const pending = pendingFileRendition({
      snapshot: fileSnapshot({ content_type: "image/png" }),
      tenantId: "acme",
      id: "w64",
      attemptId: "attempt",
      sourceEtag: "source-1",
      overlay: overlaySource({ key: "overlay-key", etag: "overlay-1" }),
      options: { width: 64 },
      requestedAt: "2026-06-28T00:00:00.000Z",
      requestedBy: "owner@example.com"
    });

    expect(renditionSourcesMatch(pending, "source-1", overlaySource({ key: "overlay-key", etag: "overlay-1" }))).toBe(true);
    expect(renditionSourcesMatch(pending, "source-2", overlaySource({ key: "overlay-key", etag: "overlay-1" }))).toBe(false);
    expect(renditionSourcesMatch(pending, "source-1", undefined)).toBe(false);
    expect(renditionSourcesMatch(renditionEntry("plain", { source_etag: "source-1" }), "source-1", undefined)).toBe(true);
  });

  it("builds deterministic rendition ids and caps unique rendition manifests", async () => {
    await expect(fileRenditionId({ width: 64, format: "webp" })).resolves.toBe("w64-f-webp");
    await expect(fileRenditionId({ watermark: { text: "Draft Copy" } })).resolves.toMatch(
      /^wm-draft-copy-[0-9a-f]{64}$/
    );

    expect(upsertFileRenditionManifest([renditionEntry("b"), renditionEntry("a")], renditionEntry("c")).map((entry) => entry.id))
      .toEqual(["a", "b", "c"]);
    expect(upsertFileRenditionManifest([renditionEntry("a")], renditionEntry("a", { status: "failed" }))).toEqual([
      renditionEntry("a", { status: "failed" })
    ]);
    expect(() =>
      upsertFileRenditionManifest(
        Array.from({ length: 32 }, (_, index) => renditionEntry(`r${String(index).padStart(2, "0")}`)),
        renditionEntry("overflow")
      )
    ).toThrow("At most 32 renditions can be stored per file");
  });
});

function fileSnapshot(data: DocumentSnapshot["data"]): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "File",
    name: "file_multipart",
    version: 1,
    docstatus: "draft",
    data,
    createdAt: "2026-06-28T00:00:00.000Z",
    updatedAt: "2026-06-28T00:00:00.000Z"
  };
}

function renditionEntry(
  id: string,
  overrides: Partial<FileRenditionManifestEntry> = {}
): FileRenditionManifestEntry {
  return {
    id,
    key: `acme/file-renditions/file/${id}.webp`,
    status: "pending",
    options: {},
    requested_at: "2026-06-28T00:00:00.000Z",
    requested_by: "owner@example.com",
    ...overrides
  };
}

function overlaySource(overrides: Partial<FileTransformOverlaySource> = {}): FileTransformOverlaySource {
  return {
    file: "file_overlay",
    key: "acme/files/file_overlay-badge.png",
    filename: "badge.png",
    contentType: "image/png",
    size: 10,
    body: new ReadableStream(),
    ...overrides
  };
}
