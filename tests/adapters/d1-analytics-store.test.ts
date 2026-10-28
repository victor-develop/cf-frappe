import { describe, expect, it } from "vitest";
import {
  D1AnalyticsExportCursorStore,
  D1AnalyticsStore,
  D1MigrationRunner,
  D1ProjectionStore,
  analyticsRowFromSnapshot,
  d1AnalyticsScanStatement,
  planD1AnalyticsMigrations,
  type AnalyticsDocumentRow,
  type AnalyticsExportCursor,
  type DocumentSnapshot
} from "../../src";
import { analyticsSchema, createTestD1, frameworkSchema } from "../d1-engine.js";

const EXPORTED_AT = "2026-03-02T00:00:00.000Z";

function row(name: string, version: number, overrides: Partial<DocumentSnapshot> = {}): AnalyticsDocumentRow {
  return analyticsRowFromSnapshot(
    {
      tenantId: "acme",
      doctype: "Ticket",
      name,
      version,
      docstatus: "draft",
      data: { status: "Open" },
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: `2026-03-01T00:00:0${version}.000Z`,
      ...overrides
    },
    EXPORTED_AT
  );
}

function regenerated(base: AnalyticsDocumentRow, generation: number, data: Record<string, unknown>, exportedAt = EXPORTED_AT): AnalyticsDocumentRow {
  return { ...base, exportGeneration: generation, dataJson: JSON.stringify(data), exportedAt };
}

function analyticsStore() {
  const d1 = createTestD1({ schema: analyticsSchema() });
  return { d1, store: new D1AnalyticsStore(d1.database) };
}

