import {
  D1_PROJECTION_MAX_POST_FILTER_ROWS,
  D1ProjectionStore,
  InMemoryProjectionStore,
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
    const db = new FakeD1Database([
      documentRow({ name: "D1 High", data: { title: "D1 High", priority: "High" } }),
      documentRow({ name: "D1 Low", data: { title: "D1 Low", priority: "Low" } })
    ]);
    const store = new D1ProjectionStore(db as unknown as D1Database);

    const result = await store.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "priority", value: "High" }])
    });

    expect(result).toMatchObject({ data: [{ name: "D1 High" }], total: 1 });
    const [rows, count] = db.statements;
    expect(rows?.sql).toContain("json_extract(data_json, '$.priority') = ?");
    expect(rows?.sql).not.toContain("High");
    expect(rows?.params).toEqual(["acme", "Note", "High", 50, 0]);
    expect(count?.sql).toContain("json_extract(data_json, '$.priority') = ?");
    expect(count?.sql).not.toContain("High");
    expect(count?.params).toEqual(["acme", "Note", "High"]);
  });

  it("rejects invalid stored D1 projection JSON rows", async () => {
    const db = new FakeD1Database([
      { ...documentRow({ name: "D1 Bad", data: { title: "D1 Bad" } }), data_json: "[" }
    ]);
    const store = new D1ProjectionStore(db as unknown as D1Database);

    await expect(store.get("acme", "Note", "D1 Bad")).rejects.toMatchObject({
      code: "D1_DOCUMENT_INVALID",
      status: 409
    });
  });

  it("rejects stored D1 projection rows with non-finite JSON numbers", async () => {
    const db = new FakeD1Database([
      { ...documentRow({ name: "D1 Infinite", data: { title: "D1 Infinite" } }), data_json: '{"count":1e999}' }
    ]);
    const store = new D1ProjectionStore(db as unknown as D1Database);

    await expect(store.get("acme", "Note", "D1 Infinite")).rejects.toMatchObject({
      code: "D1_DOCUMENT_INVALID",
      status: 409
    });
  });

  it("rejects non-JSON D1 projection data before writing rows", async () => {
    const db = new FakeD1Database([]);
    const store = new D1ProjectionStore(db as unknown as D1Database);

    await expect(
      store.save({
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
    expect(db.rows).toEqual([]);
  });

  it("snapshots D1 projections by value on save, get, and list", async () => {
    const db = new FakeD1Database([]);
    const store = new D1ProjectionStore(db as unknown as D1Database);
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

    await store.save(snapshot);
    (snapshot.data.nested as DocumentData).count = 2;

    const saved = await store.get("acme", "Note", "D1 Snapshot");
    expect(saved).toMatchObject({ data: { title: "One", nested: { count: 1 } } });

    (saved!.data.nested as DocumentData).count = 3;
    await expect(store.get("acme", "Note", "D1 Snapshot")).resolves.toMatchObject({
      data: { title: "One", nested: { count: 1 } }
    });

    const listed = await store.list({ tenantId: "acme", doctype: "Note" });
    (listed.data[0]!.data.nested as DocumentData).count = 4;
    await expect(store.get("acme", "Note", "D1 Snapshot")).resolves.toMatchObject({
      data: { title: "One", nested: { count: 1 } }
    });
  });

  it("post-filters contains without sending text matcher values to SQLite", async () => {
    const db = new FakeD1Database([
      documentRow({ name: "D1 Sale", data: { title: "50%_Off", priority: "High" } })
    ]);
    const store = new D1ProjectionStore(db as unknown as D1Database);

    const result = await store.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "title", operator: "contains", value: "50%_Off" }])
    });

    expect(result).toMatchObject({ data: [{ name: "D1 Sale" }], total: 1 });
    const [rows] = db.statements;
    expect(rows?.sql).not.toContain("LOWER(");
    expect(rows?.sql).not.toContain("LIKE");
    expect(rows?.sql).not.toContain("50%_Off");
    expect(rows?.params).toEqual(["acme", "Note", D1_PROJECTION_MAX_POST_FILTER_ROWS + 1]);
  });

  it("renders advanced scalar operators with bound filter parameters", async () => {
    const db = new FakeD1Database([
      documentRow({ name: "D1 High", data: { title: "D1 High", priority: "High", count: 5 } })
    ]);
    const store = new D1ProjectionStore(db as unknown as D1Database);

    await store.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([
        { field: "priority", operator: "ne", value: "Low" },
        { field: "count", operator: "gt", value: 2 },
        { field: "count", operator: "lt", value: 9 }
      ])
    });

    const [rows, count] = db.statements;
    expect(rows?.sql).toContain("json_extract(data_json, '$.priority') IS NOT NULL AND json_extract(data_json, '$.priority') != ?");
    expect(rows?.sql).toContain("json_extract(data_json, '$.count') > ?");
    expect(rows?.sql).toContain("json_extract(data_json, '$.count') < ?");
    expect(rows?.params).toEqual(["acme", "Note", "Low", 2, 9, 50, 0]);
    expect(count?.params).toEqual(["acme", "Note", "Low", 2, 9]);
  });

  it("renders membership operators with bound filter parameters", async () => {
    const db = new FakeD1Database([
      documentRow({ name: "D1 High", data: { title: "D1 High", priority: "High" } }),
      documentRow({ name: "D1 Medium", data: { title: "D1 Medium", priority: "Medium" } }),
      documentRow({ name: "D1 Low", data: { title: "D1 Low", priority: "Low" } })
    ]);
    const store = new D1ProjectionStore(db as unknown as D1Database);

    const result = await store.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "priority", operator: "in", value: ["High", "Medium"] }])
    });

    expect(result).toMatchObject({ data: [{ name: "D1 High" }, { name: "D1 Medium" }], total: 2 });
    const [rows, count] = db.statements;
    expect(rows?.sql).toContain("json_extract(data_json, '$.priority') IN (?, ?)");
    expect(rows?.sql).not.toContain("High");
    expect(rows?.params).toEqual(["acme", "Note", "High", "Medium", 50, 0]);
    expect(count?.sql).toContain("json_extract(data_json, '$.priority') IN (?, ?)");
    expect(count?.params).toEqual(["acme", "Note", "High", "Medium"]);

    const notInDb = new FakeD1Database(db.rows);
    const notInStore = new D1ProjectionStore(notInDb as unknown as D1Database);
    const notInResult = await notInStore.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "priority", operator: "not_in", value: ["Low", "Medium"] }])
    });

    expect(notInResult).toMatchObject({ data: [{ name: "D1 High" }], total: 1 });
    expect(notInDb.statements[0]?.sql).toContain(
      "json_extract(data_json, '$.priority') IS NOT NULL AND json_extract(data_json, '$.priority') NOT IN (?, ?)"
    );
    expect(notInDb.statements[0]?.params).toEqual(["acme", "Note", "Low", "Medium", 50, 0]);
  });

  it("renders nested compound filter expressions with bound parameters", async () => {
    const db = new FakeD1Database([
      documentRow({ name: "D1 High", data: { title: "D1 High", priority: "High", count: 10 } }),
      documentRow({ name: "D1 Count", data: { title: "D1 Count", priority: "Low", count: 3 } }),
      documentRow({ name: "D1 Miss", data: { title: "D1 Miss", priority: "Low", count: 9 } })
    ]);
    const store = new D1ProjectionStore(db as unknown as D1Database);

    const result = await store.list({
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

    expect(result).toMatchObject({ data: [{ name: "D1 High" }, { name: "D1 Count" }], total: 2 });
    const [rows, count] = db.statements;
    expect(rows?.sql).toContain(
      "(json_extract(data_json, '$.priority') = ? OR (json_extract(data_json, '$.count') >= ? AND json_extract(data_json, '$.count') <= ?))"
    );
    expect(rows?.params).toEqual(["acme", "Note", "High", 2, 4, 50, 0]);
    expect(count?.params).toEqual(["acme", "Note", "High", 2, 4]);
  });

  it("filters system projection fields with bound parameters", async () => {
    const db = new FakeD1Database([
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
    const store = new D1ProjectionStore(db as unknown as D1Database);

    const result = await store.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([
        { field: "system.docstatus", value: "submitted" },
        { field: "system.updatedAt", operator: "gte", value: "2026-01-04T00:00:00.000Z" },
        { field: "system.version", operator: "gt", value: 1 }
      ])
    });

    expect(result).toMatchObject({ data: [{ name: "D1 Submitted" }], total: 1 });
    const [rows, count] = db.statements;
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
    const db = new FakeD1Database([
      documentRow({ name: "D1 Low", data: { title: "low", count: 1 } }),
      documentRow({ name: "D1 Mid", data: { title: "mid", count: 5 } }),
      documentRow({ name: "D1 High", data: { title: "high", count: 9 } }),
      documentRow({ name: "D1 Missing", data: { title: "missing" } }),
      documentRow({ name: "D1 Null", data: { title: "null", count: null } })
    ]);
    const store = new D1ProjectionStore(db as unknown as D1Database);

    const result = await store.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "count", operator: "between", value: [2, 8] }])
    });

    expect(result).toMatchObject({ data: [{ name: "D1 Mid" }], total: 1 });
    const [rows, count] = db.statements;
    expect(rows?.sql).toContain("(json_extract(data_json, '$.count') >= ? AND json_extract(data_json, '$.count') <= ?)");
    expect(rows?.sql).not.toContain("2");
    expect(rows?.sql).not.toContain("8");
    expect(rows?.params).toEqual(["acme", "Note", 2, 8, 50, 0]);
    expect(count?.params).toEqual(["acme", "Note", 2, 8]);

    const notBetweenDb = new FakeD1Database(db.rows);
    const notBetweenStore = new D1ProjectionStore(notBetweenDb as unknown as D1Database);
    const notBetween = await notBetweenStore.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "count", operator: "not_between", value: [2, 8] }])
    });

    expect(notBetween.data.map((document) => document.name)).toEqual(["D1 Low", "D1 High"]);
    expect(notBetween.total).toBe(2);
    expect(notBetweenDb.statements[0]?.sql).toContain(
      "json_extract(data_json, '$.count') IS NOT NULL AND (json_extract(data_json, '$.count') < ? OR json_extract(data_json, '$.count') > ?)"
    );
    expect(notBetweenDb.statements[0]?.sql).not.toContain("D1 Missing");
    expect(notBetweenDb.statements[0]?.params).toEqual(["acme", "Note", 2, 8, 50, 0]);
    expect(notBetweenDb.statements[1]?.params).toEqual(["acme", "Note", 2, 8]);
  });

  it("renders presence operators without binding filter values", async () => {
    const db = new FakeD1Database([
      documentRow({ name: "D1 Body", data: { title: "body", body: "Body" } }),
      documentRow({ name: "D1 Empty Body", data: { title: "empty", body: "" } }),
      documentRow({ name: "D1 Null Body", data: { title: "null", body: null } }),
      documentRow({ name: "D1 Missing Body", data: { title: "missing" } })
    ]);
    const store = new D1ProjectionStore(db as unknown as D1Database);

    const missing = await store.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "body", operator: "is", value: "not set" }])
    });

    expect(missing.data.map((document) => document.name)).toEqual(["D1 Null Body", "D1 Missing Body"]);
    expect(missing.total).toBe(2);
    const [rows, count] = db.statements;
    expect(rows?.sql).toContain("json_extract(data_json, '$.body') IS NULL");
    expect(rows?.sql).not.toContain("not set");
    expect(rows?.params).toEqual(["acme", "Note", 50, 0]);
    expect(count?.params).toEqual(["acme", "Note"]);

    const setDb = new FakeD1Database(db.rows);
    const setStore = new D1ProjectionStore(setDb as unknown as D1Database);
    const set = await setStore.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "body", operator: "is", value: "set" }])
    });

    expect(set.data.map((document) => document.name)).toEqual(["D1 Body", "D1 Empty Body"]);
    expect(set.total).toBe(2);
    expect(setDb.statements[0]?.sql).toContain("json_extract(data_json, '$.body') IS NOT NULL");
    expect(setDb.statements[0]?.sql).not.toContain("set");
    expect(setDb.statements[0]?.params).toEqual(["acme", "Note", 50, 0]);
  });

  it("post-filters pattern operators through the shared Predicate evaluator", async () => {
    const db = new FakeD1Database([
      documentRow({ name: "D1 Launch", data: { title: "Launch Plan" } }),
      documentRow({ name: "D1 Launchpad", data: { title: "Launchpad" } }),
      documentRow({ name: "D1 Routine", data: { title: "Routine Check" } })
    ]);
    const store = new D1ProjectionStore(db as unknown as D1Database);

    const like = await store.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "title", operator: "like", value: "launch%" }])
    });

    expect(like.data.map((document) => document.name)).toEqual(["D1 Launch", "D1 Launchpad"]);
    expect(like.total).toBe(2);
    const [rows] = db.statements;
    expect(rows?.sql).not.toContain("LOWER(");
    expect(rows?.sql).not.toContain("LIKE");
    expect(rows?.sql).not.toContain("launch%");
    expect(rows?.params).toEqual(["acme", "Note", D1_PROJECTION_MAX_POST_FILTER_ROWS + 1]);

    const notLikeDb = new FakeD1Database(db.rows);
    const notLikeStore = new D1ProjectionStore(notLikeDb as unknown as D1Database);
    const notLike = await notLikeStore.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "title", operator: "not_like", value: "%launch%" }])
    });

    expect(notLike.data.map((document) => document.name)).toEqual(["D1 Routine"]);
    expect(notLike.total).toBe(1);
    expect(notLikeDb.statements[0]?.sql).not.toContain("LOWER(");
    expect(notLikeDb.statements[0]?.sql).not.toContain("LIKE");
    expect(notLikeDb.statements[0]?.sql).not.toContain("%launch%");
    expect(notLikeDb.statements[0]?.params).toEqual([
      "acme",
      "Note",
      D1_PROJECTION_MAX_POST_FILTER_ROWS + 1
    ]);

    const escapedDb = new FakeD1Database(db.rows);
    const escapedStore = new D1ProjectionStore(escapedDb as unknown as D1Database);
    const escaped = await escapedStore.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "title", operator: "like", value: "\\l%" }])
    });

    expect(escaped.data.map((document) => document.name)).toEqual(["D1 Launch", "D1 Launchpad"]);
    expect(escapedDb.statements[0]?.params).toEqual([
      "acme",
      "Note",
      D1_PROJECTION_MAX_POST_FILTER_ROWS + 1
    ]);

    const trailingEscapeDb = new FakeD1Database(db.rows);
    const trailingEscapeStore = new D1ProjectionStore(trailingEscapeDb as unknown as D1Database);
    const trailingEscape = await trailingEscapeStore.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "title", operator: "like", value: "launch plan\\" }])
    });

    expect(trailingEscape).toMatchObject({ data: [], total: 0 });
    expect(trailingEscapeDb.statements[0]?.params).toEqual([
      "acme",
      "Note",
      D1_PROJECTION_MAX_POST_FILTER_ROWS + 1
    ]);
  });

  it("matches in-memory Unicode case folding, wildcards, escaping, and negation", async () => {
    const snapshots = [
      documentSnapshot({ name: "D1 Umlaut", data: { title: "Ärger", priority: "Low" } }),
      documentSnapshot({ name: "D1 Literal", data: { title: "Value 100% Ready", priority: "Low" } }),
      documentSnapshot({ name: "D1 Routine", data: { title: "Routine", priority: "High" } }),
      documentSnapshot({ name: "D1 Null", data: { title: null, priority: "Low" } }),
      documentSnapshot({ name: "D1 Missing", data: { priority: "Low" } })
    ];
    const db = new FakeD1Database(snapshots.map(rowFromSnapshot));
    const d1 = new D1ProjectionStore(db as unknown as D1Database);
    const memory = new InMemoryProjectionStore();
    for (const snapshot of snapshots) {
      await memory.save(snapshot);
    }

    const cases: ReadonlyArray<readonly [PredicateExpression, readonly string[]]> = [
      [filterPredicate([{ field: "title", operator: "contains", value: "ä" }]), ["D1 Umlaut"]],
      [filterPredicate([{ field: "title", operator: "like", value: "ä_ger" }]), ["D1 Umlaut"]],
      [filterPredicate([{ field: "title", operator: "like", value: "value 100\\%%" }]), ["D1 Literal"]],
      [filterPredicate([{ field: "title", operator: "not_like", value: "%ä%" }]), ["D1 Literal", "D1 Routine"]],
      [{
        kind: "not",
        predicate: filterPredicate([{ field: "title", value: "Routine" }])
      }, ["D1 Umlaut", "D1 Literal", "D1 Null", "D1 Missing"]],
      [{
        kind: "group",
        match: "any",
        predicates: [
          filterPredicate([{ field: "priority", value: "High" }]),
          filterPredicate([{ field: "title", operator: "like", value: "ä%" }])
        ]
      }, ["D1 Umlaut", "D1 Routine"]]
    ];

    for (const [predicate, expectedNames] of cases) {
      const query = { tenantId: "acme", doctype: "Note", predicate } as const;
      const [d1Result, memoryResult] = await Promise.all([d1.list(query), memory.list(query)]);
      expect(d1Result.data.map((document) => document.name)).toEqual(expectedNames);
      expect(d1Result).toEqual(memoryResult);
    }

    expect(db.statements.every((statement) => !statement.sql.includes("LOWER("))).toBe(true);
    expect(db.statements.every((statement) => !statement.sql.includes("NOT ("))).toBe(true);
  });

  it("bounds shared-evaluator post-filter scans", async () => {
    const db = new FakeD1Database(Array.from(
      { length: D1_PROJECTION_MAX_POST_FILTER_ROWS + 1 },
      (_, index) => documentRow({ name: `D1 ${index}`, data: { title: "Ärger" } })
    ));
    const store = new D1ProjectionStore(db as unknown as D1Database);

    await expect(store.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "title", operator: "contains", value: "ä" }])
    })).rejects.toThrow(`exceeded ${D1_PROJECTION_MAX_POST_FILTER_ROWS} candidate rows`);
    expect(db.statements[0]?.params).toEqual([
      "acme",
      "Note",
      D1_PROJECTION_MAX_POST_FILTER_ROWS + 1
    ]);
  });

  it("orders rows by escaped JSON fields with deterministic fallbacks", async () => {
    const db = new FakeD1Database([
      documentRow({ name: "D1 High", data: { title: "apple", count: 5 } }),
      documentRow({ name: "D1 Missing", data: { title: "missing" } }),
      documentRow({ name: "D1 Low", data: { title: "Zebra", count: 1 } }),
      documentRow({ name: "a", data: { title: "same", count: 9 } }),
      documentRow({ name: "B", data: { title: "same", count: 9 } })
    ]);
    const store = new D1ProjectionStore(db as unknown as D1Database);

    const result = await store.list({
      tenantId: "acme",
      doctype: "Note",
      orderBy: "count",
      order: "asc"
    });

    expect(result.data.map((document) => document.name)).toEqual(["D1 Low", "D1 High", "B", "a", "D1 Missing"]);
    const [rows] = db.statements;
    expect(rows?.sql).toContain(
      "ORDER BY json_extract(data_json, '$.count') IS NULL ASC, json_extract(data_json, '$.count') COLLATE BINARY ASC, updated_at COLLATE BINARY DESC, name COLLATE BINARY ASC"
    );
    expect(rows?.params).toEqual(["acme", "Note", 50, 0]);

    const dbForTextOrder = new FakeD1Database(db.rows);
    const textStore = new D1ProjectionStore(dbForTextOrder as unknown as D1Database);
    const textResult = await textStore.list({
      tenantId: "acme",
      doctype: "Note",
      orderBy: "title",
      order: "asc"
    });

    expect(textResult.data.map((document) => document.name)).toEqual(["D1 Low", "D1 High", "D1 Missing", "B", "a"]);
    expect(dbForTextOrder.statements[0]?.sql).toContain(
      "ORDER BY json_extract(data_json, '$.title') IS NULL ASC, json_extract(data_json, '$.title') COLLATE BINARY ASC, updated_at COLLATE BINARY DESC, name COLLATE BINARY ASC"
    );

    const dbForNameOrder = new FakeD1Database(db.rows);
    const nameStore = new D1ProjectionStore(dbForNameOrder as unknown as D1Database);
    await nameStore.list({
      tenantId: "acme",
      doctype: "Note",
      orderBy: "name",
      order: "asc"
    });
    expect(dbForNameOrder.statements[0]?.sql).toContain(
      "ORDER BY name COLLATE BINARY ASC, updated_at COLLATE BINARY DESC"
    );
  });

  it("orders rows by system updatedAt without JSON path extraction", async () => {
    const db = new FakeD1Database([
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
    const store = new D1ProjectionStore(db as unknown as D1Database);

    const result = await store.list({
      tenantId: "acme",
      doctype: "Note",
      orderBy: "updatedAt",
      order: "desc"
    });

    expect(result.data.map((document) => document.name)).toEqual(["D1 New", "D1 Old"]);
    const [rows] = db.statements;
    expect(rows?.sql).toContain("ORDER BY updated_at COLLATE BINARY DESC");
    expect(rows?.sql).not.toContain("json_extract(data_json, '$.updatedAt')");
    expect(rows?.params).toEqual(["acme", "Note", 50, 0]);
  });

  it("applies advanced scalar operators to D1 rows and counts", async () => {
    const db = new FakeD1Database([
      documentRow({ name: "D1 Match", data: { title: "D1 Match", priority: "High", count: 5 } }),
      documentRow({ name: "D1 Low", data: { title: "D1 Low", priority: "Low", count: 5 } }),
      documentRow({ name: "D1 Boundary Low", data: { title: "D1 Boundary Low", priority: "High", count: 2 } }),
      documentRow({ name: "D1 Boundary High", data: { title: "D1 Boundary High", priority: "High", count: 9 } }),
      documentRow({ name: "D1 Missing Priority", data: { title: "D1 Missing Priority", count: 5 } }),
      documentRow({ name: "D1 Null Count", data: { title: "D1 Null Count", priority: "High", count: null } })
    ]);
    const store = new D1ProjectionStore(db as unknown as D1Database);

    const result = await store.list({
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
    const db = new FakeD1Database([
      documentRow({ name: "D1 High", data: { title: "D1 High", priority: "High" } })
    ]);
    const store = new D1ProjectionStore(db as unknown as D1Database);

    await store.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: filterPredicate([{ field: "priority') OR 1=1 --", value: "High" }])
    });

    const [rows, count] = db.statements;
    expect(rows?.sql).toContain("json_extract(data_json, '$.priority'') OR 1=1 --') = ?");
    expect(rows?.sql).not.toContain("priority') OR 1=1 --') = ?");
    expect(rows?.params).toEqual(["acme", "Note", "High", 50, 0]);
    expect(count?.sql).toContain("json_extract(data_json, '$.priority'') OR 1=1 --') = ?");
    expect(count?.params).toEqual(["acme", "Note", "High"]);
  });
});

