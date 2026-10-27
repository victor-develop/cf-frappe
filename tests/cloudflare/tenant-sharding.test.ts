import {
  createJobRegistry,
  createRegistry,
  createTenantMoveAdvanceJob,
  defineDocType,
  documentDeliveryOutboxStream,
  InMemoryJobQueue,
  PROJECTION_OUTBOX_CHANNEL,
  TENANT_MOVE_ADVANCE_JOB_NAME,
  unsafeHeaderActorResolver,
  type JobDefinition,
  type JobMessage
} from "../../src";
import {
  createAggregateCoordinatorClass,
  createCloudFrappeWorker,
  createTenantShardingRuntime,
  type AggregateCoordinatorRpc,
  type CloudFrappeProjectionDatabaseOptions,
  type CloudFrappeRuntimeServices,
  type CloudFrappeTenantShardingOptions,
  type RpcDurableObjectNamespace
} from "../../src/cloudflare";
import { createTestD1, wranglerMigratedSchema, type TestD1 } from "../d1-engine.js";

/**
 * Issue #14 through the Cloudflare wiring: the Worker, the aggregate
 * coordinator, the HTTP API and the move job, over real SQLite engines.
 */

const Note = defineDocType({
  name: "Note",
  fields: [{ name: "title", type: "text" }],
  permissions: [{ roles: ["User"], actions: ["read", "create", "update"] }]
});
const registry = createRegistry({ doctypes: [Note] });

interface Env {
  readonly DB: D1Database;
  readonly EAST: D1Database;
  readonly EAST_PROJECTIONS?: D1Database;
  readonly PROJECTIONS_DB?: D1Database;
  readonly AGGREGATES: RpcDurableObjectNamespace<AggregateCoordinatorRpc>;
}

function headersFor(tenantId: string): Record<string, string> {
  return {
    "x-cf-frappe-user": "owner@example.com",
    "x-cf-frappe-roles": "User",
    "x-cf-frappe-tenant": tenantId,
    "content-type": "application/json"
  };
}

const context = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;

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

function count(db: TestD1, sql: string, ...params: unknown[]): number {
  return Number(Object.values(db.query(sql, ...params)[0]!)[0]);
}

/** A job that hands back the resources it ran with, to look at the Worker's services. */
let probed: CloudFrappeRuntimeServices | undefined;
const probe: JobDefinition<Record<string, never>, CloudFrappeRuntimeServices> = {
  name: "test.probe",
  handler: ({ resources }) => {
    probed = resources;
  }
};

async function runJob(
  worker: ReturnType<typeof createCloudFrappeWorker<Env>>,
  env: Env,
  jobName: string,
  tenantId: string
): Promise<void> {
  const acked: string[] = [];
  await worker.queue!({
    queue: "jobs",
    messages: [{
      id: jobName,
      timestamp: new Date(),
      body: {
        jobName,
        runId: `run-${Math.random()}`,
        tenantId,
        payload: {},
        idempotencyKey: `key-${Math.random()}`,
        enqueuedAt: "2026-03-01T00:00:00.000Z",
        metadata: {}
      } satisfies JobMessage,
      attempts: 1,
      ack: () => acked.push("ack"),
      retry: () => acked.push("retry")
    }],
    ackAll() {},
    retryAll() {}
  } as never, env, context);
  expect(acked).toEqual(["ack"]);
}

