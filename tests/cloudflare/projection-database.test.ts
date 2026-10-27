import {
  CONSISTENCY_HEADER,
  createJobRegistry,
  createProjectionDeliveryDrainJob,
  createRegistry,
  defineDocType,
  documentDeliveryOutboxStream,
  PROJECTION_DELIVERY_DRAIN_JOB_NAME,
  PROJECTION_OUTBOX_CHANNEL,
  projectionDeliveryCursorStream,
  READ_AFTER_HEADER,
  InMemoryJobQueue,
  unsafeHeaderActorResolver,
  type JobMessage
} from "../../src";
import {
  createAggregateCoordinatorClass,
  createCloudFrappeWorker,
  createProjectionRuntime,
  projectionDocumentStoreOptions,
  type AggregateCoordinatorRpc,
  type CloudFrappeProjectionDatabaseOptions,
  type CloudFrappeRuntimeServices,
  type RpcDurableObjectNamespace
} from "../../src/cloudflare";
import { createTestD1, frameworkSchema, type TestD1 } from "../d1-engine.js";

const Note = defineDocType({
  name: "Note",
  fields: [{ name: "title", type: "text" }],
  permissions: [{ roles: ["User"], actions: ["read", "create", "update"] }]
});
const registry = createRegistry({ doctypes: [Note] });
const actor = { id: "owner@example.com", roles: ["User"], tenantId: "acme" };
const headers = { "x-cf-frappe-user": actor.id, "x-cf-frappe-roles": "User", "x-cf-frappe-tenant": "acme" };

interface Env {
  readonly DB: D1Database;
  readonly PROJECTIONS_DB: D1Database;
  readonly AGGREGATES: RpcDurableObjectNamespace<AggregateCoordinatorRpc>;
  readonly READ_AFTER_SECRET: string;
}

function databases() {
  const primary = createTestD1({ schema: frameworkSchema() });
  const projections = createTestD1({ schema: frameworkSchema() });
  return {
    primary,
    projections,
    close() {
      primary.close();
      projections.close();
    }
  };
}

function rows(d1: TestD1, table: string): readonly Record<string, unknown>[] {
  return d1.query(`SELECT * FROM ${table}`);
}

function namespaceOf(
  Coordinator: ReturnType<typeof createAggregateCoordinatorClass<Env>>,
  env: () => Env
): RpcDurableObjectNamespace<AggregateCoordinatorRpc> {
  const instances = new Map<string, AggregateCoordinatorRpc>();
  return {
    idFromName: (name) => name as unknown as DurableObjectId,
    get(id) {
      const name = id as unknown as string;
      let instance = instances.get(name);
      if (instance === undefined) {
        instance = new Coordinator({} as DurableObjectState, env());
        instances.set(name, instance);
      }
      return instance;
    }
  };
}

const projectionDatabase: CloudFrappeProjectionDatabaseOptions<Env> = {
  database: (env) => env.PROJECTIONS_DB,
  readYourWrites: { secret: (env) => env.READ_AFTER_SECRET, timeoutMs: 100, pollMs: 10 }
};