function filterPredicate(
  input: ListFilterExpression | readonly ListDocumentsFilter[]
): PredicateExpression {
  const expression: ListFilterExpression = Array.isArray(input)
    ? { kind: "group", match: "all", filters: input as readonly ListDocumentsFilter[] }
    : input as ListFilterExpression;
  return predicateExpressionFromListFilterExpression(expression);
}

interface FakeDocumentRow {
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

function rowFromSnapshot(snapshot: DocumentSnapshot): FakeDocumentRow {
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
}): FakeDocumentRow {
  return rowFromSnapshot(documentSnapshot(input));
}

class FakeD1Database {
  readonly statements: FakeD1PreparedStatement[] = [];
  readonly rows: FakeDocumentRow[];

  constructor(rows: readonly FakeDocumentRow[]) {
    this.rows = [...rows];
  }

  prepare(sql: string): FakeD1PreparedStatement {
    const statement = new FakeD1PreparedStatement(this, sql);
    this.statements.push(statement);
    return statement;
  }

  async batch(statements: readonly FakeD1PreparedStatement[]): Promise<readonly FakeD1Result[]> {
    return Promise.all(statements.map((statement) => statement.all()));
  }
}

interface FakeD1Result {
  readonly results: readonly (FakeDocumentRow | { readonly total: number })[];
}

