import {
  createRegistry,
  D1DocumentStore,
  D1EventStore,
  D1ShardMigrations,
  D1TenantShardDirectory,
  defineD1Migration,
  defineDocType,
  DocumentService,
  documentStream,
  fenceD1Tenant,
  isD1TenantFencedError,
  planD1Migrations,
  TenantShardRouter,
  tenantOfStream,
  type Actor,
  type Clock,
  type IdGenerator,
  type TenantShardAssignment
} from "../../src";
import { isD1ConstraintError } from "../../src/adapters/d1/constraint-error.js";
import { createTenantShardingRuntime, type CloudFrappeTenantShardingOptions } from "../../src/cloudflare";
import { createTestD1, frameworkSchema, wranglerMigratedSchema, type TestD1 } from "../d1-engine.js";

/**
 * Issue #14 at the adapter layer, on the real SQLite engine behind the D1
 * facade: three databases — `home` (also the directory), `east` and `west` —
 * and the routing stores in front of them.
 */

const Ticket = defineDocType({
  name: "Ticket",
  naming: { kind: "series", pattern: "TICK-####" },
  fields: [
    { name: "subject", type: "text", required: true },
    { name: "code", type: "text", unique: true }
  ],
  permissions: [{ roles: ["Agent"], actions: ["read", "create", "update", "delete"] }]
});
const registry = createRegistry({ doctypes: [Ticket] });

function agent(tenantId: string): Actor {
  return { id: "agent@example.com", roles: ["Agent"], tenantId };
}

let nextId = 0;
function ids(prefix = "id"): IdGenerator {
  return { next: (head = "") => `${head}${prefix}${String((nextId += 1)).padStart(6, "0")}` };
}

interface Env {
  readonly DB: D1Database;
  readonly EAST: D1Database;
  readonly WEST: D1Database;
}

interface World {
  readonly home: TestD1;
  readonly east: TestD1;
  readonly west: TestD1;
  readonly env: Env;
  runtime(overrides?: Partial<CloudFrappeTenantShardingOptions<Env>>): ReturnType<typeof createTenantShardingRuntime<Env>>;
  documents(runtime: ReturnType<typeof createTenantShardingRuntime<Env>>): DocumentService;
  close(): void;
}

const clock: Clock = { now: () => "2026-03-01T00:00:00.000Z" };

/**
 * workerd's D1 reports a trigger's `RAISE(ABORT, ...)` as
 * `D1_ERROR: <message>: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)`
 * (observed under `wrangler dev`), while `node:sqlite` reports the bare message.
 * The difference matters: D1's wording contains "constraint", which is what
 * the D1 stores turn into a version conflict. Rewrapping here keeps the tests
 * honest about the message the adapters actually see in production.
 */
const D1_TRIGGER_ERROR_CODE = 1811;
function withWorkerdErrors(db: D1Database): D1Database {
  const rethrow = (error: unknown): never => {
    const code = (error as { readonly errcode?: number }).errcode;
    if (error instanceof Error && code === D1_TRIGGER_ERROR_CODE) {
      throw new Error(`D1_ERROR: ${error.message}: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)`);
    }
    throw error;
  };
  const wrap = <T extends object>(statement: T): T =>
    new Proxy(statement, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof value !== "function") {
          return value;
        }
        return (...args: unknown[]) => {
          const result = (value as (...a: unknown[]) => unknown).apply(target, args);
          if (property === "bind") {
            return wrap(result as object);
          }
          return result instanceof Promise ? result.catch(rethrow) : result;
        };
      }
    });
  return {
    prepare: (sql: string) => wrap(db.prepare(sql)),
    batch: (statements: D1PreparedStatement[]) => db.batch(statements).catch(rethrow)
  } as unknown as D1Database;
}

function world(options: { readonly westSchema?: readonly string[] } = {}): World {
  const home = createTestD1({ schema: wranglerMigratedSchema() });
  const east = createTestD1({ schema: wranglerMigratedSchema() });
  const west = createTestD1({ schema: options.westSchema ?? wranglerMigratedSchema() });
  const env: Env = {
    DB: withWorkerdErrors(home.database),
    EAST: withWorkerdErrors(east.database),
    WEST: withWorkerdErrors(west.database)
  };
  return {
    home,
    east,
    west,
    env,
    runtime: (overrides = {}) =>
      createTenantShardingRuntime(env, {
        shards: (e) => ({ east: e.EAST, west: e.WEST }),
        clock,
        ids: ids("m"),
        ...overrides
      }, { registry }),
    documents: (runtime) => new DocumentService({ registry, store: runtime.documents, clock, ids: ids() }),
    close() {
      home.close();
      east.close();
      west.close();
    }
  };
}

