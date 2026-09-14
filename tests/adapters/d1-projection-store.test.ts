import {
  D1ProjectionStore,
  predicateExpressionFromListFilterExpression
} from "../../src";
import { d1ProjectionListQuery } from "../../src/adapters/d1/projection-query.js";
import type {
  DocumentData,
  DocumentSnapshot,
  ListDocumentsFilter,
  ListFilterExpression,
  PredicateExpression
} from "../../src";
import { createTestD1, frameworkSchema, type TestD1 } from "../d1-engine.js";

describe("D1ProjectionStore", () => {
  it("preserves Predicate null semantics without binding SQL NULL comparisons", () => {
    const compare = (operator: "eq" | "ne" | "in" | "not_in", value: null | readonly (string | null)[]) =>
      d1ProjectionListQuery({
        tenantId: "acme",
        doctype: "Note",
        predicate: {
          kind: "compare",
          left: { kind: "field", scope: "after", field: "priority" },
          operator,
          right: { kind: "literal", value }
        }
      });

    expect(compare("eq", null)).toMatchObject({
      where: "tenant_id = ? AND doctype = ? AND json_type(data_json, '$.priority') = 'null'",
      params: ["acme", "Note"]
    });
    expect(compare("ne", null)).toMatchObject({
      where: "tenant_id = ? AND doctype = ? AND json_extract(data_json, '$.priority') IS NOT NULL",
      params: ["acme", "Note"]
    });
    expect(compare("not_in", ["Low", null])).toMatchObject({
      where: "tenant_id = ? AND doctype = ? AND json_extract(data_json, '$.priority') IS NOT NULL AND json_extract(data_json, '$.priority') NOT IN (?)",
      params: ["acme", "Note", "Low"]
    });
    expect(compare("in", [null])).toMatchObject({
      where: "tenant_id = ? AND doctype = ? AND 0 = 1",
      params: ["acme", "Note"]
    });
  });

  it("lists projections with bound filter parameters for rows and counts", async () => {
    const d1 = store();
    seedRows(d1, [
      documentRow({ name: "D1 High", data: { title: "D1 High", priority: "High" } }),
      documentRow({ name: "D1 Low", data: { title: "D1 Low", priority: "Low" } })
    ]);
    const storeUnder = new D1ProjectionStore(d1.database);

    const result = await storeUnder.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "priority", value: "High" }])
    });

    expect(result).toMatchObject({ data: [{ name: "D1 High" }], total: 1 });
    const [rows, count] = d1.statements;
    expect(rows?.sql).toContain("json_extract(data_json, '$.priority') = ?");
    expect(rows?.sql).not.toContain("High");
    expect(rows?.params).toEqual(["acme", "Note", "High", 50, 0]);
    expect(count?.sql).toContain("json_extract(data_json, '$.priority') = ?");
    expect(count?.sql).not.toContain("High");
    expect(count?.params).toEqual(["acme", "Note", "High"]);
  });

  it("rejects invalid stored D1 projection JSON rows", async () => {
    const d1 = store();
    seedRows(d1, [{ ...documentRow({ name: "D1 Bad", data: { title: "D1 Bad" } }), data_json: "[" }]);
    const storeUnder = new D1ProjectionStore(d1.database);

    await expect(storeUnder.get("acme", "Note", "D1 Bad")).rejects.toMatchObject({
      code: "D1_DOCUMENT_INVALID",
      status: 409
    });
  });

  it("rejects stored D1 projection rows with non-finite JSON numbers", async () => {
    const d1 = store();
    seedRows(d1, [
      { ...documentRow({ name: "D1 Infinite", data: { title: "D1 Infinite" } }), data_json: '{"count":1e999}' }
    ]);
    const storeUnder = new D1ProjectionStore(d1.database);

    await expect(storeUnder.get("acme", "Note", "D1 Infinite")).rejects.toMatchObject({
      code: "D1_DOCUMENT_INVALID",
      status: 409
    });
  });

  it("rejects non-JSON D1 projection data before writing rows", async () => {
    const d1 = store();
    const storeUnder = new D1ProjectionStore(d1.database);

    await expect(
      storeUnder.save({
        tenantId: "acme",
        doctype: "Note",
        name: "D1 Bad",
        version: 1,
        docstatus: "draft",
        data: { count: Number.POSITIVE_INFINITY } as never,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z"
      })
    ).rejects.toMatchObject({
      code: "DOCUMENT_INVALID",
      status: 409
    });
    expect(rowCount(d1)).toBe(0);
  });

  it("snapshots D1 projections by value on save, get, and list", async () => {
    const d1 = store();
    const storeUnder = new D1ProjectionStore(d1.database);
    const snapshot: DocumentSnapshot = {
      tenantId: "acme",
      doctype: "Note",
      name: "D1 Snapshot",
      version: 1,
      docstatus: "draft",
      data: { title: "One", nested: { count: 1 } },
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    };

    await storeUnder.save(snapshot);
    (snapshot.data.nested as DocumentData).count = 2;

    const saved = await storeUnder.get("acme", "Note", "D1 Snapshot");
    expect(saved).toMatchObject({ data: { title: "One", nested: { count: 1 } } });

    (saved!.data.nested as DocumentData).count = 3;
    await expect(storeUnder.get("acme", "Note", "D1 Snapshot")).resolves.toMatchObject({
      data: { title: "One", nested: { count: 1 } }
    });

    const listed = await storeUnder.list({ tenantId: "acme", doctype: "Note" });
    (listed.data[0]!.data.nested as DocumentData).count = 4;
    await expect(storeUnder.get("acme", "Note", "D1 Snapshot")).resolves.toMatchObject({
      data: { title: "One", nested: { count: 1 } }
    });
  });

  it("pushes contains into SQL as a bound GLOB pattern, never as SQL text", async () => {
    const d1 = store();
    seedRows(d1, [documentRow({ name: "D1 Sale", data: { title: "50%_Off", priority: "High" } })]);
    const storeUnder = new D1ProjectionStore(d1.database);

    const result = await storeUnder.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "title", operator: "contains", value: "50%_Off" }])
    });

    // The pattern reaches SQLite as a parameter, so this is an
    // anti-interpolation guard; row-level GLOB parity (the `_`/`%` metacharacters
    // really matching) lives in d1-projection-glob.test.ts.
    const [rows] = d1.statements;
    expect(rows?.sql).toContain("json_extract(data_json, '$.title') GLOB ?");
    expect(rows?.sql).not.toContain("LOWER(");
    expect(rows?.sql).not.toContain("50%_Off");
    expect(rows?.params).toEqual(["acme", "Note", "*50%_[Oo][Ff][Ff]*", 50, 0]);
    expect(result).toMatchObject({ data: [{ name: "D1 Sale" }], total: 1 });
  });

  it("renders advanced scalar operators with bound filter parameters", async () => {
    const d1 = store();
    seedRows(d1, [
      documentRow({ name: "D1 High", data: { title: "D1 High", priority: "High", count: 5 } })
    ]);
    const storeUnder = new D1ProjectionStore(d1.database);

    await storeUnder.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([
        { field: "priority", operator: "ne", value: "Low" },
        { field: "count", operator: "gt", value: 2 },
        { field: "count", operator: "lt", value: 9 }
      ])
    });

    const [rows, count] = d1.statements;
    expect(rows?.sql).toContain("json_extract(data_json, '$.priority') IS NOT NULL AND json_extract(data_json, '$.priority') != ?");
    expect(rows?.sql).toContain("json_extract(data_json, '$.count') > ?");
    expect(rows?.sql).toContain("json_extract(data_json, '$.count') < ?");
    expect(rows?.params).toEqual(["acme", "Note", "Low", 2, 9, 50, 0]);
    expect(count?.params).toEqual(["acme", "Note", "Low", 2, 9]);
  });

  it("renders membership operators with bound filter parameters", async () => {
    const d1 = store();
    seedRows(d1, [
      documentRow({ name: "D1 High", data: { title: "D1 High", priority: "High" }, updatedAt: "2026-01-03T00:00:00.000Z" }),
      documentRow({ name: "D1 Medium", data: { title: "D1 Medium", priority: "Medium" }, updatedAt: "2026-01-02T00:00:00.000Z" }),
      documentRow({ name: "D1 Low", data: { title: "D1 Low", priority: "Low" }, updatedAt: "2026-01-01T00:00:00.000Z" })
    ]);
    const storeUnder = new D1ProjectionStore(d1.database);

    const result = await storeUnder.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "priority", operator: "in", value: ["High", "Medium"] }])
    });

    // Without an explicit `orderBy` the list falls back to newest-first, so
    // with distinct `updatedAt` values the order is a contract and pinned here.
    expect(result).toMatchObject({ data: [{ name: "D1 High" }, { name: "D1 Medium" }], total: 2 });
    const [rows, count] = d1.statements;
    expect(rows?.sql).toContain("json_extract(data_json, '$.priority') IN (?, ?)");
    expect(rows?.sql).not.toContain("High");
    expect(rows?.params).toEqual(["acme", "Note", "High", "Medium", 50, 0]);
    expect(count?.sql).toContain("json_extract(data_json, '$.priority') IN (?, ?)");
    expect(count?.params).toEqual(["acme", "Note", "High", "Medium"]);

    const notInResult = await storeUnder.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "priority", operator: "not_in", value: ["Low", "Medium"] }])
    });

    expect(notInResult).toMatchObject({ data: [{ name: "D1 High" }], total: 1 });
    const notInRows = d1.statements[2];
    expect(notInRows?.sql).toContain(
      "json_extract(data_json, '$.priority') IS NOT NULL AND json_extract(data_json, '$.priority') NOT IN (?, ?)"
    );
    expect(notInRows?.params).toEqual(["acme", "Note", "Low", "Medium", 50, 0]);
  });

  it("renders nested compound filter expressions with bound parameters", async () => {
    const d1 = store();
    seedRows(d1, [
      documentRow({ name: "D1 High", data: { title: "D1 High", priority: "High", count: 10 } }),
      documentRow({ name: "D1 Count", data: { title: "D1 Count", priority: "Low", count: 3 } }),
      documentRow({ name: "D1 Miss", data: { title: "D1 Miss", priority: "Low", count: 9 } })
    ]);
    const storeUnder = new D1ProjectionStore(d1.database);

    const result = await storeUnder.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate({
        kind: "group",
        match: "any",
        filters: [
          { field: "priority", value: "High" },
          {
            kind: "group",
            match: "all",
            filters: [
              { field: "count", operator: "gte", value: 2 },
              { field: "count", operator: "lte", value: 4 }
            ]
          }
        ]
      })
    });

    expect(names(result)).toEqual(["D1 Count", "D1 High"]);
    expect(result.total).toBe(2);
    const [rows, count] = d1.statements;
    expect(rows?.sql).toContain(
      "(json_extract(data_json, '$.priority') = ? OR (json_extract(data_json, '$.count') >= ? AND json_extract(data_json, '$.count') <= ?))"
    );
    expect(rows?.params).toEqual(["acme", "Note", "High", 2, 4, 50, 0]);
    expect(count?.params).toEqual(["acme", "Note", "High", 2, 4]);
  });

  it("filters system projection fields with bound parameters", async () => {
    const d1 = store();
    seedRows(d1, [
      documentRow({
        name: "D1 Draft",
        version: 1,
        docstatus: "draft",
        updatedAt: "2026-01-01T00:00:00.000Z",
        data: { title: "D1 Draft" }
      }),
      documentRow({
        name: "D1 Submitted",
        version: 3,
        docstatus: "submitted",
        updatedAt: "2026-01-05T00:00:00.000Z",
        data: { title: "D1 Submitted" }
      })
    ]);
    const storeUnder = new D1ProjectionStore(d1.database);

    const result = await storeUnder.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([
        { field: "system.docstatus", value: "submitted" },
        { field: "system.updatedAt", operator: "gte", value: "2026-01-04T00:00:00.000Z" },
        { field: "system.version", operator: "gt", value: 1 }
      ])
    });

    expect(result).toMatchObject({ data: [{ name: "D1 Submitted" }], total: 1 });
    const [rows, count] = d1.statements;
    expect(rows?.sql).toContain("docstatus = ?");
    expect(rows?.sql).toContain("updated_at >= ?");
    expect(rows?.sql).toContain("version > ?");
    expect(rows?.sql).not.toContain("$.docstatus");
    expect(rows?.sql).not.toContain("$.updatedAt");
    expect(rows?.params).toEqual([
      "acme",
      "Note",
      "submitted",
      "2026-01-04T00:00:00.000Z",
      1,
      50,
      0
    ]);
    expect(count?.params).toEqual(["acme", "Note", "submitted", "2026-01-04T00:00:00.000Z", 1]);
  });

  it("filters JSON fields with bound between endpoints", async () => {
    const d1 = store();
    seedRows(d1, [
      documentRow({ name: "D1 Low", data: { title: "low", count: 1 } }),
      documentRow({ name: "D1 Mid", data: { title: "mid", count: 5 } }),
      documentRow({ name: "D1 High", data: { title: "high", count: 9 } }),
      documentRow({ name: "D1 Missing", data: { title: "missing" } }),
      documentRow({ name: "D1 Null", data: { title: "null", count: null } })
    ]);
    const storeUnder = new D1ProjectionStore(d1.database);

    const result = await storeUnder.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "count", operator: "between", value: [2, 8] }])
    });

    expect(names(result)).toEqual(["D1 Mid"]);
    expect(result.total).toBe(1);
    const [rows, count] = d1.statements;
    expect(rows?.sql).toContain("(json_extract(data_json, '$.count') >= ? AND json_extract(data_json, '$.count') <= ?)");
    expect(rows?.sql).not.toContain("2");
    expect(rows?.sql).not.toContain("8");
    expect(rows?.params).toEqual(["acme", "Note", 2, 8, 50, 0]);
    expect(count?.params).toEqual(["acme", "Note", 2, 8]);

    const notBetween = await storeUnder.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "count", operator: "not_between", value: [2, 8] }])
    });

    expect(names(notBetween)).toEqual(["D1 High", "D1 Low"]);
    expect(notBetween.total).toBe(2);
    const notBetweenRows = d1.statements[2];
    expect(notBetweenRows?.sql).toContain(
      "json_extract(data_json, '$.count') IS NOT NULL AND (json_extract(data_json, '$.count') < ? OR json_extract(data_json, '$.count') > ?)"
    );
    expect(notBetweenRows?.sql).not.toContain("D1 Missing");
    expect(notBetweenRows?.params).toEqual(["acme", "Note", 2, 8, 50, 0]);
    expect(d1.statements[3]?.params).toEqual(["acme", "Note", 2, 8]);
  });

  it("renders presence operators without binding filter values", async () => {
    const d1 = store();
    seedRows(d1, [
      documentRow({ name: "D1 Body", data: { title: "body", body: "Body" } }),
      documentRow({ name: "D1 Empty Body", data: { title: "empty", body: "" } }),
      documentRow({ name: "D1 Null Body", data: { title: "null", body: null } }),
      documentRow({ name: "D1 Missing Body", data: { title: "missing" } })
    ]);
    const storeUnder = new D1ProjectionStore(d1.database);

    const missing = await storeUnder.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "body", operator: "is", value: "not set" }])
    });

    expect(names(missing)).toEqual(["D1 Missing Body", "D1 Null Body"]);
    expect(missing.total).toBe(2);
    const [rows, count] = d1.statements;
    expect(rows?.sql).toContain("json_extract(data_json, '$.body') IS NULL");
    expect(rows?.sql).not.toContain("not set");
    expect(rows?.params).toEqual(["acme", "Note", 50, 0]);
    expect(count?.params).toEqual(["acme", "Note"]);

    const set = await storeUnder.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "body", operator: "is", value: "set" }])
    });

    expect(names(set)).toEqual(["D1 Body", "D1 Empty Body"]);
    expect(set.total).toBe(2);
    const setRows = d1.statements[2];
    expect(setRows?.sql).toContain("json_extract(data_json, '$.body') IS NOT NULL");
    expect(setRows?.sql).not.toContain("set");
    expect(setRows?.params).toEqual(["acme", "Note", 50, 0]);
  });

  it("pushes like and not_like into SQL, including the patterns that match nothing", async () => {
    const d1 = store();
    seedRows(d1, [documentRow({ name: "D1 Launch", data: { title: "Launch Plan" } })]);
    const storeUnder = new D1ProjectionStore(d1.database);
    const compile = async (operator: "like" | "not_like", value: string) => {
      await storeUnder.list({
        tenantId: "acme",
        doctype: "Note",
        predicate: filterPredicate([{ field: "title", operator, value }])
      });
      // Each list issues the rows statement, then the count statement.
      return d1.statements.at(-2)!;
    };

    const like = await compile("like", "launch%");
    expect(like.sql).toContain("json_extract(data_json, '$.title') GLOB ?");
    expect(like.sql).not.toContain("launch%");
    expect(like.params).toEqual(["acme", "Note", "[Ll][Aa][Uu][Nn][Cc][Hh]*", 50, 0]);

    // `not_like` carries its own presence check: in memory a missing or JSON
    // null field fails the match and the row drops, while `(NULL GLOB ?) IS NOT
    // 1` is true and would keep it.
    const notLike = await compile("not_like", "%launch%");
    expect(notLike.sql).toContain(
      "json_extract(data_json, '$.title') IS NOT NULL AND (json_extract(data_json, '$.title') GLOB ?) IS NOT 1"
    );
    expect(notLike.params).toEqual(["acme", "Note", "*[Ll][Aa][Uu][Nn][Cc][Hh]*", 50, 0]);

    // A trailing lone `\\` escapes nothing and can never match. GLOB has no way
    // to say that, so the condition degrades to a false one — and the negated
    // operator keeps exactly the rows whose field is present instead.
    const neverLike = await compile("like", "launch plan\\");
    expect(neverLike.sql).toContain("AND (0 = 1)");
    expect(neverLike.params).toEqual(["acme", "Note", 50, 0]);

    const neverNotLike = await compile("not_like", "launch plan\\");
    expect(neverNotLike.sql).toContain("AND (json_extract(data_json, '$.title') IS NOT NULL)");
    expect(neverNotLike.sql).not.toContain("0 = 1");
    expect(neverNotLike.params).toEqual(["acme", "Note", 50, 0]);
  });

  it("orders rows by escaped JSON fields with deterministic fallbacks", async () => {
    const d1 = store();
    seedRows(d1, [
      documentRow({ name: "D1 High", data: { title: "apple", count: 5 } }),
      documentRow({ name: "D1 Missing", data: { title: "missing" } }),
      documentRow({ name: "D1 Low", data: { title: "Zebra", count: 1 } }),
      documentRow({ name: "a", data: { title: "same", count: 9 } }),
      documentRow({ name: "B", data: { title: "same", count: 9 } })
    ]);
    const storeUnder = new D1ProjectionStore(d1.database);

    const result = await storeUnder.list({
      tenantId: "acme",
      doctype: "Note",
      orderBy: "count",
      order: "asc"
    });

    expect(result.data.map((document) => document.name)).toEqual(["D1 Low", "D1 High", "B", "a", "D1 Missing"]);
    const [rows] = d1.statements;
    expect(rows?.sql).toContain(
      "ORDER BY json_extract(data_json, '$.count') IS NULL ASC, json_extract(data_json, '$.count') COLLATE BINARY ASC, updated_at COLLATE BINARY DESC, name COLLATE BINARY ASC"
    );
    expect(rows?.params).toEqual(["acme", "Note", 50, 0]);

    const textResult = await storeUnder.list({
      tenantId: "acme",
      doctype: "Note",
      orderBy: "title",
      order: "asc"
    });

    expect(textResult.data.map((document) => document.name)).toEqual(["D1 Low", "D1 High", "D1 Missing", "B", "a"]);
    const titleRows = d1.statements[2];
    expect(titleRows?.sql).toContain(
      "ORDER BY json_extract(data_json, '$.title') IS NULL ASC, json_extract(data_json, '$.title') COLLATE BINARY ASC, updated_at COLLATE BINARY DESC, name COLLATE BINARY ASC"
    );

    await storeUnder.list({
      tenantId: "acme",
      doctype: "Note",
      orderBy: "name",
      order: "asc"
    });
    const nameRows = d1.statements[4];
    expect(nameRows?.sql).toContain(
      "ORDER BY name COLLATE BINARY ASC, updated_at COLLATE BINARY DESC"
    );
  });

  it("orders rows by system updatedAt without JSON path extraction", async () => {
    const d1 = store();
    seedRows(d1, [
      documentRow({
        name: "D1 Old",
        updatedAt: "2026-01-01T00:00:00.000Z",
        data: { title: "old" }
      }),
      documentRow({
        name: "D1 New",
        updatedAt: "2026-01-03T00:00:00.000Z",
        data: { title: "new" }
      })
    ]);
    const storeUnder = new D1ProjectionStore(d1.database);

    const result = await storeUnder.list({
      tenantId: "acme",
      doctype: "Note",
      orderBy: "updatedAt",
      order: "desc"
    });

    expect(result.data.map((document) => document.name)).toEqual(["D1 New", "D1 Old"]);
    const [rows] = d1.statements;
    expect(rows?.sql).toContain("ORDER BY updated_at COLLATE BINARY DESC");
    expect(rows?.sql).not.toContain("json_extract(data_json, '$.updatedAt')");
    expect(rows?.params).toEqual(["acme", "Note", 50, 0]);
  });

  it("applies advanced scalar operators to D1 rows and counts", async () => {
    const d1 = store();
    seedRows(d1, [
      documentRow({ name: "D1 Match", data: { title: "D1 Match", priority: "High", count: 5 } }),
      documentRow({ name: "D1 Low", data: { title: "D1 Low", priority: "Low", count: 5 } }),
      documentRow({ name: "D1 Boundary Low", data: { title: "D1 Boundary Low", priority: "High", count: 2 } }),
      documentRow({ name: "D1 Boundary High", data: { title: "D1 Boundary High", priority: "High", count: 9 } }),
      documentRow({ name: "D1 Missing Priority", data: { title: "D1 Missing Priority", count: 5 } }),
      documentRow({ name: "D1 Null Count", data: { title: "D1 Null Count", priority: "High", count: null } })
    ]);
    const storeUnder = new D1ProjectionStore(d1.database);

    const result = await storeUnder.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([
        { field: "priority", operator: "ne", value: "Low" },
        { field: "count", operator: "gt", value: 2 },
        { field: "count", operator: "lt", value: 9 }
      ])
    });

    expect(result).toMatchObject({ data: [{ name: "D1 Match" }], total: 1 });
  });

  it("escapes filter fields embedded in JSON path SQL literals", async () => {
    const d1 = store();
    seedRows(d1, [
      documentRow({ name: "D1 High", data: { title: "D1 High", priority: "High" } })
    ]);
    const storeUnder = new D1ProjectionStore(d1.database);

    await storeUnder.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "priority') OR 1=1 --", value: "High" }])
    });

    const [rows, count] = d1.statements;
    expect(rows?.sql).toContain("json_extract(data_json, '$.priority'') OR 1=1 --') = ?");
    expect(rows?.sql).not.toContain("priority') OR 1=1 --') = ?");
    expect(rows?.params).toEqual(["acme", "Note", "High", 50, 0]);
    expect(count?.sql).toContain("json_extract(data_json, '$.priority'') OR 1=1 --') = ?");
    expect(count?.params).toEqual(["acme", "Note", "High"]);
  });
});

