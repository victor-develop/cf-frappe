import {
  createCloudFrappeWorker,
  createInMemoryAccountRecoveryNotifier,
  createSignedSessionCookie,
  deterministicIds,
  fixedClock,
  signedSessionActorResolver,
  SYSTEM_MANAGER_ROLE,
  unsafeHeaderActorResolver,
  type AggregateCoordinatorRpc,
  type PasswordHasher,
  type RealtimeHubNamespace,
  type RpcDurableObjectNamespace
} from "../../src";
import { createTestRegistry, now, owner } from "../helpers";

describe("CloudFrappe Worker routing", () => {
  it("routes only /desk and /desk/* to the Desk app", async () => {
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner
    });
    const env = {
      DB: fakeD1(),
      AGGREGATES: fakeNamespace()
    };

    const fetch = worker.fetch!;
    const desk = await fetch(cfRequest("http://localhost/desk"), env, fakeExecutionContext());
    const deskish = await fetch(cfRequest("http://localhost/deskish"), env, fakeExecutionContext());

    expect(desk.status).toBe(200);
    expect(desk.headers.get("content-type")).toContain("text/html");
    expect(deskish.status).toBe(404);
    expect(deskish.headers.get("content-type")).toContain("application/json");
  });

  it("serves the built-in Desk client runtime through Worker routing", async () => {
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner
    });
    const env = {
      DB: fakeD1(),
      AGGREGATES: fakeNamespace()
    };

    const response = await worker.fetch!(cfRequest("http://localhost/desk/client.js"), env, fakeExecutionContext());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/javascript");
    await expect(response.text()).resolves.toContain("root.cfFrappe");
  });

  it("mounts admin audit search on the Worker API", async () => {
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" })
    });
    const env = {
      DB: fakeD1(),
      AGGREGATES: fakeNamespace()
    };

    const response = await worker.fetch!(cfRequest("http://localhost/api/audit/events?limit=1"), env, fakeExecutionContext());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { tenantId: "acme", events: [] } });
  });

  it("mounts saved report-builder definitions on the Worker API", async () => {
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner
    });
    const env = {
      DB: fakeD1(),
      AGGREGATES: fakeNamespace()
    };

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/report-builder/Note"),
      env,
      fakeExecutionContext()
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: [] });
  });

  it("mounts user-permission admin API and Desk routes on the Worker", async () => {
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" })
    });
    const env = {
      DB: fakeD1(),
      AGGREGATES: fakeNamespace()
    };

    const api = await worker.fetch!(
      cfRequest("http://localhost/api/user-permissions/admin%40example.com"),
      env,
      fakeExecutionContext()
    );
    expect(api.status).toBe(200);
    await expect(api.json()).resolves.toMatchObject({
      data: {
        tenantId: "acme",
        userId: "admin@example.com",
        grants: []
      }
    });

    const desk = await worker.fetch!(
      cfRequest("http://localhost/desk/admin/user-permissions?user=admin%40example.com"),
      env,
      fakeExecutionContext()
    );
    expect(desk.status).toBe(200);
    const html = await desk.text();
    expect(html).toContain("User Permissions");
    expect(html).toContain("No grants configured.");
  });

  it("mounts role catalog API and Desk routes on the Worker", async () => {
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" })
    });
    const env = {
      DB: fakeEventD1(),
      AGGREGATES: fakeNamespace()
    };

    const empty = await worker.fetch!(cfRequest("http://localhost/api/roles"), env, fakeExecutionContext());
    expect(empty.status).toBe(200);
    await expect(empty.json()).resolves.toMatchObject({
      data: { tenantId: "acme", version: 0, roles: [] }
    });

    const created = await worker.fetch!(
      cfRequest("http://localhost/api/roles/Support%20Lead", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: "Escalation owner", expectedVersion: 0 })
      }),
      env,
      fakeExecutionContext()
    );
    expect(created.status).toBe(201);

    const desk = await worker.fetch!(
      cfRequest("http://localhost/desk/admin/roles"),
      env,
      fakeExecutionContext()
    );
    expect(desk.status).toBe(200);
    const html = await desk.text();
    expect(html).toContain("Support Lead");
    expect(html).toContain("Escalation owner");
    expect(html).toContain('action="/desk/admin/roles/Support%20Lead/disable"');
  });

  it("uses custom auth admin roles for Worker role catalog administration", async () => {
    const worker = createCloudFrappeWorker<CloudFrappeAuthTestEnv>({
      registry: createTestRegistry(),
      actor: () => ({ id: "desk-admin@example.com", roles: ["Desk Admin"], tenantId: "acme" }),
      auth: {
        sessionSecret: (env) => env.SESSION_SECRET,
        sessionMaxAgeSeconds: 60,
        secure: false,
        adminRoles: ["Desk Admin"]
      }
    });
    const env = { DB: fakeEventD1(), AGGREGATES: fakeNamespace(), SESSION_SECRET: "edge-secret" };

    const api = await worker.fetch!(cfRequest("http://localhost/api/roles"), env, fakeExecutionContext());
    expect(api.status).toBe(200);
    await expect(api.json()).resolves.toMatchObject({ data: { tenantId: "acme", roles: [] } });

    const desk = await worker.fetch!(
      cfRequest("http://localhost/desk/admin/roles"),
      env,
      fakeExecutionContext()
    );
    expect(desk.status).toBe(200);
    await expect(desk.text()).resolves.toContain("Create Role");
  });

  it("can validate account roles against the Worker role catalog", async () => {
    const worker = createCloudFrappeWorker<CloudFrappeAuthTestEnv>({
      registry: createTestRegistry(),
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" }),
      auth: {
        sessionSecret: (env) => env.SESSION_SECRET,
        sessionMaxAgeSeconds: 60,
        secure: false,
        validateRolesWithCatalog: true,
        passwords: deterministicPasswords(),
        ids: deterministicIds(["account-1"])
      }
    });
    const env = { DB: fakeEventD1(), AGGREGATES: fakeNamespace(), SESSION_SECRET: "edge-secret" };

    await worker.fetch!(
      cfRequest("http://localhost/api/roles/User", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: 0 })
      }),
      env,
      fakeExecutionContext()
    );

    const invalid = await worker.fetch!(
      cfRequest("http://localhost/api/users/ghost%40example.com", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "secret-123", roles: ["Ghost"] })
      }),
      env,
      fakeExecutionContext()
    );
    expect(invalid.status).toBe(422);
    await expect(invalid.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_FAILED",
        issues: [{ field: "roles", code: "role_not_found" }]
      }
    });

    const valid = await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "secret-123", roles: ["User"] })
      }),
      env,
      fakeExecutionContext()
    );
    expect(valid.status).toBe(201);
    await expect(valid.json()).resolves.toMatchObject({ data: { roles: ["User"] } });
  });

  it("supports env-backed signed-session actor resolvers in the Worker factory", async () => {
    const cookie = await createSignedSessionCookie(owner, {
      secret: "edge-secret",
      maxAgeSeconds: 60,
      secure: false
    });
    const worker = createCloudFrappeWorker<CloudFrappeAuthTestEnv>({
      registry: createTestRegistry(),
      actor: (request, env) => signedSessionActorResolver({ secret: env.SESSION_SECRET })(request)
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/meta/doctypes/Note", { headers: { cookie } }),
      { DB: fakeD1(), AGGREGATES: fakeNamespace(), SESSION_SECRET: "edge-secret" },
      fakeExecutionContext()
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ data: { name: "Note" } });
  });

  it("mounts optional account auth routes in the Worker factory", async () => {
    const worker = createCloudFrappeWorker<CloudFrappeAuthTestEnv>({
      registry: createTestRegistry(),
      actor: () => owner,
      auth: {
        sessionSecret: (env) => env.SESSION_SECRET,
        sessionMaxAgeSeconds: 60,
        secure: false
      }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/auth/logout", { method: "POST" }),
      { DB: fakeD1(), AGGREGATES: fakeNamespace(), SESSION_SECRET: "edge-secret" },
      fakeExecutionContext()
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("cf_frappe_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
  });

  it("mounts account recovery auth routes with Worker auth configuration", async () => {
    const recovery = createInMemoryAccountRecoveryNotifier();
    const worker = createCloudFrappeWorker<CloudFrappeAuthTestEnv>({
      registry: createTestRegistry(),
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" }),
      auth: {
        sessionSecret: (env) => env.SESSION_SECRET,
        sessionMaxAgeSeconds: 60,
        secure: false,
        passwords: deterministicPasswords(),
        recovery,
        ids: deterministicIds(["account-1", "reset-request-1"]),
        recoveryTokens: deterministicIds(["reset-token-1"]),
        clock: fixedClock(now)
      }
    });
    const env = { DB: fakeEventD1(), AGGREGATES: fakeNamespace(), SESSION_SECRET: "edge-secret" };

    await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "owner@example.com", password: "secret-123", roles: ["User"] })
      }),
      env,
      fakeExecutionContext()
    );
    const response = await worker.fetch!(
      cfRequest("http://localhost/api/auth/password-reset/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "owner@example.com", tenantId: "acme" })
      }),
      env,
      fakeExecutionContext()
    );

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ data: { accepted: true } });
    expect(recovery.passwordResetMessages).toEqual([
      {
        tenantId: "acme",
        userId: "owner@example.com",
        email: "owner@example.com",
        token: "tok_reset-token-1",
        expiresAt: "2026-01-01T01:00:00.000Z"
      }
    ]);
  });

  it("mounts user profile API routes with Worker auth configuration", async () => {
    const worker = createCloudFrappeWorker<CloudFrappeAuthTestEnv>({
      registry: createTestRegistry(),
      actor: unsafeHeaderActorResolver,
      auth: {
        sessionSecret: (env) => env.SESSION_SECRET,
        sessionMaxAgeSeconds: 60,
        secure: false,
        passwords: deterministicPasswords(),
        ids: deterministicIds(["account-1", "profile-1"]),
        clock: fixedClock(now)
      }
    });
    const env = { DB: fakeEventD1(), AGGREGATES: fakeNamespace(), SESSION_SECRET: "edge-secret" };
    const adminHeaders = {
      "content-type": "application/json",
      "x-cf-frappe-user": "admin@example.com",
      "x-cf-frappe-roles": SYSTEM_MANAGER_ROLE,
      "x-cf-frappe-tenant": "acme"
    };

    const created = await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ password: "secret-123", roles: ["User"] })
      }),
      env,
      fakeExecutionContext()
    );
    expect(created.status).toBe(201);

    const profile = await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com/profile", {
        method: "PUT",
        headers: adminHeaders,
        body: JSON.stringify({ fullName: "Ada Lovelace", expectedVersion: 0 })
      }),
      env,
      fakeExecutionContext()
    );

    expect(profile.status).toBe(200);
    await expect(profile.json()).resolves.toMatchObject({
      data: {
        userId: "owner@example.com",
        version: 1,
        profile: { fullName: "Ada Lovelace" }
      }
    });
  });

  it("revalidates signed account sessions before profile routes", async () => {
    const worker = createCloudFrappeWorker<CloudFrappeAuthTestEnv>({
      registry: createTestRegistry(),
      actor: unsafeHeaderActorResolver,
      auth: {
        sessionSecret: (env) => env.SESSION_SECRET,
        sessionMaxAgeSeconds: 60,
        revalidateSignedSessions: true,
        secure: false,
        passwords: deterministicPasswords(),
        ids: deterministicIds(["account-1", "profile-1", "roles-1"]),
        clock: fixedClock(now)
      }
    });
    const env = { DB: fakeEventD1(), AGGREGATES: fakeNamespace(), SESSION_SECRET: "edge-secret" };
    const adminHeaders = {
      "content-type": "application/json",
      "x-cf-frappe-user": "admin@example.com",
      "x-cf-frappe-roles": SYSTEM_MANAGER_ROLE,
      "x-cf-frappe-tenant": "acme"
    };
    await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ password: "secret-123", roles: ["User"] })
      }),
      env,
      fakeExecutionContext()
    );
    const login = await worker.fetch!(
      cfRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "owner@example.com", password: "secret-123", tenantId: "acme" })
      }),
      env,
      fakeExecutionContext()
    );
    const cookie = login.headers.get("set-cookie") ?? "";
    const profile = await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com/profile", {
        method: "PUT",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ fullName: "Ada Lovelace", expectedVersion: 0 })
      }),
      env,
      fakeExecutionContext()
    );
    expect(profile.status).toBe(200);
    await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com/roles", {
        method: "PUT",
        headers: adminHeaders,
        body: JSON.stringify({ roles: ["Task Manager"], expectedVersion: 1 })
      }),
      env,
      fakeExecutionContext()
    );

    const stale = await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com/profile", { headers: { cookie } }),
      env,
      fakeExecutionContext()
    );

    expect(stale.status).toBe(403);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: "PERMISSION_DENIED", message: "Session is no longer valid" }
    });
  });

  it("mounts auth-backed Desk user account administration in the Worker factory", async () => {
    const worker = createCloudFrappeWorker<CloudFrappeAuthTestEnv>({
      registry: createTestRegistry(),
      actor: () => ({ id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" }),
      auth: {
        sessionSecret: (env) => env.SESSION_SECRET,
        sessionMaxAgeSeconds: 60,
        secure: false,
        passwords: deterministicPasswords(),
        ids: deterministicIds(["account-1"]),
        clock: fixedClock(now)
      }
    });
    const env = { DB: fakeEventD1(), AGGREGATES: fakeNamespace(), SESSION_SECRET: "edge-secret" };

    const empty = await worker.fetch!(
      cfRequest("http://localhost/desk/admin/users"),
      env,
      fakeExecutionContext()
    );
    expect(empty.status).toBe(200);
    await expect(empty.text()).resolves.toContain("Create User");

    const created = await worker.fetch!(
      cfRequest("http://localhost/desk/admin/users", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          user: "worker@example.com",
          password: "secret-123",
          roles: "User",
          enabled: "true",
          expectedVersion: "0"
        })
      }),
      env,
      fakeExecutionContext()
    );
    expect(created.status).toBe(303);
    expect(created.headers.get("location")).toBe("/desk/admin/users?user=worker%40example.com");

    const loaded = await worker.fetch!(
      cfRequest("http://localhost/desk/admin/users?user=worker%40example.com"),
      env,
      fakeExecutionContext()
    );
    expect(loaded.status).toBe(200);
    const html = await loaded.text();
    expect(html).toContain("worker@example.com");
    expect(html).toContain('action="/desk/admin/users/disable"');
    expect(html).not.toContain("hash:secret-123");
  });

  it("logs in and revalidates account sessions through Worker auth configuration", async () => {
    const worker = createCloudFrappeWorker<CloudFrappeAuthTestEnv>({
      registry: createTestRegistry(),
      actor: unsafeHeaderActorResolver,
      auth: {
        sessionSecret: (env) => env.SESSION_SECRET,
        sessionMaxAgeSeconds: 60,
        revalidateSignedSessions: true,
        secure: false,
        passwords: deterministicPasswords(),
        ids: deterministicIds(["account-1", "roles-1"]),
        clock: fixedClock(now)
      }
    });
    const env = { DB: fakeEventD1(), AGGREGATES: fakeNamespace(), SESSION_SECRET: "edge-secret" };
    const adminHeaders = {
      "content-type": "application/json",
      "x-cf-frappe-user": "admin@example.com",
      "x-cf-frappe-roles": SYSTEM_MANAGER_ROLE,
      "x-cf-frappe-tenant": "acme"
    };

    const created = await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ password: "secret-123", roles: ["User"] })
      }),
      env,
      fakeExecutionContext()
    );
    expect(created.status).toBe(201);

    const login = await worker.fetch!(
      cfRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "owner@example.com", password: "secret-123", tenantId: "acme" })
      }),
      env,
      fakeExecutionContext()
    );
    const cookie = login.headers.get("set-cookie") ?? "";
    expect(login.status).toBe(200);
    expect(cookie).toContain("cf_frappe_session=");

    const me = await worker.fetch!(
      cfRequest("http://localhost/api/auth/me", { headers: { cookie } }),
      env,
      fakeExecutionContext()
    );
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toMatchObject({ data: { id: "owner@example.com", roles: ["User"] } });

    const changed = await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com/roles", {
        method: "PUT",
        headers: adminHeaders,
        body: JSON.stringify({ roles: ["Task Manager"], expectedVersion: 1 })
      }),
      env,
      fakeExecutionContext()
    );
    expect(changed.status).toBe(200);

    const stale = await worker.fetch!(
      cfRequest("http://localhost/api/auth/me", { headers: { cookie } }),
      env,
      fakeExecutionContext()
    );
    expect(stale.status).toBe(403);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: "PERMISSION_DENIED", message: "Session is no longer valid" }
    });
  });

  it("revalidates signed account sessions before realtime websocket subscriptions", async () => {
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker<CloudFrappeAuthTestEnv>({
      registry: createTestRegistry(),
      actor: unsafeHeaderActorResolver,
      auth: {
        sessionSecret: (env) => env.SESSION_SECRET,
        sessionMaxAgeSeconds: 60,
        revalidateSignedSessions: true,
        secure: false,
        passwords: deterministicPasswords(),
        ids: deterministicIds(["account-1", "password-1"]),
        clock: fixedClock(now)
      },
      realtime: {
        namespace: () => fakeRealtimeNamespace(fetches)
      }
    });
    const env = { DB: fakeEventD1(), AGGREGATES: fakeNamespace(), SESSION_SECRET: "edge-secret" };
    const adminHeaders = {
      "content-type": "application/json",
      "x-cf-frappe-user": "admin@example.com",
      "x-cf-frappe-roles": SYSTEM_MANAGER_ROLE,
      "x-cf-frappe-tenant": "acme"
    };
    await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ password: "secret-123", roles: ["User"] })
      }),
      env,
      fakeExecutionContext()
    );
    const login = await worker.fetch!(
      cfRequest("http://localhost/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "owner@example.com", password: "secret-123", tenantId: "acme" })
      }),
      env,
      fakeExecutionContext()
    );
    const cookie = login.headers.get("set-cookie") ?? "";
    await worker.fetch!(
      cfRequest("http://localhost/api/users/owner%40example.com/password", {
        method: "PUT",
        headers: adminHeaders,
        body: JSON.stringify({ password: "secret-456", expectedVersion: 1 })
      }),
      env,
      fakeExecutionContext()
    );

    const stale = await worker.fetch!(
      cfRequest("http://localhost/api/realtime?topic=user:acme:owner%40example.com", {
        headers: { cookie, upgrade: "websocket" }
      }),
      env,
      fakeExecutionContext()
    );

    expect(stale.status).toBe(403);
    expect(fetches).toHaveLength(0);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: "PERMISSION_DENIED", message: "Session is no longer valid" }
    });
  });
});

