import { Hono } from "hono";
import {
  CONSISTENCY_HEADER,
  readYourWritesMiddleware,
  ConsistentProjectionStore,
  createRegistry,
  createResourceApi,
  defineDocType,
  D1ProjectionStore,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  InMemoryProjectionStore,
  ProjectionCatchUp,
  ProjectionDeliveryConsumer,
  ProjectionOutboxHandoff,
  QueryService,
  READ_AFTER_HEADER,
  signReadAfterToken,
  unsafeHeaderActorResolver,
  type IdGenerator
} from "../../src";
import { createTestD1, frameworkSchema } from "../d1-engine.js";

const NOW = "2026-03-01T00:00:00.000Z";
const SECRET = "test-only-read-after-secret";

const Note = defineDocType({
  name: "Note",
  fields: [{ name: "title", type: "text" }],
  permissions: [{ roles: ["User"], actions: ["read", "create", "update", "delete"] }]
});

let nextId = 0;
const ids: IdGenerator = { next: (prefix = "") => `${prefix}${String((nextId += 1))}` };

const owner = { "x-cf-frappe-user": "owner@example.com", "x-cf-frappe-roles": "User", "x-cf-frappe-tenant": "acme" };

function makeApp(options: {
  readonly split?: boolean;
  readonly timeoutMs?: number;
  /** What happens while a read waits — the consumer catching up, or nothing. */
  readonly whileWaiting?: (drain: () => Promise<unknown>) => Promise<void>;
  readonly now?: () => number;
} = {}) {
  const registry = createRegistry({ doctypes: [Note] });
  const projectionDatabase = new InMemoryProjectionStore();
  const store = new InMemoryDocumentStore(
    options.split === false ? {} : { projectionHandoff: new ProjectionOutboxHandoff() }
  );
  const documents = new DocumentService({ registry, store, clock: fixedClock(NOW), ids });
  const consumer = new ProjectionDeliveryConsumer({
    events: store,
    ids,
    projections: projectionDatabase,
    clock: fixedClock(NOW)
  });
  const drain = () => consumer.drain({ tenantId: "acme" });
  let clock = 0;
  const sleeps: number[] = [];
  const catchUp = new ProjectionCatchUp({
    projections: projectionDatabase,
    timeoutMs: options.timeoutMs ?? 200,
    pollMs: 50,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
      await options.whileWaiting?.(drain);
    }
  });
  const queries = new QueryService({
    registry,
    projections: options.split === false
      ? store
      : new ConsistentProjectionStore({ projections: projectionDatabase, events: store })
  });
  const app = createResourceApi({
    registry,
    documents,
    queries,
    actor: unsafeHeaderActorResolver,
    ...(options.split === false
      ? {}
      : { readYourWrites: { secret: SECRET, catchUp, ...(options.now ? { now: options.now } : {}) } })
  });
  return { app, drain, sleeps };
}

async function create(app: ReturnType<typeof makeApp>["app"], title: string, headers: Record<string, string> = owner) {
  return app.request("/api/resource/Note", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ name: title, title })
  });
}

