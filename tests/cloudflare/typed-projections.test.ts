import {
  InMemoryJobQueue,
  createJobRegistry,
  createRegistry,
  defineDocType,
  planD1TypedProjectionLayout,
  planD1TypedProjectionMigrations,
  renderD1Migration,
  type ModelRegistry
} from "../../src";
import {
  TYPED_PROJECTION_TARGET,
  createAggregateCoordinatorClass,
  createCloudFrappeWorker,
  type AggregateCoordinatorRpc,
  type CloudFrappeRuntimeServices,
  type CloudFrappeTypedProjectionOptions,
  type RpcDurableObjectNamespace
} from "../../src/cloudflare";
import { createTestD1, frameworkSchema, type TestD1 } from "../d1-engine.js";

/**
 * The configuration switch for typed projection tables (issue #15), through
 * the real Worker and the real aggregate coordinator class on one D1 engine:
 * the coordinator writes, the Worker reads, and both take the same options.
 */

const Note = defineDocType({
  name: "Note",
  fields: [
    { name: "title", type: "text" },
    { name: "status", type: "select", options: ["Open", "Done"] },
    { name: "points", type: "integer" }
  ],
  indexes: [["status"]],
  promotedFields: ["points"],
  permissions: [{ roles: ["User"], actions: ["read", "create", "update"] }]
});

const actor = { id: "owner@example.com", roles: ["User"], tenantId: "acme" };
const typedTable = planD1TypedProjectionLayout(Note).table;

interface Deployment {
  readonly d1: TestD1;
  readonly fetch: (path: string, init?: RequestInit) => Promise<Response>;
  services(): CloudFrappeRuntimeServices;
}

function deploy(
  registry: ModelRegistry,
  typedProjections?: CloudFrappeTypedProjectionOptions,
  // A redeploy over an existing database, with different options.
  existing?: TestD1
): Deployment {
  const d1 = existing ?? createTestD1({
    schema: [...frameworkSchema(), ...planD1TypedProjectionMigrations(registry.list()).map(renderD1Migration)]
  });
  const Coordinator = createAggregateCoordinatorClass({
    registry,
    documentDeliveryOutbox: false,
    notifications: false,
    assignmentRuleActor: false,
    ...(typedProjections === undefined ? {} : { typedProjections })
  });
  const instances = new Map<string, AggregateCoordinatorRpc>();
  const env = {
    DB: d1.database,
    AGGREGATES: {
      idFromName: (name: string) => name as unknown as DurableObjectId,
      get(id: DurableObjectId) {
        const key = id as unknown as string;
        let instance = instances.get(key);
        if (instance === undefined) {
          instance = new Coordinator({} as DurableObjectState, { DB: d1.database }) as unknown as AggregateCoordinatorRpc;
          instances.set(key, instance);
        }
        return instance;
      }
    } as RpcDurableObjectNamespace<AggregateCoordinatorRpc>
  };
  let captured: CloudFrappeRuntimeServices | undefined;
  const worker = createCloudFrappeWorker<typeof env>({
    registry,
    actor: () => actor,
    ...(typedProjections === undefined ? {} : { typedProjections }),
    jobs: {
      registry: createJobRegistry<CloudFrappeRuntimeServices>({ jobs: [] }),
      queue: (_env, services) => {
        captured = services;
        return new InMemoryJobQueue();
      }
    }
  });
  return {
    d1,
    fetch: (path, init) => worker.fetch!(
      new Request(`http://localhost${path}`, init) as unknown as Parameters<NonNullable<typeof worker.fetch>>[0],
      env,
      { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext
    ) as Promise<Response>,
    services: () => captured!
  };
}

async function seed(deployment: Deployment): Promise<void> {
  for (const [title, status, points] of [["a", "Open", 1], ["b", "Done", 2], ["c", "Open", 3], ["d", "Open", null]] as const) {
    const response = await deployment.fetch("/api/resource/Note", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, status, ...(points === null ? {} : { points }) })
    });
    expect(response.status).toBe(201);
  }
}

async function listNames(deployment: Deployment, query: string): Promise<readonly string[]> {
  const response = await deployment.fetch(`/api/resource/Note${query}`);
  expect(response.status).toBe(200);
  const body = await response.json() as { readonly data: readonly { readonly data: { readonly title: string } }[] };
  return body.data.map((document) => document.data.title).sort();
}

