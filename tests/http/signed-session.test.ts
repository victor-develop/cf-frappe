import {
  createSignedSessionCookie,
  clearSignedSessionCookie,
  signedSessionActorResolver,
  DEFAULT_TENANT_ID,
  type Actor
} from "../../src";

const actor: Actor = {
  id: "owner@example.com",
  roles: ["User", "Task Manager"],
  tenantId: "acme",
  email: "owner@example.com"
};

describe("signed session actor resolver", () => {
  it("issues an HttpOnly signed session cookie and resolves its actor", async () => {
    const cookie = await createSignedSessionCookie(actor, {
      secret: "test-secret",
      now: () => 1_000,
      maxAgeSeconds: 3_600,
      secure: false
    });

    expect(cookie).toContain("cf_frappe_session=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Max-Age=3600");
    expect(cookie).not.toContain("Secure");

    const resolver = signedSessionActorResolver({
      secret: "test-secret",
      now: () => 2_000
    });
    await expect(resolver(new Request("http://localhost", { headers: { cookie } }))).resolves.toEqual(actor);
  });

  it("round trips UTF-8 actor claims through the signed session cookie", async () => {
    const unicodeActor: Actor = {
      id: "renee@example.com",
      roles: ["User", "Equipe"],
      tenantId: "acme-paris",
      email: "renee+équipe@example.com"
    };
    const cookie = await createSignedSessionCookie(unicodeActor, {
      secret: "test-secret",
      now: () => 1_000,
      maxAgeSeconds: 3_600,
      secure: false
    });
    const resolver = signedSessionActorResolver({
      secret: "test-secret",
      now: () => 1_001
    });

    await expect(resolver(new Request("http://localhost", { headers: { cookie } }))).resolves.toEqual(unicodeActor);
  });

  it("rejects blank actor ids when issuing signed session cookies", async () => {
    await expect(
      createSignedSessionCookie(
        { ...actor, id: " \t " },
        {
          secret: "test-secret",
          now: () => 1_000,
          maxAgeSeconds: 3_600
        }
      )
    ).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "Session actor id is invalid"
    });
  });

  it("rejects tampered and expired sessions", async () => {
    const cookie = await createSignedSessionCookie(actor, {
      secret: "test-secret",
      now: () => 1_000,
      maxAgeSeconds: 10
    });
    const tampered = cookie.replace("cf_frappe_session=", "cf_frappe_session=A");
    const resolver = signedSessionActorResolver({
      secret: "test-secret",
      now: () => 1_005
    });

    await expect(resolver(new Request("https://app.test", { headers: { cookie: tampered } }))).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
    await expect(
      signedSessionActorResolver({ secret: "test-secret", now: () => 1_011 })(
        new Request("https://app.test", { headers: { cookie } })
      )
    ).rejects.toMatchObject({
      code: "PERMISSION_DENIED",
      message: "Session expired"
    });
  });

  it("can fall back to a guest actor when no signed cookie exists", async () => {
    const resolver = signedSessionActorResolver({
      secret: "test-secret",
      fallback: () => ({ id: "guest", roles: ["Guest"], tenantId: DEFAULT_TENANT_ID })
    });

    await expect(resolver(new Request("https://app.test"))).resolves.toEqual({
      id: "guest",
      roles: ["Guest"],
      tenantId: DEFAULT_TENANT_ID
    });
  });

  it("creates a clearing cookie with matching scope", () => {
    expect(clearSignedSessionCookie({ secure: false })).toBe(
      "cf_frappe_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"
    );
  });
});