function count(db: TestD1, table: string, tenantId: string): number {
  return Number(db.query(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ?`, tenantId)[0]!.n);
}

describe("tenantOfStream", () => {
  it("recovers the tenant from every stream shape, including tenants that need escaping", () => {
    for (const tenantId of ["acme", "a:b", "100%", "x.y", "über", "__global__"]) {
      expect(tenantOfStream(documentStream(tenantId, "Ticket", "T:1"))).toBe(tenantId);
    }
  });
});

describe("the tenant fence trigger", () => {
  it("is told apart from a version conflict in D1's own wording", () => {
    const fenced = new Error("D1_ERROR: CF_FRAPPE_TENANT_FENCED: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)");
    const unique = new Error("D1_ERROR: UNIQUE constraint failed: cf_frappe_events.stream, cf_frappe_events.sequence: SQLITE_CONSTRAINT");

    expect([isD1TenantFencedError(fenced), isD1ConstraintError(fenced)]).toEqual([true, false]);
    expect([isD1TenantFencedError(unique), isD1ConstraintError(unique)]).toEqual([false, true]);
  });

  it("refuses event inserts for a fenced tenant only, as an error that is not a version conflict", async () => {
    const db = createTestD1({ schema: frameworkSchema() });
    const events = new D1EventStore(db.database);
    const base = { type: "Note", doctype: "Note", actorId: "a", occurredAt: "2026-03-01T00:00:00.000Z", payload: { kind: "Noted" }, metadata: {} };
    await events.append("acme:Note:1", 0, [{ ...base, id: "e1", tenantId: "acme", stream: "acme:Note:1", documentName: "1" } as never]);
    await fenceD1Tenant(db.database, { tenantId: "acme", moveId: "move_1", attempt: 1, fencedAt: "2026-03-01T00:00:00.000Z" });

    const refused = await events
      .append("acme:Note:1", 1, [{ ...base, id: "e2", tenantId: "acme", stream: "acme:Note:1", documentName: "1" } as never])
      .catch((error: unknown) => error);
    await events.append("globex:Note:1", 0, [{ ...base, id: "e3", tenantId: "globex", stream: "globex:Note:1", documentName: "1" } as never]);

    expect(isD1TenantFencedError(refused)).toBe(true);
    // Not reported as DOCUMENT_CONFLICT: re-reading this database would find
    // the same version and fail the same way forever.
    expect(refused).not.toMatchObject({ code: "DOCUMENT_CONFLICT" });
    expect(db.query("SELECT id FROM cf_frappe_events ORDER BY id")).toEqual([{ id: "e1" }, { id: "e3" }]);
    db.close();
  });

  it("rolls back the whole commit batch — projection rows included — when one event is fenced", async () => {
    const db = createTestD1({ schema: frameworkSchema() });
    const documents = new DocumentService({ registry, store: new D1DocumentStore(db.database), clock, ids: ids() });
    await fenceD1Tenant(db.database, { tenantId: "acme", moveId: "move_1", attempt: 1, fencedAt: "2026-03-01T00:00:00.000Z" });

    await expect(documents.create({ actor: agent("acme"), doctype: "Ticket", data: { subject: "x" } })).rejects.toSatisfy(
      isD1TenantFencedError
    );

    expect(count(db, "cf_frappe_events", "acme")).toBe(0);
    expect(count(db, "cf_frappe_documents", "acme")).toBe(0);
    db.close();
  });
});

describe("tenant routing", () => {
  it("is off the hot path for tenants that only read: an unassigned tenant reads home and is not placed", async () => {
    const w = world();
    const runtime = w.runtime({ newTenants: "place" });

    expect(await runtime.events.currentVersion(documentStream("ghost", "Ticket", "T-1"))).toBe(0);
    expect(await runtime.table.get("ghost", "Ticket", "T-1")).toBeNull();

    expect(w.home.query("SELECT * FROM cf_frappe_tenant_shards")).toEqual([]);
    w.close();
  });

  it("routes each tenant's writes and reads to its own shard, invisibly to DocumentService", async () => {
    const w = world();
    const runtime = w.runtime();
    await runtime.services.provisioner.provision("acme", { shardId: "east" });
    await runtime.services.provisioner.provision("globex", { shardId: "west" });
    const documents = w.documents(runtime);

    const acme = await documents.create({ actor: agent("acme"), doctype: "Ticket", data: { subject: "A", code: "X" } });
    // The same unique code in another tenant: its reservation lives on its own shard.
    const globex = await documents.create({ actor: agent("globex"), doctype: "Ticket", data: { subject: "G", code: "X" } });
    await documents.update({ actor: agent("acme"), doctype: "Ticket", name: acme.name, patch: { subject: "A2" } });

    expect(count(w.east, "cf_frappe_events", "acme")).toBeGreaterThan(0);
    expect(count(w.east, "cf_frappe_events", "globex")).toBe(0);
    expect(count(w.west, "cf_frappe_events", "globex")).toBeGreaterThan(0);
    expect(count(w.home, "cf_frappe_events", "acme") + count(w.home, "cf_frappe_events", "globex")).toBe(0);
    expect(await runtime.table.get("acme", "Ticket", acme.name)).toMatchObject({ version: 2, data: { subject: "A2" } });
    expect(await runtime.table.get("globex", "Ticket", globex.name)).toMatchObject({ version: 1 });
    expect((await runtime.table.list({ tenantId: "acme", doctype: "Ticket" })).data.map((row) => row.name)).toEqual([acme.name]);
    w.close();
  });

  it("puts unassigned tenants on home by default, so switching sharding on changes nothing", async () => {
    const w = world();
    const runtime = w.runtime();
    await w.documents(runtime).create({ actor: agent("acme"), doctype: "Ticket", data: { subject: "A" } });

    expect(count(w.home, "cf_frappe_events", "acme")).toBeGreaterThan(0);
    expect(w.home.query("SELECT tenant_id, shard_id FROM cf_frappe_tenant_shards")).toEqual([
      { tenant_id: "acme", shard_id: "home" }
    ]);
    w.close();
  });

  it("refuses an atomic write spanning tenants, which could span databases", async () => {
    const w = world();
    const runtime = w.runtime();
    await expect(runtime.events.appendBatch([
      { stream: documentStream("acme", "Note", "1"), expectedVersion: 0, events: [] },
      { stream: documentStream("globex", "Note", "1"), expectedVersion: 0, events: [] }
    ])).rejects.toMatchObject({ code: "TENANT_SHARD_INVALID" });
    w.close();
  });

  it("keeps framework state on home without a directory entry", async () => {
    const w = world();
    const runtime = w.runtime({ newTenants: "place" });
    const stream = documentStream("__global__", "__JobSchedules", "definitions");
    await runtime.events.append(stream, 0, [{
      id: "g1", tenantId: "__global__", stream, type: "X", doctype: "__JobSchedules", documentName: "definitions",
      actorId: "a", occurredAt: "2026-03-01T00:00:00.000Z", payload: { kind: "X" } as never, metadata: {}
    }]);
    expect(w.home.query("SELECT stream FROM cf_frappe_events")).toEqual([{ stream }]);
    expect(w.home.query("SELECT * FROM cf_frappe_tenant_shards")).toEqual([]);
    w.close();
  });

  it("caches answers for the TTL and never caches an unassigned tenant", async () => {
    const directory = new D1TenantShardDirectory(createTestD1({ schema: frameworkSchema() }).database, { clock });
    let now = 0;
    let reads = 0;
    const counting = {
      get: async (tenantId: string) => {
        reads += 1;
        return directory.get(tenantId);
      },
      assign: (tenantId: string, shardId: string) => directory.assign(tenantId, shardId),
      list: directory.list.bind(directory),
      countByShard: directory.countByShard.bind(directory)
    };
    const router = new TenantShardRouter<string>({
      directory: counting,
      shards: new Map([["home", "home"], ["east", "east"]]),
      home: "home",
      provision: (tenantId) => directory.assign(tenantId, "east"),
      cacheTtlMs: 1_000,
      now: () => now
    });

    expect(await router.forRead("acme")).toBe("home");
    expect(await router.forRead("acme")).toBe("home");
    expect(reads).toBe(2);

    expect(await router.forWrite("acme")).toBe("east");
    expect(await router.forRead("acme")).toBe("east");
    expect(reads).toBe(3);

    now = 1_001;
    expect(await router.forRead("acme")).toBe("east");
    expect(reads).toBe(4);
    router.fenced("acme");
    expect(await router.forRead("acme")).toBe("east");
    expect(reads).toBe(5);
  });

  it("caches 'unassigned, read home' only when the first write would land on home anyway", async () => {
    const w = world();
    const homeFirst = w.runtime();
    const placing = w.runtime({ newTenants: "place", accepting: ["east"] });
    const stream = documentStream("acme", "Ticket", "T-1");

    await homeFirst.events.currentVersion(stream);
    await placing.events.currentVersion(stream);
    const reads = () => w.home.statements.filter((statement) => statement.sql.includes("FROM cf_frappe_tenant_shards")).length;
    const before = reads();
    await homeFirst.events.currentVersion(stream);
    expect(reads()).toBe(before);
    await placing.events.currentVersion(stream);
    expect(reads()).toBe(before + 1);
    w.close();
  });

  it("refuses to route to a shard this deployment has no binding for", async () => {
    const w = world();
    const runtime = w.runtime();
    await runtime.services.directory.assign("acme", "north");
    await expect(runtime.table.get("acme", "Ticket", "x")).rejects.toMatchObject({ code: "TENANT_SHARD_NOT_FOUND" });
    w.close();
  });
});

describe("fenced writes", () => {
  it("follow the tenant to its new shard when the directory flips while they wait", async () => {
    const w = world();
    const runtime = w.runtime({ fenceWaitMs: 2_000, cacheTtlMs: 60_000 });
    const documents = w.documents(runtime);
    const created = await documents.create({ actor: agent("acme"), doctype: "Ticket", data: { subject: "A" } });
    // Arrange what a finished move leaves: the target holds a copy, the source
    // is fenced, and this isolate's cache still says home.
    for (const row of w.home.query("SELECT * FROM cf_frappe_events WHERE tenant_id = 'acme'")) {
      const columns = Object.keys(row);
      w.east.query(
        `INSERT INTO cf_frappe_events (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        ...Object.values(row)
      );
    }
    await fenceD1Tenant(w.home.database, { tenantId: "acme", moveId: "move_x", attempt: 1, fencedAt: clock.now() });
    let flipped = false;
    setTimeout(() => {
      w.home.query("UPDATE cf_frappe_tenant_shards SET shard_id = 'east', epoch = 2 WHERE tenant_id = 'acme'");
      flipped = true;
    }, 60);

    const updated = await documents.update({ actor: agent("acme"), doctype: "Ticket", name: created.name, patch: { subject: "B" } });

    expect(flipped).toBe(true);
    expect(updated.version).toBe(2);
    expect(w.east.query("SELECT MAX(sequence) AS v FROM cf_frappe_events WHERE stream = ?", documentStream("acme", "Ticket", created.name)))
      .toEqual([{ v: 2 }]);
    expect(w.home.query("SELECT MAX(sequence) AS v FROM cf_frappe_events WHERE stream = ?", documentStream("acme", "Ticket", created.name)))
      .toEqual([{ v: 1 }]);
    w.close();
  });

  it("give up with a retryable 503 TENANT_MOVING when the fence outlasts fenceWaitMs", async () => {
    const w = world();
    const runtime = w.runtime({ fenceWaitMs: 100 });
    const documents = w.documents(runtime);
    await documents.create({ actor: agent("acme"), doctype: "Ticket", data: { subject: "A" } });
    await fenceD1Tenant(w.home.database, { tenantId: "acme", moveId: "move_x", attempt: 1, fencedAt: clock.now() });

    await expect(documents.create({ actor: agent("acme"), doctype: "Ticket", data: { subject: "B" } })).rejects.toMatchObject({
      code: "TENANT_MOVING",
      status: 503
    });
    w.close();
  });
});

