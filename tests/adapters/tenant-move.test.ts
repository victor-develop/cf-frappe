import {
  createRegistry,
  defineDocType,
  DocumentService,
  documentStream,
  fenceD1Tenant,
  readD1TenantFence,
  type Actor,
  type Clock,
  type IdGenerator
} from "../../src";
import { createTenantShardingRuntime, type CloudFrappeTenantShardingOptions } from "../../src/cloudflare";
import { createTestD1, wranglerMigratedSchema, type TestD1 } from "../d1-engine.js";

/**
 * Issue #14's online tenant move, on the real SQLite engine: copy events, rebuild
 * the target's projection from them, catch up, fence, verify, flip — with
 * writes landing between every step.
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

const acme: Actor = { id: "agent@example.com", roles: ["Agent"], tenantId: "acme" };
const globex: Actor = { id: "agent@example.com", roles: ["Agent"], tenantId: "globex" };

let nextId = 0;
function ids(prefix = "id"): IdGenerator {
  return { next: (head = "") => `${head}${prefix}${String((nextId += 1)).padStart(6, "0")}` };
}

interface Env {
  readonly DB: D1Database;
  readonly EAST: D1Database;
}

/** A clock every party shares and the test moves by hand. */
function manualClock(start = "2026-03-01T00:00:00.000Z") {
  let now = Date.parse(start);
  const clock: Clock = { now: () => new Date(now).toISOString() };
  return {
    clock,
    tick(ms = 1_000) {
      now += ms;
    }
  };
}

function setup(overrides: Partial<CloudFrappeTenantShardingOptions<Env>> = {}, moves: CloudFrappeTenantShardingOptions<Env>["moves"] = {}) {
  const home = createTestD1({ schema: wranglerMigratedSchema() });
  const east = createTestD1({ schema: wranglerMigratedSchema() });
  const env: Env = { DB: home.database, EAST: east.database };
  const time = manualClock();
  const runtime = (extra: Partial<CloudFrappeTenantShardingOptions<Env>> = {}) =>
    createTenantShardingRuntime(env, {
      shards: (e) => ({ east: e.EAST }),
      clock: time.clock,
      ids: ids("move"),
      cacheTtlMs: 0,
      moves: { pageSize: 4, pagesPerAdvance: 2, catchUpMarginMs: 60_000, ...moves },
      ...overrides,
      ...extra
    }, { registry });
  const operator = runtime();
  const documents = (rt = operator) =>
    new DocumentService({
      registry,
      store: rt.documents,
      clock: { now: () => { time.tick(10); return time.clock.now(); } },
      ids: ids()
    });
  return { home, east, env, time, runtime, operator, documents, close: () => { home.close(); east.close(); } };
}

function tenantEvents(db: TestD1, tenantId: string): readonly Record<string, unknown>[] {
  return db.query(
    "SELECT id, stream, sequence, type, occurred_at, payload_json, metadata_json FROM cf_frappe_events WHERE tenant_id = ? ORDER BY id",
    tenantId
  );
}

function tenantRows(db: TestD1, tenantId: string): readonly Record<string, unknown>[] {
  return db.query(
    "SELECT doctype, name, version, docstatus, data_json, created_at, updated_at FROM cf_frappe_documents WHERE tenant_id = ? ORDER BY doctype, name",
    tenantId
  );
}

function heads(db: TestD1, tenantId: string): readonly Record<string, unknown>[] {
  return db.query(
    "SELECT stream, MAX(sequence) AS head FROM cf_frappe_events WHERE tenant_id = ? GROUP BY stream ORDER BY stream",
    tenantId
  );
}