function store(): TestD1 {
  return createTestD1({ schema: frameworkSchema() });
}

function filterPredicate(
  input: ListFilterExpression | readonly ListDocumentsFilter[]
): PredicateExpression {
  const expression: ListFilterExpression = Array.isArray(input)
    ? { kind: "group", match: "all", filters: input as readonly ListDocumentsFilter[] }
    : input as ListFilterExpression;
  return predicateExpressionFromListFilterExpression(expression);
}

interface ProjectionRow {
  readonly tenant_id: string;
  readonly doctype: string;
  readonly name: string;
  readonly version: number;
  readonly docstatus: "draft" | "submitted" | "cancelled" | "deleted";
  readonly data_json: string;
  readonly created_at: string;
  readonly updated_at: string;
}

function documentSnapshot(input: {
  readonly name: string;
  readonly data: DocumentData;
  readonly version?: number;
  readonly docstatus?: "draft" | "submitted" | "cancelled" | "deleted";
  readonly createdAt?: string;
  readonly updatedAt?: string;
}): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Note",
    name: input.name,
    version: input.version ?? 1,
    docstatus: input.docstatus ?? "draft",
    data: input.data,
    createdAt: input.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: input.updatedAt ?? "2026-01-01T00:00:00.000Z"
  };
}

function rowFromSnapshot(snapshot: DocumentSnapshot): ProjectionRow {
  return {
    tenant_id: snapshot.tenantId,
    doctype: snapshot.doctype,
    name: snapshot.name,
    version: snapshot.version,
    docstatus: snapshot.docstatus,
    data_json: JSON.stringify(snapshot.data),
    created_at: snapshot.createdAt,
    updated_at: snapshot.updatedAt
  };
}

