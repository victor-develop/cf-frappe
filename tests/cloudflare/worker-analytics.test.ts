import { describe, expect, it, vi } from "vitest";
import {
  ANALYTICS_EXPORT_JOB_NAME,
  D1AnalyticsStore,
  D1ProjectionStore,
  InMemoryJobQueue,
  SYSTEM_MANAGER_ROLE,
  createAnalyticsExportJob,
  createJobRegistry,
  createRegistry,
  defineDocType,
  defineReport,
  fixedClock,
  unsafeHeaderActorResolver,
  type JobMessage
} from "../../src";
import {
  createCloudFrappeWorker,
  type AggregateCoordinatorRpc,
  type CloudFrappeEnv,
  type CloudFrappeRuntimeServices,
  type RpcDurableObjectNamespace
} from "../../src/cloudflare";
import { analyticsSchema, createTestD1, frameworkSchema } from "../d1-engine.js";

interface AnalyticsEnv extends CloudFrappeEnv {
  readonly ANALYTICS_DB: D1Database;
}

const Invoice = defineDocType({
  name: "Invoice",
  fields: [
    { name: "customer", type: "text" },
    { name: "status", type: "select", options: ["Open", "Paid"] },
    { name: "amount", type: "number" }
  ],
  permissions: [{ roles: ["Accountant"], actions: ["read"] }]
});

const Revenue = defineReport({
  name: "Revenue",
  doctype: "Invoice",
  queryPath: "analytical",
  columns: [{ name: "customer" }, { name: "status" }, { name: "amount" }],
  filters: [{ name: "status", field: "status", type: "select" }],
  summaries: [{ name: "invoices", aggregate: "count" }, { name: "total", aggregate: "sum", field: "amount" }],
  groups: [{ name: "by_status", field: "status", summaries: [{ name: "total", aggregate: "sum", field: "amount" }] }],
  orderBy: "amount",
  order: "desc"
});

const registry = createRegistry({ doctypes: [Invoice], reports: [Revenue] });
const NOW = "2026-04-01T00:00:00.000Z";

async function environment(): Promise<AnalyticsEnv> {
  const db = createTestD1({ schema: frameworkSchema() }).database;
  const projections = new D1ProjectionStore(db);
  const rows = [
    ["INV-1", "Acme", "Open", 120],
    ["INV-2", "Globex", "Paid", 80],
    ["INV-3", "Acme", "Paid", 45.5],
    ["INV-4", "Initech", "Open", 300]
  ] as const;
  for (const [index, [name, customer, status, amount]] of rows.entries()) {
    await projections.save({
      tenantId: "default",
      doctype: "Invoice",
      name,
      version: 1,
      docstatus: "draft",
      data: { customer, status, amount },
      createdAt: `2026-03-01T00:00:0${index}.000Z`,
      updatedAt: `2026-03-01T00:00:0${index}.000Z`
    });
  }
  return {
    DB: db,
    ANALYTICS_DB: createTestD1({ schema: analyticsSchema() }).database,
    AGGREGATES: unusedNamespace()
  };
}

function worker(options: { readonly analytics: boolean }) {
  return createCloudFrappeWorker<AnalyticsEnv>({
    registry,
    actor: unsafeHeaderActorResolver,
    ...(options.analytics
      ? {
          analytics: {
            reader: (env) => new D1AnalyticsStore(env.ANALYTICS_DB),
            sink: (env) => new D1AnalyticsStore(env.ANALYTICS_DB),
            clock: fixedClock(NOW)
          }
        }
      : {}),
    jobs: {
      registry: createJobRegistry<CloudFrappeRuntimeServices>({
        jobs: [createAnalyticsExportJob<CloudFrappeRuntimeServices>()]
      }),
      queue: () => new InMemoryJobQueue()
    }
  });
}

async function get(handler: ReturnType<typeof worker>, env: AnalyticsEnv, path: string, roles: string): Promise<Response> {
  const request = new Request(`http://localhost${path}`, {
    headers: { "x-cf-frappe-user": "u", "x-cf-frappe-roles": roles, "x-cf-frappe-tenant": "default" }
  });
  return handler.fetch!(request as never, env, executionContext());
}

async function runExportJob(handler: ReturnType<typeof worker>, env: AnalyticsEnv) {
  const message = {
    id: "msg_analytics_001",
    timestamp: new Date(NOW),
    body: {
      tenantId: "default",
      jobName: ANALYTICS_EXPORT_JOB_NAME,
      payload: {},
      runId: "job_analytics_001",
      idempotencyKey: "analytics:job_analytics_001",
      enqueuedAt: NOW,
      metadata: {}
    } satisfies JobMessage,
    attempts: 1,
    ack: vi.fn(),
    retry: vi.fn()
  };
  await handler.queue!(
    {
      queue: "jobs",
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      messages: [message as never],
      retryAll: vi.fn(),
      ackAll: vi.fn()
    } as never,
    env,
    executionContext()
  );
  return message;
}