describe("provisioning", () => {
  it("places new tenants on the accepting shard with the fewest tenants, migrating it first", async () => {
    // `west` starts as an empty database: provisioning must migrate it before
    // any tenant can land there.
    const w = world({ westSchema: [] });
    const runtime = w.runtime({ newTenants: "place", accepting: ["east", "west"] });
    await runtime.services.directory.assign("old", "east");

    const documents = w.documents(runtime);
    await documents.create({ actor: agent("fresh"), doctype: "Ticket", data: { subject: "F" } });

    expect(await runtime.services.directory.get("fresh")).toMatchObject({ shardId: "west", epoch: 1 });
    expect(count(w.west, "cf_frappe_events", "fresh")).toBeGreaterThan(0);
    expect(w.west.query("SELECT id FROM cf_frappe_migrations ORDER BY id").map((row) => row.id)).toEqual(
      planD1Migrations(registry.list()).map((migration) => migration.id)
    );
    w.close();
  });

  it("agrees on one shard when two isolates provision the same tenant at once", async () => {
    const w = world();
    const first = w.runtime({ newTenants: "place", accepting: ["east"] });
    const second = w.runtime({ newTenants: "place", accepting: ["west"] });

    const [a, b] = await Promise.all([
      first.services.provisioner.provision("acme"),
      second.services.provisioner.provision("acme")
    ]);

    expect(a.shardId).toBe(b.shardId);
    expect(w.home.query("SELECT COUNT(*) AS n FROM cf_frappe_tenant_shards")).toEqual([{ n: 1 }]);
    w.close();
  });

  it("keeps a tenant that wrote before sharding was on, and was never registered, on home under placement", async () => {
    const w = world();
    // Sharding off: acme writes straight to DB.
    const before = new DocumentService({ registry, store: new D1DocumentStore(w.env.DB), clock, ids: ids() });
    const old = await before.create({ actor: agent("acme"), doctype: "Ticket", data: { subject: "old", code: "X" } });
    // Switched on with placement, acme not registered.
    const runtime = w.runtime({ newTenants: "place", accepting: ["east"] });
    const documents = w.documents(runtime);

    const next = await documents.create({ actor: agent("acme"), doctype: "Ticket", data: { subject: "new" } });

    expect(await runtime.services.directory.get("acme")).toMatchObject({ shardId: "home" });
    expect(next.name).not.toBe(old.name);
    expect(await runtime.table.get("acme", "Ticket", old.name)).toMatchObject({ data: { subject: "old" } });
    await expect(documents.create({ actor: agent("acme"), doctype: "Ticket", data: { subject: "dup", code: "X" } })).rejects.toMatchObject({
      status: 409
    });
    expect(count(w.east, "cf_frappe_events", "acme")).toBe(0);
    // A tenant that never wrote is still placed.
    await documents.create({ actor: agent("fresh"), doctype: "Ticket", data: { subject: "F" } });
    expect(await runtime.services.directory.get("fresh")).toMatchObject({ shardId: "east" });
    w.close();
  });

  it("refuses to place an unregistered tenant with data on home onto another shard by hand", async () => {
    const w = world();
    const before = new DocumentService({ registry, store: new D1DocumentStore(w.env.DB), clock, ids: ids() });
    await before.create({ actor: agent("acme"), doctype: "Ticket", data: { subject: "old" } });
    const runtime = w.runtime();

    await expect(runtime.services.provisioner.provision("acme", { shardId: "east" })).rejects.toMatchObject({
      code: "TENANT_SHARD_INVALID",
      status: 409
    });
    expect(await runtime.services.directory.get("acme")).toBeNull();
    w.close();
  });

  it("refuses a placement onto a shard that is not bound", async () => {
    const w = world();
    const runtime = w.runtime();
    await expect(runtime.services.provisioner.provision("acme", { shardId: "north" })).rejects.toMatchObject({
      code: "TENANT_SHARD_NOT_FOUND"
    });
    w.close();
  });
});

