import type {
  JsonPrimitive,
  JsonValue,
  ListDocumentsQuery,
  ListOrderDirection,
  PredicateExpression,
  PredicateOperand,
  PredicateOperator
} from "../../core/types.js";

export interface D1ProjectionListQuery {
  readonly limit: number;
  readonly offset: number;
  readonly where: string;
  readonly params: readonly JsonPrimitive[];
  readonly orderBy: string;
  readonly postFilter?: PredicateExpression;
}

const D1_PROJECTION_COLUMNS =
  "tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at";

/**
 * SQL for a projection list page. The `LIMIT`/`OFFSET` placeholders are bound
 * after {@link D1ProjectionListQuery.params}; pass `paged: false` for the
 * post-filter path, which binds a single candidate cap instead.
 */
export function d1ProjectionListSql(
  query: D1ProjectionListQuery,
  options: { readonly paged?: boolean } = {}
): string {
  const paged = options.paged ?? true;
  return (
    `SELECT ${D1_PROJECTION_COLUMNS}\n` +
    `         FROM cf_frappe_documents\n` +
    `         WHERE ${query.where}\n` +
    `         ORDER BY ${query.orderBy}\n` +
    `         ${paged ? "LIMIT ? OFFSET ?" : "LIMIT ?"}`
  );
}

/** SQL for the total that accompanies a projection list page. */
export function d1ProjectionCountSql(query: D1ProjectionListQuery): string {
  return `SELECT COUNT(*) AS total FROM cf_frappe_documents WHERE ${query.where}`;
}

export function d1ProjectionListQuery(query: ListDocumentsQuery): D1ProjectionListQuery {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  const filtered = predicateWhere(query.predicate);
  return {
    limit,
    offset,
    where: ["tenant_id = ?", "doctype = ?", ...filtered.conditions].join(" AND "),
    params: [query.tenantId, query.doctype, ...filtered.params],
    orderBy: listOrderExpression(query.orderBy ?? "updatedAt", query.order ?? "desc"),
    ...(!filtered.exact && query.predicate !== undefined ? { postFilter: query.predicate } : {})
  };
}

interface PredicateWhere {
  readonly conditions: readonly string[];
  readonly params: readonly JsonPrimitive[];
  readonly exact: boolean;
}

function predicateWhere(expression: PredicateExpression | undefined): PredicateWhere {
  return expression === undefined
    ? { conditions: [], params: [], exact: true }
    : predicateExpressionWhere(expression);
}

function predicateExpressionWhere(expression: PredicateExpression): PredicateWhere {
  if (expression.kind === "group") {
    return predicateGroupWhere(expression);
  }
  if (expression.kind === "not") {
    return { conditions: [], params: [], exact: false };
  }
  return predicateComparisonWhere(expression);
}

function predicateGroupWhere(expression: Extract<PredicateExpression, { readonly kind: "group" }>): PredicateWhere {
  const children = expression.predicates.map(predicateExpressionWhere);
  if (expression.match === "any" && children.some((child) => !child.exact)) {
    return { conditions: [], params: [], exact: false };
  }
  const pushedDown = children.filter((child) => child.conditions.length > 0);
  const exact = children.every((child) => child.exact);
  if (pushedDown.length === 0) {
    return { conditions: [], params: [], exact };
  }
  const joiner = expression.match === "all" ? " AND " : " OR ";
  return {
    conditions: [`(${pushedDown.map((child) => child.conditions.join(" AND ")).join(joiner)})`],
    params: pushedDown.flatMap((child) => child.params),
    exact
  };
}