describe("D1AnalyticsStore on a real SQLite engine", () => {
  it("returns each document's newest version, ordered by name", async () => {
    const { d1, store } = analyticsStore();
    await store.append([row("T-2", 1), row("T-1", 1), row("T-1", 2, { data: { status: "Closed" } }), row("T-1", 3, { data: { status: "Reopened" } })]);

    const page = await store.scan({ tenantId: "acme", doctype: "Ticket", limit: 10 });

    expect(page.documents.map((document) => `${document.name}@${document.version}:${String(document.data.status)}`)).toEqual([
      "T-1@3:Reopened",
      "T-2@1:Open"
    ]);
    expect(page.nextCursor).toBeUndefined();
    d1.close();
  });

  it("absorbs a re-sent batch: appending the same versions twice changes nothing", async () => {
    const { d1, store } = analyticsStore();
    const batch = [row("T-1", 1), row("T-1", 2)];

    await store.append(batch);
    await store.append(batch);

    expect(d1.query("SELECT COUNT(*) AS total FROM cf_frappe_analytics_documents")).toEqual([{ total: 2 }]);
    d1.close();
  });

  it("lets a re-export at the same version outrank the row it replaces", async () => {
    // A rebuild (#11) or repair (#12) rewrites data without moving the version.
    // The stale row was exported first, in generation 0; the corrected one in
    // generation 1 after a reset. A reader keyed on version alone would pick
    // either; it must pick the corrected one, and keep picking it.
    const { d1, store } = analyticsStore();
    const stale = row("T-1", 4, { data: { total: 10 } });
    await store.append([stale, row("T-2", 1)]);
    await store.append([regenerated(stale, 1, { total: 12 }, "2026-03-03T00:00:00.000Z")]);
    // A late re-send of the stale generation (a run that was in flight when the
    // reset landed) must not win back.
    await store.append([regenerated(stale, 0, { total: 10 }, "2026-03-04T00:00:00.000Z")]);

    const page = await store.scan({ tenantId: "acme", doctype: "Ticket", limit: 10 });

    expect(page.documents.map((document) => `${document.name}@${document.version}:${JSON.stringify(document.data)}`)).toEqual([
      'T-1@4:{"total":12}',
      'T-2@1:{"status":"Open"}'
    ]);
    expect(d1.query("SELECT COUNT(*) AS total FROM cf_frappe_analytics_documents WHERE name = 'T-1'")).toEqual([{ total: 2 }]);
    d1.close();
  });

  it("keeps the later export when the same version and generation is appended again", async () => {
    // The same rule as the in-memory store and the R2 SQL ranking, so the three
    // adapters cannot disagree about which of two same-key rows a report sees.
    const { d1, store } = analyticsStore();
    const first = row("T-1", 1, { data: { total: 1 } });
    await store.append([first]);
    await store.append([regenerated(first, 0, { total: 2 }, "2026-03-03T00:00:00.000Z")]);

    const page = await store.scan({ tenantId: "acme", doctype: "Ticket", limit: 10 });

    expect(page.documents.map((document) => document.data)).toEqual([{ total: 2 }]);
    d1.close();
  });

  it("hides a deleted document instead of resurrecting its last live version", async () => {
    // The guard this pins: `docstatus` is tested on the newest version, not
    // used to choose it. Filtering first would answer with v1.
    const { d1, store } = analyticsStore();
    await store.append([row("T-1", 1), row("T-1", 2, { docstatus: "deleted" }), row("T-2", 1)]);

    const page = await store.scan({ tenantId: "acme", doctype: "Ticket", limit: 10 });

    expect(page.documents.map((document) => document.name)).toEqual(["T-2"]);
    d1.close();
  });

  it("applies a pre-filter to the newest version only", async () => {
    // T-1 *was* Open at v1 and is Closed now. A pre-filter evaluated before the
    // newest version is chosen would return the stale v1 as if it were current.
    const { d1, store } = analyticsStore();
    await store.append([
      row("T-1", 1, { data: { status: "Open" } }),
      row("T-1", 2, { data: { status: "Closed" } }),
      row("T-2", 1, { data: { status: "Open" } }),
      row("T-3", 1, { data: { status: 1 } })
    ]);

    const open = await store.scan({ tenantId: "acme", doctype: "Ticket", limit: 10, prefilters: [{ field: "status", value: "Open" }] });

    expect(open.documents.map((document) => `${document.name}@${document.version}`)).toEqual(["T-2@1"]);
    d1.close();
  });

  it("keeps tenants and DocTypes apart", async () => {
    const { d1, store } = analyticsStore();
    await store.append([row("T-1", 1), row("T-1", 1, { tenantId: "globex" }), row("T-1", 1, { doctype: "Invoice" })]);

    const page = await store.scan({ tenantId: "acme", doctype: "Ticket", limit: 10 });

    expect(page.documents).toEqual([expect.objectContaining({ tenantId: "acme", doctype: "Ticket", name: "T-1" })]);
    d1.close();
  });

  it("pages by name and reports the next cursor only while a page is full", async () => {
    const { d1, store } = analyticsStore();
    await store.append(["a", "b", "c", "d", "e"].map((name) => row(`T-${name}`, 1)));

    const names: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await store.scan({ tenantId: "acme", doctype: "Ticket", limit: 2, ...(cursor === undefined ? {} : { cursor }) });
      names.push(...page.documents.map((document) => document.name));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== undefined);

    expect(names).toEqual(["T-a", "T-b", "T-c", "T-d", "T-e"]);
    expect(pages).toBe(3);
    d1.close();
  });

  it("binds every value and leaves a field name it cannot inline for the caller to filter", () => {
    const statement = d1AnalyticsScanStatement({
      tenantId: "acme'; DROP TABLE x; --",
      doctype: "Ticket",
      limit: 5,
      cursor: "T-1",
      prefilters: [{ field: "status", value: "O'Brien" }, { field: "bad'); DROP", value: "x" }]
    });

    expect(statement.params).toEqual(["acme'; DROP TABLE x; --", "Ticket", "T-1", "O'Brien", 5]);
    expect(statement.sql).not.toContain("DROP");
    expect(statement.sql).not.toContain("O'Brien");
    expect(statement.sql).toContain("json_extract(data_json, '$.status') = ?");
  });

  it("reads the newest version through the primary key, not a scan per page", () => {
    const d1 = createTestD1({ schema: analyticsSchema() });
    const statement = d1AnalyticsScanStatement({ tenantId: "acme", doctype: "Ticket", limit: 50 });
    const plan = d1
      .query(`EXPLAIN QUERY PLAN ${statement.sql}`, ...statement.params)
      .map((step) => String(step.detail))
      .join("\n");

    expect(plan).toMatch(/SEARCH d USING (?:INDEX|PRIMARY KEY) .*tenant_id=\? AND doctype=\?/);
    expect(plan).toMatch(/SEARCH n USING (?:COVERING INDEX|INDEX|PRIMARY KEY) .*tenant_id=\? AND doctype=\? AND name=\?/);
    expect(plan).not.toContain("USE TEMP B-TREE FOR ORDER BY");
    d1.close();
  });

  it("is created by its own migration plan, in its own database", async () => {
    const d1 = createTestD1();
    await new D1MigrationRunner(d1.database).apply(planD1AnalyticsMigrations());
    const store = new D1AnalyticsStore(d1.database);

    await store.append([row("T-1", 1)]);

    await expect(store.scan({ tenantId: "acme", doctype: "Ticket", limit: 1 })).resolves.toMatchObject({
      documents: [{ name: "T-1" }]
    });
    expect(d1.query("SELECT name FROM sqlite_master WHERE name = 'cf_frappe_documents'")).toEqual([]);
    d1.close();
  });

  it("rolls an append back as a whole when one row fails", async () => {
    const d1 = createTestD1({ schema: analyticsSchema(), failSqlIncludes: "INSERT INTO cf_frappe_analytics_documents" });
    const store = new D1AnalyticsStore(d1.database);

    await expect(store.append([row("T-1", 1), row("T-2", 1)])).rejects.toThrow();
    expect(d1.query("SELECT COUNT(*) AS total FROM cf_frappe_analytics_documents")).toEqual([{ total: 0 }]);
    d1.close();
  });
});

