import {
  createCloudFrappeWorker,
  createSignedSessionCookie,
  signedSessionActorResolver,
  SYSTEM_MANAGER_ROLE,
  type AggregateCoordinatorRpc,
  type RpcDurableObjectNamespace
} from "../../src";
import { createTestRegistry, owner } from "../helpers";

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

function fakeExecutionContext(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
    props: {}
  } as unknown as ExecutionContext;
}
