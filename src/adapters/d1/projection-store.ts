import type {
  DocTypeName,
  DocumentName,
  DocumentSnapshot,
  JsonPrimitive,
  ListDocumentsFilter,
  ListDocumentsQuery,
  ListDocumentsResult,
  TenantId
} from "../../core/types.js";
import type { ProjectionStore } from "../../ports/projection-store.js";
import { documentFromRow, type DocumentRow } from "./serde.js";

export class D1ProjectionStore implements ProjectionStore {
  constructor(private readonly db: D1Database) {}

  async get(
    tenantId: TenantId,
    doctype: DocTypeName,
    name: DocumentName
  ): Promise<DocumentSnapshot | null> {
    const row = await this.db
      .prepare(
        `SELECT tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at
         FROM cf_frappe_documents
         WHERE tenant_id = ? AND doctype = ? AND name = ?`
      )
      .bind(tenantId, doctype, name)
      .first<DocumentRow>();
    return row ? documentFromRow(row) : null;
  }

  async save(snapshot: DocumentSnapshot): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO cf_frappe_documents
         (tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, doctype, name)
         DO UPDATE SET
           version = excluded.version,
           docstatus = excluded.docstatus,
           data_json = excluded.data_json,
           updated_at = excluded.updated_at`
      )
      .bind(
        snapshot.tenantId,
        snapshot.doctype,
        snapshot.name,
        snapshot.version,
        snapshot.docstatus,
        JSON.stringify(snapshot.data),
        snapshot.createdAt,
        snapshot.updatedAt
      )
      .run();
  }

  async list(query: ListDocumentsQuery): Promise<ListDocumentsResult> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const filtered = listFilterWhere(query.filters ?? []);
    const where = ["tenant_id = ?", "doctype = ?", ...filtered.conditions].join(" AND ");
    const params = [query.tenantId, query.doctype, ...filtered.params];
    const [rows, count] = await this.db.batch([
      this.db
        .prepare(
          `SELECT tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at
           FROM cf_frappe_documents
           WHERE ${where}
           ORDER BY updated_at DESC
           LIMIT ? OFFSET ?`
        )
        .bind(...params, limit, offset),
      this.db
        .prepare(`SELECT COUNT(*) AS total FROM cf_frappe_documents WHERE ${where}`)
        .bind(...params)
    ]);
    if (!rows || !count) {
      return { data: [], limit, offset, total: 0 };
    }
    return {
      data: ((rows.results ?? []) as DocumentRow[]).map(documentFromRow),
      limit,
      offset,
      total: Number(((count.results ?? [])[0] as { total?: number } | undefined)?.total ?? 0)
    };
  }
}

interface ListFilterWhere {
  readonly conditions: readonly string[];
  readonly params: readonly JsonPrimitive[];
}

function listFilterWhere(filters: readonly ListDocumentsFilter[]): ListFilterWhere {
  const conditions: string[] = [];
  const params: JsonPrimitive[] = [];
  for (const filter of filters) {
    const expression = `json_extract(data_json, '${escapeSqlString(jsonPath(filter.field))}')`;
    const operator = filter.operator ?? "eq";
    switch (operator) {
      case "eq":
        conditions.push(`${expression} = ?`);
        params.push(sqliteJsonValue(filter.value));
        break;
      case "ne":
        conditions.push(`${expression} IS NOT NULL AND ${expression} != ?`);
        params.push(sqliteJsonValue(filter.value));
        break;
      case "contains":
        conditions.push(`LOWER(CAST(${expression} AS TEXT)) LIKE ? ESCAPE '\\'`);
        params.push(`%${escapeLike(String(filter.value).toLowerCase())}%`);
        break;
      case "gt":
        conditions.push(`${expression} > ?`);
        params.push(sqliteJsonValue(filter.value));
        break;
      case "gte":
        conditions.push(`${expression} >= ?`);
        params.push(sqliteJsonValue(filter.value));
        break;
      case "lt":
        conditions.push(`${expression} < ?`);
        params.push(sqliteJsonValue(filter.value));
        break;
      case "lte":
        conditions.push(`${expression} <= ?`);
        params.push(sqliteJsonValue(filter.value));
        break;
      default:
        throw new Error(`Unsupported list filter operator '${String(operator)}'`);
    }
  }
  return { conditions, params };
}

function sqliteJsonValue(value: JsonPrimitive): JsonPrimitive {
  return typeof value === "boolean" ? Number(value) : value;
}

function jsonPath(field: string): string {
  return `$.${field}`;
}

function escapeSqlString(value: string): string {
  return value.replaceAll("'", "''");
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}