describe("read-your-writes over HTTP", () => {
  it("hands a write a token, and holds a list carrying it until the projection shows the write", async () => {
    const { app, sleeps } = makeApp({ whileWaiting: async (drain) => void (await drain()) });
    const written = await create(app, "One");
    const token = written.headers.get(READ_AFTER_HEADER);
    expect(written.status).toBe(201);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    const listed = await app.request("/api/resource/Note", { headers: { ...owner, [READ_AFTER_HEADER]: token! } });

    expect(listed.headers.get(CONSISTENCY_HEADER)).toBe("fresh");
    expect(sleeps).toEqual([50]);
    await expect(listed.json()).resolves.toMatchObject({ total: 1, data: [{ name: "One" }] });
  });

  it("gives up after the timeout and says the list is stale", async () => {
    const { app, sleeps } = makeApp({ timeoutMs: 120 });
    const token = (await create(app, "One")).headers.get(READ_AFTER_HEADER)!;

    const listed = await app.request("/api/resource/Note", { headers: { ...owner, [READ_AFTER_HEADER]: token } });

    expect(listed.headers.get(CONSISTENCY_HEADER)).toBe("stale");
    // Backing off: 50, then 100 cut short by the timeout.
    expect(sleeps).toEqual([50, 70]);
    await expect(listed.json()).resolves.toMatchObject({ total: 0 });
  });

  it("does not wait at all once the projection already shows the write", async () => {
    const { app, drain, sleeps } = makeApp();
    const token = (await create(app, "One")).headers.get(READ_AFTER_HEADER)!;
    await drain();

    const listed = await app.request("/api/resource/Note", { headers: { ...owner, [READ_AFTER_HEADER]: token } });

    expect(listed.headers.get(CONSISTENCY_HEADER)).toBe("fresh");
    expect(sleeps).toEqual([]);
  });

  it("reads one document strongly even without a token", async () => {
    const { app } = makeApp();
    await create(app, "One");
    await app.request("/api/resource/Note/One", {
      method: "PUT",
      headers: { ...owner, "content-type": "application/json" },
      body: JSON.stringify({ title: "Changed" })
    });

    const read = await app.request("/api/resource/Note/One", { headers: owner });

    expect(read.headers.get(CONSISTENCY_HEADER)).toBeNull();
    await expect(read.json()).resolves.toMatchObject({ data: { name: "One", version: 2, data: { title: "Changed" } } });
  });

  it("ignores a token minted for another actor or tenant, without waiting", async () => {
    const { app, sleeps } = makeApp();
    const token = (await create(app, "One")).headers.get(READ_AFTER_HEADER)!;

    const asSomeoneElse = await app.request("/api/resource/Note", {
      headers: { ...owner, "x-cf-frappe-user": "other@example.com", [READ_AFTER_HEADER]: token }
    });
    const inAnotherTenant = await app.request("/api/resource/Note", {
      headers: { ...owner, "x-cf-frappe-tenant": "globex", [READ_AFTER_HEADER]: token }
    });

    expect(asSomeoneElse.headers.get(CONSISTENCY_HEADER)).toBe("eventual");
    expect(inAnotherTenant.headers.get(CONSISTENCY_HEADER)).toBe("eventual");
    expect(sleeps).toEqual([]);
  });

  it("ignores an expired token", async () => {
    let seconds = 1_000;
    const { app, sleeps } = makeApp({ now: () => seconds });
    const token = (await create(app, "One")).headers.get(READ_AFTER_HEADER)!;
    seconds += 301;

    const listed = await app.request("/api/resource/Note", { headers: { ...owner, [READ_AFTER_HEADER]: token } });

    expect(listed.headers.get(CONSISTENCY_HEADER)).toBe("eventual");
    expect(sleeps).toEqual([]);
  });

  it("refuses a forged or malformed token", async () => {
    const { app } = makeApp();
    const forged = await signReadAfterToken(
      { v: 1, t: "acme", a: "owner@example.com", e: 9_999_999_999, d: [["Note", "Secret", 1]] },
      "not-the-secret"
    );
    for (const token of [forged, "not-a-token", "a.b.c", `${forged.split(".")[0]}.!!!`]) {
      const response = await app.request("/api/resource/Note", { headers: { ...owner, [READ_AFTER_HEADER]: token } });
      expect(response.status).toBe(400);
    }
    const unsupported = await signReadAfterToken(
      { v: 1, t: "acme", a: "owner@example.com", e: 9_999_999_999, d: [["Note", "One", 0]] },
      SECRET
    );
    expect((await app.request("/api/resource/Note", { headers: { ...owner, [READ_AFTER_HEADER]: unsupported } })).status)
      .toBe(400);
  });

  it("mints no token for a failed write", async () => {
    const { app } = makeApp();
    await create(app, "One");
    const duplicate = await create(app, "One");
    expect(duplicate.status).toBeGreaterThanOrEqual(400);
    expect(duplicate.headers.get(READ_AFTER_HEADER)).toBeNull();
  });

  it("names every document a bulk write touched", async () => {
    const { app, drain } = makeApp({ whileWaiting: async (run) => void (await run()) });
    await create(app, "One");
    await create(app, "Two");
    await drain();

    const deleted = await app.request("/api/resource/Note/delete", {
      method: "POST",
      headers: { ...owner, "content-type": "application/json" },
      body: JSON.stringify({ documents: [{ name: "One" }, { name: "Two" }] })
    });
    const token = deleted.headers.get(READ_AFTER_HEADER)!;
    const payload = JSON.parse(atob(token.split(".")[0]!.replaceAll("-", "+").replaceAll("_", "/"))) as {
      readonly d: readonly unknown[];
    };

    expect(payload.d).toEqual([["Note", "One", 2], ["Note", "Two", 2]]);
  });

  it("adds no headers at all in the single-database layout", async () => {
    const { app } = makeApp({ split: false });
    const written = await create(app, "One");
    expect(written.headers.get(READ_AFTER_HEADER)).toBeNull();

    const listed = await app.request("/api/resource/Note", { headers: { ...owner, [READ_AFTER_HEADER]: "anything" } });
    expect(listed.status).toBe(200);
    expect(listed.headers.get(CONSISTENCY_HEADER)).toBeNull();
    await expect(listed.json()).resolves.toMatchObject({ total: 1 });
  });

  it("names only the caller's own tenant's documents, and none past the wait limit", async () => {
    const snapshot = (tenantId: string, name: string, version: number) => ({
      tenantId,
      doctype: "Note",
      name,
      version,
      docstatus: "draft",
      data: {},
      createdAt: NOW,
      updatedAt: NOW
    });
    const app = new Hono();
    app.use("/api/*", readYourWritesMiddleware(
      { secret: SECRET, catchUp: { waitFor: async () => ({ status: "fresh", pending: [], waitedMs: 0 }) } },
      unsafeHeaderActorResolver
    ));
    app.post("/api/resource/mixed", (c) => c.json({
      data: [snapshot("acme", "Mine", 3), snapshot("globex", "Theirs", 7), { nested: { document: snapshot("acme", "Mine", 4) } }]
    }));
    app.post("/api/resource/many", (c) => c.json({
      data: Array.from({ length: 51 }, (_, index) => snapshot("acme", `N${index}`, 1))
    }));
    app.post("/api/other/write", (c) => c.json({ data: snapshot("acme", "Mine", 1) }));

    const mixed = await app.request("/api/resource/mixed", { method: "POST", headers: owner });
    const token = mixed.headers.get(READ_AFTER_HEADER)!;
    const payload = JSON.parse(atob(token.split(".")[0]!.replaceAll("-", "+").replaceAll("_", "/"))) as {
      readonly t: string;
      readonly d: readonly unknown[];
    };
    expect(payload).toMatchObject({ t: "acme", d: [["Note", "Mine", 4]] });
    expect((await app.request("/api/resource/many", { method: "POST", headers: owner })).headers.get(READ_AFTER_HEADER))
      .toBeNull();
    expect((await app.request("/api/other/write", { method: "POST", headers: owner })).headers.get(READ_AFTER_HEADER))
      .toBeNull();
  });

  it("refuses to start without a secret", () => {
    expect(() => createResourceApi({
      registry: createRegistry({ doctypes: [Note] }),
      documents: {} as never,
      queries: {} as never,
      actor: unsafeHeaderActorResolver,
      readYourWrites: { secret: " ", catchUp: { waitFor: async () => ({ status: "fresh", pending: [], waitedMs: 0 }) } }
    })).toThrow(/secret is required/);
  });
});

