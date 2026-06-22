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
  readonly docstatus: "draft";
  readonly data_json: string;
  readonly created_at: string;
  readonly updated_at: string;
}

function documentRow(input: { readonly name: string; readonly data: DocumentData }): FakeDocumentRow {
  return {
    tenant_id: "acme",
    doctype: "Note",
    name: input.name,
    version: 1,
    docstatus: "draft",
    data_json: JSON.stringify(input.data),
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z"
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

  async all(): Promise<FakeD1Result> {
    const filtered = this.applyFilters(this.db.rows);
    if (this.sql.includes("COUNT(*)")) {
      return { results: [{ total: filtered.length }] };
    }
    return { results: filtered };
  }

  private applyFilters(rows: readonly FakeDocumentRow[]): readonly FakeDocumentRow[] {
    const [tenantId, doctype, ...rawFilterParams] = this.params;
    const filterParams = this.sql.includes("LIMIT ? OFFSET ?") ? rawFilterParams.slice(0, -2) : rawFilterParams;
    return rows.filter((row) => {
      if (row.tenant_id !== tenantId || row.doctype !== doctype) {
        return false;
      }
      const data = JSON.parse(row.data_json) as DocumentData;
      if (this.sql.includes("json_extract(data_json, '$.priority') = ?")) {
        return data.priority === filterParams[0];
      }
      let paramIndex = 0;
      if (this.sql.includes("json_extract(data_json, '$.priority') IS NOT NULL AND json_extract(data_json, '$.priority') != ?")) {
        if (data.priority === undefined || data.priority === null || data.priority === filterParams[paramIndex]) {
          return false;
        }
        paramIndex += 1;
      }
      if (this.sql.includes("json_extract(data_json, '$.count') > ?")) {
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
      if (this.sql.includes("json_extract(data_json, '$.count') < ?")) {
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
}

function compares(
  actual: unknown,
  expected: unknown,
  predicate: (actual: number, expected: number) => boolean
): boolean {
  return typeof actual === "number" && typeof expected === "number" && predicate(actual, expected);
}
