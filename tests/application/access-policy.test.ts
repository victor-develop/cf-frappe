import {
  FrameworkError,
  ensureOidcClaimsAllowed,
  isValidCloudflareAccessJwtClaimShape,
  isValidOidcJwtClaimShape,
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
  resolveCloudflareAccessAccountSyncProjection,
  resolveOidcAccountSyncProjection,
  resolveOidcActorFromClaims,
  resolveOidcSyncActorFromClaims,
  resolveOidcSyncedAccountActor,
  resolveCloudflareAccessActorFromClaims,
  resolveCloudflareAccessSyncActorFromClaims,
  resolveCloudflareAccessSyncedAccountActor
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

  it("resolves default Cloudflare Access actors from claims", () => {
    expect(resolveCloudflareAccessActorFromClaims({
      sub: "subject-1",
      email: "owner@example.com"
    })).toEqual({
      id: "owner@example.com",
      roles: ["User"],
      tenantId: "default",
      email: "owner@example.com"
    });
  });

  it("resolves configured Cloudflare Access actors from claims", () => {
    expect(resolveCloudflareAccessActorFromClaims(
      {
        sub: "subject-1",
        email: "owner@example.com",
        groups: ["Support", "Approvers"]
      },
      {
        actorId: (claims) => claims.sub,
        tenantId: () => "acme",
        roles: (claims) => claims.groups.map((group) => `Access:${group}`)
      }
    )).toEqual({
      id: "subject-1",
      roles: ["Access:Support", "Access:Approvers"],
      tenantId: "acme",
      email: "owner@example.com"
    });
  });

  it("rejects Cloudflare Access actor claims without a subject identity", () => {
    expect(() => resolveCloudflareAccessActorFromClaims({ email: " " })).toThrow(
      "Cloudflare Access JWT subject is missing"
    );
  });

  it("rejects Cloudflare Access actor claims with invalid roles", () => {
    expect(() => resolveCloudflareAccessActorFromClaims({ sub: "subject-1" }, { roles: [] })).toThrow(
      "Cloudflare Access actor roles are invalid"
    );
    expect(() =>
      resolveCloudflareAccessActorFromClaims({ sub: "subject-1" }, { roles: ["User", " "] })
    ).toThrow("Cloudflare Access actor roles are invalid");
  });

  it("resolves default Cloudflare Access account-sync projections from claims", () => {
    expect(resolveCloudflareAccessAccountSyncProjection({
      sub: "subject-1",
      email: " OWNER@EXAMPLE.COM "
    })).toEqual({
      provider: "cloudflare-access",
      subject: "subject-1",
      userId: "owner@example.com",
      tenantId: "default",
      email: "owner@example.com",
      emailVerified: true
    });
  });

  it("resolves configured Cloudflare Access account-sync projections from claims", () => {
    expect(resolveCloudflareAccessAccountSyncProjection(
      {
        sub: "subject-1",
        email: "owner@example.com",
        groups: ["Support"],
        enabledByProvider: false
      },
      {
        provider: "access-idp",
        subject: (claims) => `access:${claims.sub}`,
        actorId: (claims) => claims.sub,
        tenantId: () => "acme",
        roles: (claims) => claims.groups,
        enabled: (claims) => claims.enabledByProvider,
        emailVerified: false,
        metadata: (claims) => ({ source: claims.sub })
      }
    )).toEqual({
      provider: "access-idp",
      subject: "access:subject-1",
      userId: "subject-1",
      tenantId: "acme",
      email: "owner@example.com",
      roles: ["Support"],
      enabled: false,
      emailVerified: false,
      metadata: { source: "subject-1" }
    });
  });

  it("uses normalized email as the Cloudflare Access account-sync subject fallback", () => {
    expect(resolveCloudflareAccessAccountSyncProjection({ email: " OWNER@EXAMPLE.COM " })).toMatchObject({
      subject: "owner@example.com",
      userId: "owner@example.com"
    });
  });

  it("rejects Cloudflare Access account-sync projections without a subject", () => {
    expect(() => resolveCloudflareAccessAccountSyncProjection({})).toThrow(
      "Cloudflare Access JWT subject is missing"
    );
  });

  it("resolves Cloudflare Access sync actors", () => {
    expect(resolveCloudflareAccessSyncActorFromClaims(
      { sub: "subject-1" },
      { provider: "access-idp", tenantId: "acme" }
    )).toEqual({
      id: "access-idp:sync",
      roles: ["System Manager"],
      tenantId: "acme"
    });
    expect(resolveCloudflareAccessSyncActorFromClaims(
      { sub: "subject-1", email: "owner@example.com" },
      {
        provider: "access-idp",
        tenantId: "acme",
        syncActorId: (claims) => `${claims.email}:sync`,
        syncActorRoles: ["Integration Manager"]
      }
    )).toEqual({
      id: "owner@example.com:sync",
      roles: ["Integration Manager"],
      tenantId: "acme"
    });
  });

  it("resolves synced Cloudflare Access account actors", () => {
    expect(resolveCloudflareAccessSyncedAccountActor({
      userId: "owner@example.com",
      roles: ["User", "Support"],
      tenantId: "acme",
      enabled: true,
      email: "owner@example.com"
    })).toEqual({
      id: "owner@example.com",
      roles: ["User", "Support"],
      tenantId: "acme",
      email: "owner@example.com"
    });
  });

  it("rejects disabled synced Cloudflare Access accounts", () => {
    expect(() => resolveCloudflareAccessSyncedAccountActor({
      userId: "owner@example.com",
      roles: ["User"],
      tenantId: "acme",
      enabled: false
    })).toThrow("Cloudflare Access account is disabled");
  });

  it("accepts valid OIDC JWT optional claim shapes", () => {
    expect(isValidOidcJwtClaimShape({
      email_verified: true,
      preferred_username: "owner",
      groups: ["Support"],
      roles: ["User"]
    })).toBe(true);
    expect(isValidOidcJwtClaimShape({})).toBe(true);
  });

  it("rejects invalid OIDC JWT scalar claim shapes", () => {
    expect(isValidOidcJwtClaimShape({ email_verified: "true" })).toBe(false);
    expect(isValidOidcJwtClaimShape({ preferred_username: 1 })).toBe(false);
  });

  it("rejects invalid OIDC JWT collection claim shapes", () => {
    expect(isValidOidcJwtClaimShape({ groups: ["Support", 1] })).toBe(false);
    expect(isValidOidcJwtClaimShape({ roles: "User" })).toBe(false);
  });

  it("accepts valid Cloudflare Access JWT optional claim shapes", () => {
    expect(isValidCloudflareAccessJwtClaimShape({ groups: ["Support", "Approvers"] })).toBe(true);
    expect(isValidCloudflareAccessJwtClaimShape({})).toBe(true);
  });

  it("rejects non-array Cloudflare Access JWT groups", () => {
    expect(isValidCloudflareAccessJwtClaimShape({ groups: "Support" })).toBe(false);
  });

  it("rejects non-string Cloudflare Access JWT groups", () => {
    expect(isValidCloudflareAccessJwtClaimShape({ groups: ["Support", 1] })).toBe(false);
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

  it("resolves default OIDC account-sync projections from claims", () => {
    expect(resolveOidcAccountSyncProjection({
      sub: "subject-1",
      email: " OWNER@EXAMPLE.COM ",
      preferred_username: "owner",
      email_verified: true
    })).toEqual({
      provider: "oidc",
      subject: "subject-1",
      userId: "owner@example.com",
      tenantId: "default",
      email: "owner@example.com",
      emailVerified: true
    });
  });

  it("resolves configured OIDC account-sync projections from claims", () => {
    expect(resolveOidcAccountSyncProjection(
      {
        sub: "subject-1",
        email: "owner@example.com",
        preferred_username: "owner",
        groups: ["Support"],
        enabledByProvider: false
      },
      {
        provider: "okta",
        subject: (claims) => `okta:${claims.sub}`,
        actorId: (claims) => claims.preferred_username,
        tenantId: () => "acme",
        roles: (claims) => claims.groups,
        enabled: (claims) => claims.enabledByProvider,
        emailVerified: true,
        metadata: (claims) => ({ source: claims.sub })
      }
    )).toEqual({
      provider: "okta",
      subject: "okta:subject-1",
      userId: "owner",
      tenantId: "acme",
      email: "owner@example.com",
      roles: ["Support"],
      enabled: false,
      emailVerified: true,
      metadata: { source: "subject-1" }
    });
  });

  it("rejects OIDC account-sync projections without a subject", () => {
    expect(() => resolveOidcAccountSyncProjection({ email: "owner@example.com" })).toThrow(
      "OIDC token subject is missing"
    );
  });

  it("resolves default OIDC sync actors", () => {
    expect(resolveOidcSyncActorFromClaims({ sub: "subject-1" }, { provider: "okta", tenantId: "acme" })).toEqual({
      id: "okta:sync",
      roles: ["System Manager"],
      tenantId: "acme"
    });
  });

  it("resolves configured OIDC sync actors", () => {
    expect(resolveOidcSyncActorFromClaims(
      { sub: "subject-1", preferred_username: "owner" },
      {
        provider: "okta",
        tenantId: "acme",
        syncActorId: (claims) => `${claims.preferred_username}:sync`,
        syncActorRoles: ["Integration Manager"]
      }
    )).toEqual({
      id: "owner:sync",
      roles: ["Integration Manager"],
      tenantId: "acme"
    });
  });

  it("allows OIDC claims unless the allowed policy rejects them", () => {
    expect(() => ensureOidcClaimsAllowed({ sub: "subject-1" })).not.toThrow();
    expect(() => ensureOidcClaimsAllowed({ sub: "subject-1" }, { allowed: true })).not.toThrow();
    expect(() => ensureOidcClaimsAllowed(
      { sub: "subject-1", groups: ["Support"] },
      { allowed: (claims) => claims.groups.includes("Support") }
    )).not.toThrow();
  });

  it("rejects OIDC claims when the allowed policy returns false", () => {
    expect(() => ensureOidcClaimsAllowed({ sub: "subject-1" }, { allowed: false })).toThrow(
      "OIDC token is not allowed"
    );
    expect(() => ensureOidcClaimsAllowed(
      { sub: "subject-1", groups: ["Guests"] },
      { allowed: (claims) => claims.groups.includes("Support") }
    )).toThrow("OIDC token is not allowed");
  });

  it("resolves synced OIDC account actors", () => {
    expect(resolveOidcSyncedAccountActor({
      userId: "owner@example.com",
      roles: ["User", "Support"],
      tenantId: "acme",
      enabled: true,
      email: "owner@example.com"
    })).toEqual({
      id: "owner@example.com",
      roles: ["User", "Support"],
      tenantId: "acme",
      email: "owner@example.com"
    });
  });

  it("rejects disabled synced OIDC accounts", () => {
    expect(() => resolveOidcSyncedAccountActor({
      userId: "owner@example.com",
      roles: ["User"],
      tenantId: "acme",
      enabled: false
    })).toThrow("OIDC account is disabled");
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
