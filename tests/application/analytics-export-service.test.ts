import {
  AnalyticsExportService,
  AnalyticsQueryService,
  D1AnalyticsStore,
  D1AnalyticsExportCursorStore,
  InMemoryAnalyticsExportCursorStore,
  InMemoryAnalyticsStore,
  InMemoryProjectionStore,
  SYSTEM_MANAGER_ROLE,
  analyticalDocTypeNames,
  createAnalyticsExportJob,
  createRegistry,
  defineDashboard,
  defineDocType,
  defineReport,
  type Actor,
  type AnalyticsDocumentReader,
  type AnalyticsDocumentRow,
  type AnalyticsExportCursorStore,
  type AnalyticsSink,
  type DocumentSnapshot,
  type QueryService
} from "../../src";
import { analyticsSchema, createTestD1, frameworkSchema } from "../d1-engine.js";

const Ticket = defineDocType({
  name: "Ticket",
  fields: [{ name: "status", type: "text" }, { name: "points", type: "integer" }],
  permissions: [{ roles: ["User"], actions: ["read"] }]
});
const Invoice = defineDocType({
  name: "Invoice",
  fields: [{ name: "amount", type: "number" }],
  permissions: [{ roles: ["User"], actions: ["read"] }]
});
const Note = defineDocType({
  name: "Note",
  fields: [{ name: "title", type: "text" }],
  permissions: [{ roles: ["User"], actions: ["read"] }]
});

const admin: Actor = { id: "admin", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };
const user: Actor = { id: "user", roles: ["User"], tenantId: "acme" };

function registry() {
  return createRegistry({
    doctypes: [Ticket, Invoice, Note],
    reports: [
      defineReport({ name: "Ticket Load", doctype: "Ticket", queryPath: "analytical", columns: [{ name: "status" }] }),
      defineReport({ name: "Note List", doctype: "Note", columns: [{ name: "title" }] })
    ],
    dashboards: [
      defineDashboard({
        name: "Money",
        queryPath: "analytical",
        cards: [{ name: "total", source: { kind: "documentAggregate", doctype: "Invoice", aggregate: "sum", field: "amount" } }]
      })
    ]
  });
}

function snapshot(name: string, updatedAt: string, overrides: Partial<DocumentSnapshot> = {}): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Ticket",
    name,
    version: 1,
    docstatus: "draft",
    data: { status: "Open" },
    createdAt: updatedAt,
    updatedAt,
    ...overrides
  };
}

function settableClock(start: string) {
  let current = start;
  return { now: () => current, set: (value: string) => { current = value; } };
}

function harness(options: { readonly batchSize?: number; readonly maxRowsPerRun?: number; readonly sink?: AnalyticsSink } = {}) {
  const projections = new InMemoryProjectionStore();
  const store = new InMemoryAnalyticsStore();
  const cursors = new InMemoryAnalyticsExportCursorStore();
  const clock = settableClock("2026-03-01T00:10:00.000Z");
  const exporter = new AnalyticsExportService({
    registry: registry(),
    feed: projections,
    sink: options.sink ?? store,
    cursors,
    clock,
    settleSeconds: 60,
    ...(options.batchSize === undefined ? {} : { batchSize: options.batchSize }),
    ...(options.maxRowsPerRun === undefined ? {} : { maxRowsPerRun: options.maxRowsPerRun })
  });
  return { projections, store, cursors, clock, exporter };
}

function analyticsAdapters(adapter: "in-memory" | "D1"): {
  readonly stores: { readonly sink: AnalyticsSink; readonly reader: AnalyticsDocumentReader; readonly cursors: AnalyticsExportCursorStore };
  readonly close: () => void;
} {
  if (adapter === "in-memory") {
    const store = new InMemoryAnalyticsStore();
    return { stores: { sink: store, reader: store, cursors: new InMemoryAnalyticsExportCursorStore() }, close: () => undefined };
  }
  const analyticsDb = createTestD1({ schema: analyticsSchema() });
  const frameworkDb = createTestD1({ schema: frameworkSchema() });
  const store = new D1AnalyticsStore(analyticsDb.database);
  return {
    stores: { sink: store, reader: store, cursors: new D1AnalyticsExportCursorStore(frameworkDb.database) },
    close: () => {
      analyticsDb.close();
      frameworkDb.close();
    }
  };
}

