import { Hono } from "hono";
import {
  CONSISTENCY_HEADER,
  readYourWritesMiddleware,
  ConsistentProjectionStore,
  createRegistry,
  createResourceApi,
  defineDocType,
  DocumentDeliveryOutboxService,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  InMemoryProjectionStore,
  PROJECTION_OUTBOX_CHANNEL,
  ProjectionCatchUp,
  ProjectionDeliveryConsumer,
  ProjectionOutboxHandoff,
  QueryService,
  READ_AFTER_HEADER,
  signReadAfterToken,
  unsafeHeaderActorResolver,
  type IdGenerator
} from "../../src";

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
    outbox: new DocumentDeliveryOutboxService({ events: store, channel: PROJECTION_OUTBOX_CHANNEL, clock: fixedClock(NOW), ids }),
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
    expect(sleeps).toEqual([50, 50, 20]);
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

  it("rejects a polling interval it could spin on", () => {
    expect(() => new ProjectionCatchUp({ projections: new InMemoryProjectionStore(), pollMs: 0 })).toThrow(/pollMs/);
    expect(() => new ProjectionCatchUp({ projections: new InMemoryProjectionStore(), timeoutMs: -1 })).toThrow(/timeoutMs/);
  });
});
