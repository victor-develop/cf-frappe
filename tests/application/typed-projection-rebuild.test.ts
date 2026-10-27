import {
  D1DocumentStore,
  D1EventStore,
  D1ProjectionStore,
  D1TypedProjectionStore,
  DocumentService,
  ProjectionRebuildService,
  QueryService,
  RoutedProjectionStore,
  createRegistry,
  defineDocType,
  planD1TypedProjectionLayout,
  planD1TypedProjectionMigrations,
  planD1TypedProjections,
  renderD1Migration,
  type Actor,
  type DocTypeDefinition
} from "../../src";
import { afterField, predicateGroup } from "../predicate-fixtures";
import { createTestD1, frameworkSchema, type TestD1 } from "../d1-engine";
import { sequentialIds, tickingClock } from "../golden/harness";

/**
 * The life cycle issue #15 asks for, end to end on the real engine: a typed
 * table lands as a named projection version (#10) beside the shared one, is
 * filled by a rebuild from the event stream (#11), is compared row by row
 * against the shared table, and only then serves reads — with `application`
 * code (`QueryService`) unable to tell the difference.
 */

const TENANT = "acme";
const actor: Actor = { id: "owner@example.com", roles: ["User"], tenantId: TENANT };

const Task = defineDocType({
  name: "Task",
  fields: [
    { name: "title", type: "text" },
    { name: "status", type: "select", options: ["Open", "Done"] },
    { name: "points", type: "integer" },
    { name: "body", type: "longText" }
  ],
  indexes: [["status"]],
  promotedFields: ["points"],
  permissions: [{ roles: ["User"], actions: ["read", "create", "update", "delete"] }]
});

interface World {
  readonly d1: TestD1;
  readonly documents: DocumentService;
  readonly events: D1EventStore;
  readonly shared: D1ProjectionStore;
  readonly typed: D1TypedProjectionStore;
  readonly router: RoutedProjectionStore;
  readonly rebuild: ProjectionRebuildService;
}

function world(doctype: DocTypeDefinition = Task): World {
  const registry = createRegistry({ doctypes: [doctype] });
  const d1 = createTestD1({
    schema: [...frameworkSchema(), ...planD1TypedProjectionMigrations([doctype]).map(renderD1Migration)]
  });
  const clock = tickingClock("2026-01-01T00:00:00.000Z");
  const ids = sequentialIds();
  // Typed projections off on the write path: the table is filled by the rebuild alone.
  const documents = new DocumentService({ registry, store: new D1DocumentStore(d1.database), clock, ids });
  const events = new D1EventStore(d1.database);
  const shared = new D1ProjectionStore(d1.database);
  const typed = new D1TypedProjectionStore(d1.database, { layouts: [planD1TypedProjectionLayout(doctype)] });
  const router = new RoutedProjectionStore({
    targets: [
      { name: "shared", state: "active", store: shared },
      { name: "typed-v1", state: "building", store: typed }
    ]
  });
  const rebuild = new ProjectionRebuildService({
    events,
    streams: events,
    router,
    targetStore: (name) => router.targetStore(name),
    clock,
    ids
  });
  return { d1, documents, events, shared, typed, router, rebuild };
}

async function seed(documents: DocumentService, count: number): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const created = await documents.create({
      actor,
      doctype: "Task",
      data: {
        title: `Task ${index}`,
        status: index % 3 === 0 ? "Done" : "Open",
        ...(index % 4 === 0 ? {} : { points: index }),
        body: `body ${index}`
      }
    });
    if (index % 2 === 0) {
      await documents.update({
        actor,
        doctype: "Task",
        name: created.name,
        patch: { title: `Task ${index} (edited)` },
        expectedVersion: created.version
      });
    }
  }
}

async function rebuildAll(context: World): Promise<string> {
  const started = await context.rebuild.start({ tenantId: TENANT, doctype: "Task", target: "typed-v1", batchSize: 4 });
  for (let more = true; more;) {
    more = (await context.rebuild.advance(TENANT, started.runId)).more;
  }
  return started.runId;
}