function documentRow(input: {
  readonly name: string;
  readonly data: DocumentData;
  readonly version?: number;
  readonly docstatus?: "draft" | "submitted" | "cancelled" | "deleted";
  readonly createdAt?: string;
  readonly updatedAt?: string;
}): ProjectionRow {
  return rowFromSnapshot(documentSnapshot(input));
}

/**
 * Inserts fixture rows with the exact column values given, bypassing the
 * store's own save path.
 *
 * The hand-written fake these replace kept the rows in an array and decided
 * with ~150 lines of hand-parsed predicate logic which ones a query "should"
 * return — it could not tell a wrong WHERE clause from an unfamiliar one. Here
 * SQLite evaluates whatever the store compiles; `list` still issues the rows
 * statement and then the count statement, in that order, so `d1.statements[N]`
 * indexing below mirrors one `list` call per two entries.
 */
function seedRows(d1: TestD1, rows: readonly ProjectionRow[]): void {
  for (const row of rows) {
    d1.query(
      `INSERT OR REPLACE INTO cf_frappe_documents
         (tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      row.tenant_id,
      row.doctype,
      row.name,
      row.version,
      row.docstatus,
      row.data_json,
      row.created_at,
      row.updated_at
    );
  }
}

function rowCount(d1: TestD1): number {
  const [row] = d1.query("SELECT COUNT(*) AS n FROM cf_frappe_documents");
  return Number(row?.n);
}

/**
 * Sorted projection names, for lists whose fixtures tie on the default order
 * key (updated_at) with no further tie-breaker in the ORDER BY: which of the
 * tied rows comes first is the engine's to choose, so only the set — not the
 * order — is a contract. Lists whose rows differ on the order key are pinned
 * exactly instead (see the membership test).
 */
function names(result: { readonly data: readonly { readonly name: string }[] }): readonly string[] {
  return result.data.map((document) => document.name).sort();
}