function deployment(options: {
  readonly sharding?: CloudFrappeTenantShardingOptions<Env>;
  readonly projectionDatabase?: CloudFrappeProjectionDatabaseOptions<Env>;
} = {}) {
  const home = createTestD1({ schema: wranglerMigratedSchema() });
  const east = createTestD1({ schema: wranglerMigratedSchema() });
  const homeProjections = createTestD1({ schema: wranglerMigratedSchema() });
  const eastProjections = createTestD1({ schema: wranglerMigratedSchema() });
  const Coordinator = createAggregateCoordinatorClass<Env>({
    registry,
    notifications: false,
    assignmentRuleActor: false,
    ...(options.sharding === undefined ? {} : { tenantSharding: options.sharding }),
    ...(options.projectionDatabase === undefined ? {} : { projectionDatabase: options.projectionDatabase })
  });
  let env!: Env;
  env = {
    DB: home.database,
    EAST: east.database,
    PROJECTIONS_DB: homeProjections.database,
    EAST_PROJECTIONS: eastProjections.database,
    AGGREGATES: namespaceOf(Coordinator, () => env)
  };
  const worker = createCloudFrappeWorker<Env>({
    registry,
    actor: unsafeHeaderActorResolver,
    ...(options.sharding === undefined ? {} : { tenantSharding: options.sharding }),
    ...(options.projectionDatabase === undefined ? {} : { projectionDatabase: options.projectionDatabase }),
    jobs: {
      registry: createJobRegistry<CloudFrappeRuntimeServices>({ jobs: [createTenantMoveAdvanceJob(), probe as never] }),
      queue: () => new InMemoryJobQueue()
    }
  });
  const send = (tenantId: string, path: string, init: RequestInit = {}) =>
    worker.fetch!(new Request(`https://app.test${path}`, {
      ...init,
      headers: { ...headersFor(tenantId), ...(init.headers ?? {}) }
    }) as never, env, context);
  const create = async (tenantId: string, name: string) => {
    const response = await send(tenantId, "/api/resource/Note", { method: "POST", body: JSON.stringify({ name, title: name }) });
    expect(response.status).toBe(201);
  };
  const list = async (tenantId: string) =>
    ((await (await send(tenantId, "/api/resource/Note?limit=100")).json()) as { data: { name: string }[] }).data
      .map((row) => row.name)
      .sort();
  return {
    home,
    east,
    homeProjections,
    eastProjections,
    env,
    worker,
    send,
    create,
    list,
    close() {
      home.close();
      east.close();
      homeProjections.close();
      eastProjections.close();
    }
  };
}

const sharding: CloudFrappeTenantShardingOptions<Env> = {
  shards: (env) => ({ east: env.EAST })
};

