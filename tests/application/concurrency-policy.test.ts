import { FrameworkError, isDocumentConflictError } from "../../src";

describe("concurrency policy", () => {
  it("classifies document conflict framework errors", () => {
    expect(isDocumentConflictError(new FrameworkError("DOCUMENT_CONFLICT", "stale", { status: 409 }))).toBe(true);
  });

  it("keeps structural document conflict errors compatible with adapters", () => {
    expect(isDocumentConflictError({ code: "DOCUMENT_CONFLICT" })).toBe(true);
  });

  it("does not classify unrelated thrown values as document conflicts", () => {
    expect(isDocumentConflictError(new FrameworkError("PERMISSION_DENIED", "no", { status: 403 }))).toBe(false);
    expect(isDocumentConflictError({ code: "BAD_REQUEST" })).toBe(false);
    expect(isDocumentConflictError(new Error("DOCUMENT_CONFLICT"))).toBe(false);
    expect(isDocumentConflictError(undefined)).toBe(false);
  });
});