describe("the projection database switch", () => {
  it("is off by default: the coordinator writes projection rows to DB inline", async () => {
    const db = databases();
    const Coordinator = createAggregateCoordinatorClass({ registry, notifications: false, assignmentRuleActor: false });
    const coordinator = new Coordinator({} as DurableObjectState, { DB: db.primary.database });

    await coordinator.transact({ kind: "create", actor, doctype: "Note", name: "One", data: { title: "One" } });

    expect(rows(db.primary, "cf_frappe_documents")).toHaveLength(1);
    expect(db.primary.query(
      "SELECT COUNT(*) AS n FROM cf_frappe_events WHERE stream = ?",
      documentDeliveryOutboxStream("acme", PROJECTION_OUTBOX_CHANNEL)
    )).toEqual([{ n: 0 }]);
    expect(projectionDocumentStoreOptions({}, undefined)).toEqual({});
    db.close();
  });

  it("on, moves the coordinator's projection rows to the projection database through the outbox", async () => {
    const db = databases();
    const Coordinator = createAggregateCoordinatorClass<Env>({
      registry,
      notifications: false,
      assignmentRuleActor: false,
      projectionDatabase
    });
    const coordinator = new Coordinator({} as DurableObjectState, {
      DB: db.primary.database,
      PROJECTIONS_DB: db.projections.database
    } as Env);

    await coordinator.transact({ kind: "create", actor, doctype: "Note", name: "One", data: { title: "One" } });

    expect(rows(db.primary, "cf_frappe_documents")).toEqual([]);
    expect(rows(db.projections, "cf_frappe_documents")).toMatchObject([{ doctype: "Note", name: "One", version: 1 }]);
    expect(db.primary.query(
      "SELECT type FROM cf_frappe_events WHERE stream = ?",
      documentDeliveryOutboxStream("acme", PROJECTION_OUTBOX_CHANNEL)
    )).toEqual([{ type: "DocumentDeliveryOutboxEnqueued" }]);
    db.close();
  });

  it("with eagerApply off, leaves the rows to the drain", async () => {
    const db = databases();
    const lazy: CloudFrappeProjectionDatabaseOptions<Env> = { ...projectionDatabase, eagerApply: false };
    const Coordinator = createAggregateCoordinatorClass<Env>({
      registry,
      notifications: false,
      assignmentRuleActor: false,
      projectionDatabase: lazy
    });
    const env = { DB: db.primary.database, PROJECTIONS_DB: db.projections.database, READ_AFTER_SECRET: "s" } as Env;
    await new Coordinator({} as DurableObjectState, env)
      .transact({ kind: "create", actor, doctype: "Note", name: "One", data: { title: "One" } });
    expect(rows(db.projections, "cf_frappe_documents")).toEqual([]);

    const runtime = createProjectionRuntime(env, lazy);
    await expect(runtime.delivery.drain({ tenantId: "acme" })).resolves.toMatchObject({ delivered: 1 });
    expect(rows(db.projections, "cf_frappe_documents")).toHaveLength(1);
    await expect(runtime.projections.get("acme", "Note", "One")).resolves.toMatchObject({ version: 1 });
    db.close();
  });

  it("logs an eager apply failure without failing the write", async () => {
    const primary = createTestD1({ schema: frameworkSchema() });
    const broken = createTestD1({ schema: frameworkSchema(), failSqlIncludes: "INSERT INTO cf_frappe_documents" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const Coordinator = createAggregateCoordinatorClass<Env>({
      registry,
      notifications: false,
      assignmentRuleActor: false,
      projectionDatabase
    });

    await new Coordinator({} as DurableObjectState, { DB: primary.database, PROJECTIONS_DB: broken.database } as Env)
      .transact({ kind: "create", actor, doctype: "Note", name: "One", data: { title: "One" } });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("\"event\":\"cf-frappe.projection.eager-apply-failed\""));
    warn.mockRestore();
    primary.close();
    broken.close();
  });

  it("serves a Worker end to end: write, read-your-writes list, drain job and lag", async () => {
    const db = databases();
    const queue = new InMemoryJobQueue();
    const Coordinator = createAggregateCoordinatorClass<Env>({
      registry,
      notifications: false,
      assignmentRuleActor: false,
      projectionDatabase
    });
    let env!: Env;
    env = {
      DB: db.primary.database,
      PROJECTIONS_DB: db.projections.database,
      READ_AFTER_SECRET: "test-only-secret",
      AGGREGATES: namespaceOf(Coordinator, () => env)
    };
    const worker = createCloudFrappeWorker<Env>({
      registry,
      actor: unsafeHeaderActorResolver,
      projectionDatabase,
      jobs: {
        registry: createJobRegistry<CloudFrappeRuntimeServices>({ jobs: [createProjectionDeliveryDrainJob()] }),
        queue: () => queue
      }
    });
    const context = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

    const written = await worker.fetch!(new Request("https://app.test/api/resource/Note", {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ name: "One", title: "One" })
    }) as never, env, context);
    expect(written.status).toBe(201);
    const token = written.headers.get(READ_AFTER_HEADER);
    expect(token).not.toBeNull();

    const listed = await worker.fetch!(new Request("https://app.test/api/resource/Note", {
      headers: { ...headers, [READ_AFTER_HEADER]: token! }
    }) as never, env, context);
    expect(listed.headers.get(CONSISTENCY_HEADER)).toBe("fresh");
    await expect(listed.json()).resolves.toMatchObject({ total: 1, data: [{ name: "One" }] });
    expect(rows(db.primary, "cf_frappe_documents")).toEqual([]);

    const message: JobMessage = {
      jobName: PROJECTION_DELIVERY_DRAIN_JOB_NAME,
      runId: "run-1",
      tenantId: "acme",
      payload: {},
      idempotencyKey: "drain-1",
      enqueuedAt: "2026-03-01T00:00:00.000Z",
      metadata: {}
    };
    const acked: string[] = [];
    await worker.queue!({
      queue: "jobs",
      messages: [{
        id: "m1",
        timestamp: new Date(),
        body: message,
        attempts: 1,
        ack: () => acked.push("m1"),
        retry: () => acked.push("retry")
      }],
      ackAll() {},
      retryAll() {}
    } as never, env, context);
    expect(acked).toEqual(["m1"]);
    expect(db.primary.query(
      "SELECT json_extract(payload_json, '$.toSequence') AS position FROM cf_frappe_events WHERE stream = ?",
      projectionDeliveryCursorStream("acme")
    )).toEqual([{ position: 1 }]);
    db.close();
  });

  it("alerts through a log line by default when the channel lags", async () => {
    const db = databases();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const env = { DB: db.primary.database, PROJECTIONS_DB: db.projections.database, READ_AFTER_SECRET: "s" } as Env;
    const Coordinator = createAggregateCoordinatorClass<Env>({
      registry,
      notifications: false,
      assignmentRuleActor: false,
      projectionDatabase: { ...projectionDatabase, eagerApply: false }
    });
    await new Coordinator({} as DurableObjectState, env)
      .transact({ kind: "create", actor, doctype: "Note", name: "One", data: { title: "One" } });

    expect(() => createProjectionRuntime(env, { ...projectionDatabase, lag: { maxInFlight: 0 } })).toThrow(/maxInFlight/);
    const strict = createProjectionRuntime(env, { ...projectionDatabase, lag: { maxInFlight: 1, maxAgeSeconds: 1 } });
    const report = await strict.delivery.checkLag("acme", "2027-01-01T00:00:00.000Z");

    expect(report.status).toBe("lagging");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("\"event\":\"cf-frappe.projection.lagging\""));
    warn.mockRestore();
    db.close();
  });

  it("logs a record the drain had to read past, and hands read fallbacks to the hook", async () => {
    const db = databases();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const env = { DB: db.primary.database, PROJECTIONS_DB: db.projections.database, READ_AFTER_SECRET: "s" } as Env;
    const channel = documentDeliveryOutboxStream("acme", PROJECTION_OUTBOX_CHANNEL);
    db.primary.query(
      `INSERT INTO cf_frappe_events (id, tenant_id, stream, sequence, type, doctype, document_name, actor_id, occurred_at, payload_json, metadata_json)
       VALUES ('evt_broken', 'acme', ?, 1, 'DocumentDeliveryOutboxEnqueued', '__DocumentDeliveryOutbox', 'broken:projection', 'x', ?, ?, '{}')`,
      channel,
      "2026-03-01T00:00:00.000Z",
      JSON.stringify({ kind: "DocumentDeliveryOutboxEnqueued", target: "projection", payload: {} })
    );
    const fallbacks: unknown[] = [];
    const runtime = createProjectionRuntime(env, {
      ...projectionDatabase,
      onReadFallback: (fallback) => void fallbacks.push(fallback)
    });

    await expect(runtime.delivery.drain({ tenantId: "acme" })).resolves.toMatchObject({ skipped: 1, cursor: 1 });
    expect(error).toHaveBeenCalledWith(expect.stringContaining("\"event\":\"cf-frappe.projection.delivery-skipped\""));
    error.mockRestore();

    const Coordinator = createAggregateCoordinatorClass<Env>({
      registry,
      notifications: false,
      assignmentRuleActor: false,
      projectionDatabase: { ...projectionDatabase, eagerApply: false }
    });
    await new Coordinator({} as DurableObjectState, env)
      .transact({ kind: "create", actor, doctype: "Note", name: "One", data: { title: "One" } });
    await expect(runtime.projections.get("acme", "Note", "One")).resolves.toMatchObject({ version: 1 });
    expect(fallbacks).toEqual([expect.objectContaining({ name: "One", projectedVersion: null, streamVersion: 1 })]);
    db.close();
  });
});