describe("the tenant sharding switch", () => {
  it("is off by default: one database, no directory, no sharding services", async () => {
    const d = deployment();

    await d.create("acme", "One");
    await runJob(d.worker, d.env, "test.probe", "acme");

    expect(count(d.home, "SELECT COUNT(*) FROM cf_frappe_documents WHERE tenant_id = 'acme'")).toBe(1);
    expect(count(d.home, "SELECT COUNT(*) FROM cf_frappe_tenant_shards")).toBe(0);
    expect(count(d.east, "SELECT COUNT(*) FROM cf_frappe_events")).toBe(0);
    expect(probed?.tenantShards).toBeUndefined();
    d.close();
  });

  it("on, writes each tenant to its shard through the coordinator and reads it back through the API", async () => {
    const d = deployment({ sharding: { ...sharding, newTenants: "place", accepting: ["east"] } });

    await d.create("acme", "One");
    await d.create("acme", "Two");
    const updated = await d.send("acme", "/api/resource/Note/One", { method: "PUT", body: JSON.stringify({ title: "Uno" }) });
    expect(updated.status).toBe(200);

    expect(count(d.east, "SELECT COUNT(*) FROM cf_frappe_documents WHERE tenant_id = 'acme'")).toBe(2);
    expect(count(d.home, "SELECT COUNT(*) FROM cf_frappe_events WHERE tenant_id = 'acme'")).toBe(0);
    expect(d.home.query("SELECT tenant_id, shard_id FROM cf_frappe_tenant_shards")).toEqual([{ tenant_id: "acme", shard_id: "east" }]);
    expect(await d.list("acme")).toEqual(["One", "Two"]);
    await expect((await d.send("acme", "/api/resource/Note/One")).json()).resolves.toMatchObject({
      data: { name: "One", version: 2, data: { title: "Uno" } }
    });
    await runJob(d.worker, d.env, "test.probe", "acme");
    expect(probed?.tenantShards?.router.home).toBe("home");
    d.close();
  });

  it("moves a live tenant with the advance job while the API keeps writing", async () => {
    const d = deployment({ sharding });
    await d.create("acme", "Before");
    await d.create("globex", "Stays");
    // The operator's isolate: same options, same databases.
    const operator = createTenantShardingRuntime(d.env, sharding, { registry });
    await operator.services.mover.start("acme", "east");

    let written = 0;
    for (let step = 0; step < 50; step += 1) {
      const active = await operator.services.mover.activeMove("acme");
      if (active === null) {
        break;
      }
      written += 1;
      await d.create("acme", `During${written}`);
      await runJob(d.worker, d.env, TENANT_MOVE_ADVANCE_JOB_NAME, "acme");
    }
    expect(await operator.services.directory.get("acme")).toMatchObject({ shardId: "east", epoch: 2 });

    // The Worker's cache still says home; this write is fenced there and
    // retried on east.
    await d.create("acme", "After");

    const expected = ["After", "Before", ...Array.from({ length: written }, (_, index) => `During${index + 1}`)].sort();
    expect(await d.list("acme")).toEqual(expected);
    expect(count(d.east, "SELECT COUNT(*) FROM cf_frappe_documents WHERE tenant_id = 'acme'")).toBe(expected.length);
    // The source keeps its frozen copy, without the write that came after.
    expect(count(d.home, "SELECT COUNT(*) FROM cf_frappe_documents WHERE tenant_id = 'acme'")).toBe(expected.length - 1);
    expect(await d.list("globex")).toEqual(["Stays"]);
    expect(count(d.east, "SELECT COUNT(*) FROM cf_frappe_events WHERE tenant_id = 'globex'")).toBe(0);
    d.close();
  });

  it("composes with the split projection layout: each shard has its own projection database", async () => {
    const projectionDatabase: CloudFrappeProjectionDatabaseOptions<Env> = { database: (env) => env.PROJECTIONS_DB! };
    const split: CloudFrappeTenantShardingOptions<Env> = {
      shards: (env) => ({ east: { database: env.EAST, projectionDatabase: env.EAST_PROJECTIONS! } })
    };
    const d = deployment({ sharding: split, projectionDatabase });
    const operator = createTenantShardingRuntime(d.env, split, { registry, projectionDatabase });
    await operator.services.provisioner.provision("acme", { shardId: "east" });

    await d.create("acme", "One");

    // Events and the projection handoff on east's primary; the rows in east's
    // projection database; nothing on home's.
    expect(count(d.east, "SELECT COUNT(*) FROM cf_frappe_events WHERE stream = ?", documentDeliveryOutboxStream("acme", PROJECTION_OUTBOX_CHANNEL))).toBe(1);
    expect(count(d.east, "SELECT COUNT(*) FROM cf_frappe_documents")).toBe(0);
    expect(count(d.eastProjections, "SELECT COUNT(*) FROM cf_frappe_documents WHERE tenant_id = 'acme'")).toBe(1);
    expect(count(d.homeProjections, "SELECT COUNT(*) FROM cf_frappe_documents")).toBe(0);
    expect(await d.list("acme")).toEqual(["One"]);

    // And a move rebuilds the target's projection database from the copied events.
    await d.create("globex", "G");
    const move = await operator.services.mover.start("globex", "east");
    expect((await operator.services.mover.run(move.moveId)).phase).toBe("completed");
    expect(d.eastProjections.query("SELECT name FROM cf_frappe_documents WHERE tenant_id = 'globex'")).toEqual([{ name: "G" }]);
    expect(await d.list("globex")).toEqual(["G"]);
    d.close();
  });
});
