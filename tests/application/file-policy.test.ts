import {
  availableFileRenditionForSource,
  availableFileRenditionForDownload,
  canUploadFile,
  completeFileRendition,
  ensureFileContentTypeTransformable,
  ensureFileObjectTransformable,
  ensureFileSizeWithinLimit,
  ensureNoPendingFileRenditionForSource,
  ensureValidFileScanResult,
  ensureFileAvailableForDownload,
  ensureFileCreateAllowed,
  ensureFileDeleteAllowed,
  ensureFileDeleteExpectedVersion,
  ensureFileExpectedVersion,
  ensureFileMetadataUpdateAllowed,
  ensureFileMultipartUploadAllowed,
  ensureFilePendingDirectUpload,
  ensureFilePendingMultipartCompletion,
  ensureFilePendingMultipartPartUpload,
  ensureFilePendingMultipartUpload,
  ensureFileMetadataPatchProvided,
  ensureFileRenditionGenerationAllowed,
  ensureDirectUploadMatches,
  ensureMultipartCompletionMatchesManifest,
  ensureMultipartPartFitsReservation,
  expectedRenditionContentType,
  failedFileRendition,
  failedFileRenditionForError,
  fileAttachedToCommandOption,
  fileBulkDeleteFailure,
  fileBulkFailure,
  fileBufferedUploadDocumentCreateCommand,
  fileBufferedUploadDocumentData,
  fileBufferedUploadPutObjectCommand,
  fileCommandMetadata,
  fileCommandTenantId,
  fileContentLength,
  fileContentTypeExtension,
  fileDashboardEntry,
  fileDashboardEntryWithPermissions,
  fileDashboardListFilters,
  fileDeleteRequestedDocumentCommand,
  fileDocumentData,
  fileMetadataPatch,
  fileMetadataUpdateDocumentCommand,
  fileMultipartAbortCommand,
  fileMultipartCompletionStartedDocumentCommand,
  fileMultipartCompletionStartedPatch,
  fileMultipartCompletionCommand,
  fileMultipartPartRecordedDocumentCommand,
  fileMultipartPartUploadCommand,
  fileMultipartUploadDocumentData,
  fileMultipartUploadAbortCommand,
  fileMultipartUploadId,
  fileObjectKeysForDelete,
  fileObjectKeysForScanFailureCleanup,
  fileObjectContentType,
  fileObjectSourceEtag,
  filePendingUploadDocumentData,
  filePrimaryObjectKey,
  fileDirectUploadReservationCommand,
  fileSnapshotFilename,
  fileRenditionGenerationReservation,
  fileRenditionObjectCustomMetadata,
  fileRenditionId,
  fileRenditionFilename,
  fileRenditionManifestPatch,
  fileRenditionManifestDocumentCommand,
  fileRenditionPutObjectCommand,
  fileRenditionSnapshotPutObjectCommand,
  fileRenditionSnapshotManifestPatch,
  fileRenditions,
  fileRenditionView,
  fileScanFailureError,
  fileScanPatch,
  fileScanTarget,
  fileSnapshotStringData,
  fileExpectedVersionCommandOption,
  fileIsPrivateCommandOption,
  fileUploadCompletionDocumentCommand,
  fileUploadCompletedPatch,
  fileUploadCompletedDocumentData,
  fileUploadContentType,
  fileUploadExpiresAt,
  fileUploadIsPrivate,
  fileUploadObjectCustomMetadata,
  fileMultipartUploadReservationCommand,
  fileUploadScanFailedDocumentData,
  fileUploadScanFailedPatch,
  fileTenantCommandOption,
  fileTransformOverlayCommandOption,
  fileTransformObjectCommand,
  fileTransformOverlaySource,
  fileTransformOptionsData,
  fileTransformOptionsFromData,
  fileTransformSource,
  isFileDeleteRequested,
  isFileMultipartCompletionStarted,
  isFileScanFailed,
  isFileUploadPending,
  isInfectedFileScanResult,
  isPreviewableFileContentType,
  MIN_MULTIPART_FILE_PART_BYTES,
  multipartPartManifest,
  multipartPartManifestPatch,
  multipartPartSize,
  normalizeBulkFileSelections,
  normalizeContentType,
  normalizeDirectUploadExpiry,
  normalizeFileDashboardFilters,
  normalizeFileDashboardLimit,
  normalizeFileSize,
  objectKey,
  optionalFileScanPatch,
  pendingFileRendition,
  requireDirectFileUploadCreator,
  requireFileObjectMetadata,
  requireFileSnapshotString,
  requireFileTransformer,
  requireMultipartFileUploads,
  requireStoredFileObject,
  requireStoredFileRenditionObject,
  renditionObjectKey,
  renditionSourcesMatch,
  reusableFileRenditionForGeneration,
  sanitizeFilename,
  shouldRequestFileDelete,
  shouldStartFileMultipartCompletion,
  upsertFileRenditionManifest,
  upsertMultipartPartManifest,
  FrameworkError
} from "../../src";
import type {
  DocTypeDefinition,
  DocumentSnapshot,
  FileStorage,
  FileObjectMetadata,
  FileRenditionManifestEntry,
  FileTransformer,
  FileTransformOverlaySource,
  StoredFileObject
} from "../../src";

