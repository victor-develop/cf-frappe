import type {
  JsonPrimitive,
  JsonValue,
  ListDocumentsQuery,
  ListOrderDirection,
  PredicateExpression,
  PredicateOperand,
  PredicateOperator
} from "../../core/types.js";
import { FrameworkError } from "../../core/errors.js";
import { containsLikePattern } from "../../core/predicates.js";
import { likeGlobPattern } from "../../core/like-glob.js";
import { D1_DOCUMENTS_TABLE } from "./tables.js";
import { d1JsonExtract, d1JsonType } from "./json-path.js";

export interface D1ProjectionListQuery {
  readonly limit: number;
  readonly offset: number;
  readonly where: string;
  readonly params: readonly JsonPrimitive[];
  readonly orderBy: string;
}

/**
 * The largest `GLOB` pattern this compiler will bind, in UTF-8 bytes.
 *
 * SQLite raises "LIKE or GLOB pattern too complex" past
 * `SQLITE_MAX_LIKE_PATTERN_LENGTH`, counted in bytes: measured on SQLite 3.51.3
 * a 49998-byte pattern is accepted and a 50001-byte one raises. Case-folding a
 * pattern expands it by up to 6.00x in bytes (`Т` -> `[Ттᲄᲅ]`, 2 bytes -> 12),
 * so a long needle can cross that line where the old in-memory path handled any
 * length. This bound sits an order of magnitude below the engine's, because the
 * engine's is a compile-time option and workerd's value is not published —
 * sitting at the measured limit would be betting on a number from a different
 * build. 4096 bytes still admits about a thousand ASCII characters of needle,
 * far past anything a quick filter types.
 */
export const D1_PROJECTION_TEXT_PATTERN_MAX_BYTES = 4096;

const D1_PROJECTION_COLUMNS =
  "tenant_id, doctype, name, version, docstatus, data_json, created_at, updated_at";

/**
 * SQL for a projection list page. The `LIMIT`/`OFFSET` placeholders are bound
 * after {@link D1ProjectionListQuery.params}.
 */
export function d1ProjectionListSql(query: D1ProjectionListQuery): string {
  return (
    `SELECT ${D1_PROJECTION_COLUMNS}\n` +
    `         FROM ${D1_DOCUMENTS_TABLE}\n` +
    `         WHERE ${query.where}\n` +
    `         ORDER BY ${query.orderBy}\n` +
    `         LIMIT ? OFFSET ?`
  );
}

/** SQL for the total that accompanies a projection list page. */
export function d1ProjectionCountSql(query: D1ProjectionListQuery): string {
  return `SELECT COUNT(*) AS total FROM ${D1_DOCUMENTS_TABLE} WHERE ${query.where}`;
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
    orderBy: listOrderExpression(query.orderBy ?? "updatedAt", query.order ?? "desc")
  };
}

interface PredicateWhere {
  readonly conditions: readonly string[];
  readonly params: readonly JsonPrimitive[];
  /**
   * True when the conditions are equivalent to the predicate rather than a
   * superset of it. Only a complete condition may be negated: negating a
   * superset does not produce a superset of the negation.
   *
   * Every operator is now pushed down exactly, so this is always true and the
   * checks that read it are unreachable — they are kept as throws rather than
   * deleted because the next operator without an exact SQL form would otherwise
   * silently return every row. PR #40 shipped a wrong operator-negation table
   * that only the real engine caught; an assertion is cheaper than that.
   */
  readonly complete: boolean;
}

function predicateWhere(expression: PredicateExpression | undefined): PredicateWhere {
  return expression === undefined
    ? { conditions: [], params: [], complete: true }
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
  assertPushedDownExactly(compiled, "a negated predicate");
  return {
    conditions: [`(${compiled.conditions.join(" AND ")}) IS NOT 1`],
    params: compiled.params,
    complete: true
  };
}

function predicateGroupWhere(expression: Extract<PredicateExpression, { readonly kind: "group" }>): PredicateWhere {
  const children = expression.predicates.map(predicateExpressionWhere);
  if (children.length === 0) {
    // Validation rejects an empty group ("Predicate group must include at least
    // one predicate"), but this compiler is exported and takes a raw query, and
    // an empty group would otherwise emit the syntactically invalid `()`.
    throw new Error("D1 projection predicate groups must contain at least one predicate");
  }
  for (const child of children) {
    // An OR cannot drop a branch, and an AND of a superset with an exact
    // condition is still a superset once negated, so nothing here tolerates a
    // partial child.
    assertPushedDownExactly(child, `a '${expression.match}' predicate group`);
  }
  const joiner = expression.match === "all" ? " AND " : " OR ";
  return {
    conditions: [`(${children.map((child) => child.conditions.join(" AND ")).join(joiner)})`],
    params: children.flatMap((child) => child.params),
    complete: true
  };
}