interface CloudFrappeAuthTestEnv {
  readonly DB: D1Database;
  readonly AGGREGATES: RpcDurableObjectNamespace<AggregateCoordinatorRpc>;
  readonly SESSION_SECRET: string;
}

function fakeNamespace(): RpcDurableObjectNamespace<AggregateCoordinatorRpc> {
  return {
    idFromName(name: string) {
      return name as unknown as DurableObjectId;
    },
    get() {
      return {
        transact() {
          throw new Error("Command path should not be used in this test");
        }
      };
    }
  };
}

function fakeRealtimeNamespace(fetches: Request[]): RealtimeHubNamespace {
  return {
    idFromName(name: string) {
      return name as unknown as DurableObjectId;
    },
    get() {
      return {
        presence() {
          return Promise.resolve({ topic: "", connections: [] });
        },
        publish() {
          return Promise.resolve(0);
        },
        replay() {
          return Promise.resolve({ topic: "", events: [], nextCursor: null });
        },
        fetch(request: Request) {
          fetches.push(request);
          return Promise.resolve(new Response(null, { status: 101 }));
        }
      };
    }
  };
}

function cfRequest(url: string, init?: RequestInit): Parameters<NonNullable<ReturnType<typeof createCloudFrappeWorker>["fetch"]>>[0] {
  return new Request(url, init) as unknown as Parameters<NonNullable<ReturnType<typeof createCloudFrappeWorker>["fetch"]>>[0];
}

