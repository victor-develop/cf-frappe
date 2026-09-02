import type {
  JsonPrimitive,
  JsonValue,
  ListDocumentsQuery,
  ListOrderDirection,
  PredicateExpression,
  PredicateOperand,
  PredicateOperator
} from "../../core/types.js";
import { D1_DOCUMENTS_TABLE } from "./tables.js";
import { d1JsonExtract, d1JsonType } from "./json-path.js";

export interface D1ProjectionListQuery {
  readonly limit: number;
  readonly offset: number;
  readonly where: string;
  readonly params: readonly JsonPrimitive[];
  readonly orderBy: string;
  /**
   * Set when the pushed-down `WHERE` is a superset of the predicate and the rows
   * it returns still need an in-memory pass. `operators` names why, so a slow
   * query is diagnosable instead of mysterious.
   */
  readonly refinement?: D1ProjectionRefinement;
}

export interface D1ProjectionRefinement {
  readonly predicate: PredicateExpression;
  readonly operators: readonly PredicateOperator[];
}

/**
 * Operators with no SQL equivalent that preserves the in-memory semantics.
 * `contains`, `like` and `not_like` all fold case by one rule — a JS regexp
 * with the `i` flag — while SQLite's `LIKE` folds ASCII only, so pushing them
 * down would change which rows match on non-ASCII data. They are therefore
 * compiled as a superset and refined in memory.
 *
 * That rule is not "full Unicode": it is the ES Canonicalize used by the `i`
 * flag, which covers most of the BMP but never applies a mapping that changes
 * length or that reaches ASCII from outside it, and does not fold anything
 * outside the BMP. It is narrower than `String.toLowerCase`, and deliberately
 * so — being reproducible is what makes a pushdown possible at all (issue #41).
 */
const D1_REFINED_OPERATORS: readonly PredicateOperator[] = ["contains", "like", "not_like"];

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
    `         FROM ${D1_DOCUMENTS_TABLE}\n` +
    `         WHERE ${query.where}\n` +
    `         ORDER BY ${query.orderBy}\n` +
    `         ${paged ? "LIMIT ? OFFSET ?" : "LIMIT ?"}`
  );
}

/** SQL for the total that accompanies a projection list page. */
export function d1ProjectionCountSql(query: D1ProjectionListQuery): string {
  return `SELECT COUNT(*) AS total FROM ${D1_DOCUMENTS_TABLE} WHERE ${query.where}`;
}

export function d1ProjectionListQuery(query: ListDocumentsQuery): D1ProjectionListQuery {
  const limit = query.limit ?? 50;
  const offset = query.offset ?? 0;
  const predicate = query.predicate;
  const filtered = predicateWhere(predicate);
  return {
    limit,
    offset,
    where: ["tenant_id = ?", "doctype = ?", ...filtered.conditions].join(" AND "),
    params: [query.tenantId, query.doctype, ...filtered.params],
    orderBy: listOrderExpression(query.orderBy ?? "updatedAt", query.order ?? "desc"),
    ...(filtered.refined.length > 0 && predicate !== undefined
      ? { refinement: { predicate, operators: filtered.refined } }
      : {})
  };
}

interface PredicateWhere {
  readonly conditions: readonly string[];
  readonly params: readonly JsonPrimitive[];
  /** Operators that could not be pushed down; empty means the SQL is exact. */
  readonly refined: readonly PredicateOperator[];
  /**
   * True when the conditions are equivalent to the predicate rather than a
   * superset of it. Only a complete condition may be negated: negating a
   * superset does not produce a superset of the negation.
   */
  readonly complete: boolean;
}

function refinedOperatorsOf(expression: PredicateExpression): readonly PredicateOperator[] {
  if (expression.kind === "not") {
    return refinedOperatorsOf(expression.predicate);
  }
  if (expression.kind === "group") {
    return dedupeOperators(expression.predicates.flatMap(refinedOperatorsOf));
  }
  return [expression.operator];
}

function dedupeOperators(operators: readonly PredicateOperator[]): readonly PredicateOperator[] {
  return [...new Set(operators)];
}

function predicateWhere(expression: PredicateExpression | undefined): PredicateWhere {
  return expression === undefined
    ? { conditions: [], params: [], refined: [], complete: true }
    : predicateExpressionWhere(expression);
}

function predicateExpressionWhere(expression: PredicateExpression): PredicateWhere {
  if (expression.kind === "group") {
    return predicateGroupWhere(expression);
  }
  if (expression.kind === "not") {
    return predicateNotWhere(expression.predicate);
  }
  return predicateComparisonWhere(expression);
}

/**
 * Negates a predicate in SQL rather than in memory.
 *
 * `NOT (expr = ?)` is wrong here: SQL comparisons against a missing key yield
 * NULL, `NOT NULL` is NULL, and the row drops out — while the in-memory
 * evaluator treats a missing field as a failed match, so its negation *keeps*
 * the row. `(expr = ?) IS NOT 1` is null-safe and means exactly "the positive
 * condition is false or unknown", which is the in-memory truth table.
 *
 * The tradeoff is that the wrapped form is not index-usable. That is inherent:
 * a negation is rarely selective enough for an index to help anyway, and paying
 * a scan beats pulling every candidate row into the Worker.
 */