/**
 * Fails loudly when a compiled child is a superset of its predicate.
 *
 * Unreachable today — every operator has an exact SQL form. It exists so that
 * adding one that does not is a 500 with a name in it rather than a list that
 * quietly contains rows the predicate excludes.
 */
function assertPushedDownExactly(compiled: PredicateWhere, context: string): void {
  if (!compiled.complete || compiled.conditions.length === 0) {
    throw new Error(
      `D1 projection predicates must compile to exact SQL, but ${context} did not. ` +
        "An operator without an exact SQL form cannot be pushed down: negating or OR-ing a " +
        "superset does not produce a superset."
    );
  }
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
        ? { conditions: [nullEqualityExpression(field, expression)], params: [], complete: true }
        : { conditions: [`${expression} = ?`], params: [sqliteJsonValue(scalar)], complete: true };
    }
    case "ne": {
      const scalar = scalarPredicateValue(value, operator);
      return {
        conditions: [scalar === null
          ? `${expression} IS NOT NULL`
          : `${expression} IS NOT NULL AND ${expression} != ?`],
        params: scalar === null ? [] : [sqliteJsonValue(scalar)],
        complete: true
      };
    }
    case "in": {
      const values = nonNullMembershipPredicateValues(value, operator);
      return {
        conditions: [values.length === 0 ? "0 = 1" : `${expression} IN (${values.map(() => "?").join(", ")})`],
        params: values.map(sqliteJsonValue),
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
        complete: true
      };
    }
    case "is":
      return {
        conditions: [`${expression} ${presencePredicateValue(value, operator) === "set" ? "IS NOT NULL" : "IS NULL"}`],
        params: [],
        complete: true
      };
    case "contains":
    case "like":
    case "not_like":
      return textPredicateWhere(field, expression, operator, value);
    case "gt":
      return {
        conditions: [`${expression} > ?`],
        params: [sqliteJsonValue(scalarPredicateValue(value, operator))],
        complete: true
      };
    case "gte":
      return {
        conditions: [`${expression} >= ?`],
        params: [sqliteJsonValue(scalarPredicateValue(value, operator))],
        complete: true
      };
    case "lt":
      return {
        conditions: [`${expression} < ?`],
        params: [sqliteJsonValue(scalarPredicateValue(value, operator))],
        complete: true
      };
    case "lte":
      return {
        conditions: [`${expression} <= ?`],
        params: [sqliteJsonValue(scalarPredicateValue(value, operator))],
        complete: true
      };
    case "between": {
      const [minimum, maximum] = rangePredicateValues(value, operator);
      return {
        conditions: [`(${expression} >= ? AND ${expression} <= ?)`],
        params: [sqliteJsonValue(minimum), sqliteJsonValue(maximum)],
        complete: true
      };
    }
    case "not_between": {
      const [minimum, maximum] = rangePredicateValues(value, operator);
      return {
        conditions: [`${expression} IS NOT NULL AND (${expression} < ? OR ${expression} > ?)`],
        params: [sqliteJsonValue(minimum), sqliteJsonValue(maximum)],
        complete: true
      };
    }
    default:
      throw new Error(`Unsupported predicate operator '${String(operator)}'`);
  }
}

/**
 * Compiles `contains`, `like` and `not_like` into a bound `GLOB` pattern.
 *
 * These were the last operators refined in the Worker: the store fetched a
 * bounded candidate set, parsed each row's JSON and re-evaluated the predicate,
 * and refused outright past 1000 candidates — so text search did not work on a
 * large doctype at all (issue #41). `GLOB` with case-fold character classes
 * reproduces the in-memory rule exactly, which removes both the cap and the
 * per-row parse. It is not faster per row — a leading wildcard defeats every
 * index either way, and the classes cost about 28% more than plain `LIKE`
 * (measured at 100k rows: 29.9 ms for `LIKE '%needle%'` against 38.4 ms for the
 * expanded classes, over a 29.2 ms no-matcher baseline). What it is, is
 * *bounded*: no cap and no per-row JSON parse, which the old path had both of.
 *
 * `not_like` needs the presence check spelled out. In memory it requires the
 * field to be present before negating, so a missing or JSON-null field drops the
 * row — while `expr GLOB ?` on NULL is NULL and `(NULL) IS NOT 1` is 1, which
 * would keep it.
 */
