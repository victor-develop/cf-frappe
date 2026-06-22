import {
  cloudflareAccessActorResolver,
  DEFAULT_TENANT_ID,
  type CloudflareAccessJwtClaims,
  type CloudflareAccessJwks
} from "../../src";

describe("Cloudflare Access actor resolver", () => {
  it("verifies Access JWT headers and resolves a default actor", async () => {
    const signing = await createJwtSigner();
    const token = await signing.sign({
      iss: "https://acme.cloudflareaccess.com",
      aud: "app-aud",
      exp: 2_000,
      nbf: 900,
      sub: "user-subject",
      email: "owner@example.com"
    });
    const fetchJwks = vi.fn(async () => signing.jwks);
    const resolver = cloudflareAccessActorResolver({
      teamDomain: "https://acme.cloudflareaccess.com/",
      audience: " app-aud ",
      now: () => 1_000,
      fetchJwks
    });

    await expect(
      resolver(new Request("https://app.test", { headers: { "cf-access-jwt-assertion": token } }))
    ).resolves.toEqual({
      id: "owner@example.com",
      roles: ["User"],
      tenantId: DEFAULT_TENANT_ID,
      email: "owner@example.com"
    });
    expect(fetchJwks).toHaveBeenCalledWith("https://acme.cloudflareaccess.com/cdn-cgi/access/certs");
  });

  it("accepts the browser authorization cookie and custom claim mapping", async () => {
    const signing = await createJwtSigner();
    const token = await signing.sign({
      iss: "https://team.cloudflareaccess.com",
      aud: ["other", "desk"],
      exp: 2_000,
      sub: "subject-1",
      email: "manager@example.com",
      groups: ["Desk Managers", "Support"]
    });
    const resolver = cloudflareAccessActorResolver({
      teamDomain: "team.cloudflareaccess.com",
      audience: ["desk", "admin"],
      now: () => 1_000,
      fetchJwks: async () => signing.jwks,
      roles: (claims) => claims.groups?.map((group) => `Access:${group}`) ?? ["User"],
      tenantId: () => "acme",
      actorId: (claims) => claims.sub
    });

    await expect(
      resolver(new Request("https://app.test", { headers: { cookie: `other=1; CF_Authorization=${token}` } }))
    ).resolves.toEqual({
      id: "subject-1",
      roles: ["Access:Desk Managers", "Access:Support"],
      tenantId: "acme",
      email: "manager@example.com"
    });
  });

  it("uses a fallback actor when no Access JWT exists", async () => {
    const resolver = cloudflareAccessActorResolver({
      teamDomain: "team.cloudflareaccess.com",
      audience: "desk",
      fetchJwks: async () => ({ keys: [] }),
      fallback: () => ({ id: "guest", roles: ["Guest"], tenantId: "default" })
    });

    await expect(resolver(new Request("https://app.test"))).resolves.toEqual({
      id: "guest",
      roles: ["Guest"],
      tenantId: "default"
    });
  });

  it("rejects bad issuer, audience, validity windows, and signatures", async () => {
    const signing = await createJwtSigner();
    const resolver = cloudflareAccessActorResolver({
      teamDomain: "team.cloudflareaccess.com",
      audience: "desk",
      now: () => 1_000,
      fetchJwks: async () => signing.jwks
    });

    await expect(jwtRequest(resolver, signing, { iss: "https://other.cloudflareaccess.com" })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "Cloudflare Access JWT issuer is invalid"
    });
    await expect(jwtRequest(resolver, signing, { aud: "other" })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "Cloudflare Access JWT audience is invalid"
    });
    await expect(jwtRequest(resolver, signing, { exp: 1_000 })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "Cloudflare Access JWT expired"
    });
    await expect(jwtRequest(resolver, signing, { nbf: 1_001 })).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "Cloudflare Access JWT is not active yet"
    });
    await expect(
      jwtRequest(resolver, signing, { groups: [123] as unknown as readonly string[] })
    ).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "Cloudflare Access JWT payload is invalid"
    });

    const token = `${await signing.sign(defaultClaims())}x`;
    await expect(
      resolver(new Request("https://app.test", { headers: { "cf-access-jwt-assertion": token } }))
    ).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "Cloudflare Access JWT signature is invalid"
    });

    const invalidJwksResolver = cloudflareAccessActorResolver({
      teamDomain: "team.cloudflareaccess.com",
      audience: "desk",
      now: () => 1_000,
      fetchJwks: async () => ({ keys: [{ kid: "test-key" } as never] })
    });
    await expect(
      invalidJwksResolver(
        new Request("https://app.test", {
          headers: { "cf-access-jwt-assertion": await signing.sign(defaultClaims()) }
        })
      )
    ).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "Cloudflare Access signing keys are invalid"
    });
  });

  it("caches Access signing keys between resolver calls", async () => {
    const signing = await createJwtSigner();
    const rotatedSigning = await createJwtSigner("rotated-key");
    let jwks = signing.jwks;
    const fetchJwks = vi.fn(async () => jwks);
    const resolver = cloudflareAccessActorResolver({
      teamDomain: "team.cloudflareaccess.com",
      audience: "desk",
      now: () => 1_000,
      fetchJwks
    });
    const first = await signing.sign(defaultClaims({ email: "first@example.com" }));
    const second = await signing.sign(defaultClaims({ email: "second@example.com" }));
    const rotated = await rotatedSigning.sign(defaultClaims({ email: "rotated@example.com" }));

    await resolver(new Request("https://app.test", { headers: { "cf-access-jwt-assertion": first } }));
    await resolver(new Request("https://app.test", { headers: { "cf-access-jwt-assertion": second } }));
    jwks = rotatedSigning.jwks;
    await expect(
      resolver(new Request("https://app.test", { headers: { "cf-access-jwt-assertion": rotated } }))
    ).resolves.toMatchObject({ id: "rotated@example.com" });

    expect(fetchJwks).toHaveBeenCalledTimes(2);
  });
});