describe("per-shard migrations", () => {
  it("reports each shard's applied and pending migrations, from Wrangler's journal or its own", async () => {
    // home and east were migrated by Wrangler (its `d1_migrations` journal);
    // west starts empty and is migrated by the roll-out (`cf_frappe_migrations`).
    const w = world({ westSchema: [] });
    const runtime = w.runtime();
    const plan = planD1Migrations(registry.list()).map((migration) => migration.id);

    const before = await runtime.services.migrations.status();
    expect(before.find((shard) => shard.shardId === "east")).toMatchObject({ pending: [], applied: [...plan].sort() });
    expect(before.find((shard) => shard.shardId === "west")).toMatchObject({ applied: [], pending: plan });

    const rolled = await runtime.services.migrations.rollOut();
    expect(rolled.steps.map((step) => [step.shardId, step.outcome])).toEqual([
      ["home", "current"],
      ["east", "current"],
      ["west", "applied"]
    ]);
    const after = await runtime.services.migrations.status();
    expect(after.every((shard) => shard.pending.length === 0)).toBe(true);
    w.close();
  });

  it("rolls out one shard at a time, stops at the first failure, and resumes where it stopped", async () => {
    const shards = {
      a: createTestD1(),
      b: createTestD1({ failSqlIncludes: "CREATE TABLE IF NOT EXISTS rolled" }),
      c: createTestD1()
    };
    const extra = defineD1Migration({
      id: "0100_rolled",
      statements: [{ name: "create_rolled", sql: "CREATE TABLE IF NOT EXISTS rolled (id TEXT PRIMARY KEY);" }]
    });
    const migrations = new D1ShardMigrations({
      shards: new Map(Object.entries(shards).map(([id, db]) => [id, db.database])),
      migrations: () => [extra]
    });

    const first = await migrations.rollOut();

    expect(first.complete).toBe(false);
    expect(first.steps.map((step) => [step.shardId, step.outcome])).toEqual([
      ["a", "applied"],
      ["b", "failed"],
      ["c", "not-attempted"]
    ]);
    expect(shards.c.query("SELECT name FROM sqlite_master WHERE name = 'rolled'")).toEqual([]);

    const healed = new D1ShardMigrations({
      shards: new Map([["a", shards.a.database], ["b", createTestD1().database], ["c", shards.c.database]]),
      migrations: () => [extra]
    });
    const second = await healed.rollOut();

    expect(second.complete).toBe(true);
    expect(second.steps.map((step) => [step.shardId, step.outcome])).toEqual([
      ["a", "current"],
      ["b", "applied"],
      ["c", "applied"]
    ]);
  });

  it("brings a shard current when two isolates migrate it at once, without failing the second", async () => {
    const db = createTestD1();
    const plan = () => [
      defineD1Migration({ id: "0100_one", statements: [{ name: "one", sql: "CREATE TABLE IF NOT EXISTS one (id TEXT PRIMARY KEY);" }] }),
      defineD1Migration({ id: "0101_two", statements: [{ name: "two", sql: "ALTER TABLE one ADD COLUMN two TEXT;" }] })
    ];
    const isolate = () => new D1ShardMigrations({ shards: new Map([["a", db.database]]), migrations: plan });

    await Promise.all([isolate().ensureCurrent("a"), isolate().ensureCurrent("a"), isolate().ensureCurrent("a")]);

    const [status] = await isolate().status();
    expect(status).toMatchObject({ applied: ["0100_one", "0101_two"], pending: [] });
  });

  it("names a shard whose applied migration no longer matches the plan", async () => {
    const db = createTestD1();
    const original = defineD1Migration({ id: "0100_x", statements: [{ name: "x", sql: "CREATE TABLE x (id TEXT);" }] });
    const changed = defineD1Migration({ id: "0100_x", statements: [{ name: "x", sql: "CREATE TABLE x (id TEXT, y TEXT);" }] });
    await new D1ShardMigrations({ shards: new Map([["a", db.database]]), migrations: () => [original] }).rollOut();

    const [status] = await new D1ShardMigrations({ shards: new Map([["a", db.database]]), migrations: () => [changed] }).status();

    expect(status).toMatchObject({ shardId: "a", error: expect.stringContaining("checksum") });
  });
});