class FakeD1PreparedStatement {
  params: readonly unknown[] = [];

  constructor(
    private readonly db: FakeD1Database,
    readonly sql: string
  ) {}

  bind(...params: readonly unknown[]): FakeD1PreparedStatement {
    this.params = params;
    return this;
  }

  async first(): Promise<FakeDocumentRow | null> {
    const [tenantId, doctype, name] = this.params;
    return this.db.rows.find((row) => row.tenant_id === tenantId && row.doctype === doctype && row.name === name) ?? null;
  }

  async all(): Promise<FakeD1Result> {
    const filtered = this.applyFilters(this.db.rows);
    if (this.sql.includes("COUNT(*)")) {
      return { results: [{ total: filtered.length }] };
    }
    return { results: this.applyOrdering(filtered) };
  }

  async run(): Promise<{ readonly success: boolean }> {
    const [tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at] = this.params;
    const row: FakeDocumentRow = {
      tenant_id: String(tenant_id),
      doctype: String(doctype),
      name: String(name),
      version: Number(version),
      docstatus: docstatus as FakeDocumentRow["docstatus"],
      data_json: String(data_json),
      created_at: String(created_at),
      updated_at: String(updated_at)
    };
    const index = this.db.rows.findIndex(
      (item) => item.tenant_id === row.tenant_id && item.doctype === row.doctype && item.name === row.name
    );
    if (index >= 0) {
      this.db.rows[index] = row;
    } else {
      this.db.rows.push(row);
    }
    return { success: true };
  }