describe("typed projection tables as a named, rebuilt, compared projection version", () => {
  it("rebuilds the typed table from events until it matches the shared table row for row", async () => {
    const context = world();
    await seed(context.documents, 11);
    expect((await context.typed.list({ tenantId: TENANT, doctype: "Task" })).total).toBe(0);

    const runId = await rebuildAll(context);
    expect(await context.rebuild.status(TENANT, runId)).toMatchObject({ status: "completed", rebuilt: 11, failed: 0 });
    expect((await context.router.compare("typed-v1", TENANT, "Task")).differences).toEqual([]);

    // The router's own gate: final catch-up, parity, then promotion.
    const promoted = await context.rebuild.promote(TENANT, runId);
    expect(promoted.differences).toEqual([]);
    expect(context.router.readingFrom()).toBe("typed-v1");
    context.d1.close();
  });

  it("reports a drifted row as a parity difference instead of promoting", async () => {
    const context = world();
    await seed(context.documents, 5);
    const runId = await rebuildAll(context);
    const victim = (await context.shared.list({ tenantId: TENANT, doctype: "Task", orderBy: "name", order: "asc" })).data[0]!;
    const table = context.typed.tableFor("Task")!;
    context.d1.query(`UPDATE ${table} SET version = version + 7 WHERE name = ?`, victim.name);

    expect((await context.router.compare("typed-v1", TENANT, "Task")).differences).toEqual([
      { tenantId: TENANT, doctype: "Task", name: victim.name, reason: "stale" }
    ]);
    // Catch-up re-saves every fold, but the version guard refuses to move a
    // newer-looking row backwards, so the drift survives and blocks promotion.
    const result = await context.rebuild.promote(TENANT, runId);
    expect(result.differences).toHaveLength(1);
    expect(context.router.readingFrom()).toBe("shared");
    context.d1.close();
  });

  it("surfaces a historical value that no longer fits the declared type as a rebuild error", async () => {
    // A history written while `points` was text, rebuilt under a layout that
    // declares it an integer: the CHECK refuses the row, the rebuild records
    // it, and the comparison names it — rather than the typed table quietly
    // holding a coerced value.
    const legacy = world(defineDocType({ ...Task, fields: Task.fields.map((field) => field.name === "points" ? { ...field, type: "text" as const } : field) }));
    await legacy.documents.create({ actor, doctype: "Task", data: { title: "old", status: "Open", points: "three" } });
    await legacy.documents.create({ actor, doctype: "Task", data: { title: "fine", status: "Open" } });

    const typed = new D1TypedProjectionStore(legacy.d1.database, { layouts: [planD1TypedProjectionLayout(Task)] });
    legacy.d1.query(`${planD1TypedProjectionMigrations([Task]).flatMap((migration) => migration.statements)[0]!.sql}`);
    const router = new RoutedProjectionStore({
      targets: [
        { name: "shared", state: "active", store: legacy.shared },
        { name: "typed-v2", state: "building", store: typed }
      ]
    });
    const rebuild = new ProjectionRebuildService({
      events: legacy.events,
      streams: legacy.events,
      router,
      targetStore: (name) => router.targetStore(name),
      clock: tickingClock("2026-02-01T00:00:00.000Z"),
      ids: sequentialIds()
    });
    const started = await rebuild.start({ tenantId: TENANT, doctype: "Task", target: "typed-v2" });
    const { state } = await rebuild.advance(TENANT, started.runId);

    expect(state).toMatchObject({ status: "completed", rebuilt: 1, failed: 1 });
    expect(state.recentErrors[0]?.reason).toMatch(/CHECK constraint failed/);
    const differences = (await router.compare("typed-v2", TENANT, "Task")).differences;
    expect(differences).toEqual([expect.objectContaining({ reason: "missing" })]);
    legacy.d1.close();
  });

  it("answers QueryService from the typed table exactly as from the shared one", async () => {
    const context = world();
    await seed(context.documents, 13);
    await rebuildAll(context);
    const registry = createRegistry({ doctypes: [Task] });
    const plan = planD1TypedProjections([Task], { mode: "active" });
    const viaShared = new QueryService({ registry, projections: context.shared });
    const viaTyped = new QueryService({
      registry,
      projections: new D1TypedProjectionStore(context.d1.database, { layouts: plan.active, fallback: context.shared })
    });

    const queries = [
      {},
      { filters: [{ field: "status", value: "Open" }] },
      { filters: [{ field: "points", operator: "gt" as const, value: 4 }], orderBy: "points", order: "asc" as const },
      { filters: [{ field: "body", operator: "like" as const, value: "%1%" }], orderBy: "title" },
      { filters: [{ field: "points", operator: "is" as const, value: "not set" }] },
      { limit: 3, offset: 2, orderBy: "status", order: "desc" as const }
    ];
    for (const query of queries) {
      const expected = await viaShared.listDocuments(actor, "Task", query);
      const actual = await viaTyped.listDocuments(actor, "Task", query);
      expect(actual, JSON.stringify(query)).toEqual(expected);
      expect(expected.total).toBeGreaterThan(0);
    }
    const predicate = predicateGroup("any", afterField("status", "Done"), afterField("points", 2));
    expect(await context.typed.list({ tenantId: TENANT, doctype: "Task", predicate }))
      .toEqual(await context.shared.list({ tenantId: TENANT, doctype: "Task", predicate }));
    context.d1.close();
  });

  it("keeps an active typed table current on the write path, with no rebuild", async () => {
    const registry = createRegistry({ doctypes: [Task] });
    const d1 = createTestD1({
      schema: [...frameworkSchema(), ...planD1TypedProjectionMigrations([Task]).map(renderD1Migration)]
    });
    const plan = planD1TypedProjections([Task], { doctypes: { Task: "active" } });
    const documents = new DocumentService({
      registry,
      store: new D1DocumentStore(d1.database, { typedProjections: plan }),
      clock: tickingClock("2026-01-01T00:00:00.000Z"),
      ids: sequentialIds()
    });
    await seed(documents, 6);
    const doomed = (await new D1ProjectionStore(d1.database).list({ tenantId: TENANT, doctype: "Task" })).data[0]!;
    await documents.delete({ actor, doctype: "Task", name: doomed.name, expectedVersion: doomed.version });

    const shared = new D1ProjectionStore(d1.database);
    const typed = new D1TypedProjectionStore(d1.database, { layouts: plan.active });
    const router = new RoutedProjectionStore({
      targets: [
        { name: "shared", state: "active", store: shared },
        { name: "typed", state: "caught-up", store: typed }
      ]
    });
    expect((await router.compare("typed", TENANT, "Task")).differences).toEqual([]);
    expect((await typed.get(TENANT, "Task", doomed.name))?.docstatus).toBe("deleted");
    d1.close();
  });
});
