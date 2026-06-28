import {
  DEFAULT_TENANT_ID,
  deterministicIds,
  fixedClock,
  hasOidcToken,
  InMemoryEventStore,
  auth0OidcProviderPreset,
  googleWorkspaceOidcProviderPreset,
  oidcAccountSyncActorResolver,
  oidcActorResolver,
  oidcGroupsRoleMapper,
  oktaOidcProviderPreset,
  UserAccountService,
  userAccountsStream,
  type Auth0OidcClaims,
  type GoogleWorkspaceOidcClaims,
  type OidcJwtClaims,
  type OktaOidcClaims,
  type PasswordHasher
} from "../../src";
import { now } from "../helpers";
import { createJwtSigner, type JwtSigner } from "./jwt-test-helpers";

describe("OIDC actor resolver", () => {
  it("verifies Bearer tokens and resolves a default actor", async () => {
    const signing = await createJwtSigner<OidcJwtClaims>();
    const token = await signing.sign({
      iss: "https://issuer.example.com",
      aud: ["other", "desk"],
      exp: 2_000,
      nbf: 900,
      sub: "user-subject",
      email: "owner@example.com"
    });
    const fetchJwks = vi.fn(async () => signing.jwks);
    const resolver = oidcActorResolver({
      issuer: "https://issuer.example.com",
      audience: " desk ",
      jwksUrl: "https://issuer.example.com/.well-known/jwks.json",
      now: () => 1_000,
      fetchJwks
    });

    await expect(
      resolver(new Request("https://app.test", { headers: { authorization: `Bearer ${token}` } }))
    ).resolves.toEqual({
      id: "owner@example.com",
      roles: ["User"],
      tenantId: DEFAULT_TENANT_ID,
      email: "owner@example.com"
    });
    expect(fetchJwks).toHaveBeenCalledWith("https://issuer.example.com/.well-known/jwks.json");
  });

  it("accepts case-insensitive Bearer schemes from the authorization header", async () => {
    const signing = await createJwtSigner<OidcJwtClaims>();
    const token = await signing.sign(defaultClaims());
    const resolver = oidcActorResolver({
      issuer: "https://login.example.com",
      audience: "desk",
      jwksUrl: "https://login.example.com/keys",
      now: () => 1_000,
      fetchJwks: async () => signing.jwks
    });

    await expect(
      resolver(new Request("https://app.test", { headers: { authorization: `bearer ${token}` } }))
    ).resolves.toMatchObject({ id: "owner@example.com" });
  });

  it("accepts configured token sources and custom claim mapping", async () => {
    interface CustomClaims extends OidcJwtClaims {
      readonly tenant?: string;
      readonly realm_access?: { readonly roles?: readonly string[] };
    }
    const signing = await createJwtSigner<CustomClaims>();
    const token = await signing.sign({
      iss: "https://login.example.com",
      aud: "desk",
      exp: 2_000,
      sub: "subject-1",
      email: "manager@example.com",
      preferred_username: "manager",
      tenant: "acme",
      realm_access: { roles: ["Desk Managers", "Support"] }
    });
    const resolver = oidcActorResolver<CustomClaims>({
      issuer: "https://login.example.com",
      audience: ["desk", "admin"],
      jwksUrl: "https://login.example.com/keys",
      now: () => 1_000,
      fetchJwks: async () => signing.jwks,
      tokenSource: { cookie: "id_token" },
      roles: (claims) => claims.realm_access?.roles?.map((role) => `OIDC:${role}`) ?? ["User"],
      tenantId: (claims) => claims.tenant,
      actorId: (claims) => claims.preferred_username
    });
    const request = new Request("https://app.test", { headers: { cookie: `other=1; id_token=${token}` } });

    expect(hasOidcToken(request, { cookie: "id_token" })).toBe(true);
    await expect(resolver(request)).resolves.toEqual({
      id: "manager",
      roles: ["OIDC:Desk Managers", "OIDC:Support"],
      tenantId: "acme",
      email: "manager@example.com"
    });
  });

  it("rejects invalid configured OIDC token source names before request handling", () => {
    const baseOptions = {
      issuer: "https://login.example.com",
      audience: "desk",
      jwksUrl: "https://login.example.com/keys",
      fetchJwks: async () => ({ keys: [] })
    };

    expect(() =>
      oidcActorResolver({
        ...baseOptions,
        tokenSource: { header: "bad header" }
      })
    ).toThrow("OIDC token source header is invalid");
    expect(() =>
      oidcActorResolver({
        ...baseOptions,
        tokenSource: { cookie: "id;token" }
      })
    ).toThrow("OIDC token source cookie is invalid");
    expect(() =>
      oidcActorResolver({
        ...baseOptions,
        tokenSource: { header: "authorization", scheme: "bad scheme" }
      })
    ).toThrow("OIDC token source scheme is invalid");
  });

  it("uses shared group-role mapping for generic OIDC claims", async () => {
    const signing = await createJwtSigner<OidcJwtClaims>();
    const token = await signing.sign(defaultClaims({
      groups: [" Support  Team ", "Support Team", "Approvers"]
    }));
    const resolver = oidcActorResolver({
      issuer: "https://login.example.com",
      audience: "desk",
      jwksUrl: "https://login.example.com/keys",
      now: () => 1_000,
      fetchJwks: async () => signing.jwks,
      roles: oidcGroupsRoleMapper()
    });

    await expect(
      resolver(new Request("https://app.test", { headers: { authorization: `Bearer ${token}` } }))
    ).resolves.toMatchObject({
      roles: ["User", "OIDC:Support Team", "OIDC:Approvers"]
    });
  });

  it("syncs OIDC claims into event-sourced provider accounts", async () => {
    const signing = await createJwtSigner<OidcJwtClaims>();
    const events = new InMemoryEventStore();
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      ids: deterministicIds(["account-created", "provider-linked"]),
      clock: fixedClock(now)
    });
    const resolver = oidcAccountSyncActorResolver({
      issuer: "https://login.example.com",
      audience: "desk",
      jwksUrl: "https://login.example.com/keys",
      now: () => 1_000,
      fetchJwks: async () => signing.jwks,
      userAccounts,
      provider: "okta",
      tenantId: () => "acme",
      roles: (claims) => ["User", ...(claims.groups ?? []).map((group) => `OIDC:${group}`)]
    });
    const token = await signing.sign(defaultClaims({
      sub: "oidc-subject-1",
      email: "OWNER@EXAMPLE.COM",
      email_verified: true,
      groups: ["Support"]
    }));
    const request = new Request("https://app.test", { headers: { authorization: `Bearer ${token}` } });

    await expect(resolver(request)).resolves.toEqual({
      id: "owner@example.com",
      roles: ["OIDC:Support", "User"],
      tenantId: "acme",
      email: "owner@example.com"
    });
    await expect(events.readStream(userAccountsStream("acme", "owner@example.com"))).resolves.toMatchObject([
      {
        actorId: "okta:sync",
        payload: {
          kind: "UserAccountCreated",
          userId: "owner@example.com",
          emailVerifiedAt: now,
          roles: ["OIDC:Support", "User"]
        }
      },
      {
        actorId: "okta:sync",
        payload: {
          kind: "UserAuthProviderLinked",
          provider: "okta",
          subject: "oidc-subject-1"
        }
      }
    ]);

    await expect(resolver(request)).resolves.toMatchObject({ id: "owner@example.com" });
    await expect(events.readStream(userAccountsStream("acme", "owner@example.com"))).resolves.toHaveLength(2);
  });

  it("uses a fallback actor when no OIDC token exists", async () => {
    const resolver = oidcActorResolver({
      issuer: "https://login.example.com",
      audience: "desk",
      jwksUrl: "https://login.example.com/keys",
      fetchJwks: async () => ({ keys: [] }),
      fallback: () => ({ id: "guest", roles: ["Guest"], tenantId: "default" })
    });

    await expect(resolver(new Request("https://app.test"))).resolves.toEqual({
      id: "guest",
      roles: ["Guest"],
      tenantId: "default"
    });
  });

  it("rejects unsafe verifier clocks before evaluating OIDC validity windows", async () => {
    const signing = await createJwtSigner<OidcJwtClaims>();
    const resolver = oidcActorResolver({
      issuer: "https://login.example.com",
      audience: "desk",
      jwksUrl: "https://login.example.com/keys",
      now: () => Number.MAX_SAFE_INTEGER + 1,
      fetchJwks: async () => signing.jwks
    });

    await expect(jwtRequest(resolver, signing, {})).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "JWT clock must be a safe integer"
    });
  });

  it("rejects unsafe registered timestamp claims before evaluating OIDC validity windows", async () => {
    const signing = await createJwtSigner<OidcJwtClaims>();
    const resolver = oidcActorResolver({
      issuer: "https://login.example.com",
      audience: "desk",
      jwksUrl: "https://login.example.com/keys",
      now: () => 1_000,
      fetchJwks: async () => signing.jwks
    });

    await expect(jwtRequest(resolver, signing, { exp: Number.MAX_SAFE_INTEGER + 1 })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "OIDC token payload is invalid"
    });
  });

  it("rejects blank audience entries before matching OIDC audiences", async () => {
    const signing = await createJwtSigner<OidcJwtClaims>();
    const resolver = oidcActorResolver({
      issuer: "https://login.example.com",
      audience: "desk",
      jwksUrl: "https://login.example.com/keys",
      now: () => 1_000,
      fetchJwks: async () => signing.jwks
    });

    await expect(jwtRequest(resolver, signing, { aud: ["desk", " "] })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "OIDC token payload is invalid"
    });
  });

  it("rejects blank JWT key ids before resolving OIDC signing keys", async () => {
    const signing = await createJwtSigner<OidcJwtClaims>();
    const resolver = oidcActorResolver({
      issuer: "https://login.example.com",
      audience: "desk",
      jwksUrl: "https://login.example.com/keys",
      now: () => 1_000,
      fetchJwks: async () => signing.jwks
    });
    const token = await signing.sign(defaultClaims(), { kid: " " });

    await expect(
      resolver(new Request("https://app.test", { headers: { authorization: `Bearer ${token}` } }))
    ).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "OIDC token header is invalid"
    });
  });

  it("rejects blank JWT type headers before verifying OIDC tokens", async () => {
    const signing = await createJwtSigner<OidcJwtClaims>();
    const resolver = oidcActorResolver({
      issuer: "https://login.example.com",
      audience: "desk",
      jwksUrl: "https://login.example.com/keys",
      now: () => 1_000,
      fetchJwks: async () => signing.jwks
    });
    const token = await signing.sign(defaultClaims(), { typ: " " });

    await expect(
      resolver(new Request("https://app.test", { headers: { authorization: `Bearer ${token}` } }))
    ).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "OIDC token header is invalid"
    });
  });

  it("rejects bad issuer, audience, validity windows, signatures, and claim shapes", async () => {
    const signing = await createJwtSigner<OidcJwtClaims>();
    expect(() =>
      oidcActorResolver({
        issuer: "http://login.example.com",
        audience: "desk",
        jwksUrl: "https://login.example.com/keys",
        fetchJwks: async () => signing.jwks
      })
    ).toThrow("OIDC issuer must be an HTTPS URL");
    expect(() =>
      oidcActorResolver({
        issuer: "https://login.example.com",
        audience: "desk",
        jwksUrl: "http://login.example.com/keys",
        fetchJwks: async () => signing.jwks
      })
    ).toThrow("OIDC jwksUrl must be an HTTPS URL");
    const resolver = oidcActorResolver({
      issuer: "https://login.example.com",
      audience: "desk",
      jwksUrl: "https://login.example.com/keys",
      now: () => 1_000,
      fetchJwks: async () => signing.jwks
    });

    await expect(jwtRequest(resolver, signing, { iss: "https://other.example.com" })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "OIDC token issuer is invalid"
    });
    await expect(jwtRequest(resolver, signing, { aud: "other" })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "OIDC token audience is invalid"
    });
    await expect(jwtRequest(resolver, signing, { exp: 1_000 })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "OIDC token expired"
    });
    await expect(jwtRequest(resolver, signing, { nbf: 1_001 })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "OIDC token is not active yet"
    });
    await expect(
      jwtRequest(resolver, signing, { email_verified: "yes" as unknown as boolean })
    ).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "OIDC token payload is invalid"
    });

    const unsupported = await signing.sign(defaultClaims(), { alg: "HS256" });
    await expect(
      resolver(new Request("https://app.test", { headers: { authorization: `Bearer ${unsupported}` } }))
    ).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "OIDC token algorithm is unsupported"
    });

    const token = `${await signing.sign(defaultClaims())}x`;
    await expect(
      resolver(new Request("https://app.test", { headers: { authorization: `Bearer ${token}` } }))
    ).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "OIDC token signature is invalid"
    });

    const invalidJwksResolver = oidcActorResolver({
      issuer: "https://login.example.com",
      audience: "desk",
      jwksUrl: "https://login.example.com/keys",
      now: () => 1_000,
      fetchJwks: async () => ({ keys: [{ kid: "test-key" } as never] })
    });
    await expect(
      invalidJwksResolver(
        new Request("https://app.test", {
          headers: { authorization: `Bearer ${await signing.sign(defaultClaims())}` }
        })
      )
    ).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "OIDC signing keys are invalid"
    });
  });

  it("caches OIDC signing keys between resolver calls and refreshes on unknown keys", async () => {
    const signing = await createJwtSigner<OidcJwtClaims>();
    const rotatedSigning = await createJwtSigner<OidcJwtClaims>("rotated-key");
    let jwks = signing.jwks;
    const fetchJwks = vi.fn(async () => jwks);
    const resolver = oidcActorResolver({
      issuer: "https://login.example.com",
      audience: "desk",
      jwksUrl: "https://login.example.com/keys",
      now: () => 1_000,
      fetchJwks
    });
    const first = await signing.sign(defaultClaims({ email: "first@example.com" }));
    const second = await signing.sign(defaultClaims({ email: "second@example.com" }));
    const rotated = await rotatedSigning.sign(defaultClaims({ email: "rotated@example.com" }));

    await resolver(new Request("https://app.test", { headers: { authorization: `Bearer ${first}` } }));
    await resolver(new Request("https://app.test", { headers: { authorization: `Bearer ${second}` } }));
    jwks = rotatedSigning.jwks;
    await expect(
      resolver(new Request("https://app.test", { headers: { authorization: `Bearer ${rotated}` } }))
    ).resolves.toMatchObject({ id: "rotated@example.com" });

    expect(fetchJwks).toHaveBeenCalledTimes(2);
  });

  it("requires an OIDC subject for account sync unless the subject mapping is explicit", async () => {
    const signing = await createJwtSigner<OidcJwtClaims>();
    const events = new InMemoryEventStore();
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      ids: deterministicIds(["account-created", "provider-linked"]),
      clock: fixedClock(now)
    });
    const resolver = oidcAccountSyncActorResolver({
      issuer: "https://login.example.com",
      audience: "desk",
      jwksUrl: "https://login.example.com/keys",
      now: () => 1_000,
      fetchJwks: async () => signing.jwks,
      userAccounts,
      provider: "oidc-email",
      tenantId: () => "acme",
      subject: (claims) => claims.email
    });
    const strictResolver = oidcAccountSyncActorResolver({
      issuer: "https://login.example.com",
      audience: "desk",
      jwksUrl: "https://login.example.com/keys",
      now: () => 1_000,
      fetchJwks: async () => signing.jwks,
      userAccounts,
      provider: "oidc",
      tenantId: () => "acme"
    });
    const token = await signing.sign({
      iss: "https://login.example.com",
      aud: "desk",
      exp: 2_000,
      nbf: 900,
      email: "owner@example.com"
    });
    const request = new Request("https://app.test", { headers: { authorization: `Bearer ${token}` } });

    await expect(strictResolver(request)).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "OIDC token subject is missing"
    });
    await expect(resolver(request)).resolves.toMatchObject({
      id: "owner@example.com",
      email: "owner@example.com",
      tenantId: "acme"
    });
    await expect(events.readStream(userAccountsStream("acme", "owner@example.com"))).resolves.toMatchObject([
      { payload: { kind: "UserAccountCreated" } },
      {
        payload: {
          kind: "UserAuthProviderLinked",
          provider: "oidc-email",
          subject: "owner@example.com"
        }
      }
    ]);
  });

  it("maps Okta groups into event-sourced account roles through the provider preset", async () => {
    const signing = await createJwtSigner<OktaOidcClaims>();
    const events = new InMemoryEventStore();
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      ids: deterministicIds(["account-created", "provider-linked"]),
      clock: fixedClock(now)
    });
    const resolver = oidcAccountSyncActorResolver<OktaOidcClaims>({
      issuer: "https://okta.example.com/oauth2/default",
      audience: "desk",
      jwksUrl: "https://okta.example.com/oauth2/default/v1/keys",
      now: () => 1_000,
      fetchJwks: async () => signing.jwks,
      userAccounts,
      tenantId: () => "acme",
      ...oktaOidcProviderPreset({
        metadataClaims: ["groups", "preferred_username"]
      })
    });
    const token = await signing.sign({
      iss: "https://okta.example.com/oauth2/default",
      aud: "desk",
      exp: 2_000,
      nbf: 900,
      sub: "00u1",
      email: "owner@example.com",
      preferred_username: "owner@example.com",
      email_verified: true,
      groups: ["Support", "Desk Managers"]
    });

    await expect(
      resolver(new Request("https://app.test", { headers: { authorization: `Bearer ${token}` } }))
    ).resolves.toMatchObject({
      id: "owner@example.com",
      roles: ["Okta:Desk Managers", "Okta:Support", "User"],
      tenantId: "acme"
    });
    const saved = await events.readStream(userAccountsStream("acme", "owner@example.com"));
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({
      metadata: {
        groups: ["Support", "Desk Managers"],
        preferred_username: "owner@example.com"
      },
      payload: {
        kind: "UserAccountCreated",
        roles: ["Okta:Desk Managers", "Okta:Support", "User"]
      }
    });
  });

  it("maps Auth0 namespaced roles, optional permissions, and organization tenants", async () => {
    interface Auth0TestClaims extends Auth0OidcClaims {
      readonly "https://app.example.com/roles"?: readonly string[];
    }
    const signing = await createJwtSigner<Auth0TestClaims>();
    const events = new InMemoryEventStore();
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      ids: deterministicIds(["account-created", "provider-linked"]),
      clock: fixedClock(now)
    });
    const resolver = oidcAccountSyncActorResolver<Auth0TestClaims>({
      issuer: "https://tenant.us.auth0.com/",
      audience: "desk",
      jwksUrl: "https://tenant.us.auth0.com/.well-known/jwks.json",
      now: () => 1_000,
      fetchJwks: async () => signing.jwks,
      userAccounts,
      ...auth0OidcProviderPreset({
        namespace: "https://app.example.com",
        includePermissions: true,
        metadataClaims: ["org_id", "org_name"]
      })
    });
    const token = await signing.sign({
      iss: "https://tenant.us.auth0.com/",
      aud: "desk",
      exp: 2_000,
      nbf: 900,
      sub: "auth0|abc",
      email: "owner@example.com",
      email_verified: true,
      org_id: "tenant-acme",
      org_name: "Acme",
      permissions: ["tickets:read"],
      "https://app.example.com/roles": ["Desk Managers"]
    });

    await expect(
      resolver(new Request("https://app.test", { headers: { authorization: `Bearer ${token}` } }))
    ).resolves.toMatchObject({
      roles: ["Auth0:Desk Managers", "Auth0Permission:tickets:read", "User"],
      tenantId: "tenant-acme"
    });
    const saved = await events.readStream(userAccountsStream("tenant-acme", "owner@example.com"));
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({
      metadata: {
        org_id: "tenant-acme",
        org_name: "Acme"
      },
      payload: {
        kind: "UserAccountCreated",
        roles: ["Auth0:Desk Managers", "Auth0Permission:tickets:read", "User"]
      }
    });
  });

  it("rejects Google Workspace tokens outside allowed domains before syncing accounts", async () => {
    const signing = await createJwtSigner<GoogleWorkspaceOidcClaims>();
    const events = new InMemoryEventStore();
    const userAccounts = new UserAccountService({
      events,
      passwords: deterministicPasswords(),
      ids: deterministicIds(["account-created", "provider-linked"]),
      clock: fixedClock(now)
    });
    const resolver = oidcAccountSyncActorResolver<GoogleWorkspaceOidcClaims>({
      issuer: "https://accounts.google.com",
      audience: "desk-client",
      jwksUrl: "https://www.googleapis.com/oauth2/v3/certs",
      now: () => 1_000,
      fetchJwks: async () => signing.jwks,
      userAccounts,
      ...googleWorkspaceOidcProviderPreset({
        hostedDomains: ["example.com"],
        tenantId: "acme",
        metadataClaims: ["hd"]
      })
    });
    const blocked = await signing.sign({
      iss: "https://accounts.google.com",
      aud: "desk-client",
      exp: 2_000,
      nbf: 900,
      sub: "google-sub-1",
      email: "owner@other.com",
      email_verified: true,
      hd: "other.com"
    });
    await expect(
      resolver(new Request("https://app.test", { headers: { authorization: `Bearer ${blocked}` } }))
    ).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "OIDC token is not allowed"
    });
    await expect(events.readStream(userAccountsStream("acme", "owner@other.com"))).resolves.toEqual([]);

    const allowed = await signing.sign({
      iss: "https://accounts.google.com",
      aud: "desk-client",
      exp: 2_000,
      nbf: 900,
      sub: "google-sub-2",
      email: "owner@example.com",
      email_verified: true,
      hd: "example.com"
    });
    await expect(
      resolver(new Request("https://app.test", { headers: { authorization: `Bearer ${allowed}` } }))
    ).resolves.toEqual({
      id: "owner@example.com",
      roles: ["User"],
      tenantId: "acme",
      email: "owner@example.com"
    });
    const saved = await events.readStream(userAccountsStream("acme", "owner@example.com"));
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({
      metadata: { hd: "example.com" },
      payload: {
        kind: "UserAccountCreated",
        emailVerifiedAt: now
      }
    });
  });
});

async function jwtRequest(
  resolver: ReturnType<typeof oidcActorResolver>,
  signing: JwtSigner<OidcJwtClaims>,
  claims: Partial<OidcJwtClaims>
): Promise<unknown> {
  const token = await signing.sign(defaultClaims(claims));
  return resolver(new Request("https://app.test", { headers: { authorization: `Bearer ${token}` } }));
}

function defaultClaims(overrides: Partial<OidcJwtClaims> = {}): OidcJwtClaims {
  return {
    iss: "https://login.example.com",
    aud: "desk",
    exp: 2_000,
    nbf: 900,
    sub: "subject",
    email: "owner@example.com",
    ...overrides
  };
}

function deterministicPasswords(): PasswordHasher {
  return {
    async hash(password) {
      return `hash:${password}`;
    },
    async verify(password, encodedHash) {
      return encodedHash === `hash:${password}`;
    }
  };
}
