import { describe, expect, it } from "vitest";
import { D1ProjectionStore } from "../../src/adapters/d1/projection-store.js";
import { QueryService } from "../../src/application/query-service.js";
import { InMemoryProjectionStore } from "../../src/adapters/in-memory/projection-store.js";
import { createRegistry, defineDocType } from "../../src/index.js";
import { createProjectionEngine } from "../sqlite-engine.js";

const Note = defineDocType({
  name: "Note",
  fields: [{ name: "title", type: "text" }],
  indexes: [["title"]],
  permissions: [{ roles: ["User"], actions: ["read"] }]
});

/**
 * Counts the statements one list render issues, and how many of them are the
 * match `COUNT(*)`.
 *
 * A `D1Database` facade rather than a spy on the store: the point is what
 * reaches SQL, and the store is free to batch.
 */
function countingDatabase(real: D1Database): { db: D1Database; statements: () => number; counts: () => number } {
  let statements = 0;
  let counts = 0;
  const db = {
    prepare(sql: string) {
      statements += 1;
      if (sql.includes("COUNT(")) {
        counts += 1;
      }
      return real.prepare(sql);
    },
    batch(list: unknown[]) {
      return (real as unknown as { batch: (l: unknown[]) => unknown }).batch(list);
    },
    exec(sql: string) {
      return real.exec(sql);
    },
    dump() {
      return real.dump();
    },
    withSession() {
      return db;
    }
  } as unknown as D1Database;
  return { db, statements: () => statements, counts: () => counts };
}

describe("list render cost", () => {
  it("counts the predicate matches once, not once per permission-scan page", async () => {
    // Row-level permissions are decided in the Worker, so the whole match set is
    // paged through at 200 rows a page to report an exact readable total. The
    // match `COUNT(*)` does not change between those pages, and it is a
    // full-table count under the same predicate — which a pushed-down text
    // filter turns into a scan. Re-running it per page made half the statements
    // in a list render a scan, and that cost grows with the match set: a 500k
    // doctype matching 100k would have issued about 500 of them for one click.
    const engine = createProjectionEngine([Note]);
    engine.insert(
      Array.from({ length: 4000 }, (_unused, index) => ({
        tenantId: "t1",
        doctype: "Note",
        name: `N${String(index).padStart(5, "0")}`,
        data: { title: index % 2 === 0 ? "Ärger bulk" : "bulk" }
      }))
    );
    const counting = countingDatabase(engine.asD1Database());
    const queries = new QueryService({
      registry: createRegistry({ doctypes: [Note] }),
      projections: new D1ProjectionStore(counting.db)
    });

    const page = await queries.listDocuments(
      { id: "u", roles: ["User"], tenantId: "t1" },
      "Note",
      { limit: 20, offset: 0, filters: [{ field: "title", operator: "contains", value: "ärger" }] }
    );

    // 2000 matches at 200 a page is 10 pages, so the page count is what makes
    // the assertion meaningful rather than incidental.
    expect({ rows: page.data.length, total: page.total }).toEqual({ rows: 20, total: 2000 });
    expect(counting.statements()).toBe(11);
    expect(counting.counts()).toBe(1);
    engine.close();
  });

  it("reports total 0 under skipTotal in both stores, not just in D1", async () => {
    // The in-memory store has the count for free, so reporting 0 is a choice
    // rather than a saving: a caller that reads a total it asked not to be
    // computed should break the same way on either adapter instead of only on
    // D1. Nothing pinned that, and dropping the branch passed the whole suite.
    const engine = createProjectionEngine([Note]);
    engine.insert(
      Array.from({ length: 30 }, (_unused, index) => ({
        tenantId: "t1",
        doctype: "Note",
        name: `N${String(index).padStart(5, "0")}`,
        data: { title: "Ärger" }
      }))
    );
    const memory = new InMemoryProjectionStore();
    for (let index = 0; index < 30; index += 1) {
      await memory.save({
        tenantId: "t1",
        doctype: "Note",
        name: `N${String(index).padStart(5, "0")}`,
        version: 1,
        docstatus: "draft",
        data: { title: "Ärger" },
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      });
    }
    const d1 = new D1ProjectionStore(engine.asD1Database());
    const query = { tenantId: "t1", doctype: "Note", limit: 5, skipTotal: true } as const;

    const [fromD1, fromMemory] = await Promise.all([d1.list(query), memory.list(query)]);

    expect({ rows: fromD1.data.length, total: fromD1.total }).toEqual({ rows: 5, total: 0 });
    expect({ rows: fromMemory.data.length, total: fromMemory.total }).toEqual({ rows: 5, total: 0 });
    // And without it both still count, so the assertion above is about the flag
    // rather than about an empty table.
    await expect(d1.list({ ...query, skipTotal: false })).resolves.toMatchObject({ total: 30 });
    await expect(memory.list({ ...query, skipTotal: false })).resolves.toMatchObject({ total: 30 });
    engine.close();
  });

  it("still reports an exact readable total", async () => {
    // The count is asked for once, so nothing may read a skipped one by mistake.
    const engine = createProjectionEngine([Note]);
    engine.insert(
      Array.from({ length: 450 }, (_unused, index) => ({
        tenantId: "t1",
        doctype: "Note",
        name: `N${String(index).padStart(5, "0")}`,
        data: { title: index % 3 === 0 ? "Ärger" : "other" }
      }))
    );
    const queries = new QueryService({
      registry: createRegistry({ doctypes: [Note] }),
      projections: new D1ProjectionStore(engine.asD1Database())
    });

    await expect(
      queries.listDocuments({ id: "u", roles: ["User"], tenantId: "t1" }, "Note", {
        limit: 5,
        offset: 0,
        filters: [{ field: "title", operator: "contains", value: "ärger" }]
      })
    ).resolves.toMatchObject({ total: 150, limit: 5 });
    engine.close();
  });
});