describe("moving a tenant between shards", () => {
  it("moves a tenant that keeps writing through every phase, and loses nothing", async () => {
    const world = setup();
    const docs = world.documents();
    const created: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      created.push((await docs.create({ actor: acme, doctype: "Ticket", data: { subject: `t${index}`, code: `c${index}` } })).name);
    }
    await docs.create({ actor: globex, doctype: "Ticket", data: { subject: "other tenant" } });
    const globexBefore = tenantEvents(world.home, "globex");

    let move = await world.operator.services.mover.start("acme", "east");
    const phases: string[] = [];
    let writes = 0;
    while (move.phase !== "completed") {
      phases.push(move.phase);
      // A write between every step: creates, updates and unique-value changes,
      // so the catch-up passes and the final fenced pass all have work to do.
      if (writes < 12) {
        writes += 1;
        if (writes % 3 === 0) {
          await docs.create({ actor: acme, doctype: "Ticket", data: { subject: `late${writes}`, code: `late${writes}` } });
        } else {
          const name = created[writes % created.length]!;
          await docs.update({ actor: acme, doctype: "Ticket", name, patch: { subject: `edit${writes}`, code: `e${writes}` } });
        }
      }
      world.time.tick(5_000);
      move = await world.operator.services.mover.advance(move.moveId);
    }

    expect(new Set(phases)).toEqual(new Set(["copying", "building", "catching-up", "cutover"]));
    expect(await world.operator.services.directory.get("acme")).toMatchObject({ shardId: "east", epoch: 2 });
    expect(move.state.cutovers.at(-1)).toMatchObject({ outcome: "completed" });
    // The events, byte for byte, and therefore every stream's head — the
    // version every later write's optimistic check compares against.
    expect(tenantEvents(world.east, "acme")).toEqual(tenantEvents(world.home, "acme"));
    expect(heads(world.east, "acme")).toEqual(heads(world.home, "acme"));
    // The projection the target rebuilt from those events is the one the
    // source's commits wrote inline.
    expect(tenantRows(world.east, "acme")).toEqual(tenantRows(world.home, "acme"));
    expect(tenantRows(world.east, "acme").length).toBeGreaterThan(6);
    // Nothing deleted anywhere; nothing of another tenant touched.
    expect(tenantEvents(world.home, "globex")).toEqual(globexBefore);
    expect(tenantEvents(world.east, "globex")).toEqual([]);
    // The source is left frozen for the tenant.
    expect(await readD1TenantFence(world.home.database, "acme")).toMatchObject({ moveId: move.moveId });

    // And the tenant carries on, on its new shard.
    const after = await docs.update({ actor: acme, doctype: "Ticket", name: created[0]!, patch: { subject: "after" } });
    expect(world.east.query("SELECT MAX(sequence) AS v FROM cf_frappe_events WHERE stream = ?", documentStream("acme", "Ticket", created[0]!)))
      .toEqual([{ v: after.version }]);
    await expect(docs.create({ actor: acme, doctype: "Ticket", data: { subject: "dup", code: "c3" } })).rejects.toMatchObject({
      status: 409
    });
    world.close();
  });

  it("sends a write from an isolate whose cache still says the old shard to the new one", async () => {
    const world = setup();
    const stale = world.runtime({ cacheTtlMs: 3_600_000, fenceWaitMs: 1_000 });
    const staleDocs = world.documents(stale);
    const ticket = await staleDocs.create({ actor: acme, doctype: "Ticket", data: { subject: "a" } });
    // `stale` has now cached acme → home for an hour.

    const move = await world.operator.services.mover.start("acme", "east");
    expect((await world.operator.services.mover.run(move.moveId)).phase).toBe("completed");

    const updated = await staleDocs.update({ actor: acme, doctype: "Ticket", name: ticket.name, patch: { subject: "b" } });

    expect(updated.version).toBe(2);
    const stream = documentStream("acme", "Ticket", ticket.name);
    expect(world.east.query("SELECT MAX(sequence) AS v FROM cf_frappe_events WHERE stream = ?", stream)).toEqual([{ v: 2 }]);
    expect(world.home.query("SELECT MAX(sequence) AS v FROM cf_frappe_events WHERE stream = ?", stream)).toEqual([{ v: 1 }]);
    world.close();
  });

  it("catches an event the window missed with the count check, unfences, rescans, and only then flips", async () => {
    const world = setup({}, { catchUpMarginMs: 0, pageSize: 50 });
    const docs = world.documents();
    await docs.create({ actor: acme, doctype: "Ticket", data: { subject: "a" } });
    const move = await world.operator.services.mover.start("acme", "east");
    let current = await world.operator.services.mover.advance(move.moveId);
    while (current.phase !== "cutover") {
      world.time.tick(60_000);
      current = await world.operator.services.mover.advance(move.moveId);
    }
    // A commit whose occurredAt was stamped long before it landed — before the
    // window the final pass looks at. Inserted straight into the source, the
    // way a slow writer's batch would arrive.
    world.home.query(
      `INSERT INTO cf_frappe_events (id, tenant_id, stream, sequence, type, doctype, document_name, actor_id, occurred_at, payload_json, metadata_json)
       VALUES ('late-1', 'acme', ?, 1, 'Noted', 'Note', 'n1', 'a', '2000-01-01T00:00:00.000Z', '{"kind":"Noted"}', '{}')`,
      documentStream("acme", "Note", "n1")
    );

    current = await world.operator.services.mover.advance(move.moveId);

    expect(current.phase).toBe("catching-up");
    expect(current.state.cutovers.at(-1)).toMatchObject({ outcome: "counts-differ" });
    // The fence came off: the tenant can write while the rescan runs.
    expect(await readD1TenantFence(world.home.database, "acme")).toBeNull();
    expect(await world.operator.services.directory.get("acme")).toMatchObject({ shardId: "home" });

    const done = await world.operator.services.mover.run(move.moveId);
    expect(done.phase).toBe("completed");
    expect(tenantEvents(world.east, "acme")).toEqual(tenantEvents(world.home, "acme"));
    world.close();
  });

  it("unfences and goes back to catching up when the fenced final pass would run long", async () => {
    const world = setup({}, { pageSize: 2, maxCutoverPages: 1, cutoverThreshold: 1_000 });
    const docs = world.documents();
    await docs.create({ actor: acme, doctype: "Ticket", data: { subject: "a" } });
    const move = await world.operator.services.mover.start("acme", "east");
    let current = move;
    while (current.phase !== "cutover") {
      current = await world.operator.services.mover.advance(move.moveId);
    }
    for (let index = 0; index < 4; index += 1) {
      await docs.create({ actor: acme, doctype: "Ticket", data: { subject: `burst${index}` } });
    }

    current = await world.operator.services.mover.advance(move.moveId);

    expect(current.phase).toBe("catching-up");
    expect(current.state.cutovers.at(-1)).toMatchObject({ outcome: "too-many-pages", pages: 1 });
    expect(await readD1TenantFence(world.home.database, "acme")).toBeNull();
    world.close();
  });

  it("aborts cleanly: unfenced, no move in the directory, and the tenant keeps writing where it was", async () => {
    const world = setup();
    const docs = world.documents();
    await docs.create({ actor: acme, doctype: "Ticket", data: { subject: "a" } });
    const move = await world.operator.services.mover.start("acme", "east");
    await fenceD1Tenant(world.home.database, { tenantId: "acme", moveId: move.moveId, fencedAt: world.time.clock.now() });

    const aborted = await world.operator.services.mover.abort(move.moveId, "operator changed their mind");

    expect(aborted).toMatchObject({ phase: "aborted", state: { abortReason: "operator changed their mind" } });
    expect(await readD1TenantFence(world.home.database, "acme")).toBeNull();
    expect(await world.operator.services.directory.get("acme")).toMatchObject({ shardId: "home" });
    expect((await world.operator.services.directory.get("acme"))?.moveId).toBeUndefined();
    await docs.create({ actor: acme, doctype: "Ticket", data: { subject: "b" } });
    expect(await world.operator.services.mover.advance(move.moveId)).toMatchObject({ phase: "aborted" });
    world.close();
  });

  it("lets only one of two drivers apply a step", async () => {
    const world = setup();
    await world.documents().create({ actor: acme, doctype: "Ticket", data: { subject: "a" } });
    const move = await world.operator.services.mover.start("acme", "east");
    const stale = await world.operator.services.directory.requireMove(move.moveId);
    await world.operator.services.mover.advance(move.moveId);

    await expect(world.operator.services.directory.saveMove(stale, { phase: "building", state: stale.state })).rejects.toMatchObject({
      code: "DOCUMENT_CONFLICT"
    });
    world.close();
  });

  it("will not flip the directory for a driver whose journal revision is stale", async () => {
    const world = setup();
    await world.documents().create({ actor: acme, doctype: "Ticket", data: { subject: "a" } });
    const move = await world.operator.services.mover.start("acme", "east");
    let current = move;
    while (current.phase !== "cutover") {
      current = await world.operator.services.mover.advance(move.moveId);
    }
    const stale = { ...current, revision: current.revision - 1 };

    await expect(world.operator.services.directory.completeMove(stale, current.state)).rejects.toMatchObject({
      code: "DOCUMENT_CONFLICT"
    });
    expect(await world.operator.services.directory.get("acme")).toMatchObject({ shardId: "home", moveId: move.moveId });
    world.close();
  });

  it("refuses moves that cannot be safe", async () => {
    const world = setup();
    await world.documents().create({ actor: acme, doctype: "Ticket", data: { subject: "a" } });
    const mover = world.operator.services.mover;

    await expect(mover.start("__global__", "east")).rejects.toMatchObject({ status: 400 });
    await expect(mover.start("acme", "home")).rejects.toMatchObject({ code: "TENANT_MOVE_INVALID" });
    await expect(mover.start("acme", "north")).rejects.toMatchObject({ code: "TENANT_SHARD_NOT_FOUND" });
    await mover.start("acme", "east");
    await expect(mover.start("acme", "east")).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
    world.close();
  });

  it("refuses a target that is behind its source on migrations", async () => {
    const world = setup();
    world.home.query("INSERT INTO d1_migrations (name) VALUES ('0100_newer.sql')");
    await world.documents().create({ actor: acme, doctype: "Ticket", data: { subject: "a" } });

    await expect(world.operator.services.mover.start("acme", "east")).rejects.toMatchObject({
      code: "TENANT_MOVE_INVALID",
      message: expect.stringContaining("0100_newer")
    });
    world.close();
  });

  it("moves a tenant back onto a shard holding its frozen copy, once no cache can still route there", async () => {
    const world = setup({}, { staleFenceAgeMs: 30_000 });
    const docs = world.documents();
    const ticket = await docs.create({ actor: acme, doctype: "Ticket", data: { subject: "a" } });
    const away = await world.operator.services.mover.start("acme", "east");
    await world.operator.services.mover.run(away.moveId);
    await docs.update({ actor: acme, doctype: "Ticket", name: ticket.name, patch: { subject: "b" } });

    await expect(world.operator.services.mover.start("acme", "home")).rejects.toMatchObject({
      code: "TENANT_MOVE_INVALID",
      message: expect.stringContaining("too recently")
    });

    world.time.tick(60_000);
    const back = await world.operator.services.mover.start("acme", "home");
    const done = await world.operator.services.mover.run(back.moveId);

    expect(done.phase).toBe("completed");
    expect(await world.operator.services.directory.get("acme")).toMatchObject({ shardId: "home", epoch: 3 });
    expect(tenantEvents(world.home, "acme")).toEqual(tenantEvents(world.east, "acme"));
    expect(tenantRows(world.home, "acme")).toEqual(tenantRows(world.east, "acme"));
    expect(await readD1TenantFence(world.home.database, "acme")).toBeNull();
    expect(await readD1TenantFence(world.east.database, "acme")).toMatchObject({ moveId: back.moveId });
    world.close();
  });

  it("reads the copy order straight off the tenant/time index, without a sort", () => {
    const db = createTestD1({ schema: wranglerMigratedSchema() });
    const plan = db
      .query(
        `EXPLAIN QUERY PLAN SELECT id FROM cf_frappe_events
         WHERE tenant_id = ? AND occurred_at >= ?
           AND (occurred_at > ? OR stream > ? OR (stream = ? AND sequence > ?))
         ORDER BY occurred_at, stream, sequence LIMIT ?`,
        "acme", "t", "t", "s", "s", 0, 10
      )
      .map((row) => String(row.detail))
      .join(" | ");

    expect(plan).toContain("idx_cf_frappe_events_tenant_time");
    expect(plan).not.toContain("TEMP B-TREE");
    db.close();
  });
});
