import {
  createSignedSessionCookie,
  signedSessionActorResolver,
} from "../../src";
import {
  createCloudFrappeWorker,
  type AggregateCoordinatorRpc,
  type RealtimeHubNamespace,
  type RealtimePresenceConnection,
  type RpcDurableObjectNamespace
} from "../../src/cloudflare";
import { createTestRegistry, owner } from "../helpers";

describe("CloudFrappe Worker realtime", () => {
  it("routes authorized websocket subscriptions to the topic hub", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => ({ ...owner, roles: ["System Manager"] }),
      realtime: { namespace: () => fakeRealtimeNamespace(topics, fetches) }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/realtime?topic=document:acme:Note:My%20Note&replayAfter=3&replayLimit=25", {
        headers: { upgrade: "websocket" }
      }),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(101);
    expect(topics).toEqual(["document:acme:Note:My%20Note"]);
    expect(fetches).toHaveLength(1);
    expect(new URL(fetches[0]!.url).searchParams.get("tenantId")).toBe("acme");
    expect(new URL(fetches[0]!.url).searchParams.get("userId")).toBe("owner@example.com");
    expect(new URL(fetches[0]!.url).searchParams.get("replayAfter")).toBe("3");
    expect(new URL(fetches[0]!.url).searchParams.get("replayLimit")).toBe("25");
  });

  it("routes authorized websocket subscriptions through configured realtime routes", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => ({ ...owner, roles: ["System Manager"] }),
      realtime: { namespace: () => fakeRealtimeNamespace(topics, fetches), route: "/rt" }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/rt?topic=document:acme:Note:My%20Note&replayAfter=7", {
        headers: { upgrade: "websocket" }
      }),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(101);
    expect(topics).toEqual(["document:acme:Note:My%20Note"]);
    expect(fetches).toHaveLength(1);
    expect(new URL(fetches[0]!.url).pathname).toBe("/rt");
    expect(new URL(fetches[0]!.url).searchParams.get("tenantId")).toBe("acme");
    expect(new URL(fetches[0]!.url).searchParams.get("userId")).toBe("owner@example.com");
    expect(new URL(fetches[0]!.url).searchParams.get("replayAfter")).toBe("7");
  });

  it("normalizes trailing slashes on configured realtime websocket routes", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => ({ ...owner, roles: ["System Manager"] }),
      realtime: { namespace: () => fakeRealtimeNamespace(topics, fetches), route: "/rt/" }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/rt?topic=document:acme:Note:My%20Note", {
        headers: { upgrade: "websocket" }
      }),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(101);
    expect(topics).toEqual(["document:acme:Note:My%20Note"]);
    expect(fetches).toHaveLength(1);
    expect(new URL(fetches[0]!.url).pathname).toBe("/rt");
  });

  it("routes authorized doctype websocket subscriptions to the topic hub", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => ({ ...owner, roles: ["System Manager"] }),
      realtime: { namespace: () => fakeRealtimeNamespace(topics, fetches) }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/realtime?topic=doctype:acme:Note", {
        headers: { upgrade: "websocket" }
      }),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(101);
    expect(topics).toEqual(["doctype:acme:Note"]);
    expect(fetches).toHaveLength(1);
  });

  it("routes same-tenant system-manager tenant websocket subscriptions to the topic hub", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => ({ ...owner, roles: ["System Manager"] }),
      realtime: { namespace: () => fakeRealtimeNamespace(topics, fetches) }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/realtime?topic=tenant:acme", {
        headers: { upgrade: "websocket" }
      }),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(101);
    expect(topics).toEqual(["tenant:acme"]);
    expect(fetches).toHaveLength(1);
  });

  it("routes same-user websocket subscriptions to the user topic hub", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner,
      realtime: { namespace: () => fakeRealtimeNamespace(topics, fetches) }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/realtime?topic=user:acme:owner%40example.com", {
        headers: { upgrade: "websocket" }
      }),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(101);
    expect(topics).toEqual(["user:acme:owner%40example.com"]);
    expect(fetches).toHaveLength(1);
  });

  it("returns authorized realtime presence snapshots without opening a websocket", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner,
      realtime: {
        namespace: () => fakeRealtimeNamespace(topics, fetches, {
          connections: [
            {
              connectionId: "conn-1",
              connectedAt: "2026-06-23T00:00:00.000Z",
              tenantId: "acme",
              userId: "owner@example.com"
            }
          ]
        })
      }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/realtime/presence?topic=document:acme:Note:My%20Note"),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(200);
    expect(topics).toEqual(["document:acme:Note:My%20Note"]);
    expect(fetches).toEqual([]);
    await expect(response.json()).resolves.toEqual({
      data: {
        topic: "document:acme:Note:My%20Note",
        connections: [
          {
            connectionId: "conn-1",
            connectedAt: "2026-06-23T00:00:00.000Z",
            tenantId: "acme",
            userId: "owner@example.com"
          }
        ]
      }
    });
  });

  it("returns authorized realtime presence snapshots through configured realtime routes", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner,
      realtime: {
        route: "/rt",
        namespace: () => fakeRealtimeNamespace(topics, fetches, {
          connections: [
            {
              connectionId: "conn-1",
              connectedAt: "2026-06-23T00:00:00.000Z",
              tenantId: "acme",
              userId: "owner@example.com"
            }
          ]
        })
      }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/rt/presence?topic=document:acme:Note:My%20Note"),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(200);
    expect(topics).toEqual(["document:acme:Note:My%20Note"]);
    expect(fetches).toEqual([]);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        topic: "document:acme:Note:My%20Note",
        connections: [{ connectionId: "conn-1" }]
      }
    });
  });

  it("normalizes trailing slashes on configured realtime presence routes", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner,
      realtime: {
        route: "/rt/",
        namespace: () => fakeRealtimeNamespace(topics, fetches, {
          connections: [
            {
              connectionId: "conn-1",
              connectedAt: "2026-06-23T00:00:00.000Z",
              tenantId: "acme",
              userId: "owner@example.com"
            }
          ]
        })
      }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/rt/presence?topic=document:acme:Note:My%20Note"),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(200);
    expect(topics).toEqual(["document:acme:Note:My%20Note"]);
    expect(fetches).toEqual([]);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        topic: "document:acme:Note:My%20Note",
        connections: [{ connectionId: "conn-1" }]
      }
    });
  });

  it("rejects realtime presence requests without topics before authorization or hub access", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => {
        throw new Error("Actor should not be resolved for missing realtime presence topics");
      },
      realtime: { namespace: () => fakeRealtimeNamespace(topics, fetches) }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/realtime/presence"),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "BAD_REQUEST", message: "topic is required" }
    });
    expect(topics).toEqual([]);
    expect(fetches).toEqual([]);
  });

  it("rejects invalid realtime presence topics before authorization or hub access", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => {
        throw new Error("Actor should not be resolved for invalid realtime presence topics");
      },
      realtime: { namespace: () => fakeRealtimeNamespace(topics, fetches) }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/realtime/presence?topic=user:acme"),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "BAD_REQUEST", message: "topic is invalid" }
    });
    expect(topics).toEqual([]);
    expect(fetches).toEqual([]);
  });

  it("preserves canonical encoded topic delimiters for realtime presence snapshots", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner,
      realtime: {
        namespace: () => fakeRealtimeNamespace(topics, fetches, {
          connections: [
            {
              connectionId: "conn-1",
              connectedAt: "2026-06-23T00:00:00.000Z",
              tenantId: "acme",
              userId: "owner@example.com"
            }
          ]
        })
      }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/realtime/presence?topic=document:acme:Note:A%3AB"),
      { DB: fakeD1("A:B"), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(200);
    expect(topics).toEqual(["document:acme:Note:A%3AB"]);
    expect(fetches).toEqual([]);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        topic: "document:acme:Note:A%3AB",
        connections: [{ connectionId: "conn-1" }]
      }
    });
  });

  it("rejects websocket subscriptions for another user's realtime room", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner,
      realtime: { namespace: () => fakeRealtimeNamespace(topics, fetches) }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/realtime?topic=user:acme:manager%40example.com", {
        headers: { upgrade: "websocket" }
      }),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(403);
    expect(topics).toEqual([]);
    expect(fetches).toEqual([]);
  });

  it("rejects unauthorized realtime presence snapshots before reaching the hub", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner,
      realtime: { namespace: () => fakeRealtimeNamespace(topics, fetches) }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/realtime/presence?topic=tenant:acme"),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(403);
    expect(topics).toEqual([]);
    expect(fetches).toEqual([]);
  });

  it("rejects non-GET realtime presence snapshots before authorization or hub access", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => {
        throw new Error("Actor should not be resolved for invalid presence methods");
      },
      realtime: { namespace: () => fakeRealtimeNamespace(topics, fetches) }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/realtime/presence?topic=document:acme:Note:My%20Note", {
        method: "POST"
      }),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
    expect(topics).toEqual([]);
    expect(fetches).toEqual([]);
  });

  it("rejects realtime websocket requests without upgrade before authorization or hub access", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => {
        throw new Error("Actor should not be resolved for invalid realtime websocket requests");
      },
      realtime: { namespace: () => fakeRealtimeNamespace(topics, fetches) }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/realtime?topic=document:acme:Note:My%20Note"),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(426);
    expect(await response.text()).toBe("Expected WebSocket upgrade");
    expect(topics).toEqual([]);
    expect(fetches).toEqual([]);
  });

  it("rejects realtime requests without topics before authorization or hub access", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => {
        throw new Error("Actor should not be resolved for missing realtime topics");
      },
      realtime: { namespace: () => fakeRealtimeNamespace(topics, fetches) }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/realtime", {
        headers: { upgrade: "websocket" }
      }),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "BAD_REQUEST", message: "topic is required" }
    });
    expect(topics).toEqual([]);
    expect(fetches).toEqual([]);
  });

  it("rejects invalid realtime topics before authorization or hub access", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => {
        throw new Error("Actor should not be resolved for invalid realtime topics");
      },
      realtime: { namespace: () => fakeRealtimeNamespace(topics, fetches) }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/realtime?topic=document:acme:Note", {
        headers: { upgrade: "websocket" }
      }),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "BAD_REQUEST", message: "topic is invalid" }
    });
    expect(topics).toEqual([]);
    expect(fetches).toEqual([]);
  });

  it("rejects doctype realtime subscriptions from non-system actors", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner,
      realtime: { namespace: () => fakeRealtimeNamespace(topics, fetches) }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/realtime?topic=doctype:acme:Note", {
        headers: { upgrade: "websocket" }
      }),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(403);
    expect(topics).toEqual([]);
    expect(fetches).toEqual([]);
  });

  it("uses env-backed signed sessions for realtime subscriptions", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const cookie = await createSignedSessionCookie(owner, {
      secret: "edge-secret",
      maxAgeSeconds: 60,
      secure: false
    });
    const worker = createCloudFrappeWorker<RealtimeAuthEnv>({
      registry: createTestRegistry(),
      actor: (request, env) => signedSessionActorResolver({ secret: env.SESSION_SECRET })(request),
      realtime: { namespace: () => fakeRealtimeNamespace(topics, fetches) }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/realtime?topic=document:acme:Note:My%20Note", {
        headers: { upgrade: "websocket", cookie }
      }),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace(), SESSION_SECRET: "edge-secret" },
      fakeExecutionContext()
    );

    expect(response.status).toBe(101);
    expect(topics).toEqual(["document:acme:Note:My%20Note"]);
    expect(fetches).toHaveLength(1);
  });

  it("preserves canonical encoded topic delimiters inside document names", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner,
      realtime: { namespace: () => fakeRealtimeNamespace(topics, fetches) }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/realtime?topic=document:acme:Note:A%3AB", {
        headers: { upgrade: "websocket" }
      }),
      { DB: fakeD1("A:B"), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(101);
    expect(topics).toEqual(["document:acme:Note:A%3AB"]);
    expect(new URL(fetches[0]!.url).searchParams.get("topic")).toBe("document:acme:Note:A%3AB");

    const serializedUrl = new URL("http://localhost/api/realtime");
    serializedUrl.searchParams.set("topic", "document:acme:Note:A%3AB");

    const serializedResponse = await worker.fetch!(
      cfRequest(serializedUrl.toString(), {
        headers: { upgrade: "websocket" }
      }),
      { DB: fakeD1("A:B"), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(serializedResponse.status).toBe(101);
    expect(topics).toEqual(["document:acme:Note:A%3AB", "document:acme:Note:A%3AB"]);
    expect(new URL(fetches[1]!.url).searchParams.get("topic")).toBe("document:acme:Note:A%3AB");
  });

  it("rejects broad tenant topics for non-system actors", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner,
      realtime: { namespace: () => fakeRealtimeNamespace(topics, fetches) }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/realtime?topic=tenant:acme", {
        headers: { upgrade: "websocket" }
      }),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(403);
    expect(topics).toEqual([]);
    expect(fetches).toEqual([]);
  });

  it("maps actor resolver failures to structured errors", async () => {
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => {
        throw new Error("auth unavailable");
      },
      realtime: { namespace: () => fakeRealtimeNamespace([], []) }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/realtime?topic=document:acme:Note:My%20Note", {
        headers: { upgrade: "websocket" }
      }),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INTERNAL_SERVER_ERROR", message: "auth unavailable" }
    });
  });

  it("rejects cross-tenant realtime subscriptions before reaching the hub", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner,
      realtime: { namespace: () => fakeRealtimeNamespace(topics, fetches) }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/realtime?topic=tenant:other", {
        headers: { upgrade: "websocket" }
      }),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(403);
    expect(topics).toEqual([]);
    expect(fetches).toEqual([]);
  });

  it("rejects cross-tenant doctype realtime subscriptions before reaching the hub", async () => {
    const topics: string[] = [];
    const fetches: Request[] = [];
    const worker = createCloudFrappeWorker({
      registry: createTestRegistry(),
      actor: () => owner,
      realtime: { namespace: () => fakeRealtimeNamespace(topics, fetches) }
    });

    const response = await worker.fetch!(
      cfRequest("http://localhost/api/realtime?topic=doctype:other:Note", {
        headers: { upgrade: "websocket" }
      }),
      { DB: fakeD1(), AGGREGATES: fakeAggregateNamespace() },
      fakeExecutionContext()
    );

    expect(response.status).toBe(403);
    expect(topics).toEqual([]);
    expect(fetches).toEqual([]);
  });
});