describe("analyticalDocTypeNames", () => {
  it("collects the DocTypes analytical reports and dashboards read, and nothing else", () => {
    // Note is only on an operational report, so nothing will ever ask the copy
    // for it and exporting it would be pure cost.
    expect(analyticalDocTypeNames(registry())).toEqual(["Invoice", "Ticket"]);
  });
});

describe("InMemoryAnalyticsStore ranking", () => {
  it("ranks like the D1 and R2 SQL readers: version, then export generation, then later export", async () => {
    const store = new InMemoryAnalyticsStore();
    const base: AnalyticsDocumentRow = {
      tenantId: "acme",
      doctype: "Ticket",
      name: "T-1",
      version: 4,
      docstatus: "draft",
      dataJson: '{"points":10}',
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z",
      exportGeneration: 0,
      exportedAt: "2026-03-02T00:00:00.000Z"
    };
    await store.append([base]);
    await store.append([{ ...base, exportGeneration: 1, dataJson: '{"points":12}', exportedAt: "2026-03-03T00:00:00.000Z" }]);
    // A run that was in flight when the reset landed re-sends generation 0 later still.
    await store.append([{ ...base, exportedAt: "2026-03-04T00:00:00.000Z" }]);
    // Same key twice: the later append's values win, as D1's upsert does.
    await store.append([{ ...base, name: "T-2", version: 1, dataJson: '{"points":1}' }]);
    await store.append([{ ...base, name: "T-2", version: 1, dataJson: '{"points":2}', exportedAt: "2026-03-03T00:00:00.000Z" }]);

    const page = await store.scan({ tenantId: "acme", doctype: "Ticket", limit: 10 });

    expect(page.documents.map((item) => `${item.name}:${String(item.data.points)}`)).toEqual(["T-1:12", "T-2:2"]);
  });
});

