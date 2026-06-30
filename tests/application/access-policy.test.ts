import {
  FrameworkError,
  isPermissionDeniedError,
  normalizeCloudflareAccessAudiences,
  normalizeCloudflareAccessTeamDomain,
  normalizeOidcAudiences,
  normalizeOidcClaimNameList,
  normalizeOidcHostedDomainSet,
  normalizeOidcIssuer,
  normalizeOidcJwksUrl,
  normalizeOidcRoleList,
  normalizeOidcTokenSource,
  resolveOidcActorFromClaims
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

  it("normalizes OIDC issuer and JWKS URLs before resolver setup", () => {
    expect(normalizeOidcIssuer(" https://issuer.example.com ")).toBe("https://issuer.example.com");
    expect(normalizeOidcJwksUrl(" https://issuer.example.com/.well-known/jwks.json ")).toBe(
      "https://issuer.example.com/.well-known/jwks.json"
    );
  });

  it("rejects blank OIDC issuer and JWKS URLs with stable bad-request errors", () => {
    expect(() => normalizeOidcIssuer(" ")).toThrow("OIDC issuer is required");
    expect(() => normalizeOidcJwksUrl(" ")).toThrow("OIDC jwksUrl is required");
  });

  it("rejects non-HTTPS OIDC issuer and JWKS URLs", () => {
    expect(() => normalizeOidcIssuer("http://issuer.example.com")).toThrow("OIDC issuer must be an HTTPS URL");
    expect(() => normalizeOidcJwksUrl("http://issuer.example.com/jwks")).toThrow(
      "OIDC jwksUrl must be an HTTPS URL"
    );
  });

  it("normalizes OIDC audiences", () => {
    expect([...normalizeOidcAudiences([" desk ", "admin"])]).toEqual(["desk", "admin"]);
    expect([...normalizeOidcAudiences(" desk ")]).toEqual(["desk"]);
  });

  it("rejects empty OIDC audience values with stable bad-request errors", () => {
    expect(() => normalizeOidcAudiences([])).toThrow("OIDC audience is required");
    try {
      normalizeOidcAudiences(["desk", " "]);
    } catch (error) {
      expect(error).toMatchObject({
        code: "BAD_REQUEST",
        message: "OIDC audience is required",
        status: 400
      });
    }
  });

  it("normalizes default OIDC token-source configuration", () => {
    expect(normalizeOidcTokenSource(undefined)).toEqual({
      header: "authorization",
      scheme: "bearer"
    });
  });

  it("normalizes configured OIDC token-source fields", () => {
    expect(normalizeOidcTokenSource({ header: " X-Id-Token ", scheme: " DPoP " })).toEqual({
      header: "x-id-token",
      scheme: "dpop"
    });
    expect(normalizeOidcTokenSource({ cookie: " id_token " })).toEqual({ cookie: "id_token" });
  });

  it("rejects invalid OIDC token-source configuration with stable bad-request errors", () => {
    expect(() => normalizeOidcTokenSource({ header: "bad header" })).toThrow("OIDC token source header is invalid");
    expect(() => normalizeOidcTokenSource({ cookie: "id;token" })).toThrow("OIDC token source cookie is invalid");
    expect(() => normalizeOidcTokenSource({ cookie: "id_token", scheme: "bearer" })).toThrow(
      "OIDC token source scheme requires a header"
    );
    try {
      normalizeOidcTokenSource({});
    } catch (error) {
      expect(error).toMatchObject({
        code: "BAD_REQUEST",
        message: "OIDC token source is required",
        status: 400
      });
    }
  });

  it("resolves default OIDC actors from claims", () => {
    expect(resolveOidcActorFromClaims({
      sub: "subject-1",
      email: "owner@example.com",
      preferred_username: "owner"
    })).toEqual({
      id: "owner@example.com",
      roles: ["User"],
      tenantId: "default",
      email: "owner@example.com"
    });
  });

  it("resolves configured OIDC actors from claims", () => {
    expect(resolveOidcActorFromClaims(
      {
        sub: "subject-1",
        email: "owner@example.com",
        preferred_username: "owner",
        groups: ["Support", "Approvers"]
      },
      {
        actorId: (claims) => claims.preferred_username,
        tenantId: () => "acme",
        roles: (claims) => claims.groups.map((group) => `OIDC:${group}`)
      }
    )).toEqual({
      id: "owner",
      roles: ["OIDC:Support", "OIDC:Approvers"],
      tenantId: "acme",
      email: "owner@example.com"
    });
  });

  it("rejects OIDC actor claims without a subject identity", () => {
    expect(() => resolveOidcActorFromClaims({ email: " " })).toThrow("OIDC token subject is missing");
  });

  it("rejects OIDC actor claims with invalid roles", () => {
    expect(() => resolveOidcActorFromClaims({ sub: "subject-1" }, { roles: [] })).toThrow(
      "OIDC actor roles are invalid"
    );
    expect(() =>
      resolveOidcActorFromClaims({ sub: "subject-1" }, { roles: ["User", " "] })
    ).toThrow("OIDC actor roles are invalid");
  });

  it("normalizes OIDC provider role lists", () => {
    expect(normalizeOidcRoleList([" User ", "Desk   Manager", "", "User", "Desk Manager"])).toEqual([
      "User",
      "Desk Manager"
    ]);
  });

  it("normalizes OIDC provider claim-name lists", () => {
    expect(normalizeOidcClaimNameList([" roles ", "groups", "", "roles"])).toEqual(["roles", "groups"]);
  });

  it("normalizes OIDC hosted-domain sets", () => {
    expect([...normalizeOidcHostedDomainSet([" Example.COM ", "", "example.com", "teams.example.com"])]).toEqual([
      "example.com",
      "teams.example.com"
    ]);
    expect([...normalizeOidcHostedDomainSet(" Example.COM ")]).toEqual(["example.com"]);
    expect([...normalizeOidcHostedDomainSet(undefined)]).toEqual([]);
  });
});
