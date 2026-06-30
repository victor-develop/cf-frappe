import {
  FrameworkError,
  isPermissionDeniedError,
  normalizeCloudflareAccessAudiences,
  normalizeCloudflareAccessTeamDomain
} from "../../src";

describe("access policy", () => {
  it("classifies permission-denied framework errors", () => {
    expect(isPermissionDeniedError(new FrameworkError("PERMISSION_DENIED", "nope", { status: 403 }))).toBe(true);
  });

  it("keeps structural permission-denied errors compatible with access probes", () => {
    expect(isPermissionDeniedError({ code: "PERMISSION_DENIED" })).toBe(true);
  });

  it("does not classify unrelated thrown values as permission denied", () => {
    expect(isPermissionDeniedError(new FrameworkError("BAD_REQUEST", "bad", { status: 400 }))).toBe(false);
    expect(isPermissionDeniedError({ code: "BAD_REQUEST" })).toBe(false);
    expect(isPermissionDeniedError({ code: "DOCUMENT_NOT_FOUND" })).toBe(false);
    expect(isPermissionDeniedError(new Error("PERMISSION_DENIED"))).toBe(false);
    expect(isPermissionDeniedError(null)).toBe(false);
  });

  it("normalizes Cloudflare Access team domains before resolver setup", () => {
    expect(normalizeCloudflareAccessTeamDomain(" https://team.cloudflareaccess.com/ ")).toBe(
      "team.cloudflareaccess.com"
    );
    expect(normalizeCloudflareAccessTeamDomain("http://team.cloudflareaccess.com///")).toBe(
      "team.cloudflareaccess.com"
    );
  });

  it("rejects blank Cloudflare Access team domains with stable bad-request errors", () => {
    expect(() => normalizeCloudflareAccessTeamDomain(" https:// ")).toThrow("Cloudflare Access teamDomain is required");
    try {
      normalizeCloudflareAccessTeamDomain(" ");
    } catch (error) {
      expect(error).toMatchObject({
        code: "BAD_REQUEST",
        message: "Cloudflare Access teamDomain is required",
        status: 400
      });
    }
  });

  it("normalizes Cloudflare Access audiences and rejects empty values", () => {
    expect([...normalizeCloudflareAccessAudiences([" aud-1 ", "aud-2"])]).toEqual(["aud-1", "aud-2"]);
    expect([...normalizeCloudflareAccessAudiences(" aud-1 ")]).toEqual(["aud-1"]);
  });

  it("rejects empty Cloudflare Access audience values with stable bad-request errors", () => {
    expect(() => normalizeCloudflareAccessAudiences([])).toThrow("Cloudflare Access audience is required");
    try {
      normalizeCloudflareAccessAudiences(["aud-1", " "]);
    } catch (error) {
      expect(error).toMatchObject({
        code: "BAD_REQUEST",
        message: "Cloudflare Access audience is required",
        status: 400
      });
    }
  });
});
