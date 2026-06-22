import {
  createInMemoryAccountRecoveryNotifier,
  SYSTEM_MANAGER_ROLE,
  UserAccountService,
  createResourceApi,
  deterministicIds,
  fixedClock,
  userAccountSessionActorResolver,
  userAccountsStream,
  unsafeHeaderActorResolver,
  type ActorResolver,
  type PasswordHasher
} from "../../src";
import { createServices, now } from "../helpers";

const adminHeaders = {
  "content-type": "application/json",
  "x-cf-frappe-user": "admin@example.com",
  "x-cf-frappe-roles": SYSTEM_MANAGER_ROLE,
  "x-cf-frappe-tenant": "acme"
};

describe("auth and user account api", () => {
  it("creates accounts, logs in with signed sessions, resolves me, and logs out", async () => {
    const { app } = makeAuthApp();

    const created = await app.request("/api/users/owner%40example.com", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        email: "owner@example.com",
        password: "secret-123",
        roles: ["User"]
      })
    });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      data: {
        tenantId: "acme",
        userId: "owner@example.com",
        email: "owner@example.com",
        roles: ["User"],
        enabled: true,
        version: 1
      }
    });

    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "owner@example.com",
        password: "secret-123",
        tenantId: "acme"
      })
    });
    const cookie = login.headers.get("set-cookie") ?? "";
    expect(login.status).toBe(200);
    expect(cookie).toContain("cf_frappe_session=");
    expect(cookie).toContain("HttpOnly");
    await expect(login.json()).resolves.toMatchObject({
      data: {
        id: "owner@example.com",
        email: "owner@example.com",
        roles: ["User"],
        tenantId: "acme"
      }
    });

    const me = await app.request("/api/auth/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toMatchObject({
      data: {
        id: "owner@example.com",
        email: "owner@example.com",
        roles: ["User"],
        tenantId: "acme"
      }
    });

    const logout = await app.request("/api/auth/logout", { method: "POST", headers: { cookie } });
    expect(logout.status).toBe(204);
    expect(logout.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("manages roles, passwords, and enabled state through admin routes", async () => {
    const { app } = makeAuthApp();
    await app.request("/api/users/owner%40example.com", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ password: "secret-123", roles: ["User"] })
    });

    const roles = await app.request("/api/users/owner%40example.com/roles", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ roles: ["Task Manager", "User"], expectedVersion: 1 })
    });
    expect(roles.status).toBe(200);
    await expect(roles.json()).resolves.toMatchObject({ data: { version: 2, roles: ["Task Manager", "User"] } });

    const password = await app.request("/api/users/owner%40example.com/password", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ password: "secret-456", expectedVersion: 2 })
    });
    expect(password.status).toBe(200);
    await expect(password.json()).resolves.toMatchObject({ data: { version: 3 } });

    const disabled = await app.request("/api/users/owner%40example.com/disable", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ expectedVersion: 3 })
    });
    expect(disabled.status).toBe(200);
    await expect(disabled.json()).resolves.toMatchObject({ data: { version: 4, enabled: false } });

    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "owner@example.com", password: "secret-456", tenantId: "acme" })
    });
    expect(login.status).toBe(403);
    await expect(login.json()).resolves.toMatchObject({
      error: { code: "PERMISSION_DENIED", message: "Invalid credentials" }
    });

    const enabled = await app.request("/api/users/owner%40example.com/enable", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ expectedVersion: 4 })
    });
    expect(enabled.status).toBe(200);
    await expect(enabled.json()).resolves.toMatchObject({ data: { version: 5, enabled: true } });
  });

  it("maps auth route validation, permission, and body-limit failures to JSON errors", async () => {
    const { app } = makeAuthApp(40);
    const denied = await app.request("/api/users/owner%40example.com", {
      method: "POST",
      headers: { ...adminHeaders, "x-cf-frappe-roles": "User" },
      body: JSON.stringify({ password: "12345678", roles: ["User"] })
    });
    expect(denied.status).toBe(403);
    await expect(denied.json()).resolves.toMatchObject({ error: { code: "PERMISSION_DENIED" } });

    const deniedMalformedWrite = await app.request("/api/users/owner%40example.com/roles", {
      method: "PUT",
      headers: { ...adminHeaders, "x-cf-frappe-roles": "User" },
      body: "{"
    });
    expect(deniedMalformedWrite.status).toBe(403);
    await expect(deniedMalformedWrite.json()).resolves.toMatchObject({ error: { code: "PERMISSION_DENIED" } });

    const oversized = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "99" },
      body: "{}"
    });
    expect(oversized.status).toBe(400);
    await expect(oversized.json()).resolves.toMatchObject({ error: { code: "BAD_REQUEST" } });

    const missingIdentifier = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "secret-123" })
    });
    expect(missingIdentifier.status).toBe(400);
    await expect(missingIdentifier.json()).resolves.toMatchObject({
      error: { code: "BAD_REQUEST", message: "userId is required" }
    });
  });

  it("rejects existing signed-session cookies after account events change the stream version", async () => {
    const { app } = makeAuthApp();
    await app.request("/api/users/owner%40example.com", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ password: "secret-123", roles: ["User"] })
    });
    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "owner@example.com", password: "secret-123", tenantId: "acme" })
    });
    const cookie = login.headers.get("set-cookie") ?? "";

    const before = await app.request("/api/auth/me", { headers: { cookie } });
    expect(before.status).toBe(200);

    const changed = await app.request("/api/users/owner%40example.com/roles", {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({ roles: ["Task Manager"], expectedVersion: 1 })
    });
    expect(changed.status).toBe(200);

    const after = await app.request("/api/auth/me", { headers: { cookie } });
    expect(after.status).toBe(403);
    await expect(after.json()).resolves.toMatchObject({
      error: { code: "PERMISSION_DENIED", message: "Session is no longer valid" }
    });
  });

  it("exposes generic password reset and email verification auth routes", async () => {
    const { app, recovery, services } = makeAuthApp();
    await app.request("/api/users/owner%40example.com", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({
        email: "owner@example.com",
        password: "secret-123",
        roles: ["User"]
      })
    });

    const resetRequest = await app.request("/api/auth/password-reset/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "owner@example.com", tenantId: "acme", expiresInSeconds: 1 })
    });
    expect(resetRequest.status).toBe(202);
    await expect(resetRequest.json()).resolves.toEqual({ data: { accepted: true } });
    expect(recovery.passwordResetMessages).toHaveLength(1);
    expect(recovery.passwordResetMessages[0]?.expiresAt).toBe("2026-01-01T01:00:00.000Z");

    const resetComplete = await app.request("/api/auth/password-reset/complete?token=should-not-persist", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "owner@example.com",
        tenantId: "acme",
        token: recovery.passwordResetMessages[0]?.token,
        password: "secret-456"
      })
    });
    expect(resetComplete.status).toBe(200);
    await expect(resetComplete.json()).resolves.toMatchObject({
      data: { userId: "owner@example.com", version: 3 }
    });
    await expect(services.events.readStream(userAccountsStream("acme", "owner@example.com"))).resolves.toMatchObject([
      { payload: { kind: "UserAccountCreated" } },
      { payload: { kind: "UserPasswordResetRequested" } },
      {
        payload: { kind: "UserPasswordResetCompleted" },
        metadata: { url: "http://localhost/api/auth/password-reset/complete?token=%5Bredacted%5D" }
      }
    ]);

    const verifyRequest = await app.request("/api/auth/email-verification/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "owner@example.com", tenantId: "acme", expiresInSeconds: 1 })
    });
    expect(verifyRequest.status).toBe(202);
    await expect(verifyRequest.json()).resolves.toEqual({ data: { accepted: true } });
    expect(recovery.emailVerificationMessages).toHaveLength(1);
    expect(recovery.emailVerificationMessages[0]?.expiresAt).toBe("2026-01-02T00:00:00.000Z");

    const verifyComplete = await app.request("/api/auth/email-verification/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "owner@example.com",
        tenantId: "acme",
        token: recovery.emailVerificationMessages[0]?.token
      })
    });
    expect(verifyComplete.status).toBe(200);
    await expect(verifyComplete.json()).resolves.toMatchObject({
      data: {
        userId: "owner@example.com",
        emailVerifiedAt: now
      }
    });
  });

  it("does not expose account existence through recovery request routes", async () => {
    const { app, recovery } = makeAuthApp();

    const missing = await app.request("/api/auth/password-reset/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "missing@example.com", tenantId: "acme" })
    });
    expect(missing.status).toBe(202);
    await expect(missing.json()).resolves.toEqual({ data: { accepted: true } });

    const malformed = await app.request("/api/auth/password-reset/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "missing@example.com", tenantId: "acme", token: "bad", password: "secret-456" })
    });
    expect(malformed.status).toBe(403);
    await expect(malformed.json()).resolves.toMatchObject({ error: { code: "PERMISSION_DENIED" } });
    expect(recovery.passwordResetMessages).toEqual([]);
  });
});

function makeAuthApp(maxJsonBytes = 1_048_576) {
  const services = createServices(["e1"], {
    savedFilterIds: ["sf1", "sfe1"],
    savedReportIds: ["sr1", "sre1"]
  });
  const recovery = createInMemoryAccountRecoveryNotifier();
  const userAccounts = new UserAccountService({
    events: services.events,
    passwords: deterministicPasswords(),
    recovery,
    ids: deterministicIds([
      "account-1",
      "roles-1",
      "password-1",
      "disable-1",
      "enable-1",
      "reset-request-1",
      "reset-complete-1",
      "verify-request-1",
      "verify-complete-1"
    ]),
    recoveryTokens: deterministicIds(["reset-token-1", "verify-token-1"]),
    clock: fixedClock(now)
  });
  const actor: ActorResolver = userAccountSessionActorResolver({
    userAccounts,
    secret: "test-secret",
    fallback: unsafeHeaderActorResolver
  });
  return {
    services,
    userAccounts,
    recovery,
    app: createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      actor,
      userAccounts,
      auth: {
        secret: "test-secret",
        maxAgeSeconds: 3_600,
        secure: false
      },
      maxJsonBytes
    })
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