function predicateNotWhere(inner: PredicateExpression): PredicateWhere {
  const compiled = predicateExpressionWhere(inner);
  if (!compiled.complete || compiled.conditions.length === 0) {
    // The inner SQL is a superset, so its negation would drop matching rows.
    return {
      conditions: [],
      params: [],
      refined: compiled.refined.length > 0 ? compiled.refined : refinedOperatorsOf(inner),
      complete: false
    };
  }
  return {
    conditions: [`(${compiled.conditions.join(" AND ")}) IS NOT 1`],
    params: compiled.params,
    refined: [],
    complete: true
  };
}

function predicateGroupWhere(expression: Extract<PredicateExpression, { readonly kind: "group" }>): PredicateWhere {
  const children = expression.predicates.map(predicateExpressionWhere);
  const refined = dedupeOperators(children.flatMap((child) => child.refined));
  if (expression.match === "any" && refined.length > 0) {
    // An OR cannot drop a branch: if any branch needs refinement, the whole
    // group has to be evaluated in memory.
    return { conditions: [], params: [], refined, complete: false };
  }
  const pushedDown = children.filter((child) => child.conditions.length > 0);
  const complete = refined.length === 0 && children.every((child) => child.complete);
  if (pushedDown.length === 0) {
    return { conditions: [], params: [], refined, complete };
  }
  const joiner = expression.match === "all" ? " AND " : " OR ";
  return {
    conditions: [`(${pushedDown.map((child) => child.conditions.join(" AND ")).join(joiner)})`],
    params: pushedDown.flatMap((child) => child.params),
    refined,
    complete
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
        ? { conditions: [nullEqualityExpression(field, expression)], params: [], refined: [], complete: true }
        : { conditions: [`${expression} = ?`], params: [sqliteJsonValue(scalar)], refined: [], complete: true };
    }
    case "ne": {
      const scalar = scalarPredicateValue(value, operator);
      return {
        conditions: [scalar === null
          ? `${expression} IS NOT NULL`
          : `${expression} IS NOT NULL AND ${expression} != ?`],
        params: scalar === null ? [] : [sqliteJsonValue(scalar)],
        refined: [],
      complete: true
      };
    }
    case "in": {
      const values = nonNullMembershipPredicateValues(value, operator);
      return {
        conditions: [values.length === 0 ? "0 = 1" : `${expression} IN (${values.map(() => "?").join(", ")})`],
        params: values.map(sqliteJsonValue),
        refined: [],
      complete: true
      };
    }
    case "not_in": {
      const values = nonNullMembershipPredicateValues(value, operator);
      return {
        conditions: [values.length === 0
          ? `${expression} IS NOT NULL`
          : `${expression} IS NOT NULL AND ${expression} NOT IN (${values.map(() => "?").join(", ")})`],
        params: values.map(sqliteJsonValue),
        refined: [],
      complete: true
      };
    }
    case "is":
      return {
        conditions: [`${expression} ${presencePredicateValue(value, operator) === "set" ? "IS NOT NULL" : "IS NULL"}`],
        params: [],
        refined: [],
      complete: true
      };
    case "contains":
    case "like":
    case "not_like":
      return { conditions: [], params: [], refined: [operator], complete: false };
    case "gt":
      return {
        conditions: [`${expression} > ?`],
        params: [sqliteJsonValue(scalarPredicateValue(value, operator))],
        refined: [],
      complete: true
      };
    case "gte":
      return {
        conditions: [`${expression} >= ?`],
        params: [sqliteJsonValue(scalarPredicateValue(value, operator))],
        refined: [],
      complete: true
      };
    case "lt":
      return {
        conditions: [`${expression} < ?`],
        params: [sqliteJsonValue(scalarPredicateValue(value, operator))],
        refined: [],
      complete: true
      };
    case "lte":
      return {
        conditions: [`${expression} <= ?`],
        params: [sqliteJsonValue(scalarPredicateValue(value, operator))],
        refined: [],
      complete: true
      };
    case "between": {
      const [minimum, maximum] = rangePredicateValues(value, operator);
      return {
        conditions: [`(${expression} >= ? AND ${expression} <= ?)`],
        params: [sqliteJsonValue(minimum), sqliteJsonValue(maximum)],
        refined: [],
      complete: true
      };
    }
    case "not_between": {
      const [minimum, maximum] = rangePredicateValues(value, operator);
      return {
        conditions: [`${expression} IS NOT NULL AND (${expression} < ? OR ${expression} > ?)`],
        params: [sqliteJsonValue(minimum), sqliteJsonValue(maximum)],
        refined: [],
      complete: true
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
  return d1JsonExtract(field);
}

function nullEqualityExpression(field: string, expression: string): string {
  return systemFilterExpression(field) === undefined
    ? `${d1JsonType(field)} = 'null'`
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
  const expression = d1JsonExtract(orderBy);
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