describe("D1AnalyticsExportCursorStore on the framework schema", () => {
  const cursor: AnalyticsExportCursor = {
    tenantId: "acme",
    doctype: "Ticket",
    position: { updatedAt: "2026-03-01T00:00:05.000Z", name: "T-5" },
    completeThrough: "2026-03-01T00:09:00.000Z",
    pendingThrough: null,
    pendingVisibleAt: null,
    generation: 0,
    reexporting: false,
    exportedRows: 5,
    lastRunAt: "2026-03-01T00:10:00.000Z",
    lastError: null
  };

  it("round-trips a cursor and lists a tenant's cursors only", async () => {
    const d1 = createTestD1({ schema: frameworkSchema() });
    const cursors = new D1AnalyticsExportCursorStore(d1.database);
    await cursors.save(cursor);
    await cursors.save({ ...cursor, doctype: "Invoice", position: null, completeThrough: null, exportedRows: 0, lastError: "down" });
    await cursors.save({ ...cursor, tenantId: "globex" });

    await expect(cursors.get("acme", "Ticket")).resolves.toEqual(cursor);
    await expect(cursors.get("acme", "Missing")).resolves.toBeNull();
    expect((await cursors.list("acme")).map((item) => item.doctype)).toEqual(["Invoice", "Ticket"]);
    expect((await cursors.list("acme"))[0]).toMatchObject({ position: null, completeThrough: null, lastError: "down" });
    d1.close();
  });

  it("never lets completeThrough move backwards, whichever run saves last", async () => {
    // Two overlapping runs can save in either order. The position may regress —
    // that only re-sends rows the sink already has — but the freshness claim
    // must not.
    const d1 = createTestD1({ schema: frameworkSchema() });
    const cursors = new D1AnalyticsExportCursorStore(d1.database);
    await cursors.save(cursor);
    await cursors.save({ ...cursor, completeThrough: "2026-03-01T00:01:00.000Z", position: { updatedAt: "2026-03-01T00:00:01.000Z", name: "T-1" } });

    await expect(cursors.get("acme", "Ticket")).resolves.toMatchObject({
      completeThrough: "2026-03-01T00:09:00.000Z",
      position: { name: "T-1" }
    });
    await cursors.save({ ...cursor, completeThrough: null });
    await expect(cursors.get("acme", "Ticket")).resolves.toMatchObject({ completeThrough: "2026-03-01T00:09:00.000Z" });
    await cursors.save({ ...cursor, completeThrough: "2026-03-01T00:20:00.000Z" });
    await expect(cursors.get("acme", "Ticket")).resolves.toMatchObject({ completeThrough: "2026-03-01T00:20:00.000Z" });
    d1.close();
  });

  it("round-trips a pending horizon, the generation and the re-export flag", async () => {
    const d1 = createTestD1({ schema: frameworkSchema() });
    const cursors = new D1AnalyticsExportCursorStore(d1.database);
    const pending: AnalyticsExportCursor = {
      ...cursor,
      pendingThrough: "2026-03-01T00:19:00.000Z",
      pendingVisibleAt: "2026-03-01T00:26:00.000Z",
      generation: 2,
      reexporting: true
    };

    await expect(cursors.save(pending)).resolves.toBe(true);

    await expect(cursors.get("acme", "Ticket")).resolves.toEqual(pending);
    d1.close();
  });

  it("starts a re-export on reset: new generation, no position, freshness kept", async () => {
    const d1 = createTestD1({ schema: frameworkSchema() });
    const cursors = new D1AnalyticsExportCursorStore(d1.database);
    await cursors.save(cursor);
    await cursors.save({ ...cursor, doctype: "Invoice" });

    await cursors.reset("acme", "Ticket");
    await cursors.reset("acme", "Never Exported");

    await expect(cursors.get("acme", "Ticket")).resolves.toEqual({
      ...cursor,
      position: null,
      generation: 1,
      reexporting: true
    });
    await expect(cursors.get("acme", "Invoice")).resolves.toEqual({ ...cursor, doctype: "Invoice" });
    await expect(cursors.get("acme", "Never Exported")).resolves.toMatchObject({
      position: null,
      completeThrough: null,
      generation: 1,
      reexporting: true
    });
    d1.close();
  });

  it("refuses a save from the generation before a reset, so the reset sticks", async () => {
    // A run read the cursor (generation 0), then a reset landed. The run's next
    // save carries its old position; accepting it would silently undo the reset.
    const d1 = createTestD1({ schema: frameworkSchema() });
    const cursors = new D1AnalyticsExportCursorStore(d1.database);
    await cursors.save(cursor);
    await cursors.reset("acme", "Ticket");

    await expect(cursors.save({ ...cursor, position: { updatedAt: "2026-03-01T00:00:09.000Z", name: "T-9" } })).resolves.toBe(false);

    await expect(cursors.get("acme", "Ticket")).resolves.toMatchObject({ position: null, generation: 1, reexporting: true });
    await expect(cursors.save({ ...cursor, generation: 1, position: { updatedAt: "2026-03-01T00:00:01.000Z", name: "T-1" } })).resolves.toBe(true);
    await expect(cursors.get("acme", "Ticket")).resolves.toMatchObject({ position: { name: "T-1" }, generation: 1 });
    d1.close();
  });
});

