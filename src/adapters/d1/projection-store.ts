import type {
  DocTypeName,
  DocumentName,
  DocumentSnapshot,
  JsonPrimitive,
  ListFilterValue,
  ListFilterExpression,
  ListOrderDirection,
  ListDocumentsFilter,
  ListDocumentsQuery,
  ListDocumentsResult,
  TenantId
} from "../../core/types.js";
import { cloneDocumentSnapshot } from "../../core/document-snapshots.js";
import { andListFilterExpressions, isListFilterGroup, listFilterExpressionFromFilters } from "../../core/list-view.js";
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
    const normalized = cloneDocumentSnapshot(snapshot);
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
        normalized.tenantId,
        normalized.doctype,
        normalized.name,
        normalized.version,
        normalized.docstatus,
        JSON.stringify(normalized.data),
        normalized.createdAt,
        normalized.updatedAt
      )
      .run();
  }

  async list(query: ListDocumentsQuery): Promise<ListDocumentsResult> {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;
    const filtered = listFilterWhere(
      andListFilterExpressions([
        listFilterExpressionFromFilters(query.filters ?? []),
        query.filterExpression
      ])
    );
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

function listFilterWhere(expression: ListFilterExpression | undefined): ListFilterWhere {
  return expression === undefined ? { conditions: [], params: [] } : listFilterExpressionWhere(expression);
}

function listFilterExpressionWhere(expression: ListFilterExpression): ListFilterWhere {
  if (isListFilterGroup(expression)) {
    const children = expression.filters.map(listFilterExpressionWhere).filter((child) => child.conditions.length > 0);
    if (children.length === 0) {
      return { conditions: [], params: [] };
    }
    const joiner = expression.match === "all" ? " AND " : " OR ";
    return {
      conditions: [`(${children.map((child) => child.conditions.join(" AND ")).join(joiner)})`],
      params: children.flatMap((child) => child.params)
    };
  }
  return listFilterPredicateWhere(expression);
}

function listFilterPredicateWhere(filter: ListDocumentsFilter): ListFilterWhere {
  const expression = listFilterExpression(filter.field);
  const operator = filter.operator ?? "eq";
  switch (operator) {
    case "eq":
      return { conditions: [`${expression} = ?`], params: [sqliteJsonValue(scalarFilterValue(filter))] };
    case "ne":
      return {
        conditions: [`${expression} IS NOT NULL AND ${expression} != ?`],
        params: [sqliteJsonValue(scalarFilterValue(filter))]
      };
    case "in": {
      const values = membershipFilterValues(filter);
      return {
        conditions: [`${expression} IN (${values.map(() => "?").join(", ")})`],
        params: values.map(sqliteJsonValue)
      };
    }
    case "not_in": {
      const values = membershipFilterValues(filter);
      return {
        conditions: [`${expression} IS NOT NULL AND ${expression} NOT IN (${values.map(() => "?").join(", ")})`],
        params: values.map(sqliteJsonValue)
      };
    }
    case "is":
      return {
        conditions: [`${expression} ${presenceFilterValue(filter) === "set" ? "IS NOT NULL" : "IS NULL"}`],
        params: []
      };
    case "contains":
      return {
        conditions: [`LOWER(CAST(${expression} AS TEXT)) LIKE ? ESCAPE '\\'`],
        params: [`%${escapeLike(String(scalarFilterValue(filter)).toLowerCase())}%`]
      };
    case "like":
      return {
        conditions: [`LOWER(CAST(${expression} AS TEXT)) LIKE ? ESCAPE '\\'`],
        params: [patternFilterValue(filter)]
      };
    case "not_like":
      return {
        conditions: [`${expression} IS NOT NULL AND LOWER(CAST(${expression} AS TEXT)) NOT LIKE ? ESCAPE '\\'`],
        params: [patternFilterValue(filter)]
      };
    case "gt":
      return { conditions: [`${expression} > ?`], params: [sqliteJsonValue(scalarFilterValue(filter))] };
    case "gte":
      return { conditions: [`${expression} >= ?`], params: [sqliteJsonValue(scalarFilterValue(filter))] };
    case "lt":
      return { conditions: [`${expression} < ?`], params: [sqliteJsonValue(scalarFilterValue(filter))] };
    case "lte":
      return { conditions: [`${expression} <= ?`], params: [sqliteJsonValue(scalarFilterValue(filter))] };
    case "between": {
      const [minimum, maximum] = rangeFilterValues(filter);
      return {
        conditions: [`(${expression} >= ? AND ${expression} <= ?)`],
        params: [sqliteJsonValue(minimum), sqliteJsonValue(maximum)]
      };
    }
    case "not_between": {
      const [minimum, maximum] = rangeFilterValues(filter);
      return {
        conditions: [`${expression} IS NOT NULL AND (${expression} < ? OR ${expression} > ?)`],
        params: [sqliteJsonValue(minimum), sqliteJsonValue(maximum)]
      };
    }
    default:
      throw new Error(`Unsupported list filter operator '${String(operator)}'`);
  }
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

function presenceFilterValue(filter: ListDocumentsFilter): "set" | "not set" {
  if (filter.value === "set" || filter.value === "not set") {
    return filter.value;
  }
  throw new Error(`List filter operator '${filter.operator ?? "eq"}' requires set or not set`);
}

function patternFilterValue(filter: ListDocumentsFilter): string {
  const value = scalarFilterValue(filter);
  if (value === null) {
    throw new Error(`List filter operator '${filter.operator ?? "eq"}' requires a non-null pattern value`);
  }
  return String(value).toLowerCase();
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