describe("ProjectionCatchUp", () => {
  it("bounds the number of documents a read may wait for", async () => {
    const catchUp = new ProjectionCatchUp({ projections: new InMemoryProjectionStore() });
    const requirements = Array.from({ length: 51 }, (_, index) => ({
      tenantId: "acme",
      doctype: "Note",
      name: `N${index}`,
      version: 1
    }));
    await expect(catchUp.waitFor(requirements)).rejects.toThrow(/at most 50/);
  });

  it("rejects a polling interval it could spin on, and a budget it could not keep", () => {
    const projections = new InMemoryProjectionStore();
    expect(() => new ProjectionCatchUp({ projections, pollMs: 0 })).toThrow(/pollMs/);
    expect(() => new ProjectionCatchUp({ projections, timeoutMs: -1 })).toThrow(/timeoutMs/);
    expect(() => new ProjectionCatchUp({ projections, pollMs: 100, maxPollMs: 50 })).toThrow(/maxPollMs/);
    expect(() => new ProjectionCatchUp({ projections, maxChecks: 0 })).toThrow(/maxChecks/);
  });

  it("waits for one tenant's documents only", async () => {
    const catchUp = new ProjectionCatchUp({ projections: new InMemoryProjectionStore() });
    await expect(catchUp.waitFor([
      { tenantId: "acme", doctype: "Note", name: "A", version: 1 },
      { tenantId: "other", doctype: "Note", name: "B", version: 1 }
    ])).rejects.toThrow(/one tenant/);
    await expect(catchUp.waitFor([])).resolves.toEqual({ status: "fresh", pending: [], waitedMs: 0 });
  });

  describe("against the real D1 engine", () => {
    function snapshot(name: string, version: number, tenantId = "acme") {
      return {
        tenantId,
        doctype: "Note",
        name,
        version,
        docstatus: "draft" as const,
        data: { title: name },
        createdAt: NOW,
        updatedAt: NOW
      };
    }

    function timed(options: { readonly timeoutMs?: number; readonly maxChecks?: number } = {}) {
      const d1 = createTestD1({ schema: frameworkSchema() });
      let clock = 0;
      const sleeps: number[] = [];
      const catchUp = new ProjectionCatchUp({
        projections: new D1ProjectionStore(d1.database),
        ...options,
        now: () => clock,
        sleep: async (ms) => {
          sleeps.push(ms);
          clock += ms;
        }
      });
      return { d1, catchUp, sleeps, projections: new D1ProjectionStore(d1.database) };
    }

    it("checks every document with one query, and spends a bounded number of them on a wait that times out", async () => {
      const { d1, catchUp, sleeps } = timed();
      const requirements = Array.from({ length: 50 }, (_, index) => ({
        tenantId: "acme",
        doctype: "Note",
        name: `N${index}`,
        version: 1
      }));
      const before = d1.statements.length;

      const result = await catchUp.waitFor(requirements);

      expect(result).toMatchObject({ status: "stale", waitedMs: 2000 });
      expect(result.pending).toHaveLength(50);
      // Eight queries for fifty documents over the default two seconds — the
      // per-document, fixed-interval poll this replaces ran 2 050.
      expect(d1.statements.length - before).toBe(8);
      expect(sleeps).toEqual([50, 100, 200, 400, 500, 500, 250]);
      d1.close();
    });

    it("stops at maxChecks queries even when the timeout is far off", async () => {
      const { d1, catchUp } = timed({ timeoutMs: 60_000, maxChecks: 3 });
      const before = d1.statements.length;

      await expect(catchUp.waitFor([{ tenantId: "acme", doctype: "Note", name: "A", version: 1 }]))
        .resolves.toMatchObject({ status: "stale" });
      expect(d1.statements.length - before).toBe(3);
      d1.close();
    });

    it("reads versions per document, for this tenant only", async () => {
      const { d1, projections } = timed();
      await projections.saveNewest([snapshot("Behind", 1), snapshot("Ahead", 4), snapshot("Missing", 9, "other")]);

      await expect(projections.versions("acme", [
        { doctype: "Note", name: "Ahead" },
        { doctype: "Note", name: "Missing" },
        { doctype: "Note", name: "Behind" },
        { doctype: "Other", name: "Ahead" }
      ])).resolves.toEqual([4, null, 1, null]);
      await expect(projections.versions("acme", [])).resolves.toEqual([]);
      d1.close();
    });

    it("reports fresh once every document reaches its version, and names the ones that did not", async () => {
      const { d1, catchUp, projections } = timed({ timeoutMs: 0 });
      await projections.saveNewest([snapshot("Behind", 1), snapshot("Ahead", 4)]);

      await expect(catchUp.waitFor([
        { tenantId: "acme", doctype: "Note", name: "Ahead", version: 3 },
        { tenantId: "acme", doctype: "Note", name: "Behind", version: 2 }
      ])).resolves.toMatchObject({ status: "stale", pending: [{ name: "Behind", version: 2 }] });
      await expect(catchUp.waitFor([{ tenantId: "acme", doctype: "Note", name: "Ahead", version: 4 }]))
        .resolves.toMatchObject({ status: "fresh" });
      d1.close();
    });
  });
});