  private applyFilters(rows: readonly FakeDocumentRow[]): readonly FakeDocumentRow[] {
    const [tenantId, doctype, ...rawFilterParams] = this.params;
    const filterParams = this.sql.includes("LIMIT ? OFFSET ?") ? rawFilterParams.slice(0, -2) : rawFilterParams;
    return rows.filter((row) => {
      if (row.tenant_id !== tenantId || row.doctype !== doctype) {
        return false;
      }
      const data = JSON.parse(row.data_json) as DocumentData;
      if (
        this.sql.includes(
          "(json_extract(data_json, '$.priority') = ? OR (json_extract(data_json, '$.count') >= ? AND json_extract(data_json, '$.count') <= ?))"
        )
      ) {
        return (
          data.priority === filterParams[0] ||
          (compares(data.count, filterParams[1], (actual, expected) => actual >= expected) &&
            compares(data.count, filterParams[2], (actual, expected) => actual <= expected))
        );
      }
      if (this.sql.includes("json_extract(data_json, '$.priority') = ?")) {
        return data.priority === filterParams[0];
      }
      let paramIndex = 0;
      if (this.sql.includes("docstatus = ?")) {
        if (row.docstatus !== filterParams[paramIndex]) {
          return false;
        }
        paramIndex += 1;
      }
      if (this.sql.includes("updated_at >= ?")) {
        if (!(row.updated_at >= String(filterParams[paramIndex]))) {
          return false;
        }
        paramIndex += 1;
      }
      if (this.sql.includes("version > ?")) {
        if (!(row.version > Number(filterParams[paramIndex]))) {
          return false;
        }
        paramIndex += 1;
      }
      if (this.sql.includes("json_extract(data_json, '$.priority') IN (?, ?)")) {
        if (!filterParams.slice(paramIndex, paramIndex + 2).includes(data.priority)) {
          return false;
        }
        paramIndex += 2;
      }
      if (this.sql.includes("json_extract(data_json, '$.priority') IS NOT NULL AND json_extract(data_json, '$.priority') NOT IN (?, ?)")) {
        if (data.priority === undefined || data.priority === null || filterParams.slice(paramIndex, paramIndex + 2).includes(data.priority)) {
          return false;
        }
        paramIndex += 2;
      }
      if (this.sql.includes("json_extract(data_json, '$.priority') IS NOT NULL AND json_extract(data_json, '$.priority') != ?")) {
        if (data.priority === undefined || data.priority === null || data.priority === filterParams[paramIndex]) {
          return false;
        }
        paramIndex += 1;
      }
      if (this.sql.includes("json_extract(data_json, '$.body') IS NOT NULL")) {
        if (data.body === undefined || data.body === null) {
          return false;
        }
      }
      if (this.sql.includes("json_extract(data_json, '$.body') IS NULL")) {
        if (data.body !== undefined && data.body !== null) {
          return false;
        }
      }
      const hasCountNotBetween = this.sql.includes(
        "json_extract(data_json, '$.count') IS NOT NULL AND (json_extract(data_json, '$.count') < ? OR json_extract(data_json, '$.count') > ?)"
      );
      if (hasCountNotBetween) {
        if (
          !compares(data.count, filterParams[paramIndex], (actual, expected) => actual < expected) &&
          !compares(data.count, filterParams[paramIndex + 1], (actual, expected) => actual > expected)
        ) {
          return false;
        }
        paramIndex += 2;
      }
      if (!hasCountNotBetween && this.sql.includes("json_extract(data_json, '$.count') > ?")) {
        if (!compares(data.count, filterParams[paramIndex], (actual, expected) => actual > expected)) {
          return false;
        }
        paramIndex += 1;
      }
      if (this.sql.includes("json_extract(data_json, '$.count') >= ?")) {
        if (!compares(data.count, filterParams[paramIndex], (actual, expected) => actual >= expected)) {
          return false;
        }
        paramIndex += 1;
      }
      if (!hasCountNotBetween && this.sql.includes("json_extract(data_json, '$.count') < ?")) {
        if (!compares(data.count, filterParams[paramIndex], (actual, expected) => actual < expected)) {
          return false;
        }
        paramIndex += 1;
      }
      if (this.sql.includes("json_extract(data_json, '$.count') <= ?")) {
        return compares(data.count, filterParams[paramIndex], (actual, expected) => actual <= expected);
      }
      return true;
    });
  }