function fakeD1(): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind() {
          return this;
        },
        async all() {
          if (sql.includes("FROM cf_frappe_documents")) {
            return { results: [] };
          }
          return { results: [] };
        },
        async first() {
          return null;
        },
        async run() {
          return { success: true };
        }
      };
    },
    async batch(statements: any[]) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    dump() {
      throw new Error("Not implemented");
    },
    exec() {
      throw new Error("Not implemented");
    },
    withSession() {
      throw new Error("Not implemented");
    }
  } as unknown as D1Database;
}

function fakeEventD1(): D1Database {
  const events: Array<{
    readonly id: string;
    readonly tenant_id: string;
    readonly stream: string;
    readonly sequence: number;
    readonly type: string;
    readonly doctype: string;
    readonly document_name: string;
    readonly actor_id: string;
    readonly occurred_at: string;
    readonly payload_json: string;
    readonly metadata_json: string;
  }> = [];
  return {
    prepare(sql: string) {
      const statement = {
        params: [] as unknown[],
        bind(...params: unknown[]) {
          this.params = params;
          return this;
        },
        async all() {
          if (!sql.includes("FROM cf_frappe_events")) {
            return { results: [] };
          }
          const stream = String(this.params[0] ?? "");
          const maxSequence = sql.includes("sequence <= ?") ? Number(this.params[1]) : undefined;
          const limit = sql.includes("LIMIT ?") ? Number(this.params.at(-1)) : undefined;
          const ordered = events
            .filter((event) => event.stream === stream)
            .filter((event) => maxSequence === undefined || event.sequence <= maxSequence)
            .sort((left, right) => sql.includes("ORDER BY sequence DESC") ? right.sequence - left.sequence : left.sequence - right.sequence);
          return { results: limit === undefined ? ordered : ordered.slice(0, limit) };
        },
        async first() {
          if (sql.includes("COALESCE(MAX(sequence), 0)")) {
            const stream = String(this.params[0] ?? "");
            return {
              version: events
                .filter((event) => event.stream === stream)
                .reduce((version, event) => Math.max(version, event.sequence), 0)
            };
          }
          return null;
        },
        async run() {
          if (sql.includes("INSERT INTO cf_frappe_events")) {
            const [
              id,
              tenantId,
              stream,
              sequence,
              type,
              doctype,
              documentName,
              actorId,
              occurredAt,
              payloadJson,
              metadataJson
            ] = this.params;
            events.push({
              id: String(id),
              tenant_id: String(tenantId),
              stream: String(stream),
              sequence: Number(sequence),
              type: String(type),
              doctype: String(doctype),
              document_name: String(documentName),
              actor_id: String(actorId),
              occurred_at: String(occurredAt),
              payload_json: String(payloadJson),
              metadata_json: String(metadataJson)
            });
          }
          return { success: true };
        }
      };
      return statement;
    },
    async batch(statements: any[]) {
      return Promise.all(statements.map((statement) => statement.run()));
    },
    dump() {
      throw new Error("Not implemented");
    },
    exec() {
      throw new Error("Not implemented");
    },
    withSession() {
      throw new Error("Not implemented");
    }
  } as unknown as D1Database;
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

function fakeExecutionContext(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {}
  } as unknown as ExecutionContext;
}
