import { D1ProjectionStore } from "../../src";
import type { DocumentData } from "../../src";

describe("D1ProjectionStore", () => {
  it("lists projections with bound filter parameters for rows and counts", async () => {
    const db = new FakeD1Database([
      documentRow({ name: "D1 High", data: { title: "D1 High", priority: "High" } }),
      documentRow({ name: "D1 Low", data: { title: "D1 Low", priority: "Low" } })
    ]);
    const store = new D1ProjectionStore(db as unknown as D1Database);

    const result = await store.list({
      tenantId: "acme",
      doctype: "Note",
      filters: [{ field: "priority", value: "High" }]
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

  it("escapes contains filter values before binding LIKE parameters", async () => {
    const db = new FakeD1Database([
      documentRow({ name: "D1 Sale", data: { title: "50%_Off", priority: "High" } })
    ]);
    const store = new D1ProjectionStore(db as unknown as D1Database);

    await store.list({
      tenantId: "acme",
      doctype: "Note",
      filters: [{ field: "title", operator: "contains", value: "50%_Off" }]
    });

    const [rows, count] = db.statements;
    expect(rows?.sql).toContain("LIKE ? ESCAPE '\\'");
    expect(rows?.sql).not.toContain("50%_Off");
    expect(rows?.params).toEqual(["acme", "Note", "%50\\%\\_off%", 50, 0]);
    expect(count?.sql).toContain("LIKE ? ESCAPE '\\'");
    expect(count?.params).toEqual(["acme", "Note", "%50\\%\\_off%"]);
  });

  it("renders advanced scalar operators with bound filter parameters", async () => {
    const db = new FakeD1Database([
      documentRow({ name: "D1 High", data: { title: "D1 High", priority: "High", count: 5 } })
    ]);
    const store = new D1ProjectionStore(db as unknown as D1Database);

    await store.list({
      tenantId: "acme",
      doctype: "Note",
      filters: [
        { field: "priority", operator: "ne", value: "Low" },
        { field: "count", operator: "gt", value: 2 },
        { field: "count", operator: "lt", value: 9 }
      ]
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
      filters: [{ field: "priority", operator: "in", value: ["High", "Medium"] }]
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
      filters: [{ field: "priority", operator: "not_in", value: ["Low", "Medium"] }]
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
      filterExpression: {
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
      }
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
      filters: [
        { field: "system.docstatus", value: "submitted" },
        { field: "system.updatedAt", operator: "gte", value: "2026-01-04T00:00:00.000Z" },
        { field: "system.version", operator: "gt", value: 1 }
      ]
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
      filters: [{ field: "count", operator: "between", value: [2, 8] }]
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
      filters: [{ field: "count", operator: "not_between", value: [2, 8] }]
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
      filters: [{ field: "body", operator: "is", value: "not set" }]
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
      filters: [{ field: "body", operator: "is", value: "set" }]
    });

    expect(set.data.map((document) => document.name)).toEqual(["D1 Body", "D1 Empty Body"]);
    expect(set.total).toBe(2);
    expect(setDb.statements[0]?.sql).toContain("json_extract(data_json, '$.body') IS NOT NULL");
    expect(setDb.statements[0]?.sql).not.toContain("set");
    expect(setDb.statements[0]?.params).toEqual(["acme", "Note", 50, 0]);
  });

  it("renders pattern operators with bound LIKE parameters", async () => {
    const db = new FakeD1Database([
      documentRow({ name: "D1 Launch", data: { title: "Launch Plan" } }),
      documentRow({ name: "D1 Launchpad", data: { title: "Launchpad" } }),
      documentRow({ name: "D1 Routine", data: { title: "Routine Check" } })
    ]);
    const store = new D1ProjectionStore(db as unknown as D1Database);

    const like = await store.list({
      tenantId: "acme",
      doctype: "Note",
      filters: [{ field: "title", operator: "like", value: "launch%" }]
    });

    expect(like.data.map((document) => document.name)).toEqual(["D1 Launch", "D1 Launchpad"]);
    expect(like.total).toBe(2);
    const [rows, count] = db.statements;
    expect(rows?.sql).toContain("LOWER(CAST(json_extract(data_json, '$.title') AS TEXT)) LIKE ? ESCAPE '\\'");
    expect(rows?.sql).not.toContain("launch%");
    expect(rows?.params).toEqual(["acme", "Note", "launch%", 50, 0]);
    expect(count?.params).toEqual(["acme", "Note", "launch%"]);

    const notLikeDb = new FakeD1Database(db.rows);
    const notLikeStore = new D1ProjectionStore(notLikeDb as unknown as D1Database);
    const notLike = await notLikeStore.list({
      tenantId: "acme",
      doctype: "Note",
      filters: [{ field: "title", operator: "not_like", value: "%launch%" }]
    });

    expect(notLike.data.map((document) => document.name)).toEqual(["D1 Routine"]);
    expect(notLike.total).toBe(1);
    expect(notLikeDb.statements[0]?.sql).toContain(
      "json_extract(data_json, '$.title') IS NOT NULL AND LOWER(CAST(json_extract(data_json, '$.title') AS TEXT)) NOT LIKE ? ESCAPE '\\'"
    );
    expect(notLikeDb.statements[0]?.sql).not.toContain("%launch%");
    expect(notLikeDb.statements[0]?.params).toEqual(["acme", "Note", "%launch%", 50, 0]);

    const escapedDb = new FakeD1Database(db.rows);
    const escapedStore = new D1ProjectionStore(escapedDb as unknown as D1Database);
    const escaped = await escapedStore.list({
      tenantId: "acme",
      doctype: "Note",
      filters: [{ field: "title", operator: "like", value: "\\l%" }]
    });

    expect(escaped.data.map((document) => document.name)).toEqual(["D1 Launch", "D1 Launchpad"]);
    expect(escapedDb.statements[0]?.params).toEqual(["acme", "Note", "\\l%", 50, 0]);

    const trailingEscapeDb = new FakeD1Database(db.rows);
    const trailingEscapeStore = new D1ProjectionStore(trailingEscapeDb as unknown as D1Database);
    const trailingEscape = await trailingEscapeStore.list({
      tenantId: "acme",
      doctype: "Note",
      filters: [{ field: "title", operator: "like", value: "launch plan\\" }]
    });

    expect(trailingEscape).toMatchObject({ data: [], total: 0 });
    expect(trailingEscapeDb.statements[0]?.params).toEqual(["acme", "Note", "launch plan\\", 50, 0]);
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
      filters: [
        { field: "priority", operator: "ne", value: "Low" },
        { field: "count", operator: "gt", value: 2 },
        { field: "count", operator: "lt", value: 9 }
      ]
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
      filters: [{ field: "priority') OR 1=1 --", value: "High" }]
    });

    const [rows, count] = db.statements;
    expect(rows?.sql).toContain("json_extract(data_json, '$.priority'') OR 1=1 --') = ?");
    expect(rows?.sql).not.toContain("priority') OR 1=1 --') = ?");
    expect(rows?.params).toEqual(["acme", "Note", "High", 50, 0]);
    expect(count?.sql).toContain("json_extract(data_json, '$.priority'') OR 1=1 --') = ?");
    expect(count?.params).toEqual(["acme", "Note", "High"]);
  });
});

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

function documentRow(input: {
  readonly name: string;
  readonly data: DocumentData;
  readonly version?: number;
  readonly docstatus?: "draft" | "submitted" | "cancelled" | "deleted";
  readonly createdAt?: string;
  readonly updatedAt?: string;
}): FakeDocumentRow {
  return {
    tenant_id: "acme",
    doctype: "Note",
    name: input.name,
    version: input.version ?? 1,
    docstatus: input.docstatus ?? "draft",
    data_json: JSON.stringify(input.data),
    created_at: input.createdAt ?? "2026-01-01T00:00:00.000Z",
    updated_at: input.updatedAt ?? "2026-01-01T00:00:00.000Z"
  };
}

class FakeD1Database {
  readonly statements: FakeD1PreparedStatement[] = [];

  constructor(readonly rows: readonly FakeDocumentRow[]) {}

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
      if (this.sql.includes("LOWER(CAST(json_extract(data_json, '$.title') AS TEXT)) LIKE ? ESCAPE")) {
        if (!matchesSqlLikePattern(data.title, filterParams[paramIndex])) {
          return false;
        }
        paramIndex += 1;
      }
      if (this.sql.includes("LOWER(CAST(json_extract(data_json, '$.title') AS TEXT)) NOT LIKE ? ESCAPE")) {
        if (data.title === undefined || data.title === null || matchesSqlLikePattern(data.title, filterParams[paramIndex])) {
          return false;
        }
        paramIndex += 1;
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

function matchesSqlLikePattern(actual: unknown, pattern: unknown): boolean {
  if (actual === undefined || actual === null || typeof pattern !== "string") {
    return false;
  }
  return new RegExp(`^${sqlLikePatternRegex(pattern)}$`, "i").test(String(actual));
}

function sqlLikePatternRegex(pattern: string): string {
  let regex = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "\\") {
      const next = pattern[index + 1];
      if (next === undefined) {
        regex += "(?!)";
        continue;
      }
      regex += escapeRegex(next);
      index += 1;
      continue;
    }
    if (char === "%") {
      regex += "[\\s\\S]*";
      continue;
    }
    if (char === "_") {
      regex += "[\\s\\S]";
      continue;
    }
    regex += escapeRegex(char ?? "");
  }
  return regex;
}

function escapeRegex(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