describe("AnalyticsExportService", () => {
  it("copies projection rows older than the settle window, and nothing younger", async () => {
    const { projections, store, exporter } = harness();
    await projections.save(snapshot("T-1", "2026-03-01T00:00:00.000Z"));
    await projections.save(snapshot("T-2", "2026-03-01T00:09:00.000Z"));
    // 30 seconds old at a 60-second settle window: possibly still in flight.
    await projections.save(snapshot("T-3", "2026-03-01T00:09:30.000Z"));

    const result = await exporter.exportTenant({ tenantId: "acme" });

    expect(result.horizon).toBe("2026-03-01T00:09:00.000Z");
    expect(store.allRows().map((row) => row.name).sort()).toEqual(["T-1", "T-2"]);
    expect(result.doctypes).toEqual([
      expect.objectContaining({ doctype: "Invoice", status: "exported", exported: 0, drained: true }),
      expect.objectContaining({
        doctype: "Ticket",
        status: "exported",
        exported: 2,
        drained: true,
        completeThrough: "2026-03-01T00:09:00.000Z",
        lagSeconds: 60
      })
    ]);
  });

  it("resumes after its cursor and re-exports a document only when it changes", async () => {
    const { projections, store, exporter, clock } = harness();
    await projections.save(snapshot("T-1", "2026-03-01T00:00:00.000Z"));
    await projections.save(snapshot("T-2", "2026-03-01T00:01:00.000Z"));
    await exporter.exportTenant({ tenantId: "acme" });
    store.appends.length = 0;

    clock.set("2026-03-01T00:20:00.000Z");
    await projections.save(snapshot("T-1", "2026-03-01T00:15:00.000Z", { version: 2, data: { status: "Closed" } }));
    const second = await exporter.exportTenant({ tenantId: "acme", doctypes: ["Ticket"] });

    expect(second.exported).toBe(1);
    expect(store.appends.flat().map((row) => `${row.name}@${row.version}`)).toEqual(["T-1@2"]);
    // Both versions are kept: the copy is append-only.
    expect(store.allRows().filter((row) => row.name === "T-1").map((row) => row.version).sort()).toEqual([1, 2]);
  });

  it("orders ties on updatedAt by name, so a batch boundary inside a tie loses nothing", async () => {
    const { projections, store, exporter } = harness({ batchSize: 2 });
    for (const name of ["T-e", "T-a", "T-d", "T-c", "T-b"]) {
      await projections.save(snapshot(name, "2026-03-01T00:00:00.000Z"));
    }

    const result = await exporter.exportTenant({ tenantId: "acme", doctypes: ["Ticket"] });

    expect(result.exported).toBe(5);
    expect(store.appends.map((batch) => batch.map((row) => row.name))).toEqual([["T-a", "T-b"], ["T-c", "T-d"], ["T-e"]]);
  });

  it("stops at maxRowsPerRun without claiming completeness, and finishes on the next run", async () => {
    const { projections, store, exporter, cursors } = harness({ batchSize: 2, maxRowsPerRun: 3 });
    for (let index = 0; index < 5; index += 1) {
      await projections.save(snapshot(`T-${index}`, `2026-03-01T00:00:0${index}.000Z`));
    }

    const first = await exporter.exportTenant({ tenantId: "acme", doctypes: ["Ticket"] });
    expect(first.doctypes[0]).toMatchObject({ exported: 3, drained: false, completeThrough: null, lagSeconds: null });
    expect(await cursors.get("acme", "Ticket")).toMatchObject({
      position: { updatedAt: "2026-03-01T00:00:02.000Z", name: "T-2" },
      completeThrough: null,
      exportedRows: 3
    });

    const second = await exporter.exportTenant({ tenantId: "acme", doctypes: ["Ticket"] });
    expect(second.doctypes[0]).toMatchObject({ exported: 2, drained: true, completeThrough: "2026-03-01T00:09:00.000Z" });
    expect(store.allRows()).toHaveLength(5);
  });

  it("exports a delete as a row, so the copy can tell deleted from never-exported", async () => {
    const { projections, store, exporter } = harness();
    await projections.save(snapshot("T-1", "2026-03-01T00:00:00.000Z", { version: 3, docstatus: "deleted" }));

    await exporter.exportTenant({ tenantId: "acme", doctypes: ["Ticket"] });

    expect(store.allRows()).toEqual([expect.objectContaining({ name: "T-1", version: 3, docstatus: "deleted" })]);
    await expect(store.scan({ tenantId: "acme", doctype: "Ticket", limit: 10 })).resolves.toEqual({ documents: [] });
  });

  it("keeps the other tenant's rows out", async () => {
    const { projections, store, exporter } = harness();
    await projections.save(snapshot("T-1", "2026-03-01T00:00:00.000Z"));
    await projections.save(snapshot("T-9", "2026-03-01T00:00:00.000Z", { tenantId: "globex" }));

    await exporter.exportTenant({ tenantId: "acme" });

    expect(store.allRows().map((row) => row.tenantId)).toEqual(["acme"]);
  });

  it("records a failing sink on the cursor, keeps its position, and still exports the other DocTypes", async () => {
    const store = new InMemoryAnalyticsStore();
    let failTickets = true;
    const sink: AnalyticsSink = {
      async append(rows: readonly AnalyticsDocumentRow[]) {
        if (failTickets && rows.some((row) => row.doctype === "Ticket")) {
          throw new Error("pipeline unavailable");
        }
        await store.append(rows);
      }
    };
    const { projections, exporter, cursors } = harness({ sink });
    await projections.save(snapshot("T-1", "2026-03-01T00:00:00.000Z"));
    await projections.save(snapshot("I-1", "2026-03-01T00:00:00.000Z", { doctype: "Invoice", data: { amount: 5 } }));

    const failed = await exporter.exportTenant({ tenantId: "acme" });
    expect(failed.failed).toBe(1);
    expect(failed.doctypes.find((item) => item.doctype === "Ticket")).toMatchObject({
      status: "failed",
      exported: 0,
      error: "pipeline unavailable"
    });
    expect(store.allRows().map((row) => row.name)).toEqual(["I-1"]);
    expect(await cursors.get("acme", "Ticket")).toMatchObject({ position: null, completeThrough: null, lastError: "pipeline unavailable" });

    failTickets = false;
    const recovered = await exporter.exportTenant({ tenantId: "acme" });
    expect(recovered.failed).toBe(0);
    expect(await cursors.get("acme", "Ticket")).toMatchObject({ lastError: null, completeThrough: "2026-03-01T00:09:00.000Z" });
  });

  it("never moves completeThrough backwards when the clock does", async () => {
    const { projections, exporter, clock, cursors } = harness();
    await projections.save(snapshot("T-1", "2026-03-01T00:00:00.000Z"));
    await exporter.exportTenant({ tenantId: "acme", doctypes: ["Ticket"] });

    clock.set("2026-03-01T00:05:00.000Z");
    await exporter.exportTenant({ tenantId: "acme", doctypes: ["Ticket"] });

    expect((await cursors.get("acme", "Ticket"))?.completeThrough).toBe("2026-03-01T00:09:00.000Z");
  });

  it("re-exports a DocType from the start after a reset, which the version key absorbs", async () => {
    const { projections, store, exporter } = harness();
    await projections.save(snapshot("T-1", "2026-03-01T00:00:00.000Z"));
    await exporter.exportTenant({ tenantId: "acme", doctypes: ["Ticket"] });

    await exporter.reset(admin, "Ticket");
    const again = await exporter.exportTenant({ tenantId: "acme", doctypes: ["Ticket"] });

    expect(again.exported).toBe(1);
    // One row per generation; the reader takes the newer one.
    expect(store.allRows().map((row) => row.exportGeneration)).toEqual([0, 1]);
    await expect(store.scan({ tenantId: "acme", doctype: "Ticket", limit: 10 })).resolves.toMatchObject({ documents: [{ name: "T-1" }] });
  });

  for (const adapter of ["in-memory", "D1"] as const) {
    it(`shows data a rebuild rewrote at the same version once the reset re-export drains (${adapter})`, async () => {
      // The operator's runbook: a projection bug is fixed, the DocType is
      // rebuilt (#11) — same events, so same version and updatedAt, new data —
      // and the export is reset. The analytical read must show the new data.
      const { stores, close } = analyticsAdapters(adapter);
      const projections = new InMemoryProjectionStore();
      const clock = settableClock("2026-03-01T00:10:00.000Z");
      const exporter = new AnalyticsExportService({ registry: registry(), feed: projections, sink: stores.sink, cursors: stores.cursors, clock });
      const document = snapshot("T-1", "2026-03-01T00:00:00.000Z", { version: 4, data: { status: "Open", points: 10 } });
      await projections.save(document);
      await projections.save(snapshot("T-2", "2026-03-01T00:00:01.000Z", { data: { status: "Open", points: 1 } }));
      await exporter.exportTenant({ tenantId: "acme", doctypes: ["Ticket"] });

      await projections.save({ ...document, data: { status: "Open", points: 12 } });
      await exporter.reset(admin, "Ticket");
      // While the re-export has not run, the copy still answers — from before the rebuild.
      expect(await exporter.status(admin)).toContainEqual(
        expect.objectContaining({ doctype: "Ticket", completeThrough: "2026-03-01T00:09:00.000Z", reexporting: true })
      );
      clock.set("2026-03-01T00:11:00.000Z");
      await exporter.exportTenant({ tenantId: "acme", doctypes: ["Ticket"] });

      const page = await stores.reader.scan({ tenantId: "acme", doctype: "Ticket", limit: 10 });
      expect(page.documents.map((item) => `${item.name}@${item.version}:${String(item.data.points)}`)).toEqual(["T-1@4:12", "T-2@1:1"]);
      expect(await exporter.status(admin)).toContainEqual(
        expect.objectContaining({ doctype: "Ticket", completeThrough: "2026-03-01T00:10:00.000Z", reexporting: false })
      );
      close();
    });

    it(`keeps a reset when a run that read the cursor before it saves afterwards (${adapter})`, async () => {
      const { stores, close } = analyticsAdapters(adapter);
      const projections = new InMemoryProjectionStore();
      for (let index = 0; index < 4; index += 1) {
        await projections.save(snapshot(`T-${index}`, `2026-03-01T00:00:0${index}.000Z`));
      }
      let exporter!: AnalyticsExportService;
      let resetDone = false;
      const sink: AnalyticsSink = {
        async append(rows) {
          await stores.sink.append(rows);
          if (!resetDone) {
            // The reset lands between this run's first append and its save.
            resetDone = true;
            await exporter.reset(admin, "Ticket");
          }
        }
      };
      exporter = new AnalyticsExportService({
        registry: registry(),
        feed: projections,
        sink,
        cursors: stores.cursors,
        clock: settableClock("2026-03-01T00:10:00.000Z"),
        batchSize: 2
      });

      const raced = await exporter.exportTenant({ tenantId: "acme", doctypes: ["Ticket"] });

      expect(raced.doctypes[0]).toMatchObject({ status: "superseded", exported: 2, drained: false });
      expect(raced.failed).toBe(0);
      await expect(stores.cursors.get("acme", "Ticket")).resolves.toMatchObject({ position: null, generation: 1, reexporting: true });
      const next = await exporter.exportTenant({ tenantId: "acme", doctypes: ["Ticket"] });
      expect(next.doctypes[0]).toMatchObject({ status: "exported", exported: 4, drained: true });
      close();
    });
  }

  it("vouches for rows only once a buffering sink has made them visible", async () => {
    // Pipelines accepts records on `send` and writes them into the table only
    // when its sink rolls a file. A sink that shows rows `visibleAfterSeconds`
    // after accepting them must not have them counted any earlier.
    const store = new InMemoryAnalyticsStore();
    const clock = settableClock("2026-03-01T00:10:00.000Z");
    const buffered: { readonly rows: readonly AnalyticsDocumentRow[]; readonly visibleAt: number }[] = [];
    const sink: AnalyticsSink = {
      visibleAfterSeconds: 300,
      async append(rows) {
        buffered.push({ rows, visibleAt: Date.parse(clock.now()) + 300_000 });
      }
    };
    const reader: AnalyticsDocumentReader = {
      async scan(query) {
        for (const batch of buffered.splice(0)) {
          if (batch.visibleAt <= Date.parse(clock.now())) {
            await store.append(batch.rows);
          } else {
            buffered.push(batch);
          }
        }
        return store.scan(query);
      }
    };
    const projections = new InMemoryProjectionStore();
    const cursors = new InMemoryAnalyticsExportCursorStore();
    const exporter = new AnalyticsExportService({ registry: registry(), feed: projections, sink, cursors, clock });
    const queries = {
      async queryDocTypeFor() {
        return undefined;
      },
      async readableDocumentsFrom(_actor: Actor, _doctype: string, documents: readonly DocumentSnapshot[]) {
        return documents;
      }
    } as unknown as QueryService;
    const analytics = new AnalyticsQueryService({ reader, queries, cursors, clock });
    await projections.save(snapshot("T-1", "2026-03-01T00:00:00.000Z"));

    const first = await exporter.exportTenant({ tenantId: "acme", doctypes: ["Ticket"] });

    // Sent, not visible: the first export is not finished as far as a reader can tell.
    expect(first.doctypes[0]).toMatchObject({ status: "exported", drained: true, completeThrough: null, lagSeconds: null });
    clock.set("2026-03-01T00:10:30.000Z");
    await expect(analytics.readableDocuments(user, "Ticket")).rejects.toMatchObject({ code: "ANALYTICS_UNAVAILABLE" });
    expect((await exporter.status(admin)).find((item) => item.doctype === "Ticket")).toMatchObject({ completeThrough: null });

    // Later runs keep the pending horizon rather than pushing it back.
    await projections.save(snapshot("T-2", "2026-03-01T00:12:00.000Z"));
    clock.set("2026-03-01T00:14:00.000Z");
    await exporter.exportTenant({ tenantId: "acme", doctypes: ["Ticket"] });
    expect(await cursors.get("acme", "Ticket")).toMatchObject({
      completeThrough: null,
      pendingThrough: "2026-03-01T00:09:00.000Z",
      pendingVisibleAt: "2026-03-01T00:15:00.000Z"
    });

    // Once the delay has passed the claim holds — read straight from the
    // cursor, without waiting for another run — and the rows are there.
    clock.set("2026-03-01T00:15:00.000Z");
    const read = await analytics.readableDocuments(user, "Ticket");
    expect(read.analytics.completeThrough).toBe("2026-03-01T00:09:00.000Z");
    expect(read.documents.map((item) => item.name)).toEqual(["T-1"]);
    expect((await exporter.status(admin)).find((item) => item.doctype === "Ticket")).toMatchObject({
      completeThrough: "2026-03-01T00:09:00.000Z",
      lagSeconds: 360
    });

    // The next drained run settles it and starts the next pending horizon.
    clock.set("2026-03-01T00:16:00.000Z");
    const third = await exporter.exportTenant({ tenantId: "acme", doctypes: ["Ticket"] });
    expect(third.doctypes[0]).toMatchObject({ completeThrough: "2026-03-01T00:09:00.000Z" });
    expect(await cursors.get("acme", "Ticket")).toMatchObject({
      completeThrough: "2026-03-01T00:09:00.000Z",
      pendingThrough: "2026-03-01T00:15:00.000Z",
      pendingVisibleAt: "2026-03-01T00:21:00.000Z"
    });
  });

  it("reports per-DocType freshness to admins only", async () => {
    const { projections, exporter, clock } = harness();
    await projections.save(snapshot("T-1", "2026-03-01T00:00:00.000Z"));
    await exporter.exportTenant({ tenantId: "acme", doctypes: ["Ticket"] });
    clock.set("2026-03-01T00:12:00.000Z");

    await expect(exporter.status(admin)).resolves.toEqual([
      { doctype: "Invoice", completeThrough: null, lagSeconds: null, reexporting: false, exportedRows: 0, lastRunAt: null, lastError: null },
      {
        doctype: "Ticket",
        completeThrough: "2026-03-01T00:09:00.000Z",
        lagSeconds: 180,
        reexporting: false,
        exportedRows: 1,
        lastRunAt: "2026-03-01T00:10:00.000Z",
        lastError: null
      }
    ]);
    await expect(exporter.status(user)).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    await expect(exporter.reset(user, "Ticket")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  });

  it("refuses to export or reset a DocType outside the exported set", async () => {
    const { exporter } = harness();

    await expect(exporter.exportTenant({ tenantId: "acme", doctypes: ["Note"] })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(exporter.reset(admin, "Note")).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("validates its configuration at construction", () => {
    const base = { registry: registry(), feed: new InMemoryProjectionStore(), sink: new InMemoryAnalyticsStore(), cursors: new InMemoryAnalyticsExportCursorStore() };

    expect(() => new AnalyticsExportService({ ...base, doctypes: ["Missing"] })).toThrow();
    expect(() => new AnalyticsExportService({ ...base, batchSize: 0 })).toThrow("batchSize");
    expect(() => new AnalyticsExportService({ ...base, settleSeconds: -1 })).toThrow("settleSeconds");
  });
});

describe("createAnalyticsExportJob", () => {
  it("exports the job's tenant and returns the run as JSON", async () => {
    const { projections, exporter } = harness();
    await projections.save(snapshot("T-1", "2026-03-01T00:00:00.000Z"));
    const job = createAnalyticsExportJob();

    const result = await job.handler({
      tenantId: "acme",
      payload: {},
      resources: { analyticsExports: exporter }
    } as never);

    expect(job.name).toBe("cf-frappe.analytics.export");
    expect(result).toMatchObject({ tenantId: "acme", exported: 1, failed: 0 });
  });

  it("throws when a DocType failed, so job history and retries see it", async () => {
    const sink: AnalyticsSink = { append: async () => { throw new Error("down"); } };
    const { projections, exporter } = harness({ sink });
    await projections.save(snapshot("T-1", "2026-03-01T00:00:00.000Z"));
    const job = createAnalyticsExportJob();

    await expect(job.handler({ tenantId: "acme", payload: {}, resources: { analyticsExports: exporter } } as never)).rejects.toThrow(
      "Analytics export failed for Ticket: down"
    );
  });

  it("fails clearly when analytics is not configured", async () => {
    const job = createAnalyticsExportJob();

    await expect(job.handler({ tenantId: "acme", payload: {}, resources: {} } as never)).rejects.toThrow("not configured");
  });
});
