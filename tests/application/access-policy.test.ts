import { FrameworkError, isPermissionDeniedError } from "../../src";

describe("access policy", () => {
  it("classifies permission-denied framework errors", () => {
    expect(isPermissionDeniedError(new FrameworkError("PERMISSION_DENIED", "nope", { status: 403 }))).toBe(true);
  });

  it("keeps structural permission-denied errors compatible with access probes", () => {
    expect(isPermissionDeniedError({ code: "PERMISSION_DENIED" })).toBe(true);
  });

  it("does not classify unrelated thrown values as permission denied", () => {
    expect(isPermissionDeniedError(new FrameworkError("BAD_REQUEST", "bad", { status: 400 }))).toBe(false);
    expect(isPermissionDeniedError({ code: "DOCUMENT_NOT_FOUND" })).toBe(false);
    expect(isPermissionDeniedError(new Error("PERMISSION_DENIED"))).toBe(false);
    expect(isPermissionDeniedError(null)).toBe(false);
  });
});
