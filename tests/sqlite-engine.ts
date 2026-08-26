import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { planD1Migrations, renderD1Migration } from "../src";
import {
  d1ProjectionCountSql,
  d1ProjectionListQuery,
  d1ProjectionListSql
} from "../src/adapters/d1/projection-query.js";
import type { DocTypeDefinition, DocumentData, JsonPrimitive, ListDocumentsQuery } from "../src";

/**
 * A real SQLite engine loaded with the schema and indexes the framework plans,
 * so index reachability and query plans can be asserted instead of re-probed by
 * hand. `node:sqlite` is not the same build as D1's SQLite, so assert on
 * reachability and correctness — which index is *available* and whether results
 * are right — rather than on cost estimates or choices between close candidates.
 */
export interface ProjectionEngine {
  /** Joined `EXPLAIN QUERY PLAN` details for the list page query. */
  plan(query: ListDocumentsQuery): string;
  /** Document names the list page query returns, in order. */
  names(query: ListDocumentsQuery): readonly string[];
  /** Total the list page reports. */
  total(query: ListDocumentsQuery): number;
  /** True when the plan sorts rather than reading the order from an index. */
  sorts(query: ListDocumentsQuery): boolean;
  insert(rows: readonly ProjectionRow[]): void;
  analyze(): void;
  clearStatistics(): void;
  /** Rows currently recorded in `sqlite_stat1`, empty when never analyzed. */
  statistics(): readonly { readonly index: string; readonly stat: string }[];
  /**
   * A `D1Database`-shaped handle backed by this engine, so a real
   * `D1ProjectionStore` can be exercised against real SQL instead of a
   * hand-written interpreter of a SQL subset.
   */
  asD1Database(): D1Database;
  close(): void;
}

export interface ProjectionRow {
  readonly tenantId?: string;
  readonly doctype: string;
  readonly name: string;
  readonly data: DocumentData;
  readonly updatedAt?: string;
  readonly createdAt?: string;
  readonly docstatus?: string;
}

const CORE_SCHEMA_PATH = new URL("../migrations/0001_cf_frappe_core.sql", import.meta.url);

export function createProjectionEngine(doctypes: readonly DocTypeDefinition[]): ProjectionEngine {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(CORE_SCHEMA_PATH, "utf8"));
  for (const migration of planD1Migrations(doctypes, { includeCore: false })) {
    db.exec(renderD1Migration(migration));
  }

  const insert = db.prepare(
    `INSERT INTO cf_frappe_documents
     (tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?)`
  );

  const bind = (query: ListDocumentsQuery): readonly (string | number | null)[] =>
    d1ProjectionListQuery(query).params.map((param: JsonPrimitive) =>
      typeof param === "boolean" ? (param ? 1 : 0) : param
    );

  return {
    plan(query) {
      const listQuery = d1ProjectionListQuery(query);
      const sql = d1ProjectionListSql(listQuery);
      return db
        .prepare(`EXPLAIN QUERY PLAN ${sql}`)
        .all(...bind(query), listQuery.limit, listQuery.offset)
        .map((row) => String(row.detail))
        .join(" | ");
    },
    sorts(query) {
      return this.plan(query).includes("TEMP B-TREE");
    },
    names(query) {
      const listQuery = d1ProjectionListQuery(query);
      return db
        .prepare(d1ProjectionListSql(listQuery))
        .all(...bind(query), listQuery.limit, listQuery.offset)
        .map((row) => String(row.name));
    },
    total(query) {
      const listQuery = d1ProjectionListQuery(query);
      const row = db.prepare(d1ProjectionCountSql(listQuery)).all(...bind(query))[0];
      return Number(row?.total ?? 0);
    },
    insert(rows) {
      for (const row of rows) {
        insert.run(
          row.tenantId ?? "t1",
          row.doctype,
          row.name,
          row.docstatus ?? "draft",
          JSON.stringify(row.data),
          row.createdAt ?? "2026-01-01T00:00:00.000Z",
          row.updatedAt ?? "2026-01-01T00:00:00.000Z"
        );
      }
    },
    analyze() {
      db.exec("ANALYZE cf_frappe_documents");
    },
    clearStatistics() {
      db.exec("DELETE FROM sqlite_stat1");
    },
    statistics() {
      const present = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_stat1'")
        .all();
      if (present.length === 0) {
        return [];
      }
      return db
        .prepare("SELECT idx, stat FROM sqlite_stat1 WHERE idx IS NOT NULL ORDER BY idx")
        .all()
        .map((row) => ({ index: String(row.idx), stat: String(row.stat) }));
    },
    asD1Database() {
      return createD1Facade(db);
    },
    close() {
      db.close();
    }
  };
}

/** Deterministic rows: `status` cycles over `statusCount`, `priority` over three values. */
export function projectionRows(input: {
  readonly doctype: string;
  readonly count: number;
  readonly statusCount?: number;
  readonly prefix?: string;
}): readonly ProjectionRow[] {
  const statusCount = input.statusCount ?? 10;
  const prefix = input.prefix ?? input.doctype.slice(0, 1).toUpperCase();
  const rows: ProjectionRow[] = [];
  for (let index = 0; index < input.count; index += 1) {
    rows.push({
      doctype: input.doctype,
      name: `${prefix}-${String(index).padStart(6, "0")}`,
      data: {
        status: `S${index % statusCount}`,
        priority: ["Low", "Med", "High"][index % 3] as string
      },
      updatedAt: `2026-01-01T00:00:${String(index % 60).padStart(2, "0")}.000Z`
    });
  }
  return rows;
}

type SqlParam = string | number | bigint | null;

function toSqlParams(params: readonly unknown[]): readonly SqlParam[] {
  return params.map((param) => {
    if (param === null || param === undefined) {
      return null;
    }
    if (typeof param === "boolean") {
      return param ? 1 : 0;
    }
    if (typeof param === "number" || typeof param === "bigint" || typeof param === "string") {
      return param;
    }
    return JSON.stringify(param);
  });
}

function createD1Facade(db: DatabaseSync): D1Database {
  const statement = (sql: string, params: readonly SqlParam[]) => ({
    bind: (...next: readonly unknown[]) => statement(sql, toSqlParams(next)),
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    first: async () => db.prepare(sql).all(...params)[0] ?? null,
    run: async () => {
      db.prepare(sql).run(...params);
      return { success: true };
    }
  });
  return {
    prepare: (sql: string) => statement(sql, []),
    batch: async (statements: readonly { all(): Promise<unknown> }[]) =>
      Promise.all(statements.map((entry) => entry.all()))
  } as unknown as D1Database;
}