describe("file policy", () => {
  it("normalizes content types for comparison", () => {
    expect(normalizeContentType(" Application/PDF ; charset=utf-8 ")).toBe("application/pdf ; charset=utf-8");
    expect(normalizeContentType(undefined)).toBe("");
  });

  it("normalizes file command tenant and upload defaults", () => {
    expect(fileCommandTenantId({ tenantId: "actor-tenant" }, "explicit-tenant")).toBe("explicit-tenant");
    expect(fileCommandTenantId({ tenantId: "actor-tenant" }, undefined)).toBe("actor-tenant");
    expect(fileCommandTenantId({}, undefined)).toBe("default");
    expect(fileUploadContentType("image/png")).toBe("image/png");
    expect(fileUploadContentType(undefined)).toBe("application/octet-stream");
    expect(fileUploadIsPrivate(false)).toBe(false);
    expect(fileUploadIsPrivate(undefined)).toBe(true);
  });

  it("shapes optional file document command options", () => {
    const metadata = { source: "unit" };

    expect(fileTenantCommandOption("explicit-tenant")).toEqual({ tenantId: "explicit-tenant" });
    expect(fileTenantCommandOption(undefined)).toEqual({});
    expect(fileExpectedVersionCommandOption(2)).toEqual({ expectedVersion: 2 });
    expect(fileExpectedVersionCommandOption(undefined)).toEqual({});
    expect(fileCommandMetadata(metadata)).toBe(metadata);
    expect(fileCommandMetadata(undefined)).toEqual({});
  });

  it("shapes optional file attachment command options", () => {
    const attachedTo = { doctype: "Invoice", name: "INV-1" };

    expect(fileAttachedToCommandOption(attachedTo)).toEqual({ attachedTo });
    expect(fileAttachedToCommandOption(null)).toEqual({ attachedTo: null });
    expect(fileAttachedToCommandOption(undefined)).toEqual({});
  });

  it("shapes optional file privacy and transform overlay command options", () => {
    const overlay = overlaySource();

    expect(fileIsPrivateCommandOption(false)).toEqual({ isPrivate: false });
    expect(fileIsPrivateCommandOption(undefined)).toEqual({});
    expect(fileTransformOverlayCommandOption(overlay)).toEqual({ overlay });
    expect(fileTransformOverlayCommandOption(undefined)).toEqual({});
  });

  it("marks only browser-safe content types as previewable", () => {
    expect(isPreviewableFileContentType("text/plain; charset=utf-8")).toBe(true);
    expect(isPreviewableFileContentType("IMAGE/PNG")).toBe(true);
    expect(isPreviewableFileContentType("image/svg+xml")).toBe(false);
    expect(isPreviewableFileContentType("text/html")).toBe(false);
  });

  it("rejects non-transformable file content types", () => {
    expect(() => ensureFileContentTypeTransformable("image/png", "File 'file_image'")).not.toThrow();
    expect(() => ensureFileContentTypeTransformable("text/plain", "File 'file_text'")).toThrow(
      "File 'file_text' cannot be transformed"
    );
  });

  it("requires configured file transformers", () => {
    const transformer: FileTransformer = {
      async transform() {
        return {
          body: new ReadableStream<Uint8Array>(),
          contentType: "image/webp"
        };
      }
    };

    expect(requireFileTransformer(transformer)).toBe(transformer);
    expect(() => requireFileTransformer(undefined)).toThrow("File transforms are not configured");
  });

  it("requires configured direct and multipart upload storage capabilities", () => {
    const createDirectUpload: NonNullable<FileStorage["createDirectUpload"]> = async (command) => ({
      method: "PUT",
      key: command.key,
      url: `https://uploads.example/${command.key}`,
      headers: {},
      expiresAt: command.expiresAt
    });
    const multipartUploads: NonNullable<FileStorage["multipartUploads"]> = {
      async createMultipartUpload(command) {
        return { key: command.key, uploadId: "upload-1" };
      },
      async uploadMultipartPart(command) {
        return { partNumber: command.partNumber, etag: "etag-1" };
      },
      async completeMultipartUpload(command) {
        return {
          key: command.key,
          size: 1,
          etag: "etag-final",
          uploadedAt: "2026-06-28T00:00:00.000Z",
          customMetadata: {}
        };
      },
      async abortMultipartUpload() {}
    };

    expect(requireDirectFileUploadCreator(createDirectUpload)).toBe(createDirectUpload);
    expect(requireMultipartFileUploads(multipartUploads)).toBe(multipartUploads);
    expect(() => requireDirectFileUploadCreator(undefined)).toThrow(
      "Direct uploads are not supported by this file storage"
    );
    expect(() => requireMultipartFileUploads(undefined)).toThrow(
      "Multipart uploads are not supported by this file storage"
    );
  });

  it("requires stored file objects with stable not-found messages", () => {
    const metadata = fileObject({ key: "acme/files/file_invoice-invoice.pdf" });
    const object = storedFileObject(metadata);

    expect(requireFileObjectMetadata(metadata, "File", "file_invoice")).toBe(metadata);
    expect(requireStoredFileObject(object, "File", "file_invoice")).toBe(object);
    expect(requireStoredFileRenditionObject(object, "File", "file_invoice", "thumb")).toBe(object);
    expect(() => requireFileObjectMetadata(null, "File", "file_invoice")).toThrow(
      "File/file_invoice content was not found"
    );
    expect(() => requireStoredFileObject(undefined, "File", "file_invoice")).toThrow(
      "File/file_invoice content was not found"
    );
    expect(() => requireStoredFileRenditionObject(null, "File", "file_invoice", "thumb")).toThrow(
      "File/file_invoice rendition 'thumb' content was not found"
    );
  });

  it("reads file object content types from object metadata before snapshots", () => {
    const snapshot = fileSnapshot({ content_type: "image/png" });
    expect(fileObjectContentType(snapshot, fileObject({ contentType: "image/webp" }))).toBe("image/webp");
    const { contentType: _contentType, ...withoutContentType } = fileObject({});
    expect(fileObjectContentType(snapshot, withoutContentType)).toBe("image/png");
  });

  it("selects file object source etags and transformability", () => {
    const snapshot = fileSnapshot({ content_type: "image/png" });
    expect(fileObjectSourceEtag(fileObject({ etag: "object-etag", httpEtag: '"http-etag"' }))).toBe('"http-etag"');
    expect(fileObjectSourceEtag(fileObject({ etag: "object-etag" }))).toBe("object-etag");
    expect(() => ensureFileObjectTransformable(snapshot, fileObject({ contentType: "image/jpeg" }), "File 'image'")).not.toThrow();
    expect(() => ensureFileObjectTransformable(snapshot, fileObject({ contentType: "text/plain" }), "File 'text'")).toThrow(
      "File 'text' cannot be transformed"
    );
  });

  it("normalizes declared file sizes", () => {
    expect(normalizeFileSize(0)).toBe(0);
    expect(normalizeFileSize(42)).toBe(42);
    expect(() => normalizeFileSize(-1)).toThrow("size must be a non-negative integer");
    expect(() => normalizeFileSize(1.5)).toThrow("size must be a non-negative integer");
  });

  it("rejects files above configured upload byte limits", () => {
    expect(() => ensureFileSizeWithinLimit(4, 4)).not.toThrow();
    expect(() => ensureFileSizeWithinLimit(5, 4)).toThrow("File exceeds 4 bytes");
  });

  it("plans direct upload expiry windows", () => {
    expect(normalizeDirectUploadExpiry(undefined)).toBe(900);
    expect(normalizeDirectUploadExpiry(60)).toBe(60);
    expect(normalizeDirectUploadExpiry(604800)).toBe(604800);
    expect(() => normalizeDirectUploadExpiry(59)).toThrow("expiresInSeconds must be between 60 and 604800 seconds");
    expect(() => normalizeDirectUploadExpiry(604801)).toThrow("expiresInSeconds must be between 60 and 604800 seconds");
    expect(fileUploadExpiresAt("2026-06-28T00:00:00.000Z", 60)).toBe("2026-06-28T00:01:00.000Z");
    expect(fileUploadExpiresAt("2026-06-28T00:00:00.000Z", undefined)).toBe("2026-06-28T00:15:00.000Z");
    expect(() => fileUploadExpiresAt("not-a-date", 60)).toThrow("clock returned an invalid timestamp");
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

  it("calculates buffered file content lengths", () => {
    expect(fileContentLength("你好")).toBe(6);
    expect(fileContentLength(new Uint8Array([1, 2, 3]))).toBe(3);
    expect(fileContentLength(new ArrayBuffer(4))).toBe(4);
    expect(fileContentLength(new Blob(["hello"]))).toBe(5);
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

  it("builds multipart part manifest document patches", () => {
    expect(multipartPartManifestPatch([
      { partNumber: 2, etag: "two", size: 2 }
    ], { partNumber: 1, etag: "one", size: 1 })).toEqual({
      multipart_parts: [
        { partNumber: 1, etag: "one", size: 1 },
        { partNumber: 2, etag: "two", size: 2 }
      ]
    });
    expect(multipartPartManifestPatch([
      { partNumber: 1, etag: "one", size: 1 }
    ], { partNumber: 1, etag: "one-new", size: 3 })).toEqual({
      multipart_parts: [{ partNumber: 1, etag: "one-new", size: 3 }]
    });
  });

  it("builds multipart part record document command intents", () => {
    const snapshot = fileSnapshot({
      multipart_parts: [{ partNumber: 1, etag: "one", size: 5 }]
    });

    expect(fileMultipartPartRecordedDocumentCommand({
      snapshot,
      part: { partNumber: 2, etag: "two" },
      size: 7
    })).toEqual({
      command: "recordMultipartPart",
      input: {
        multipart_parts: [
          { partNumber: 1, etag: "one", size: 5 },
          { partNumber: 2, etag: "two", size: 7 }
        ]
      },
      expectedVersion: 1
    });
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

  it("builds file transform sources from stored objects", () => {
    const body = new ReadableStream<Uint8Array>();
    const { contentType: _contentType, ...metadataWithoutContentType } = fileObject({
      key: "acme/files/file_photo-photo.png",
      httpEtag: '"object-http"'
    });
    const source = fileTransformSource(fileSnapshot({
      filename: "photo.png",
      content_type: "image/png"
    }), {
      body,
      metadata: metadataWithoutContentType
    });

    expect(source).toEqual({
      key: "acme/files/file_photo-photo.png",
      filename: "photo.png",
      contentType: "image/png",
      size: 12,
      body,
      etag: "object-1",
      httpEtag: '"object-http"'
    });
  });

  it("builds file transformer port commands", () => {
    const body = new ReadableStream<Uint8Array>();
    const overlay = overlaySource({ placement: "top-left", opacity: 50 });
    const object = storedFileObject(fileObject({
      key: "acme/files/file_photo-photo.png",
      contentType: "image/png",
      filename: "photo.png",
      size: 42,
      httpEtag: '"object-http"'
    }));
    const options = { width: 128, format: "webp" as const };

    expect(fileTransformObjectCommand({
      actorId: "owner@example.com",
      tenantId: "acme",
      snapshot: fileSnapshot({
        filename: "photo.png",
        content_type: "image/png"
      }),
      object: { ...object, body },
      options,
      overlay
    })).toEqual({
      actorId: "owner@example.com",
      tenantId: "acme",
      source: {
        key: "acme/files/file_photo-photo.png",
        filename: "photo.png",
        contentType: "image/png",
        size: 42,
        body,
        etag: "object-1",
        httpEtag: '"object-http"'
      },
      options,
      overlay
    });
  });

  it("builds transform overlay sources with transformability guards", () => {
    const body = new ReadableStream<Uint8Array>();
    const snapshot = fileSnapshot({
      filename: "badge.png",
      content_type: "image/png"
    });
    const object: StoredFileObject = {
      body,
      metadata: fileObject({
        key: "acme/files/file_badge-badge.png",
        contentType: "image/webp"
      })
    };

    expect(fileTransformOverlaySource(snapshot, object, {
      file: "file_badge",
      placement: "bottom-right",
      opacity: 0.5,
      width: 32
    })).toEqual({
      file: "file_badge",
      key: "acme/files/file_badge-badge.png",
      filename: "badge.png",
      contentType: "image/webp",
      size: 12,
      body,
      etag: "object-1",
      placement: "bottom-right",
      opacity: 0.5,
      width: 32
    });
    expect(() =>
      fileTransformOverlaySource(snapshot, {
        body,
        metadata: fileObject({ contentType: "text/plain" })
      }, { file: "file_badge" })
    ).toThrow("File overlay 'file_badge' cannot be transformed");
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

  it("selects available file renditions for downloads", () => {
    const available = renditionEntry("thumb", { status: "available" });
    const snapshot = fileSnapshot({
      renditions: [
        renditionEntry("thumb-pending", { status: "pending" }),
        available
      ]
    });

    expect(availableFileRenditionForDownload(snapshot, "thumb")).toBe(available);
    expect(() => availableFileRenditionForDownload(snapshot, "thumb-pending")).toThrow(
      "File/file_multipart rendition 'thumb-pending' was not found"
    );
    expect(() => availableFileRenditionForDownload(snapshot, "missing")).toThrow(
      "File/file_multipart rendition 'missing' was not found"
    );
  });

  it("plans unique file object keys for delete", () => {
    const snapshot = fileSnapshot({
      key: "acme/files/file_multipart-original.png",
      renditions: [
        renditionEntry("thumb", { key: "acme/file-renditions/file/thumb.webp" }),
        renditionEntry("duplicate", { key: "acme/file-renditions/file/thumb.webp" })
      ]
    });

    expect(fileObjectKeysForDelete(snapshot)).toEqual([
      "acme/files/file_multipart-original.png",
      "acme/file-renditions/file/thumb.webp"
    ]);
  });

  it("plans primary file object cleanup after scan failures", () => {
    const snapshot = fileSnapshot({
      key: "acme/files/file_multipart-original.png",
      renditions: [
        renditionEntry("thumb", { key: "acme/file-renditions/file/thumb.webp" })
      ]
    });

    expect(fileObjectKeysForScanFailureCleanup(snapshot)).toEqual([
      "acme/files/file_multipart-original.png"
    ]);
  });

  it("reads primary file object keys", () => {
    expect(filePrimaryObjectKey(fileSnapshot({ key: "acme/files/file_multipart-original.png" }))).toBe(
      "acme/files/file_multipart-original.png"
    );
    expect(() => filePrimaryObjectKey(fileSnapshot({}))).toThrow("File/file_multipart has no key");
  });

  it("reads persisted file names", () => {
    expect(fileSnapshotFilename(fileSnapshot({ filename: "invoice.pdf" }))).toBe("invoice.pdf");
    expect(() => fileSnapshotFilename(fileSnapshot({}))).toThrow("File/file_multipart has no filename");
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

  it("maps rendition failures from thrown values", () => {
    const pending = pendingFileRendition({
      snapshot: fileSnapshot({ content_type: "image/png" }),
      tenantId: "acme",
      id: "w64-f-webp",
      attemptId: "attempt/1",
      sourceEtag: "source-1",
      options: { width: 64, format: "webp" },
      requestedAt: "2026-06-28T00:00:00.000Z",
      requestedBy: "owner@example.com"
    });

    expect(failedFileRenditionForError({ pending, error: new Error("transform exploded") })).toMatchObject({
      status: "failed",
      failure_message: "transform exploded"
    });
    expect(failedFileRenditionForError({ pending, error: "unknown failure" })).toMatchObject({
      status: "failed",
      failure_message: "unknown failure"
    });
  });

  it("builds rendition storage put commands", () => {
    const body = new ReadableStream<Uint8Array>();
    const pending = renditionEntry("w64-f-webp", {
      key: "acme/file-renditions/file/w64-f-webp-attempt.webp"
    });

    expect(fileRenditionPutObjectCommand({
      pending,
      transform: {
        body,
        contentType: "image/webp",
        contentLength: 123
      },
      sourceFilename: "photo.png",
      tenantId: "acme",
      sourceFile: "file_photo",
      sourceEtag: '"source-http"',
      renditionId: "w64-f-webp"
    })).toEqual({
      key: "acme/file-renditions/file/w64-f-webp-attempt.webp",
      body,
      contentType: "image/webp",
      filename: "photo.png.w64-f-webp.webp",
      size: 123,
      customMetadata: {
        tenantId: "acme",
        sourceFile: "file_photo",
        sourceEtag: '"source-http"',
        renditionId: "w64-f-webp"
      }
    });
  });

  it("builds rendition storage put commands from source snapshots", () => {
    const body = new ReadableStream<Uint8Array>();
    const pending = renditionEntry("w64-f-webp", {
      key: "acme/file-renditions/file/w64-f-webp-attempt.webp"
    });

    expect(fileRenditionSnapshotPutObjectCommand({
      pending,
      transform: {
        body,
        contentType: "image/webp"
      },
      source: fileSnapshot({ filename: "photo.png" }),
      tenantId: "acme",
      sourceEtag: '"source-http"',
      renditionId: "w64-f-webp"
    })).toEqual({
      key: "acme/file-renditions/file/w64-f-webp-attempt.webp",
      body,
      contentType: "image/webp",
      filename: "photo.png.w64-f-webp.webp",
      customMetadata: {
        tenantId: "acme",
        sourceFile: "file_multipart",
        sourceEtag: '"source-http"',
        renditionId: "w64-f-webp"
      }
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

  it("selects reusable available file renditions for matching sources", () => {
    const overlay = {
      ...overlaySource({ key: "overlay-key" }),
      etag: "overlay-1"
    };
    const available = renditionEntry("thumb", {
      status: "available",
      source_etag: "source-1",
      overlay_file: overlay.file,
      overlay_key: overlay.key,
      overlay_etag: "overlay-1"
    });
    expect(availableFileRenditionForSource([
      renditionEntry("thumb", { status: "available", source_etag: "source-2" }),
      available
    ], "thumb", "source-1", overlay)).toBe(available);
    expect(availableFileRenditionForSource([available], "thumb", "source-2", overlay)).toBeUndefined();
  });

  it("selects reusable generated file renditions from snapshots", () => {
    const overlay = overlaySource({ key: "overlay-key", etag: "overlay-1" });
    const available = renditionEntry("thumb", {
      status: "available",
      source_etag: "source-1",
      overlay_file: overlay.file,
      overlay_key: overlay.key,
      overlay_etag: "overlay-1"
    });
    const snapshot = fileSnapshot({
      renditions: [
        renditionEntry("thumb", { status: "pending", source_etag: "source-1" }),
        available
      ]
    });

    expect(reusableFileRenditionForGeneration(snapshot, "thumb", "source-1", overlay)).toBe(available);
    expect(reusableFileRenditionForGeneration(snapshot, "thumb", "source-2", overlay)).toBeUndefined();
  });

  it("rejects duplicate pending file rendition generation", () => {
    const pending = renditionEntry("thumb", {
      status: "pending",
      source_etag: "source-1"
    });
    expect(() => ensureNoPendingFileRenditionForSource([pending], "thumb", "source-1", undefined)).toThrow(
      "File rendition 'thumb' is already being generated"
    );
    expect(() => ensureNoPendingFileRenditionForSource([pending], "thumb", "source-2", undefined)).not.toThrow();
  });

  it("plans file rendition reservations as pending manifest patches", () => {
    const snapshot = fileSnapshot({
      content_type: "image/png",
      renditions: [renditionEntry("existing")]
    });
    const reservation = fileRenditionGenerationReservation({
      snapshot,
      tenantId: "acme",
      id: "w64-f-webp",
      attemptId: "attempt-1",
      sourceEtag: "source-1",
      options: { width: 64, format: "webp" },
      requestedAt: "2026-06-28T00:00:00.000Z",
      requestedBy: "owner@example.com"
    });

    expect(reservation.pending).toMatchObject({
      id: "w64-f-webp",
      key: "acme/file-renditions/file_multipart/w64-f-webp-attempt-1.webp",
      status: "pending",
      source_etag: "source-1"
    });
    expect(reservation.patch).toEqual({
      renditions: [
        renditionEntry("existing"),
        reservation.pending
      ]
    });
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

  it("builds rendition manifest document patches", () => {
    expect(fileRenditionManifestPatch([renditionEntry("b")], renditionEntry("a"))).toEqual({
      renditions: [renditionEntry("a"), renditionEntry("b")]
    });
    expect(fileRenditionManifestPatch([renditionEntry("a")], renditionEntry("a", { status: "failed" }))).toEqual({
      renditions: [renditionEntry("a", { status: "failed" })]
    });
  });

  it("builds rendition manifest patches from latest snapshots", () => {
    const replacement = renditionEntry("thumb", { status: "available" });
    expect(fileRenditionSnapshotManifestPatch(fileSnapshot({
      renditions: [
        renditionEntry("thumb", { status: "pending" }),
        { id: "invalid" },
        renditionEntry("detail")
      ]
    }), replacement)).toEqual({
      renditions: [
        renditionEntry("detail"),
        replacement
      ]
    });
  });

  it("builds rendition manifest document command intents", () => {
    const replacement = renditionEntry("thumb", { status: "available" });

    expect(fileRenditionManifestDocumentCommand({
      snapshot: {
        ...fileSnapshot({
          renditions: [
            renditionEntry("thumb", { status: "pending" }),
            renditionEntry("detail")
          ]
        }),
        version: 7
      },
      command: "completeRendition",
      rendition: replacement
    })).toEqual({
      command: "completeRendition",
      input: {
        renditions: [
          renditionEntry("detail"),
          replacement
        ]
      },
      expectedVersion: 7
    });
  });

  it("normalizes bulk file selections", () => {
    expect(normalizeBulkFileSelections([
      { name: " file_a ", expectedVersion: 2 },
      { name: "file_b" }
    ])).toEqual([
      { name: "file_a", expectedVersion: 2 },
      { name: "file_b" }
    ]);
  });

  it("rejects invalid bulk file selections", () => {
    expect(() => normalizeBulkFileSelections([])).toThrow("At least one file must be selected");
    expect(() => normalizeBulkFileSelections([{ name: " " }])).toThrow("File name is required");
    expect(() => normalizeBulkFileSelections([{ name: "file_a" }, { name: " file_a " }])).toThrow(
      "Duplicate file selection 'file_a'"
    );
    expect(() => normalizeBulkFileSelections([{ name: "file_a", expectedVersion: 1.5 }])).toThrow(
      "expectedVersion must be an integer"
    );
    expect(() =>
      normalizeBulkFileSelections(Array.from({ length: 101 }, (_, index) => ({ name: `file_${String(index)}` })))
    ).toThrow("At most 100 files can be selected");
  });

  it("maps bulk file failures without service state", () => {
    expect(fileBulkDeleteFailure("file_a", new FrameworkError("DOCUMENT_NOT_FOUND", "missing", { status: 404 }))).toEqual({
      name: "file_a",
      code: "DOCUMENT_NOT_FOUND",
      message: "missing",
      status: 404
    });
    expect(fileBulkFailure("file_b", new Error("storage unavailable"), "fallback")).toEqual({
      name: "file_b",
      code: "UNKNOWN",
      message: "storage unavailable",
      status: 500
    });
    expect(fileBulkFailure("file_c", "bad", "Bulk metadata update failed")).toEqual({
      name: "file_c",
      code: "UNKNOWN",
      message: "Bulk metadata update failed",
      status: 500
    });
  });

  it("validates direct upload object metadata against its reservation", () => {
    const snapshot = fileSnapshot({
      size: 12,
      content_type: "Text/Plain"
    });
    const object = fileObject({ size: 12, contentType: " text/plain " });

    expect(() => ensureDirectUploadMatches(snapshot, object)).not.toThrow();
    expect(() => ensureDirectUploadMatches(snapshot, { ...object, size: 11 })).toThrow(
      "Direct upload object size mismatch"
    );
    expect(() => ensureDirectUploadMatches(snapshot, { ...object, contentType: "application/pdf" }, "Multipart upload")).toThrow(
      "Multipart upload object content type mismatch"
    );
  });

  it("plans file scan patches without persisting empty optional scanner fields", () => {
    expect(fileScanPatch({ status: "clean", engine: "", message: "" }, "2026-06-28T01:00:00.000Z")).toEqual({
      scan_status: "clean",
      scan_checked_at: "2026-06-28T01:00:00.000Z"
    });
    expect(
      fileScanPatch(
        {
          status: "infected",
          checkedAt: "2026-06-28T02:00:00.000Z",
          engine: "unit-av",
          message: "EICAR"
        },
        "2026-06-28T01:00:00.000Z"
      )
    ).toEqual({
      scan_status: "infected",
      scan_checked_at: "2026-06-28T02:00:00.000Z",
      scan_engine: "unit-av",
      scan_message: "EICAR"
    });
  });

  it("omits scan patches when no scanner result exists", () => {
    expect(optionalFileScanPatch(undefined, "2026-06-28T01:00:00.000Z")).toEqual({});
    expect(optionalFileScanPatch({ status: "clean" }, "2026-06-28T01:00:00.000Z")).toEqual({
      scan_status: "clean",
      scan_checked_at: "2026-06-28T01:00:00.000Z"
    });
  });

  it("identifies infected scanner results", () => {
    expect(isInfectedFileScanResult(undefined)).toBe(false);
    expect(isInfectedFileScanResult({ status: "clean" })).toBe(false);
    expect(isInfectedFileScanResult({ status: "infected" })).toBe(true);
  });

  it("builds file scan targets from stored object metadata", () => {
    const { contentType: _contentType, ...objectWithoutContentType } = fileObject({
      key: "acme/files/file_1-invoice.pdf",
      httpEtag: '"http-etag"'
    });
    expect(fileScanTarget({
      actorId: "owner@example.com",
      tenantId: "acme",
      filename: "invoice.pdf",
      source: "direct_upload",
      object: objectWithoutContentType
    })).toEqual({
      actorId: "owner@example.com",
      tenantId: "acme",
      key: "acme/files/file_1-invoice.pdf",
      filename: "invoice.pdf",
      contentType: "application/octet-stream",
      size: 12,
      source: "direct_upload",
      etag: "object-1",
      httpEtag: '"http-etag"'
    });
  });

  it("builds upload object storage custom metadata", () => {
    expect(fileUploadObjectCustomMetadata({
      tenantId: "acme",
      uploadedBy: "owner@example.com"
    })).toEqual({
      tenantId: "acme",
      uploadedBy: "owner@example.com"
    });
  });

  it("builds upload storage port commands", () => {
    expect(fileBufferedUploadPutObjectCommand({
      key: "acme/files/file_1-invoice.pdf",
      body: "hello",
      contentType: "application/pdf",
      filename: "invoice.pdf",
      size: 5,
      tenantId: "acme",
      uploadedBy: "owner@example.com"
    })).toEqual({
      key: "acme/files/file_1-invoice.pdf",
      body: "hello",
      contentType: "application/pdf",
      filename: "invoice.pdf",
      size: 5,
      customMetadata: { tenantId: "acme", uploadedBy: "owner@example.com" }
    });
    expect(fileDirectUploadReservationCommand({
      key: "acme/files/file_1-invoice.pdf",
      contentType: "application/pdf",
      filename: "invoice.pdf",
      size: 42,
      expiresAt: "2026-06-28T00:15:00.000Z",
      tenantId: "acme",
      uploadedBy: "owner@example.com"
    })).toEqual({
      key: "acme/files/file_1-invoice.pdf",
      contentType: "application/pdf",
      filename: "invoice.pdf",
      size: 42,
      expiresAt: "2026-06-28T00:15:00.000Z",
      customMetadata: { tenantId: "acme", uploadedBy: "owner@example.com" }
    });
    expect(fileMultipartUploadReservationCommand({
      key: "acme/files/file_1-invoice.pdf",
      contentType: "application/pdf",
      filename: "invoice.pdf",
      tenantId: "acme",
      uploadedBy: "owner@example.com"
    })).toEqual({
      key: "acme/files/file_1-invoice.pdf",
      contentType: "application/pdf",
      filename: "invoice.pdf",
      customMetadata: { tenantId: "acme", uploadedBy: "owner@example.com" }
    });
  });

  it("builds multipart storage operation commands", () => {
    const snapshot = fileSnapshot({ key: "acme/files/file_1-invoice.pdf" });
    const parts = [{ partNumber: 1, etag: "part-1" }];

    expect(fileMultipartPartUploadCommand({
      snapshot,
      uploadId: "upload-1",
      partNumber: 1,
      body: "chunk"
    })).toEqual({
      key: "acme/files/file_1-invoice.pdf",
      uploadId: "upload-1",
      partNumber: 1,
      body: "chunk"
    });
    expect(fileMultipartCompletionCommand({
      snapshot,
      uploadId: "upload-1",
      parts
    })).toEqual({
      key: "acme/files/file_1-invoice.pdf",
      uploadId: "upload-1",
      parts
    });
    expect(fileMultipartAbortCommand({
      snapshot,
      uploadId: "upload-1"
    })).toEqual({
      key: "acme/files/file_1-invoice.pdf",
      uploadId: "upload-1"
    });
    expect(fileMultipartUploadAbortCommand({
      key: "acme/files/file_2-failed.pdf",
      uploadId: "upload-2"
    })).toEqual({
      key: "acme/files/file_2-failed.pdf",
      uploadId: "upload-2"
    });
  });

  it("builds rendition object storage custom metadata", () => {
    expect(fileRenditionObjectCustomMetadata({
      tenantId: "acme",
      sourceFile: "file_source",
      sourceEtag: '"source-http"',
      renditionId: "w64-f-webp"
    })).toEqual({
      tenantId: "acme",
      sourceFile: "file_source",
      sourceEtag: '"source-http"',
      renditionId: "w64-f-webp"
    });
  });

  it("validates file scanner result statuses", () => {
    expect(() => ensureValidFileScanResult({ status: "clean" })).not.toThrow();
    expect(() => ensureValidFileScanResult({ status: "infected" })).not.toThrow();
    expect(() => ensureValidFileScanResult({ status: "queued" as "clean" })).toThrow(
      "File scanner returned an invalid status"
    );
  });

  it("builds file document data for buffered uploads", () => {
    expect(fileDocumentData({
      filename: "invoice.pdf",
      key: "acme/files/file_1-invoice.pdf",
      contentType: "application/pdf",
      size: 42,
      isPrivate: false,
      uploadedBy: "owner@example.com",
      uploadedAt: "2026-06-28T00:00:00.000Z",
      storageState: "available",
      attachedTo: { doctype: "Invoice", name: "INV-1" }
    })).toEqual({
      filename: "invoice.pdf",
      key: "acme/files/file_1-invoice.pdf",
      content_type: "application/pdf",
      size: 42,
      is_private: false,
      uploaded_by: "owner@example.com",
      uploaded_at: "2026-06-28T00:00:00.000Z",
      storage_state: "available",
      attached_to_doctype: "Invoice",
      attached_to_name: "INV-1"
    });
  });

  it("builds pending upload document data with scanner and expiry fields", () => {
    expect(fileDocumentData({
      filename: "invoice.pdf",
      key: "acme/files/file_1-invoice.pdf",
      contentType: "application/pdf",
      size: 42,
      isPrivate: true,
      uploadedBy: "owner@example.com",
      uploadedAt: "2026-06-28T00:00:00.000Z",
      storageState: "upload_pending",
      directUploadExpiresAt: "2026-06-28T00:15:00.000Z",
      scannerConfigured: true
    })).toEqual({
      filename: "invoice.pdf",
      key: "acme/files/file_1-invoice.pdf",
      content_type: "application/pdf",
      size: 42,
      is_private: true,
      uploaded_by: "owner@example.com",
      uploaded_at: "2026-06-28T00:00:00.000Z",
      storage_state: "upload_pending",
      direct_upload_expires_at: "2026-06-28T00:15:00.000Z",
      scan_status: "pending"
    });
  });

  it("builds semantic upload document data for buffered and pending uploads", () => {
    const base = {
      filename: "invoice.pdf",
      key: "acme/files/file_1-invoice.pdf",
      contentType: "application/pdf",
      size: 42,
      uploadedBy: "owner@example.com",
      uploadedAt: "2026-06-28T00:00:00.000Z"
    };

    expect(fileBufferedUploadDocumentData({
      ...base,
      attachedTo: { doctype: "Invoice", name: "INV-1" }
    })).toMatchObject({
      is_private: true,
      storage_state: "available",
      attached_to_doctype: "Invoice",
      attached_to_name: "INV-1"
    });
    expect(filePendingUploadDocumentData({
      ...base,
      isPrivate: false,
      directUploadExpiresAt: "2026-06-28T00:15:00.000Z",
      scannerConfigured: true
    })).toMatchObject({
      is_private: false,
      storage_state: "upload_pending",
      direct_upload_expires_at: "2026-06-28T00:15:00.000Z",
      scan_status: "pending"
    });
  });

  it("adds multipart upload ids to reserved file document data", () => {
    const data = fileDocumentData({
      filename: "invoice.pdf",
      key: "acme/files/file_1-invoice.pdf",
      contentType: "application/pdf",
      size: 42,
      isPrivate: true,
      uploadedBy: "owner@example.com",
      uploadedAt: "2026-06-28T00:00:00.000Z",
      storageState: "upload_pending"
    });

    expect(fileMultipartUploadDocumentData(data, "upload-1")).toEqual({
      ...data,
      multipart_upload_id: "upload-1"
    });
  });

  it("builds upload completion and scan-failure patches", () => {
    const object = fileObject({ etag: "object-etag", httpEtag: '"http-etag"' });
    const scan = fileScanPatch({ status: "clean" }, "2026-06-28T01:00:00.000Z");
    expect(fileUploadCompletedPatch(object, scan)).toEqual({
      storage_state: "available",
      etag: '"http-etag"',
      scan_status: "clean",
      scan_checked_at: "2026-06-28T01:00:00.000Z"
    });
    expect(fileUploadScanFailedPatch(fileObject({ etag: "object-etag" }), scan)).toEqual({
      storage_state: "scan_failed",
      etag: "object-etag",
      scan_status: "clean",
      scan_checked_at: "2026-06-28T01:00:00.000Z"
    });
    expect(fileMultipartCompletionStartedPatch()).toEqual({ storage_state: "upload_completing" });
  });

  it("builds multipart completion-start document command intents", () => {
    expect(fileMultipartCompletionStartedDocumentCommand({
      snapshot: fileSnapshot({ storage_state: "upload_pending" }),
      expectedVersion: 3
    })).toEqual({
      command: "beginMultipartUploadCompletion",
      input: { storage_state: "upload_completing" },
      expectedVersion: 3
    });
    expect(fileMultipartCompletionStartedDocumentCommand({
      snapshot: fileSnapshot({ storage_state: "upload_pending" })
    })).toEqual({
      command: "beginMultipartUploadCompletion",
      input: { storage_state: "upload_completing" }
    });
    expect(fileMultipartCompletionStartedDocumentCommand({
      snapshot: fileSnapshot({ storage_state: "upload_completing" }),
      expectedVersion: 3
    })).toBeUndefined();
  });

  it("selects upload completion document command intents", () => {
    const object = fileObject({ etag: "object-etag", httpEtag: '"http-etag"' });
    const scanPatch = fileScanPatch({ status: "clean" }, "2026-06-28T01:00:00.000Z");

    expect(fileUploadCompletionDocumentCommand({
      uploadCommand: "completeDirectUpload",
      object,
      scanPatch
    })).toEqual({
      command: "completeDirectUpload",
      input: {
        storage_state: "available",
        etag: '"http-etag"',
        scan_status: "clean",
        scan_checked_at: "2026-06-28T01:00:00.000Z"
      }
    });
    expect(fileUploadCompletionDocumentCommand({
      uploadCommand: "completeMultipartUpload",
      object,
      scanPatch,
      infected: true
    })).toEqual({
      command: "failScan",
      input: {
        storage_state: "scan_failed",
        etag: '"http-etag"',
        scan_status: "clean",
        scan_checked_at: "2026-06-28T01:00:00.000Z"
      }
    });
  });

  it("builds final buffered-upload document data", () => {
    const data = {
      filename: "invoice.pdf",
      key: "acme/files/file_1-invoice.pdf",
      content_type: "application/pdf",
      size: 42,
      is_private: true,
      uploaded_by: "owner@example.com",
      uploaded_at: "2026-06-28T00:00:00.000Z",
      storage_state: "upload_pending"
    };
    const object = fileObject({ etag: "object-etag", httpEtag: '"http-etag"' });
    const scan = fileScanPatch({ status: "clean" }, "2026-06-28T01:00:00.000Z");

    expect(fileUploadCompletedDocumentData(data, object, scan)).toEqual({
      ...data,
      storage_state: "available",
      etag: '"http-etag"',
      scan_status: "clean",
      scan_checked_at: "2026-06-28T01:00:00.000Z"
    });
    expect(fileUploadScanFailedDocumentData(data, fileObject({ etag: "object-etag" }), scan)).toEqual({
      ...data,
      storage_state: "scan_failed",
      etag: "object-etag",
      scan_status: "clean",
      scan_checked_at: "2026-06-28T01:00:00.000Z"
    });
  });

  it("builds buffered-upload document create intents", () => {
    const data = {
      filename: "invoice.pdf",
      key: "acme/files/file_1-invoice.pdf",
      content_type: "application/pdf",
      size: 42,
      is_private: true,
      uploaded_by: "owner@example.com",
      uploaded_at: "2026-06-28T00:00:00.000Z",
      storage_state: "available"
    };
    const object = fileObject({ etag: "object-etag", httpEtag: '"http-etag"' });
    const scanPatch = fileScanPatch({ status: "infected", message: "signature" }, "2026-06-28T01:00:00.000Z");

    expect(fileBufferedUploadDocumentCreateCommand({
      data,
      object,
      scanPatch
    })).toEqual({
      data: {
        ...data,
        storage_state: "available",
        etag: '"http-etag"',
        scan_status: "infected",
        scan_message: "signature",
        scan_checked_at: "2026-06-28T01:00:00.000Z"
      }
    });
    expect(fileBufferedUploadDocumentCreateCommand({
      data,
      object,
      scanPatch,
      infected: true
    })).toEqual({
      data: {
        ...data,
        storage_state: "scan_failed",
        etag: '"http-etag"',
        scan_status: "infected",
        scan_message: "signature",
        scan_checked_at: "2026-06-28T01:00:00.000Z"
      },
      eventType: "FileScanFailed"
    });
  });

  it("builds file metadata patches", () => {
    expect(fileMetadataPatch({
      filename: " folder/invoice.pdf ",
      isPrivate: false,
      attachedTo: { doctype: "Invoice", name: "INV-1" }
    })).toEqual({
      filename: "folder-invoice.pdf",
      is_private: false,
      attached_to_doctype: "Invoice",
      attached_to_name: "INV-1"
    });
    expect(fileMetadataPatch({ attachedTo: null })).toEqual({
      attached_to_doctype: "",
      attached_to_name: ""
    });
  });

  it("builds file metadata update document command intents", () => {
    expect(fileMetadataUpdateDocumentCommand({
      filename: " folder/invoice.pdf ",
      isPrivate: false,
      attachedTo: null,
      expectedVersion: 4
    })).toEqual({
      command: "updateMetadata",
      input: {
        filename: "folder-invoice.pdf",
        is_private: false,
        attached_to_doctype: "",
        attached_to_name: ""
      },
      expectedVersion: 4
    });
  });

  it("rejects empty file metadata patches", () => {
    expect(() => fileMetadataPatch({})).toThrow("At least one file metadata field must be provided");
  });

  it("rejects missing file metadata patch fields", () => {
    expect(() => ensureFileMetadataPatchProvided({})).toThrow("At least one file metadata field must be provided");
    expect(() => ensureFileMetadataPatchProvided({ isPrivate: true })).not.toThrow();
    expect(() => ensureFileMetadataPatchProvided({ attachedTo: null })).not.toThrow();
  });

  it("builds file scan failure errors from persisted scan details first", () => {
    const fromSnapshot = fileScanFailureError(
      { status: "infected", message: "scanner fallback" },
      fileSnapshot({ scan_message: "persisted signature" })
    );
    expect(fromSnapshot.code).toBe("FILE_SCAN_FAILED");
    expect(fromSnapshot.status).toBe(422);
    expect(fromSnapshot.message).toBe("File scan failed: persisted signature");

    expect(
      fileScanFailureError({ status: "infected", message: "scanner signature" }, fileSnapshot({})).message
    ).toBe("File scan failed: scanner signature");
    expect(fileScanFailureError({ status: "infected" }, fileSnapshot({})).message).toBe("File scan failed");
  });

  it("reads optional and required string fields from file snapshots", () => {
    const snapshot = fileSnapshot({ key: "acme/files/file.pdf", filename: 42 });
    expect(fileSnapshotStringData(snapshot, "key")).toBe("acme/files/file.pdf");
    expect(fileSnapshotStringData(snapshot, "filename")).toBe("");
    expect(requireFileSnapshotString(snapshot, "key")).toBe("acme/files/file.pdf");
    expect(() => requireFileSnapshotString(snapshot, "filename")).toThrow("File/file_multipart has no filename");
  });

  it("validates expected file snapshot versions", () => {
    const snapshot = fileSnapshot({});
    expect(() => ensureFileExpectedVersion(snapshot, undefined)).not.toThrow();
    expect(() => ensureFileExpectedVersion(snapshot, 1)).not.toThrow();
    expect(() => ensureFileExpectedVersion(snapshot, 2)).toThrow("Expected version 2, found 1");
  });

  it("allows downloads only for finalized and safe file states", () => {
    expect(() => ensureFileAvailableForDownload(fileSnapshot({ storage_state: "available" }))).not.toThrow();
    expect(() => ensureFileAvailableForDownload(fileSnapshot({ storage_state: "upload_pending" }))).toThrow(
      "File/file_multipart upload has not been finalized"
    );
    expect(() => ensureFileAvailableForDownload(fileSnapshot({ storage_state: "upload_completing" }))).toThrow(
      "File/file_multipart upload has not been finalized"
    );
    expect(() => ensureFileAvailableForDownload(fileSnapshot({ storage_state: "scan_failed" }))).toThrow(
      "File/file_multipart did not pass file scanning"
    );
    expect(() => ensureFileAvailableForDownload(fileSnapshot({ storage_state: "delete_requested" }))).toThrow(
      "File/file_multipart is pending deletion"
    );
  });

  it("validates pending direct-upload file state", () => {
    expect(() => ensureFilePendingDirectUpload(fileSnapshot({ storage_state: "upload_pending" }))).not.toThrow();
    expect(() => ensureFilePendingDirectUpload(fileSnapshot({ storage_state: "available" }))).toThrow(
      "File/file_multipart is not pending direct upload"
    );
    expect(() => ensureFilePendingDirectUpload(fileSnapshot({ storage_state: "delete_requested" }))).toThrow(
      "File/file_multipart is pending deletion"
    );
  });

  it("validates pending multipart file state and upload id", () => {
    expect(() =>
      ensureFilePendingMultipartUpload(
        fileSnapshot({ storage_state: "upload_completing", multipart_upload_id: "upload-1" }),
        ["upload_pending", "upload_completing"]
      )
    ).not.toThrow();
    expect(() =>
      ensureFilePendingMultipartUpload(fileSnapshot({ storage_state: "upload_pending" }), ["upload_pending"])
    ).toThrow("File/file_multipart is not pending multipart upload");
    expect(() =>
      ensureFilePendingMultipartUpload(
        fileSnapshot({ storage_state: "available", multipart_upload_id: "upload-1" }),
        ["upload_pending"]
      )
    ).toThrow("File/file_multipart is not pending multipart upload");
    expect(() =>
      ensureFilePendingMultipartUpload(
        fileSnapshot({ storage_state: "delete_requested", multipart_upload_id: "upload-1" }),
        ["upload_pending"]
      )
    ).toThrow("File/file_multipart is pending deletion");
  });

  it("validates multipart part upload state", () => {
    expect(() =>
      ensureFilePendingMultipartPartUpload(fileSnapshot({ storage_state: "upload_pending", multipart_upload_id: "upload-1" }))
    ).not.toThrow();
    expect(() =>
      ensureFilePendingMultipartPartUpload(fileSnapshot({ storage_state: "upload_completing", multipart_upload_id: "upload-1" }))
    ).toThrow("File/file_multipart is not pending multipart upload");
  });

  it("validates resumable multipart completion state", () => {
    expect(() =>
      ensureFilePendingMultipartCompletion(fileSnapshot({ storage_state: "upload_pending", multipart_upload_id: "upload-1" }))
    ).not.toThrow();
    expect(() =>
      ensureFilePendingMultipartCompletion(
        fileSnapshot({ storage_state: "upload_completing", multipart_upload_id: "upload-1" })
      )
    ).not.toThrow();
    expect(() =>
      ensureFilePendingMultipartCompletion(fileSnapshot({ storage_state: "available", multipart_upload_id: "upload-1" }))
    ).toThrow("File/file_multipart is not pending multipart upload");
  });

  it("reads required multipart upload ids", () => {
    expect(fileMultipartUploadId(fileSnapshot({ multipart_upload_id: "upload-1" }))).toBe("upload-1");
    expect(() => fileMultipartUploadId(fileSnapshot({}))).toThrow("File/file_multipart has no multipart upload");
  });

  it("validates delete expected versions while allowing idempotent delete requests", () => {
    expect(() => ensureFileDeleteExpectedVersion(fileSnapshot({ storage_state: "available" }), undefined)).not.toThrow();
    expect(() => ensureFileDeleteExpectedVersion(fileSnapshot({ storage_state: "available" }), 1)).not.toThrow();
    expect(() => ensureFileDeleteExpectedVersion(fileSnapshot({ storage_state: "available" }), 2)).toThrow(
      "Expected version 2, found 1"
    );
    expect(() => ensureFileDeleteExpectedVersion(fileSnapshot({ storage_state: "delete_requested" }), 2)).not.toThrow();
  });

  it("validates file create permissions and schema together", () => {
    const doctype: DocTypeDefinition = {
      name: "File",
      fields: [
        { name: "filename", type: "text", required: true },
        { name: "size", type: "integer" }
      ],
      permissions: [{ roles: ["File Manager"], actions: ["create"] }]
    };

    expect(() => ensureFileCreateAllowed({
      actor: { id: "manager@example.com", roles: ["File Manager"] },
      doctype,
      fileDoctype: "File",
      data: { filename: "invoice.pdf", size: 42 }
    })).not.toThrow();
    expect(() => ensureFileCreateAllowed({
      actor: { id: "reader@example.com", roles: ["Reader"] },
      doctype,
      fileDoctype: "File",
      data: { filename: "invoice.pdf", size: 42 }
    })).toThrow("Actor 'reader@example.com' cannot create File");
    let error: unknown;
    try {
      ensureFileCreateAllowed({
        actor: { id: "manager@example.com", roles: ["File Manager"] },
        doctype,
        fileDoctype: "File",
        data: { size: 42 }
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: "VALIDATION_FAILED",
      issues: [expect.objectContaining({ field: "filename", code: "required" })]
    });
  });

  it("validates file delete permissions and expected versions together", () => {
    const doctype: DocTypeDefinition = {
      name: "File",
      fields: [],
      permissions: [{ roles: ["File Manager"], actions: ["delete"] }]
    };
    const snapshot = fileSnapshot({ storage_state: "available" });

    expect(() => ensureFileDeleteAllowed({
      actor: { id: "manager@example.com", roles: ["File Manager"] },
      doctype,
      fileDoctype: "File",
      snapshot,
      expectedVersion: 1
    })).not.toThrow();
    expect(() => ensureFileDeleteAllowed({
      actor: { id: "reader@example.com", roles: ["Reader"] },
      doctype,
      fileDoctype: "File",
      snapshot,
      expectedVersion: 1
    })).toThrow("Actor 'reader@example.com' cannot delete File/file_multipart");
    expect(() => ensureFileDeleteAllowed({
      actor: { id: "manager@example.com", roles: ["File Manager"] },
      doctype,
      fileDoctype: "File",
      snapshot,
      expectedVersion: 2
    })).toThrow("Expected version 2, found 1");
  });

  it("validates file metadata update permissions before deletion state", () => {
    const doctype: DocTypeDefinition = {
      name: "File",
      fields: [],
      permissions: [{ roles: ["File Manager"], actions: ["metadata"] }]
    };

    expect(() => ensureFileMetadataUpdateAllowed({
      actor: { id: "manager@example.com", roles: ["File Manager"] },
      doctype,
      fileDoctype: "File",
      snapshot: fileSnapshot({ storage_state: "available" })
    })).not.toThrow();
    expect(() => ensureFileMetadataUpdateAllowed({
      actor: { id: "reader@example.com", roles: ["Reader"] },
      doctype,
      fileDoctype: "File",
      snapshot: fileSnapshot({ storage_state: "delete_requested" })
    })).toThrow("Actor 'reader@example.com' cannot execute updateMetadata on File/file_multipart");
    expect(() => ensureFileMetadataUpdateAllowed({
      actor: { id: "manager@example.com", roles: ["File Manager"] },
      doctype,
      fileDoctype: "File",
      snapshot: fileSnapshot({ storage_state: "delete_requested" })
    })).toThrow("File/file_multipart is pending deletion");
  });

  it("validates file rendition generation permissions", () => {
    const doctype: DocTypeDefinition = {
      name: "File",
      fields: [],
      permissions: [{ roles: ["File Manager"], actions: ["rendition"] }]
    };
    const snapshot = fileSnapshot({ storage_state: "available" });

    expect(() => ensureFileRenditionGenerationAllowed({
      actor: { id: "manager@example.com", roles: ["File Manager"] },
      doctype,
      fileDoctype: "File",
      snapshot
    })).not.toThrow();
    expect(() => ensureFileRenditionGenerationAllowed({
      actor: { id: "reader@example.com", roles: ["Reader"] },
      doctype,
      fileDoctype: "File",
      snapshot
    })).toThrow("Actor 'reader@example.com' cannot generate renditions for File/file_multipart");
  });

  it("validates multipart upload state before permissions", () => {
    const doctype: DocTypeDefinition = {
      name: "File",
      fields: [],
      permissions: [{ roles: ["File Manager"], actions: ["metadata"] }]
    };

    expect(() => ensureFileMultipartUploadAllowed({
      actor: { id: "manager@example.com", roles: ["File Manager"] },
      doctype,
      fileDoctype: "File",
      snapshot: fileSnapshot({ storage_state: "upload_pending", multipart_upload_id: "upload-1" }),
      ensurePendingMultipartUpload: ensureFilePendingMultipartPartUpload
    })).not.toThrow();
    expect(() => ensureFileMultipartUploadAllowed({
      actor: { id: "reader@example.com", roles: ["Reader"] },
      doctype,
      fileDoctype: "File",
      snapshot: fileSnapshot({ storage_state: "available", multipart_upload_id: "upload-1" }),
      ensurePendingMultipartUpload: ensureFilePendingMultipartPartUpload
    })).toThrow("File/file_multipart is not pending multipart upload");
    expect(() => ensureFileMultipartUploadAllowed({
      actor: { id: "reader@example.com", roles: ["Reader"] },
      doctype,
      fileDoctype: "File",
      snapshot: fileSnapshot({ storage_state: "upload_pending", multipart_upload_id: "upload-1" }),
      ensurePendingMultipartUpload: ensureFilePendingMultipartPartUpload
    })).toThrow("Actor 'reader@example.com' cannot execute multipart upload on File/file_multipart");
  });

  it("identifies files with delete already requested", () => {
    expect(isFileDeleteRequested(fileSnapshot({ storage_state: "available" }))).toBe(false);
    expect(isFileDeleteRequested(fileSnapshot({ storage_state: "delete_requested" }))).toBe(true);
  });

  it("plans delete-request events only before delete has been requested", () => {
    expect(shouldRequestFileDelete(fileSnapshot({ storage_state: "available" }))).toBe(true);
    expect(shouldRequestFileDelete(fileSnapshot({ storage_state: "delete_requested" }))).toBe(false);
  });

  it("builds delete-request document command intents", () => {
    expect(fileDeleteRequestedDocumentCommand(fileSnapshot({ storage_state: "available" }))).toEqual({
      command: "requestDelete",
      input: {},
      expectedVersion: 1
    });
    expect(fileDeleteRequestedDocumentCommand(fileSnapshot({ storage_state: "delete_requested" }))).toBeUndefined();
  });

  it("identifies multipart files already completing", () => {
    expect(isFileMultipartCompletionStarted(fileSnapshot({ storage_state: "upload_pending" }))).toBe(false);
    expect(isFileMultipartCompletionStarted(fileSnapshot({ storage_state: "upload_completing" }))).toBe(true);
  });

  it("plans multipart completion start events only before completion has started", () => {
    expect(shouldStartFileMultipartCompletion(fileSnapshot({ storage_state: "upload_pending" }))).toBe(true);
    expect(shouldStartFileMultipartCompletion(fileSnapshot({ storage_state: "upload_completing" }))).toBe(false);
  });

  it("identifies files still pending upload finalization", () => {
    expect(isFileUploadPending(fileSnapshot({ storage_state: "upload_pending" }))).toBe(true);
    expect(isFileUploadPending(fileSnapshot({ storage_state: "upload_completing" }))).toBe(false);
    expect(isFileUploadPending(fileSnapshot({ storage_state: "available" }))).toBe(false);
  });

  it("identifies files that failed scanning", () => {
    expect(isFileScanFailed(fileSnapshot({ storage_state: "scan_failed" }))).toBe(true);
    expect(isFileScanFailed(fileSnapshot({ storage_state: "available" }))).toBe(false);
    expect(isFileScanFailed(fileSnapshot({ storage_state: "delete_requested" }))).toBe(false);
  });

  it("normalizes file dashboard limits", () => {
    expect(normalizeFileDashboardLimit(undefined)).toBe(50);
    expect(normalizeFileDashboardLimit(1)).toBe(1);
    expect(normalizeFileDashboardLimit(200)).toBe(200);
    expect(() => normalizeFileDashboardLimit(0)).toThrow("File dashboard limit must be between 1 and 200");
    expect(() => normalizeFileDashboardLimit(201)).toThrow("File dashboard limit must be between 1 and 200");
    expect(() => normalizeFileDashboardLimit(1.5)).toThrow("File dashboard limit must be between 1 and 200");
  });

  it("normalizes file dashboard filters", () => {
    expect(normalizeFileDashboardFilters({
      attachedToDoctype: " Invoice ",
      attachedToName: "",
      filename: " invoice ",
      contentType: " application/pdf ",
      uploadedBy: " owner@example.com ",
      storageState: " available ",
      scanStatus: " clean ",
      isPrivate: false
    })).toEqual({
      attachedToDoctype: "Invoice",
      filename: "invoice",
      contentType: "application/pdf",
      uploadedBy: "owner@example.com",
      storageState: "available",
      scanStatus: "clean",
      isPrivate: false
    });
    expect(normalizeFileDashboardFilters({ attachedToDoctype: "   " })).toEqual({});
  });

  it("maps file dashboard filters to list document filters", () => {
    expect(fileDashboardListFilters({
      attachedToDoctype: "Invoice",
      attachedToName: "INV-1",
      filename: "invoice",
      contentType: "pdf",
      uploadedBy: "owner@example.com",
      storageState: "available",
      scanStatus: "clean",
      isPrivate: true
    })).toEqual([
      { field: "attached_to_doctype", operator: "eq", value: "Invoice" },
      { field: "attached_to_name", operator: "eq", value: "INV-1" },
      { field: "filename", operator: "contains", value: "invoice" },
      { field: "content_type", operator: "contains", value: "pdf" },
      { field: "uploaded_by", operator: "eq", value: "owner@example.com" },
      { field: "storage_state", operator: "eq", value: "available" },
      { field: "scan_status", operator: "eq", value: "clean" },
      { field: "is_private", operator: "eq", value: true }
    ]);
  });

  it("projects file dashboard entries from snapshots", () => {
    const entry = fileDashboardEntry(fileSnapshot({
      filename: "invoice.pdf",
      content_type: "application/pdf",
      size: 123,
      is_private: false,
      storage_state: "available",
      direct_upload_expires_at: "2026-06-28T01:00:00.000Z",
      scan_status: "clean",
      scan_checked_at: "2026-06-28T02:00:00.000Z",
      scan_engine: "unit-av",
      scan_message: "ok",
      uploaded_by: "owner@example.com",
      uploaded_at: "2026-06-28T00:00:00.000Z",
      attached_to_doctype: "Invoice",
      attached_to_name: "INV-1",
      renditions: [renditionEntry("thumb", { status: "available", content_type: "image/webp" })]
    }));

    expect(entry).toMatchObject({
      name: "file_multipart",
      filename: "invoice.pdf",
      contentType: "application/pdf",
      size: 123,
      isPrivate: false,
      previewable: true,
      storageState: "available",
      directUploadExpiresAt: "2026-06-28T01:00:00.000Z",
      scanStatus: "clean",
      scanCheckedAt: "2026-06-28T02:00:00.000Z",
      scanEngine: "unit-av",
      scanMessage: "ok",
      uploadedBy: "owner@example.com",
      uploadedAt: "2026-06-28T00:00:00.000Z",
      expectedVersion: 1,
      attachedTo: { doctype: "Invoice", name: "INV-1" },
      renditions: [expect.objectContaining({ id: "thumb", contentType: "image/webp" })]
    });
    expect(fileDashboardEntry(fileSnapshot({ filename: "", content_type: "image/svg+xml" }))).toMatchObject({
      filename: "file_multipart",
      isPrivate: true,
      previewable: false,
      storageState: "available"
    });
  });

  it("projects file dashboard permission flags from doctype actions", () => {
    const doctype: DocTypeDefinition = {
      name: "File",
      fields: [],
      permissions: [
        { roles: ["File Manager"], actions: ["create", "metadata", "delete"] },
        { roles: ["File Viewer"], actions: ["read"] }
      ]
    };
    const snapshot = fileSnapshot({ filename: "invoice.pdf", content_type: "application/pdf" });

    expect(fileDashboardEntryWithPermissions({
      actor: { id: "manager@example.com", roles: ["File Manager"] },
      doctype,
      snapshot
    })).toMatchObject({
      filename: "invoice.pdf",
      editable: true,
      deletable: true
    });
    expect(fileDashboardEntryWithPermissions({
      actor: { id: "viewer@example.com", roles: ["File Viewer"] },
      doctype,
      snapshot
    })).toMatchObject({
      filename: "invoice.pdf",
      editable: false,
      deletable: false
    });
    expect(canUploadFile({ id: "manager@example.com", roles: ["File Manager"] }, doctype)).toBe(true);
    expect(canUploadFile({ id: "viewer@example.com", roles: ["File Viewer"] }, doctype)).toBe(false);
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

function fileObject(overrides: Partial<FileObjectMetadata> = {}): FileObjectMetadata {
  return {
    ...baseFileObject(),
    ...overrides
  };
}

function storedFileObject(metadata: FileObjectMetadata = fileObject()): StoredFileObject {
  return {
    metadata,
    body: new ReadableStream<Uint8Array>()
  };
}

function baseFileObject(): FileObjectMetadata {
  return {
    key: "acme/files/file_object-invoice.txt",
    size: 12,
    etag: "object-1",
    uploadedAt: "2026-06-28T00:00:00.000Z",
    contentType: "text/plain",
    customMetadata: {}
  };
}
