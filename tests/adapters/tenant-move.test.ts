import {
  createJobRegistry,
  createRegistry,
  defineDocType,
  DocumentService,
  documentStream,
  fenceD1Tenant,
  JobScheduleService,
  liftD1TenantFence,
  jobScheduleDefinitionsStream,
  readD1TenantFence,
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type Clock,
  type IdGenerator
} from "../../src";
import { createTenantShardingRuntime, type CloudFrappeTenantShardingOptions } from "../../src/cloudflare";
import { vi } from "vitest";
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
    await fenceD1Tenant(world.home.database, { tenantId: "acme", moveId: move.moveId, attempt: 1, fencedAt: world.time.clock.now() });

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

  it("leaves the source fenced when a stale cutover driver runs after another driver completed the move", async () => {
    const world = setup();
    const docs = world.documents();
    // An isolate that will keep routing acme to home from its cache.
    const stuck = world.runtime({ cacheTtlMs: 3_600_000, fenceWaitMs: 1_000 });
    const ticket = await world.documents(stuck).create({ actor: acme, doctype: "Ticket", data: { subject: "a" } });
    const move = await world.operator.services.mover.start("acme", "east");
    let current = move;
    while (current.phase !== "cutover") {
      current = await world.operator.services.mover.advance(move.moveId);
    }
    // Driver B read the move in `cutover`; driver A completes it first, and a
    // write then lands on the target — so B's count check would now differ.
    const stale = await world.operator.services.directory.requireMove(move.moveId);
    expect((await world.operator.services.mover.advance(move.moveId)).phase).toBe("completed");
    await docs.update({ actor: acme, doctype: "Ticket", name: ticket.name, patch: { subject: "on east" } });
    const homeEvents = tenantEvents(world.home, "acme");

    vi.spyOn(world.operator.services.directory, "requireMove").mockResolvedValueOnce(stale);
    await expect(world.operator.services.mover.advance(move.moveId)).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });

    expect(await readD1TenantFence(world.home.database, "acme")).toMatchObject({ moveId: move.moveId });
    // The stale isolate's write is refused on home and follows the directory
    // to east, where its (equally cached) read of version 1 is a plain
    // version conflict the caller retries. What matters: nothing landed on home.
    await expect(
      world.documents(stuck).update({ actor: acme, doctype: "Ticket", name: ticket.name, patch: { subject: "stale isolate" } })
    ).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
    expect(tenantEvents(world.home, "acme")).toEqual(homeEvents);
    expect(await world.operator.table.get("acme", "Ticket", ticket.name)).toMatchObject({ data: { subject: "on east" } });
    world.close();
  });

  it("lets only one of two cutover drivers holding the same revision touch the fence", async () => {
    const world = setup({}, { catchUpMarginMs: 0, pageSize: 50 });
    await world.documents().create({ actor: acme, doctype: "Ticket", data: { subject: "a" } });
    const move = await world.operator.services.mover.start("acme", "east");
    let current = move;
    while (current.phase !== "cutover") {
      world.time.tick(60_000);
      current = await world.operator.services.mover.advance(move.moveId);
    }
    // A late commit outside the window, so the winner's count check differs
    // and it goes back to catching up, lifting the fence.
    world.home.query(
      `INSERT INTO cf_frappe_events (id, tenant_id, stream, sequence, type, doctype, document_name, actor_id, occurred_at, payload_json, metadata_json)
       VALUES ('late-1', 'acme', ?, 1, 'Noted', 'Note', 'n1', 'a', '2000-01-01T00:00:00.000Z', '{"kind":"Noted"}', '{}')`,
      documentStream("acme", "Note", "n1")
    );
    const stale = await world.operator.services.directory.requireMove(move.moveId);
    const winner = await world.operator.services.mover.advance(move.moveId);
    expect(winner.phase).toBe("catching-up");

    vi.spyOn(world.operator.services.directory, "requireMove").mockResolvedValueOnce(stale);
    await expect(world.operator.services.mover.advance(move.moveId)).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });

    // The loser neither left a fence behind for the catch-up passes nor lifted one.
    expect(await readD1TenantFence(world.home.database, "acme")).toBeNull();
    expect((await world.operator.services.mover.run(move.moveId)).phase).toBe("completed");
    expect(await readD1TenantFence(world.home.database, "acme")).toMatchObject({ moveId: move.moveId });
    world.close();
  });

  it("lifts its own fence when an abort lands between its claim and its flip", async () => {
    const world = setup();
    await world.documents().create({ actor: acme, doctype: "Ticket", data: { subject: "a" } });
    const move = await world.operator.services.mover.start("acme", "east");
    let current = move;
    while (current.phase !== "cutover") {
      current = await world.operator.services.mover.advance(move.moveId);
    }
    const directory = world.operator.services.directory;
    const saveMove = directory.saveMove.bind(directory);
    // The abort commits right after this driver claimed the cutover, before it fences.
    vi.spyOn(directory, "saveMove").mockImplementationOnce(async (record, next) => {
      const claimed = await saveMove(record, next);
      await world.operator.services.mover.abort(move.moveId, "operator");
      return claimed;
    });
    const completeMove = vi.spyOn(directory, "completeMove");

    await expect(world.operator.services.mover.advance(move.moveId)).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });
    // It noticed right after fencing, not only when its flip failed.
    expect(completeMove).not.toHaveBeenCalled();

    expect(await world.operator.services.mover.status(move.moveId)).toMatchObject({ phase: "aborted" });
    expect(await world.operator.services.directory.get("acme")).toMatchObject({ shardId: "home" });
    expect(await readD1TenantFence(world.home.database, "acme")).toBeNull();
    world.close();
  });

  it("leaves the fence alone when its back-off loses to a driver that completed the move", async () => {
    const world = setup({}, { catchUpMarginMs: 0, pageSize: 50 });
    await world.documents().create({ actor: acme, doctype: "Ticket", data: { subject: "a" } });
    const move = await world.operator.services.mover.start("acme", "east");
    let current = move;
    while (current.phase !== "cutover") {
      world.time.tick(60_000);
      current = await world.operator.services.mover.advance(move.moveId);
    }
    world.home.query(
      `INSERT INTO cf_frappe_events (id, tenant_id, stream, sequence, type, doctype, document_name, actor_id, occurred_at, payload_json, metadata_json)
       VALUES ('late-1', 'acme', ?, 1, 'Noted', 'Note', 'n1', 'a', '2000-01-01T00:00:00.000Z', '{"kind":"Noted"}', '{}')`,
      documentStream("acme", "Note", "n1")
    );
    const directory = world.operator.services.directory;
    const saveMove = directory.saveMove.bind(directory);
    const spy = vi.spyOn(directory, "saveMove");
    spy.mockImplementationOnce((record, next) => saveMove(record, next));
    // This driver's counts differ; before its back-off is journaled, another
    // driver (one that took the move over) completes it and flips the directory.
    spy.mockImplementationOnce(async (record, next) => {
      const latest = await directory.requireMove(move.moveId);
      await directory.completeMove(latest, latest.state);
      return saveMove(record, next);
    });

    await expect(world.operator.services.mover.advance(move.moveId)).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });

    expect(await world.operator.services.directory.get("acme")).toMatchObject({ shardId: "east" });
    expect(await readD1TenantFence(world.home.database, "acme")).toMatchObject({ moveId: move.moveId });
    world.close();
  });

  it("refuses an abort that loses to a completing cutover, and keeps the source fenced", async () => {
    const world = setup();
    await world.documents().create({ actor: acme, doctype: "Ticket", data: { subject: "a" } });
    const move = await world.operator.services.mover.start("acme", "east");
    let current = move;
    while (current.phase !== "cutover") {
      current = await world.operator.services.mover.advance(move.moveId);
    }
    const stale = await world.operator.services.directory.requireMove(move.moveId);
    expect((await world.operator.services.mover.advance(move.moveId)).phase).toBe("completed");

    vi.spyOn(world.operator.services.directory, "requireMove").mockResolvedValueOnce(stale);
    await expect(world.operator.services.mover.abort(move.moveId, "too late")).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });

    expect(await readD1TenantFence(world.home.database, "acme")).toMatchObject({ moveId: move.moveId });
    expect(await world.operator.services.directory.get("acme")).toMatchObject({ shardId: "east" });
    world.close();
  });

  it("lifts a fence left behind on an aborted move when abort is called again", async () => {
    const world = setup({ fenceWaitMs: 50 });
    const docs = world.documents();
    await docs.create({ actor: acme, doctype: "Ticket", data: { subject: "a" } });
    const move = await world.operator.services.mover.start("acme", "east");
    await world.operator.services.mover.abort(move.moveId, "first");
    // What an invocation that fenced and then died, after the abort, leaves.
    await fenceD1Tenant(world.home.database, { tenantId: "acme", moveId: move.moveId, attempt: 1, fencedAt: world.time.clock.now() });
    await expect(docs.create({ actor: acme, doctype: "Ticket", data: { subject: "b" } })).rejects.toMatchObject({
      code: "TENANT_MOVING"
    });

    expect(await world.operator.services.mover.abort(move.moveId, "again")).toMatchObject({
      phase: "aborted",
      state: { abortReason: "first" }
    });

    expect(await readD1TenantFence(world.home.database, "acme")).toBeNull();
    await docs.create({ actor: acme, doctype: "Ticket", data: { subject: "b" } });
    world.close();
  });

  it("never lets a back-off lift the fence a later cutover attempt of the same move completes under", async () => {
    const world = setup();
    const docs = world.documents();
    await docs.create({ actor: acme, doctype: "Ticket", data: { subject: "a" } });
    const slow = world.runtime({ moves: { pageSize: 2, maxCutoverPages: 1, cutoverThreshold: 1_000, catchUpMarginMs: 60_000 } });
    const fast = world.runtime({ moves: { pageSize: 100, cutoverThreshold: 1_000, catchUpMarginMs: 60_000 } });
    const move = await fast.services.mover.start("acme", "east");
    let current = move;
    while (current.phase !== "cutover") {
      current = await fast.services.mover.advance(move.moveId);
    }
    // Enough new events that the slow driver's one-page final pass runs out.
    for (let index = 0; index < 4; index += 1) {
      await docs.create({ actor: acme, doctype: "Ticket", data: { subject: `b${index}` } });
    }

    // The fast driver stops right before its flip.
    let reachedFlip!: () => void;
    const atFlip = new Promise<void>((resolve) => (reachedFlip = resolve));
    let releaseFlip!: () => void;
    const flipGate = new Promise<void>((resolve) => (releaseFlip = resolve));
    const fastDirectory = fast.services.directory;
    const completeMove = fastDirectory.completeMove.bind(fastDirectory);
    vi.spyOn(fastDirectory, "completeMove").mockImplementation(async (record, state) => {
      reachedFlip();
      await flipGate;
      return completeMove(record, state);
    });
    // The slow driver backs off (too many pages) and journals it; before it
    // lifts its fence, the fast driver catches up, claims a new attempt, runs
    // its final pass and reaches its flip.
    let fastCutover: Promise<unknown> | undefined;
    const slowDirectory = slow.services.directory;
    const get = slowDirectory.get.bind(slowDirectory);
    let paused = false;
    vi.spyOn(slowDirectory, "get").mockImplementation(async (tenantId) => {
      if (!paused) {
        paused = true;
        expect((await fast.services.mover.advance(move.moveId)).phase).toBe("cutover");
        fastCutover = fast.services.mover.advance(move.moveId);
        await atFlip;
      }
      return get(tenantId);
    });

    const backedOff = await slow.services.mover.advance(move.moveId);
    expect(backedOff.state.cutovers.at(-1)).toMatchObject({ outcome: "too-many-pages" });

    // A write routed to home by a stale cache, between the fast driver's count and its flip.
    expect(() =>
      world.home.query(
        `INSERT INTO cf_frappe_events (id, tenant_id, stream, sequence, type, doctype, document_name, actor_id, occurred_at, payload_json, metadata_json)
         VALUES ('lost-1', 'acme', ?, 1, 'DocumentCreated', 'Ticket', 'LOST-1', 'a', ?, '{"kind":"DocumentCreated"}', '{}')`,
        documentStream("acme", "Ticket", "LOST-1"),
        world.time.clock.now()
      )
    ).toThrow(/CF_FRAPPE_TENANT_FENCED/);

    releaseFlip();
    expect(await fastCutover).toMatchObject({ phase: "completed" });
    expect(await world.operator.services.directory.get("acme")).toMatchObject({ shardId: "east" });
    expect(await readD1TenantFence(world.home.database, "acme")).toMatchObject({ moveId: move.moveId });
    expect(tenantEvents(world.home, "acme")).toEqual(tenantEvents(world.east, "acme"));
    world.close();
  });

  it("lets a later attempt take the fence over, and never an earlier one", async () => {
    const db = createTestD1({ schema: wranglerMigratedSchema() });
    const at = "2026-03-01T00:00:00.000Z";
    await fenceD1Tenant(db.database, { tenantId: "acme", moveId: "move_1", attempt: 3, fencedAt: at });

    expect(await fenceD1Tenant(db.database, { tenantId: "acme", moveId: "move_1", attempt: 2, fencedAt: at })).toMatchObject({ attempt: 3 });
    expect(await fenceD1Tenant(db.database, { tenantId: "acme", moveId: "move_2", attempt: 9, fencedAt: at })).toMatchObject({
      moveId: "move_1",
      attempt: 3
    });
    expect(await fenceD1Tenant(db.database, { tenantId: "acme", moveId: "move_1", attempt: 5, fencedAt: at })).toMatchObject({ attempt: 5 });

    await liftD1TenantFence(db.database, "acme", "move_1", 3);
    expect(await readD1TenantFence(db.database, "acme")).toMatchObject({ attempt: 5 });
    await liftD1TenantFence(db.database, "acme", "move_1", 5);
    expect(await readD1TenantFence(db.database, "acme")).toBeNull();
    db.close();
  });

  it("refuses a stale cutover driver whose claim was overtaken before it fenced, and leaves the live fence alone", async () => {
    const world = setup();
    await world.documents().create({ actor: acme, doctype: "Ticket", data: { subject: "a" } });
    const move = await world.operator.services.mover.start("acme", "east");
    let current = move;
    while (current.phase !== "cutover") {
      current = await world.operator.services.mover.advance(move.moveId);
    }
    const directory = world.operator.services.directory;
    const saveMove = directory.saveMove.bind(directory);
    // Right after this driver's claim, a later attempt of the same move is
    // claimed and fences the source first.
    vi.spyOn(directory, "saveMove").mockImplementationOnce(async (record, next) => {
      const claimed = await saveMove(record, next);
      const later = await saveMove(claimed, { phase: "catching-up", state: claimed.state });
      const relaunched = await saveMove(later, { phase: "cutover", state: later.state });
      const reclaimed = await saveMove(relaunched, { phase: "cutover", state: relaunched.state });
      await fenceD1Tenant(world.home.database, { tenantId: "acme", moveId: move.moveId, attempt: reclaimed.revision, fencedAt: world.time.clock.now() });
      return claimed;
    });

    await expect(world.operator.services.mover.advance(move.moveId)).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });

    const live = await world.operator.services.mover.status(move.moveId);
    expect(await readD1TenantFence(world.home.database, "acme")).toMatchObject({ moveId: move.moveId, attempt: live.revision });
    world.close();
  });

  it("refuses to flip when its own fence is gone by the time the final pass is done", async () => {
    const world = setup();
    await world.documents().create({ actor: acme, doctype: "Ticket", data: { subject: "a" } });
    const move = await world.operator.services.mover.start("acme", "east");
    let current = move;
    while (current.phase !== "cutover") {
      current = await world.operator.services.mover.advance(move.moveId);
    }
    const directory = world.operator.services.directory;
    const getMove = directory.getMove.bind(directory);
    // Right after the cutover fenced and checked the journal, the fence row disappears.
    let lifted = false;
    vi.spyOn(directory, "getMove").mockImplementation(async (moveId) => {
      const read = await getMove(moveId);
      if (!lifted && (await readD1TenantFence(world.home.database, "acme")) !== null) {
        lifted = true;
        await liftD1TenantFence(world.home.database, "acme", move.moveId);
      }
      return read;
    });

    await expect(world.operator.services.mover.advance(move.moveId)).rejects.toMatchObject({ code: "DOCUMENT_CONFLICT" });

    expect(await world.operator.services.directory.get("acme")).toMatchObject({ shardId: "home", moveId: move.moveId });
    expect((await world.operator.services.mover.run(move.moveId)).phase).toBe("completed");
    expect(await readD1TenantFence(world.home.database, "acme")).toMatchObject({ moveId: move.moveId });
    world.close();
  });

  it("lifts the leftover fence of an attempt whose back-off committed but never lifted it, on the next catch-up pass", async () => {
    const world = setup({ fenceWaitMs: 50 });
    const docs = world.documents();
    await docs.create({ actor: acme, doctype: "Ticket", data: { subject: "a" } });
    const move = await world.operator.services.mover.start("acme", "east");
    let current = move;
    while (current.phase !== "cutover") {
      current = await world.operator.services.mover.advance(move.moveId);
    }
    const directory = world.operator.services.directory;
    // A claimed attempt that fenced, journaled its back-off, and died before its lift.
    const claimed = await directory.saveMove(current, { phase: "cutover", state: current.state });
    await fenceD1Tenant(world.home.database, { tenantId: "acme", moveId: move.moveId, attempt: claimed.revision, fencedAt: world.time.clock.now() });
    await directory.saveMove(claimed, { phase: "catching-up", state: claimed.state });
    await expect(docs.create({ actor: acme, doctype: "Ticket", data: { subject: "b" } })).rejects.toMatchObject({ code: "TENANT_MOVING" });

    await world.operator.services.mover.advance(move.moveId);

    expect(await readD1TenantFence(world.home.database, "acme")).toBeNull();
    await docs.create({ actor: acme, doctype: "Ticket", data: { subject: "b" } });
    expect((await world.operator.services.mover.run(move.moveId)).phase).toBe("completed");
    expect(tenantEvents(world.home, "acme")).toEqual(tenantEvents(world.east, "acme"));
    world.close();
  });

  it("ages a frozen copy's fence from when the directory flipped, not from when the cutover began", async () => {
    const world = setup({}, { staleFenceAgeMs: 30_000 });
    await world.documents().create({ actor: acme, doctype: "Ticket", data: { subject: "a" } });
    const away = await world.operator.services.mover.start("acme", "east");
    await world.operator.services.mover.run(away.moveId);
    // A cutover that began long before it flipped the directory.
    world.home.query("UPDATE cf_frappe_tenant_fences SET fenced_at = '2000-01-01T00:00:00.000Z' WHERE tenant_id = 'acme'");

    world.time.tick(20_000);
    await expect(world.operator.services.mover.start("acme", "home")).rejects.toMatchObject({
      message: expect.stringContaining("too recently")
    });
    world.time.tick(20_000);
    await expect(world.operator.services.mover.start("acme", "home")).resolves.toMatchObject({ phase: "copying" });
    world.close();
  });

  it("keeps runtime job schedules on home: a moved tenant can still save and delete them, and a move never carries them", async () => {
    const world = setup({}, { staleFenceAgeMs: 0 });
    const jobs = (rt = world.operator) =>
      new JobScheduleService({
        registry: createJobRegistry({ jobs: [{ name: "reports.daily", handler: () => undefined }] }),
        schedules: [],
        events: rt.events,
        clock: world.time.clock,
        ids: ids("sched")
      });
    const admin: Actor = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
    await world.documents().create({ actor: acme, doctype: "Ticket", data: { subject: "a" } });
    await jobs().save(admin, { id: "before", cron: "0 1 * * *", jobName: "reports.daily" });

    const away = await world.operator.services.mover.start("acme", "east");
    const done = await world.operator.services.mover.run(away.moveId);
    expect(done.phase).toBe("completed");
    // Counted without the definitions stream on either side, and not copied.
    const report = done.state.cutovers.at(-1)!;
    expect(report.sourceEvents).toBe(report.targetEvents);
    expect(report.sourceEvents).toBe(tenantEvents(world.home, "acme").length - 1);
    const globalStream = jobScheduleDefinitionsStream();
    expect(world.east.query("SELECT COUNT(*) AS n FROM cf_frappe_events WHERE stream = ?", globalStream)).toEqual([{ n: 0 }]);

    // acme is fenced on home for good, and its schedules still live there.
    await jobs().save(admin, { id: "after", cron: "0 2 * * *", jobName: "reports.daily" });
    await jobs().delete(admin, "before");
    expect(world.home.query("SELECT type FROM cf_frappe_events WHERE stream = ? ORDER BY sequence", globalStream)).toEqual([
      { type: "JobScheduleSaved" },
      { type: "JobScheduleSaved" },
      { type: "JobScheduleDeleted" }
    ]);
    expect((await jobs().schedulesForCron("0 2 * * *")).map((schedule: { readonly id?: string }) => schedule.id)).toEqual(["after"]);

    // And moving back to home, where those rows are, agrees with itself.
    const back = await world.operator.services.mover.start("acme", "home");
    expect((await world.operator.services.mover.run(back.moveId)).phase).toBe("completed");
    world.close();
  });

  it("reads the copy order straight off the tenant/time index, without a sort", () => {
    const db = createTestD1({ schema: wranglerMigratedSchema() });
    const plan = db
      .query(
        `EXPLAIN QUERY PLAN SELECT id FROM cf_frappe_events
         WHERE tenant_id = ? AND occurred_at >= ?
           AND (occurred_at > ? OR stream > ? OR (stream = ? AND sequence > ?))
           AND substr(stream, 1, 11) <> ?
         ORDER BY occurred_at, stream, sequence LIMIT ?`,
        "acme", "t", "t", "s", "s", 0, "__global__:", 10
      )
      .map((row) => String(row.detail))
      .join(" | ");

    expect(plan).toContain("idx_cf_frappe_events_tenant_time");
    expect(plan).not.toContain("TEMP B-TREE");
    db.close();
  });
});