interface RealtimeAuthEnv {
  readonly DB: D1Database;
  readonly AGGREGATES: RpcDurableObjectNamespace<AggregateCoordinatorRpc>;
  readonly SESSION_SECRET: string;
}

function fakeRealtimeNamespace(
  topics: string[],
  fetches: Request[],
  presence: { readonly connections: readonly RealtimePresenceConnection[] } = { connections: [] }
): RealtimeHubNamespace {
  return {
    idFromName(name: string) {
      topics.push(name);
      return name as unknown as DurableObjectId;
    },
    get() {
      return {
        async fetch(request: Request) {
          fetches.push(request);
          return { status: 101 } as Response;
        },
        async presence() {
          return { topic: topics.at(-1) ?? "", connections: presence.connections };
        },
        async publish() {
          return 0;
        },
        async replay() {
          return { topic: topics.at(-1) ?? "", events: [], nextCursor: null };
        }
      };
    }
  };
}

function fakeAggregateNamespace(): RpcDurableObjectNamespace<AggregateCoordinatorRpc> {
  return {
    idFromName(name: string) {
      return name as unknown as DurableObjectId;
    },
    get() {
      return {
        transact() {
          throw new Error("Command path should not be used");
        },
        tryTransact() {
          throw new Error("Command path should not be used");
        }
      };
    }
  };
}

function cfRequest(url: string, init?: RequestInit): Parameters<NonNullable<ReturnType<typeof createCloudFrappeWorker>["fetch"]>>[0] {
  return new Request(url, init) as unknown as Parameters<NonNullable<ReturnType<typeof createCloudFrappeWorker>["fetch"]>>[0];
}

function fakeD1(name = "My Note"): D1Database {
  return {
    prepare() {
      return {
        bind() {
          return this;
        },
        async all() {
          return { results: [] };
        },
        async first() {
          return {
            tenant_id: "acme",
            doctype: "Note",
            name,
            version: 1,
            docstatus: "draft",
            data_json: JSON.stringify({
              title: name,
              created_by: "owner@example.com",
              priority: "Medium"
            }),
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z"
          };
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