describe("cross-tenant scatter-gather", () => {
  async function populated() {
    const w = world();
    const runtime = w.runtime();
    const documents = w.documents(runtime);
    const placement: Record<string, string> = { a: "east", b: "west", c: "home", d: "east" };
    for (const [tenantId, shardId] of Object.entries(placement)) {
      await runtime.services.provisioner.provision(tenantId, { shardId });
    }
    for (const [index, tenantId] of ["a", "b", "b", "c", "d", "d", "d"].entries()) {
      await new DocumentService({
        registry,
        store: runtime.documents,
        clock: { now: () => `2026-03-01T00:00:0${index}.000Z` },
        ids: ids()
      }).create({ actor: agent(tenantId), doctype: "Ticket", data: { subject: `${tenantId}${index}` } });
    }
    return { w, runtime };
  }

  it("counts per tenant across shards — the billing roll-up", async () => {
    const { w, runtime } = await populated();

    const counted = await runtime.services.scatter.countDocuments({ tenants: ["a", "b", "c", "d"], doctype: "Ticket" });

    expect(counted.results.map((result) => [result.tenantId, result.shardId, result.value])).toEqual([
      ["a", "east", 1],
      ["b", "west", 2],
      ["c", "home", 1],
      ["d", "east", 3]
    ]);
    expect(counted.total).toBe(7);
    expect(counted.failures).toEqual([]);
    w.close();
  });

  it("merges a global search newest first and caps it at the limit", async () => {
    const { w, runtime } = await populated();

    const found = await runtime.services.scatter.search({ tenants: ["a", "b", "c", "d"], doctype: "Ticket", limit: 3 });

    expect(found.data.map((row) => row.data.subject)).toEqual(["d6", "d5", "d4"]);
    w.close();
  });

  it("refuses more tenants than maxTenants in one call, and pages the directory instead", async () => {
    const { w, runtime } = await populated();
    const limited = w.runtime({ scatter: { maxTenants: 2 } });

    await expect(limited.services.scatter.gather({ tenants: ["a", "b", "c"], run: async () => 1 })).rejects.toMatchObject({
      code: "TENANT_SCATTER_LIMIT_EXCEEDED",
      status: 400
    });
    const first = await limited.services.scatter.tenants();
    const second = await limited.services.scatter.tenants({ after: first.at(-1)!.tenantId });
    expect([...first, ...second].map((row) => row.tenantId)).toEqual(["a", "b", "c", "d"]);
    expect(first).toHaveLength(2);
    void runtime;
    w.close();
  });

  it("never has more than `concurrency` tenants in flight", async () => {
    const { w } = await populated();
    const limited = w.runtime({ scatter: { concurrency: 2 } });
    let inFlight = 0;
    let peak = 0;

    await limited.services.scatter.gather({
      tenants: ["a", "b", "c", "d"],
      run: async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
      }
    });

    expect(peak).toBe(2);
    w.close();
  });

  it("reports a failing or slow tenant instead of failing the whole call", async () => {
    const { w } = await populated();
    const limited = w.runtime({ scatter: { perTenantTimeoutMs: 50 } });

    const gathered = await limited.services.scatter.gather({
      tenants: ["a", "b", "c"],
      run: async ({ tenantId }) => {
        if (tenantId === "b") {
          throw new Error("west is down");
        }
        if (tenantId === "c") {
          await new Promise((resolve) => setTimeout(resolve, 200));
        }
        return tenantId;
      }
    });

    expect(gathered.results.map((result) => result.value)).toEqual(["a"]);
    expect(gathered.failures).toEqual([
      { tenantId: "b", shardId: "west", error: "west is down" },
      { tenantId: "c", shardId: "home", error: expect.stringContaining("did not answer within 50 ms") }
    ]);
    w.close();
  });
});