async function jwtRequest(
  resolver: ReturnType<typeof cloudflareAccessActorResolver>,
  signing: JwtSigner,
  claims: Partial<CloudflareAccessJwtClaims>
): Promise<unknown> {
  const token = await signing.sign(defaultClaims(claims));
  return resolver(new Request("https://app.test", { headers: { "cf-access-jwt-assertion": token } }));
}

function defaultClaims(overrides: Partial<CloudflareAccessJwtClaims> = {}): CloudflareAccessJwtClaims {
  return {
    iss: "https://team.cloudflareaccess.com",
    aud: "desk",
    exp: 2_000,
    nbf: 900,
    sub: "subject",
    email: "owner@example.com",
    ...overrides
  };
}

interface JwtSigner {
  readonly jwks: CloudflareAccessJwks;
  sign(claims: CloudflareAccessJwtClaims): Promise<string>;
}

async function createJwtSigner(kid = "test-key"): Promise<JwtSigner> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  );
  const publicJwk = {
    ...(await crypto.subtle.exportKey("jwk", keyPair.publicKey)),
    kid,
    alg: "RS256",
    use: "sig"
  };
  return {
    jwks: { keys: [publicJwk] },
    async sign(claims) {
      const header = { alg: "RS256", typ: "JWT", kid };
      const headerPart = base64UrlJson(header);
      const payloadPart = base64UrlJson(claims);
      const signature = await crypto.subtle.sign(
        { name: "RSASSA-PKCS1-v1_5" },
        keyPair.privateKey,
        new TextEncoder().encode(`${headerPart}.${payloadPart}`)
      );
      return `${headerPart}.${payloadPart}.${base64UrlEncode(new Uint8Array(signature))}`;
    }
  };
}

function base64UrlJson(value: unknown): string {
  return base64UrlEncode(new TextEncoder().encode(JSON.stringify(value)));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index]!);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