  private applyOrdering(rows: readonly FakeDocumentRow[]): readonly FakeDocumentRow[] {
    if (this.sql.includes("json_extract(data_json, '$.count') COLLATE BINARY ASC")) {
      return [...rows].sort((left, right) => {
        const leftData = JSON.parse(left.data_json) as DocumentData;
        const rightData = JSON.parse(right.data_json) as DocumentData;
        const count = Number(leftData.count ?? Number.POSITIVE_INFINITY) - Number(rightData.count ?? Number.POSITIVE_INFINITY);
        if (count !== 0) {
          return count;
        }
        const updated = binaryCompare(right.updated_at, left.updated_at);
        return updated !== 0 ? updated : binaryCompare(left.name, right.name);
      });
    }
    if (this.sql.includes("json_extract(data_json, '$.title') COLLATE BINARY ASC")) {
      return [...rows].sort((left, right) => {
        const leftData = JSON.parse(left.data_json) as DocumentData;
        const rightData = JSON.parse(right.data_json) as DocumentData;
        const title = binaryCompare(String(leftData.title ?? ""), String(rightData.title ?? ""));
        if (title !== 0) {
          return title;
        }
        const updated = binaryCompare(right.updated_at, left.updated_at);
        return updated !== 0 ? updated : binaryCompare(left.name, right.name);
      });
    }
    if (this.sql.includes("ORDER BY updated_at COLLATE BINARY DESC")) {
      return [...rows].sort((left, right) => binaryCompare(right.updated_at, left.updated_at));
    }
    return rows;
  }
}

function binaryCompare(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function compares(
  actual: unknown,
  expected: unknown,
  predicate: (actual: number, expected: number) => boolean
): boolean {
  return typeof actual === "number" && typeof expected === "number" && predicate(actual, expected);
}