describe("sharding configuration", () => {
  it("refuses listing the home shard, reusing a database, and malformed ids", () => {
    const w = world();
    const attempt = (shards: CloudFrappeTenantShardingOptions<Env>["shards"]) => () =>
      createTenantShardingRuntime(w.env, { shards }, { registry });

    expect(attempt((e) => ({ home: e.EAST }))).toThrow(/home shard/);
    expect(attempt((e) => ({ east: e.DB }))).toThrow(/reuses a database/);
    expect(attempt((e) => ({ east: e.EAST, west: e.EAST }))).toThrow(/reuses a database/);
    expect(attempt((e) => ({ "bad id": e.EAST }))).toThrow(/letters, digits/);
    w.close();
  });

  it("requires a projection database per shard exactly when the split layout is on", () => {
    const w = world();
    const split = { database: (e: Env) => e.WEST };
    expect(() => createTenantShardingRuntime(w.env, { shards: (e) => ({ east: e.EAST }) }, { registry, projectionDatabase: split }))
      .toThrow(/needs a projectionDatabase/);
    expect(() => createTenantShardingRuntime(w.env, {
      shards: (e) => ({ east: { database: e.EAST, projectionDatabase: e.WEST } })
    }, { registry })).toThrow(/projectionDatabase is off/);
    w.close();
  });
});

export type { TenantShardAssignment };
