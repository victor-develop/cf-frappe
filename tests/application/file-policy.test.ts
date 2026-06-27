import {
  expectedRenditionContentType,
  fileContentTypeExtension,
  fileRenditionFilename,
  isPreviewableFileContentType,
  normalizeContentType,
  normalizeDirectUploadExpiry,
  normalizeFileSize,
  objectKey,
  renditionObjectKey,
  sanitizeFilename
} from "../../src";

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
});
