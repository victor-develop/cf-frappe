import type {
  DocTypeName,
  DocumentName,
  DocumentSnapshot,
  JsonPrimitive,
  ListFilterValue,
  ListOrderDirection,
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
    const orderBy = listOrderExpression(query.orderBy ?? "updatedAt", query.order ?? "desc");
    const [rows, count] = await this.db.batch([
      this.db
        .prepare(
          `SELECT tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at
           FROM cf_frappe_documents
           WHERE ${where}
           ORDER BY ${orderBy}
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
    const expression = listFilterExpression(filter.field);
    const operator = filter.operator ?? "eq";
    switch (operator) {
      case "eq":
        conditions.push(`${expression} = ?`);
        params.push(sqliteJsonValue(scalarFilterValue(filter)));
        break;
      case "ne":
        conditions.push(`${expression} IS NOT NULL AND ${expression} != ?`);
        params.push(sqliteJsonValue(scalarFilterValue(filter)));
        break;
      case "in": {
        const values = membershipFilterValues(filter);
        conditions.push(`${expression} IN (${values.map(() => "?").join(", ")})`);
        params.push(...values.map(sqliteJsonValue));
        break;
      }
      case "not_in": {
        const values = membershipFilterValues(filter);
        conditions.push(`${expression} IS NOT NULL AND ${expression} NOT IN (${values.map(() => "?").join(", ")})`);
        params.push(...values.map(sqliteJsonValue));
        break;
      }
      case "contains":
        conditions.push(`LOWER(CAST(${expression} AS TEXT)) LIKE ? ESCAPE '\\'`);
        params.push(`%${escapeLike(String(scalarFilterValue(filter)).toLowerCase())}%`);
        break;
      case "gt":
        conditions.push(`${expression} > ?`);
        params.push(sqliteJsonValue(scalarFilterValue(filter)));
        break;
      case "gte":
        conditions.push(`${expression} >= ?`);
        params.push(sqliteJsonValue(scalarFilterValue(filter)));
        break;
      case "lt":
        conditions.push(`${expression} < ?`);
        params.push(sqliteJsonValue(scalarFilterValue(filter)));
        break;
      case "lte":
        conditions.push(`${expression} <= ?`);
        params.push(sqliteJsonValue(scalarFilterValue(filter)));
        break;
      case "between": {
        const [minimum, maximum] = rangeFilterValues(filter);
        conditions.push(`(${expression} >= ? AND ${expression} <= ?)`);
        params.push(sqliteJsonValue(minimum), sqliteJsonValue(maximum));
        break;
      }
      default:
        throw new Error(`Unsupported list filter operator '${String(operator)}'`);
    }
  }
  return { conditions, params };
}

function listFilterExpression(field: string): string {
  const systemExpression = systemFilterExpression(field);
  if (systemExpression) {
    return systemExpression;
  }
  return `json_extract(data_json, '${escapeSqlString(jsonPath(field))}')`;
}

function systemFilterExpression(field: string): string | undefined {
  switch (field) {
    case "system.name":
      return "name";
    case "system.docstatus":
      return "docstatus";
    case "system.createdAt":
      return "created_at";
    case "system.updatedAt":
      return "updated_at";
    case "system.version":
      return "version";
    default:
      return undefined;
  }
}

function scalarFilterValue(filter: ListDocumentsFilter): JsonPrimitive {
  if (isFilterValueArray(filter.value)) {
    throw new Error(`List filter operator '${filter.operator ?? "eq"}' requires a scalar value`);
  }
  return filter.value;
}

function membershipFilterValues(filter: ListDocumentsFilter): readonly JsonPrimitive[] {
  if (!isFilterValueArray(filter.value) || filter.value.length === 0) {
    throw new Error(`List filter operator '${filter.operator ?? "eq"}' requires one or more values`);
  }
  return filter.value;
}

function rangeFilterValues(filter: ListDocumentsFilter): readonly [JsonPrimitive, JsonPrimitive] {
  if (!isFilterValueArray(filter.value) || filter.value.length !== 2) {
    throw new Error(`List filter operator '${filter.operator ?? "eq"}' requires exactly two values`);
  }
  const minimum = filter.value[0];
  const maximum = filter.value[1];
  if (minimum === undefined || minimum === null || maximum === undefined || maximum === null) {
    throw new Error(`List filter operator '${filter.operator ?? "eq"}' requires non-null range values`);
  }
  return [minimum, maximum];
}

function isFilterValueArray(value: ListFilterValue): value is readonly JsonPrimitive[] {
  return Array.isArray(value);
}

function sqliteJsonValue(value: JsonPrimitive): JsonPrimitive {
  return typeof value === "boolean" ? Number(value) : value;
}

function listOrderExpression(orderBy: string, order: ListOrderDirection): string {
  const direction = order === "asc" ? "ASC" : "DESC";
  const systemExpression = systemOrderExpression(orderBy);
  if (systemExpression) {
    if (systemExpression === "version") {
      return `${systemExpression} ${direction}, updated_at COLLATE BINARY DESC, name COLLATE BINARY ASC`;
    }
    if (systemExpression === "updated_at") {
      return `${systemExpression} COLLATE BINARY ${direction}`;
    }
    const fallbacks =
      systemExpression === "name"
        ? "updated_at COLLATE BINARY DESC"
        : "updated_at COLLATE BINARY DESC, name COLLATE BINARY ASC";
    return `${systemExpression} COLLATE BINARY ${direction}, ${fallbacks}`;
  }
  const expression = `json_extract(data_json, '${escapeSqlString(jsonPath(orderBy))}')`;
  return `${expression} IS NULL ASC, ${expression} COLLATE BINARY ${direction}, updated_at COLLATE BINARY DESC, name COLLATE BINARY ASC`;
}

function systemOrderExpression(orderBy: string): string | undefined {
  switch (orderBy) {
    case "name":
      return "name";
    case "createdAt":
      return "created_at";
    case "updatedAt":
      return "updated_at";
    case "version":
      return "version";
    default:
      return undefined;
  }
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