describe("the Worker's analytics option", () => {
  it("retries an export job whose sink failed", async () => {
    const env = await environment();
    const failing = createCloudFrappeWorker<AnalyticsEnv>({
      registry,
      actor: unsafeHeaderActorResolver,
      analytics: {
        reader: (current) => new D1AnalyticsStore(current.ANALYTICS_DB),
        sink: () => ({ append: async () => { throw new Error("stream unavailable"); } }),
        clock: fixedClock(NOW)
      },
      jobs: {
        registry: createJobRegistry<CloudFrappeRuntimeServices>({ jobs: [createAnalyticsExportJob<CloudFrappeRuntimeServices>()] }),
        queue: () => new InMemoryJobQueue()
      }
    });

    const message = await runExportJob(failing, env);

    expect(message.retry).toHaveBeenCalledOnce();
    expect(message.ack).not.toHaveBeenCalled();
  });

  it("serves an analytical report from the copy once the export job has run, matching the projection", async () => {
    const env = await environment();
    const analytical = worker({ analytics: true });

    // Before the first export the copy vouches for nothing: 503, not zeros.
    const early = await get(analytical, env, "/api/report/Revenue/run", "Accountant");
    expect(early.status).toBe(503);
    await expect(early.json()).resolves.toMatchObject({ error: { code: "ANALYTICS_UNAVAILABLE" } });

    const message = await runExportJob(analytical, env);
    expect(message.ack).toHaveBeenCalledOnce();
    expect(message.retry).not.toHaveBeenCalled();

    for (const query of ["", "?status=Paid", "?status=Open&limit=1&offset=1"]) {
      const fromCopy = (await (await get(analytical, env, `/api/report/Revenue/run${query}`, "Accountant")).json()) as Record<string, unknown>;
      const fromProjection = (await (await get(worker({ analytics: false }), env, `/api/report/Revenue/run${query}`, "Accountant")).json()) as Record<string, unknown>;
      const { analytics, ...rest } = fromCopy;
      expect(analytics, query).toEqual({ path: "analytical", completeThrough: "2026-03-31T23:59:00.000Z" });
      expect(rest, query).toEqual(fromProjection);
      expect(fromProjection).not.toHaveProperty("analytics");
    }
  });

  it("reports export freshness to admins and nobody else", async () => {
    const env = await environment();
    const analytical = worker({ analytics: true });
    await runExportJob(analytical, env);

    const status = await get(analytical, env, "/api/analytics/exports", SYSTEM_MANAGER_ROLE);
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toEqual({
      data: [
        {
          doctype: "Invoice",
          completeThrough: "2026-03-31T23:59:00.000Z",
          lagSeconds: 60,
          reexporting: false,
          exportedRows: 4,
          lastRunAt: NOW,
          lastError: null
        }
      ]
    });
    expect((await get(analytical, env, "/api/analytics/exports", "Accountant")).status).toBe(403);
  });

  it("mounts nothing and changes nothing when the option is absent", async () => {
    const env = await environment();
    const plain = worker({ analytics: false });

    expect((await get(plain, env, "/api/analytics/exports", SYSTEM_MANAGER_ROLE)).status).toBe(404);
    const report = (await (await get(plain, env, "/api/report/Revenue/run", "Accountant")).json()) as Record<string, unknown>;
    expect(report).toMatchObject({ total: 4 });
    expect(report).not.toHaveProperty("analytics");
    // And the export job, if scheduled anyway, fails permanently — a retry
    // cannot fix configuration — and exports nothing.
    const message = await runExportJob(plain, env);
    expect(message.retry).not.toHaveBeenCalled();
    expect(message.ack).toHaveBeenCalledOnce();
    await expect(new D1AnalyticsStore(env.ANALYTICS_DB).scan({ tenantId: "default", doctype: "Invoice", limit: 10 })).resolves.toEqual({
      documents: []
    });
  });
});

function unusedNamespace(): RpcDurableObjectNamespace<AggregateCoordinatorRpc> {
  return {
    idFromName: (name: string) => name as unknown as DurableObjectId,
    get() {
      throw new Error("The command path is not used by analytics");
    }
  } as unknown as RpcDurableObjectNamespace<AggregateCoordinatorRpc>;
}

function executionContext(): ExecutionContext {
  return { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
}