describe("typed projection tables through the Worker and the aggregate coordinator", () => {
  it("touches no typed table when the option is omitted", async () => {
    const deployment = deploy(createRegistry({ doctypes: [Note] }));
    await seed(deployment);
    expect(await listNames(deployment, "?filter_status=Open")).toEqual(["a", "c", "d"]);
    expect(deployment.d1.executed.some((sql) => sql.includes("cf_frappe_p_"))).toBe(false);
    expect(deployment.services().typedProjections).toBeUndefined();
    deployment.d1.close();
  });

  it("writes and reads an active DocType through its typed table", async () => {
    const deployment = deploy(createRegistry({ doctypes: [Note] }), { doctypes: { Note: { mode: "active", table: typedTable } } });
    await seed(deployment);
    expect(deployment.d1.query(`SELECT COUNT(*) AS n FROM ${typedTable}`)[0]!.n).toBe(4);

    const before = deployment.d1.executed.length;
    expect(await listNames(deployment, "?filter_status=Open")).toEqual(["a", "c", "d"]);
    const reads = deployment.d1.executed.slice(before);
    expect(reads.some((sql) => sql.includes(`FROM ${typedTable}`) && sql.includes("f_status = ?"))).toBe(true);
    expect(reads.some((sql) => sql.includes("FROM cf_frappe_documents") && sql.includes("doctype = ?") && sql.includes("status"))).toBe(false);
    expect(await listNames(deployment, "?filter_points=2")).toEqual(["b"]);

    // Parity with the shared table, which is still written alongside.
    const typed = deployment.services().typedProjections!;
    expect((await typed.compare("acme", "Note")).differences).toEqual([]);
    deployment.d1.close();
  });

  it("writes a shadow DocType's typed table but keeps reading the shared one", async () => {
    const deployment = deploy(createRegistry({ doctypes: [Note] }), { mode: "shadow" });
    await seed(deployment);
    expect(deployment.d1.query(`SELECT COUNT(*) AS n FROM ${typedTable}`)[0]!.n).toBe(4);
    const before = deployment.d1.executed.length;
    expect(await listNames(deployment, "?filter_status=Open")).toEqual(["a", "c", "d"]);
    expect(deployment.d1.executed.slice(before).some((sql) => sql.includes(`FROM ${typedTable}`))).toBe(false);
    deployment.d1.close();
  });

  it("routes reads per DocType when one is active and another is in shadow", async () => {
    const Memo = defineDocType({ ...Note, name: "Memo" });
    const registry = createRegistry({ doctypes: [Note, Memo] });
    const deployment = deploy(registry, { doctypes: { Note: { mode: "active", table: typedTable }, Memo: "shadow" } });
    const memoTable = planD1TypedProjectionLayout(Memo).table;
    const created = await deployment.fetch("/api/resource/Memo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "m", status: "Open" })
    });
    expect(created.status).toBe(201);
    expect(deployment.d1.query(`SELECT COUNT(*) AS n FROM ${memoTable}`)[0]!.n).toBe(1);

    const before = deployment.d1.executed.length;
    const response = await deployment.fetch("/api/resource/Memo?filter_status=Open");
    expect(response.status).toBe(200);
    const reads = deployment.d1.executed.slice(before);
    expect(reads.some((sql) => sql.includes(`FROM ${memoTable}`))).toBe(false);
    expect(reads.some((sql) => sql.includes("FROM cf_frappe_documents"))).toBe(true);
    deployment.d1.close();
  });

  it("rebuilds a typed table switched on after the fact, and compares it clean", async () => {
    // Documents written with the option off, then the same database deployed
    // with the DocType in `shadow`: the history predates the table, so only a
    // rebuild from the event stream can fill it.
    const registry = createRegistry({ doctypes: [Note] });
    const before = deploy(registry);
    await seed(before);
    const options: CloudFrappeTypedProjectionOptions = { mode: "shadow" };
    const after = deploy(registry, options, before.d1);
    await after.fetch("/api/resource/Note");
    const typed = after.services().typedProjections!;

    expect((await typed.compare("acme", "Note")).differences.map((difference) => difference.reason))
      .toEqual(["missing", "missing", "missing", "missing"]);
    const run = await typed.rebuild.start({ tenantId: "acme", doctype: "Note", target: TYPED_PROJECTION_TARGET });
    for (let more = true; more;) {
      more = (await typed.rebuild.advance("acme", run.runId)).more;
    }
    expect((await typed.compare("acme", "Note")).differences).toEqual([]);
    before.d1.close();
  });

  it("refuses a misconfiguration when the Worker and the coordinator are created", () => {
    const registry = createRegistry({ doctypes: [Note] });
    expect(() => createCloudFrappeWorker({ registry, actor: () => actor, typedProjections: { doctypes: { Nope: "active" } } }))
      .toThrow(/not registered/);
    expect(() => createAggregateCoordinatorClass({ registry, typedProjections: { mode: "on" as never } }))
      .toThrow(/must be one of/);
    expect(() => createCloudFrappeWorker({ registry, actor: () => actor, typedProjections: { doctypes: { Note: "active" } } }))
      .toThrow(/names no table/);
  });

  it("refuses to start when an active DocType's layout no longer plans its pinned table", () => {
    // The pin was taken on the table that was rebuilt and compared. Adding an
    // index moves the layout digest; without the check, the Worker would read
    // a new, empty table and the coordinator would write only there.
    const pinned: CloudFrappeTypedProjectionOptions = { doctypes: { Note: { mode: "active", table: typedTable } } };
    const indexed = createRegistry({ doctypes: [defineDocType({ ...Note, indexes: [["status"], ["status", "title"]] })] });
    expect(() => createCloudFrappeWorker({ registry: indexed, actor: () => actor, typedProjections: pinned }))
      .toThrow(expect.objectContaining({ code: "D1_TYPED_PROJECTION_LAYOUT_MISMATCH" }));
    expect(() => createAggregateCoordinatorClass({ registry: indexed, typedProjections: pinned }))
      .toThrow(expect.objectContaining({ code: "D1_TYPED_PROJECTION_LAYOUT_MISMATCH" }));
  });
});
