import {
  SYSTEM_MANAGER_ROLE,
  UserAccountService,
  createResourceApi,
  deterministicIds,
  fixedClock,
  userAccountSessionActorResolver,
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
});

function makeAuthApp(maxJsonBytes = 1_048_576) {
  const services = createServices(["e1"], {
    savedFilterIds: ["sf1", "sfe1"],
    savedReportIds: ["sr1", "sre1"]
  });
  const userAccounts = new UserAccountService({
    events: services.events,
    passwords: deterministicPasswords(),
    ids: deterministicIds(["account-1", "roles-1", "password-1", "disable-1", "enable-1"]),
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