describe("D1ProjectionStore change feed", () => {
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

  async function seeded() {
    const d1 = createTestD1({ schema: frameworkSchema() });
    const projections = new D1ProjectionStore(d1.database);
    for (const document of [
      snapshot("T-c", "2026-03-01T00:00:01.000Z"),
      snapshot("T-a", "2026-03-01T00:00:01.000Z"),
      snapshot("T-b", "2026-03-01T00:00:01.000Z"),
      snapshot("T-d", "2026-03-01T00:00:00.000Z"),
      snapshot("T-e", "2026-03-01T00:00:05.000Z"),
      snapshot("T-x", "2026-03-01T00:00:01.000Z", { tenantId: "globex" }),
      snapshot("I-1", "2026-03-01T00:00:01.000Z", { doctype: "Invoice" })
    ]) {
      await projections.save(document);
    }
    return { d1, projections };
  }

  it("lists one tenant's DocType in (updatedAt, name) order up to the horizon", async () => {
    const { d1, projections } = await seeded();

    const rows = await projections.listChangedSince({ tenantId: "acme", doctype: "Ticket", through: "2026-03-01T00:00:01.000Z", limit: 10 });

    expect(rows.map((document) => document.name)).toEqual(["T-d", "T-a", "T-b", "T-c"]);
    d1.close();
  });

  it("resumes strictly after a position, including inside a tie on updatedAt", async () => {
    const { d1, projections } = await seeded();

    const rows = await projections.listChangedSince({
      tenantId: "acme",
      doctype: "Ticket",
      after: { updatedAt: "2026-03-01T00:00:01.000Z", name: "T-a" },
      through: "2026-03-01T00:01:00.000Z",
      limit: 10
    });

    expect(rows.map((document) => document.name)).toEqual(["T-b", "T-c", "T-e"]);
    d1.close();
  });

  it("walks the whole DocType in limit-sized pages without skipping or repeating", async () => {
    const { d1, projections } = await seeded();
    const seen: string[] = [];
    let after: { updatedAt: string; name: string } | undefined;
    // Bounded, so a keyset that fails to advance fails here instead of hanging.
    for (let pages = 0; pages < 10; pages += 1) {
      const rows = await projections.listChangedSince({
        tenantId: "acme",
        doctype: "Ticket",
        ...(after === undefined ? {} : { after }),
        through: "2026-03-01T00:01:00.000Z",
        limit: 2
      });
      if (rows.length === 0) {
        break;
      }
      seen.push(...rows.map((document) => document.name));
      const last = rows.at(-1)!;
      after = { updatedAt: last.updatedAt, name: last.name };
    }

    expect(seen).toEqual(["T-d", "T-a", "T-b", "T-c", "T-e"]);
    d1.close();
  });

  it("ranges over the list index rather than scanning the projection", async () => {
    const { d1 } = await seeded();
    const plan = d1
      .query(
        `EXPLAIN QUERY PLAN
         SELECT tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at
         FROM cf_frappe_documents
         WHERE tenant_id = ? AND doctype = ?
           AND updated_at >= ? AND updated_at <= ?
           AND (updated_at > ? OR name > ?)
         ORDER BY updated_at ASC, name ASC
         LIMIT ?`,
        "acme",
        "Ticket",
        "2026-03-01T00:00:01.000Z",
        "2026-03-01T00:01:00.000Z",
        "2026-03-01T00:00:01.000Z",
        "T-a",
        2
      )
      .map((step) => String(step.detail))
      .join("\n");

    expect(plan).toMatch(/idx_cf_frappe_documents_list \(tenant_id=\? AND doctype=\? AND updated_at>\? AND updated_at<\?\)/);
    // Only the name tie-break needs sorting, within one updated_at value.
    expect(plan).not.toContain("USE TEMP B-TREE FOR ORDER BY");
    d1.close();
  });

  it("runs the statement the plan test inspects", async () => {
    // Keeps the plan test honest: the SQL it explains is the SQL the adapter runs.
    const { d1, projections } = await seeded();
    await projections.listChangedSince({
      tenantId: "acme",
      doctype: "Ticket",
      after: { updatedAt: "2026-03-01T00:00:01.000Z", name: "T-a" },
      through: "2026-03-01T00:01:00.000Z",
      limit: 2
    });

    const executed = d1.executed.at(-1)!.replace(/\s+/g, " ");
    expect(executed).toContain(
      "WHERE tenant_id = ? AND doctype = ? AND updated_at >= ? AND updated_at <= ? AND (updated_at > ? OR name > ?) ORDER BY updated_at ASC, name ASC LIMIT ?"
    );
    d1.close();
  });
});