function predicateComparisonWhere(
  predicate: Extract<PredicateExpression, { readonly kind: "compare" }>
): PredicateWhere {
  const field = predicateField(predicate.left);
  const expression = listFilterExpression(field);
  const value = predicateLiteral(predicate.right);
  const operator = predicate.operator;
  switch (operator) {
    case "eq": {
      const scalar = scalarPredicateValue(value, operator);
      return scalar === null
        ? { conditions: [nullEqualityExpression(field, expression)], params: [], exact: true }
        : { conditions: [`${expression} = ?`], params: [sqliteJsonValue(scalar)], exact: true };
    }
    case "ne": {
      const scalar = scalarPredicateValue(value, operator);
      return {
        conditions: [scalar === null
          ? `${expression} IS NOT NULL`
          : `${expression} IS NOT NULL AND ${expression} != ?`],
        params: scalar === null ? [] : [sqliteJsonValue(scalar)],
        exact: true
      };
    }
    case "in": {
      const values = nonNullMembershipPredicateValues(value, operator);
      return {
        conditions: [values.length === 0 ? "0 = 1" : `${expression} IN (${values.map(() => "?").join(", ")})`],
        params: values.map(sqliteJsonValue),
        exact: true
      };
    }
    case "not_in": {
      const values = nonNullMembershipPredicateValues(value, operator);
      return {
        conditions: [values.length === 0
          ? `${expression} IS NOT NULL`
          : `${expression} IS NOT NULL AND ${expression} NOT IN (${values.map(() => "?").join(", ")})`],
        params: values.map(sqliteJsonValue),
        exact: true
      };
    }
    case "is":
      return {
        conditions: [`${expression} ${presencePredicateValue(value, operator) === "set" ? "IS NOT NULL" : "IS NULL"}`],
        params: [],
        exact: true
      };
    case "contains":
    case "like":
    case "not_like":
      return { conditions: [], params: [], exact: false };
    case "gt":
      return {
        conditions: [`${expression} > ?`],
        params: [sqliteJsonValue(scalarPredicateValue(value, operator))],
        exact: true
      };
    case "gte":
      return {
        conditions: [`${expression} >= ?`],
        params: [sqliteJsonValue(scalarPredicateValue(value, operator))],
        exact: true
      };
    case "lt":
      return {
        conditions: [`${expression} < ?`],
        params: [sqliteJsonValue(scalarPredicateValue(value, operator))],
        exact: true
      };
    case "lte":
      return {
        conditions: [`${expression} <= ?`],
        params: [sqliteJsonValue(scalarPredicateValue(value, operator))],
        exact: true
      };
    case "between": {
      const [minimum, maximum] = rangePredicateValues(value, operator);
      return {
        conditions: [`(${expression} >= ? AND ${expression} <= ?)`],
        params: [sqliteJsonValue(minimum), sqliteJsonValue(maximum)],
        exact: true
      };
    }
    case "not_between": {
      const [minimum, maximum] = rangePredicateValues(value, operator);
      return {
        conditions: [`${expression} IS NOT NULL AND (${expression} < ? OR ${expression} > ?)`],
        params: [sqliteJsonValue(minimum), sqliteJsonValue(maximum)],
        exact: true
      };
    }
    default:
      throw new Error(`Unsupported predicate operator '${String(operator)}'`);
  }
}

function predicateField(operand: PredicateOperand): string {
  if (operand.kind !== "field" || operand.scope !== "after") {
    throw new Error("D1 projection predicates require an after-field left operand");
  }
  return operand.field;
}

function predicateLiteral(operand: PredicateOperand): JsonValue {
  if (operand.kind !== "literal") {
    throw new Error("D1 projection predicates require a literal right operand");
  }
  return operand.value;
}

function listFilterExpression(field: string): string {
  const systemExpression = systemFilterExpression(field);
  if (systemExpression) {
    return systemExpression;
  }
  return `json_extract(data_json, '${escapeSqlString(jsonPath(field))}')`;
}

function nullEqualityExpression(field: string, expression: string): string {
  return systemFilterExpression(field) === undefined
    ? `json_type(data_json, '${escapeSqlString(jsonPath(field))}') = 'null'`
    : `${expression} IS NULL`;
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

function scalarPredicateValue(value: JsonValue, operator: PredicateOperator): JsonPrimitive {
  if (Array.isArray(value) || (typeof value === "object" && value !== null)) {
    throw new Error(`Predicate operator '${operator}' requires a scalar value`);
  }
  return value;
}

function membershipPredicateValues(value: JsonValue, operator: PredicateOperator): readonly JsonPrimitive[] {
  if (!isPrimitiveArray(value) || value.length === 0) {
    throw new Error(`Predicate operator '${operator}' requires one or more values`);
  }
  return value;
}

function nonNullMembershipPredicateValues(
  value: JsonValue,
  operator: PredicateOperator
): readonly Exclude<JsonPrimitive, null>[] {
  return membershipPredicateValues(value, operator).filter(
    (item): item is Exclude<JsonPrimitive, null> => item !== null
  );
}

function presencePredicateValue(value: JsonValue, operator: PredicateOperator): "set" | "not set" {
  if (value === "set" || value === "not set") {
    return value;
  }
  throw new Error(`Predicate operator '${operator}' requires set or not set`);
}

function rangePredicateValues(value: JsonValue, operator: PredicateOperator): readonly [JsonPrimitive, JsonPrimitive] {
  if (!isPrimitiveArray(value) || value.length !== 2) {
    throw new Error(`Predicate operator '${operator}' requires exactly two values`);
  }
  const minimum = value[0];
  const maximum = value[1];
  if (minimum === undefined || minimum === null || maximum === undefined || maximum === null) {
    throw new Error(`Predicate operator '${operator}' requires non-null range values`);
  }
  return [minimum, maximum];
}

function isPrimitiveArray(value: JsonValue): value is readonly JsonPrimitive[] {
  return Array.isArray(value) && value.every((item) => item === null || ["string", "number", "boolean"].includes(typeof item));
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