function textPredicateWhere(
  field: string,
  expression: string,
  operator: "contains" | "like" | "not_like",
  value: JsonValue
): PredicateWhere {
  if (operator === "contains") {
    const needle = containsNeedle(value, operator);
    return needle === undefined
      ? neverMatchesWhere()
      : globPredicateWhere(field, expression, operator, containsLikePattern(needle));
  }
  if (typeof value !== "string") {
    // In memory both `like` and `not_like` require a string pattern and are
    // false without one — `not_like` included, so this is not "keep every row".
    return neverMatchesWhere();
  }
  return globPredicateWhere(field, expression, operator, value);
}

function globPredicateWhere(
  field: string,
  expression: string,
  operator: "contains" | "like" | "not_like",
  pattern: string
): PredicateWhere {
  assertTextPatternHasNoNul(field, pattern);
  const translated = likeGlobPattern(pattern);
  if (translated.kind === "never") {
    // A pattern ending in a lone `\` matches nothing. `not_like` still keeps
    // exactly the rows whose field is present, which a bare `0 = 1` under a
    // negation would get wrong in the other direction (it would keep every row,
    // including the ones with no such field).
    return operator === "not_like"
      ? { conditions: [`${expression} IS NOT NULL`], params: [], complete: true }
      : neverMatchesWhere();
  }
  assertTextPatternWithinLimit(field, translated.pattern);
  return operator === "not_like"
    ? {
      conditions: [`${expression} IS NOT NULL AND (${expression} GLOB ?) IS NOT 1`],
      params: [translated.pattern],
      complete: true
    }
    : { conditions: [`${expression} GLOB ?`], params: [translated.pattern], complete: true };
}

function neverMatchesWhere(): PredicateWhere {
  return { conditions: ["0 = 1"], params: [], complete: true };
}

/** `undefined` when the in-memory rule cannot match at all. */
function containsNeedle(value: JsonValue, operator: PredicateOperator): string | undefined {
  if (value === null) {
    return undefined;
  }
  // `String(actual)`/`String(expected)` is what the in-memory rule applies, so
  // coerce the needle the same way rather than rejecting a non-string.
  return String(scalarPredicateValue(value, operator));
}

/**
 * Rejects a text filter whose pattern contains U+0000.
 *
 * SQLite's `patternCompare` walks NUL-terminated C strings, so a bound GLOB
 * pattern is read only up to its first U+0000. `contains "\u0000"` compiles to
 * `*\u0000*`, which SQLite reads as `*` — **every row matches, and the filter
 * is silently gone**. Measured on a real engine with bound parameters:
 * `GLOB '*' || char(0) || '*'` returned every row, the in-memory rule returned
 * only the row that actually contains U+0000.
 *
 * The needle is client-supplied JSON, so this has to be refused rather than
 * translated. A stored value cannot contain U+0000 either — `validateFieldValue`
 * rejects it — so between the two the pushdown stays faithful instead of the
 * divergence being written down and lived with.
 */
function assertTextPatternHasNoNul(field: string, pattern: string): void {
  if (pattern.includes("\u0000")) {
    throw new FrameworkError(
      "D1_PROJECTION_TEXT_PATTERN_INVALID",
      `Text filter on '${field}' contains U+0000, which SQLite's pattern matching cannot ` +
        "represent: it truncates the pattern there and would match every row",
      { status: 400 }
    );
  }
}

function assertTextPatternWithinLimit(field: string, pattern: string): void {
  const bytes = new TextEncoder().encode(pattern).length;
  if (bytes > D1_PROJECTION_TEXT_PATTERN_MAX_BYTES) {
    throw new FrameworkError(
      "D1_PROJECTION_TEXT_PATTERN_TOO_LONG",
      `Text filter on '${field}' compiles to a ${bytes}-byte GLOB pattern, over the ` +
        `${D1_PROJECTION_TEXT_PATTERN_MAX_BYTES}-byte limit. Case-folding expands a pattern by up ` +
        "to 6x in bytes, so use a shorter search term.",
      { status: 400 }
    );
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

