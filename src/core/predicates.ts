import { FrameworkError, type FrameworkErrorCode } from "./errors.js";
import { cloneJsonValue } from "./json.js";
import type {
  Actor,
  DocTypeDefinition,
  DocumentData,
  DocumentSnapshot,
  DomainEvent,
  FieldDefinition,
  JsonPrimitive,
  JsonValue,
  ListFilterExpression,
  PredicateExpression,
  PredicateOperand,
  PredicateOperator,
  PredicateScope
} from "./types.js";

export const MAX_PREDICATE_DEPTH = 5;
export const MAX_PREDICATE_NODES = 64;
export const PREDICATE_OPERATORS = Object.freeze([
  "eq",
  "ne",
  "in",
  "not_in",
  "is",
  "contains",
  "like",
  "not_like",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "not_between"
] as const satisfies readonly PredicateOperator[]);

const SYSTEM_PREDICATE_FIELDS = new Map<string, FieldDefinition>([
  ["system.name", { name: "system.name", type: "text", readOnly: true }],
  ["system.docstatus", {
    name: "system.docstatus",
    type: "select",
    options: ["draft", "submitted", "cancelled", "deleted"],
    readOnly: true
  }],
  ["system.createdAt", { name: "system.createdAt", type: "datetime", readOnly: true }],
  ["system.updatedAt", { name: "system.updatedAt", type: "datetime", readOnly: true }],
  ["system.version", { name: "system.version", type: "integer", readOnly: true }]
]);
const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "constructor", "prototype"]);

export interface NormalizePredicateExpressionOptions {
  readonly availableScopes?: readonly PredicateScope[];
  readonly errorCode?: FrameworkErrorCode;
  readonly maxDepth?: number;
  readonly maxNodes?: number;
}

export interface PredicateEvaluationContext {
  readonly before: DocumentSnapshot | null;
  readonly after: DocumentSnapshot | null;
  readonly input: DocumentData;
  readonly event?: DomainEvent;
  readonly actor?: Actor;
}

export function normalizePredicateExpression(
  doctype: DocTypeDefinition,
  expression: PredicateExpression,
  options: NormalizePredicateExpressionOptions = {}
): PredicateExpression {
  const availableScopes = new Set<PredicateScope>(options.availableScopes ?? ["after"]);
  const maxDepth = options.maxDepth ?? MAX_PREDICATE_DEPTH;
  const maxNodes = options.maxNodes ?? MAX_PREDICATE_NODES;
  const budget = { remaining: maxNodes };
  return normalizePredicateNode(doctype, expression, {
    availableScopes,
    budget,
    depth: 1,
    errorCode: options.errorCode ?? "BAD_REQUEST",
    maxDepth,
    maxNodes
  });
}

export function evaluatePredicateExpression(
  expression: PredicateExpression | undefined,
  context: PredicateEvaluationContext
): boolean {
  if (expression === undefined) {
    return true;
  }
  switch (expression.kind) {
    case "group":
      return expression.match === "all"
        ? expression.predicates.every((predicate) => evaluatePredicateExpression(predicate, context))
        : expression.predicates.some((predicate) => evaluatePredicateExpression(predicate, context));
    case "not":
      return !evaluatePredicateExpression(expression.predicate, context);
    case "compare":
      return comparePredicateValues(
        predicateOperandValue(expression.left, context),
        expression.operator,
        predicateOperandValue(expression.right, context)
      );
  }
}

export function predicateExpressionFromListFilterExpression(
  expression: ListFilterExpression
): PredicateExpression {
  if (isListFilterGroupExpression(expression)) {
    return Object.freeze({
      kind: "group",
      match: expression.match,
      predicates: Object.freeze(expression.filters.map(predicateExpressionFromListFilterExpression))
    });
  }
  return Object.freeze({
    kind: "compare",
    left: Object.freeze({ kind: "field", scope: "after", field: expression.field }),
    operator: expression.operator ?? "eq",
    right: Object.freeze({
      kind: "literal",
      value: cloneJsonValue(expression.value as JsonValue)
    })
  });
}

export function andPredicateExpressions(
  expressions: readonly (PredicateExpression | undefined)[]
): PredicateExpression | undefined {
  const predicates: PredicateExpression[] = [];
  for (const expression of expressions) {
    if (expression === undefined) {
      continue;
    }
    if (expression.kind === "group" && expression.match === "all") {
      predicates.push(...expression.predicates);
      continue;
    }
    predicates.push(expression);
  }
  if (predicates.length === 0) {
    return undefined;
  }
  if (predicates.length === 1) {
    return predicates[0];
  }
  return Object.freeze({ kind: "group", match: "all", predicates: Object.freeze(predicates) });
}

function normalizePredicateNode(
  doctype: DocTypeDefinition,
  expression: PredicateExpression,
  options: {
    readonly availableScopes: ReadonlySet<PredicateScope>;
    readonly budget: { remaining: number };
    readonly depth: number;
    readonly errorCode: FrameworkErrorCode;
    readonly maxDepth: number;
    readonly maxNodes: number;
  }
): PredicateExpression {
  consumeBudget(options);
  if (!isRecord(expression)) {
    throw invalid(options.errorCode, "Predicate expression must be an object");
  }
  if (options.depth > options.maxDepth) {
    throw invalid(options.errorCode, `Predicate expression cannot exceed ${options.maxDepth} levels`);
  }
  if (expression.kind === "group") {
    if (expression.match !== "all" && expression.match !== "any") {
      throw invalid(options.errorCode, "Predicate group match must be all or any");
    }
    if (!Array.isArray(expression.predicates) || expression.predicates.length === 0) {
      throw invalid(options.errorCode, "Predicate group must include at least one predicate");
    }
    return Object.freeze({
      kind: "group",
      match: expression.match,
      predicates: Object.freeze(expression.predicates.map((predicate) => normalizePredicateNode(doctype, predicate, {
        ...options,
        depth: options.depth + 1
      })))
    });
  }
  if (expression.kind === "not") {
    return Object.freeze({
      kind: "not",
      predicate: normalizePredicateNode(doctype, expression.predicate, {
        ...options,
        depth: options.depth + 1
      })
    });
  }
  if (expression.kind !== "compare") {
    throw invalid(options.errorCode, `Unsupported predicate kind '${String((expression as { kind?: unknown }).kind)}'`);
  }
  if (!isPredicateOperator(expression.operator)) {
    throw invalid(options.errorCode, `Unsupported predicate operator '${String(expression.operator)}'`);
  }
  const left = normalizeOperand(doctype, expression.left, options);
  const right = normalizeOperand(doctype, expression.right, options);
  assertOperatorAllowedForOperand(doctype, left, expression.operator, options.errorCode);
  assertStaticOperatorValue(expression.operator, right, options.errorCode);
  assertOperandCompatibility(doctype, left, expression.operator, right, options.errorCode);
  return Object.freeze({ kind: "compare", left, operator: expression.operator, right });
}

function normalizeOperand(
  doctype: DocTypeDefinition,
  operand: PredicateOperand,
  options: {
    readonly availableScopes: ReadonlySet<PredicateScope>;
    readonly errorCode: FrameworkErrorCode;
  }
): PredicateOperand {
  if (!isRecord(operand)) {
    throw invalid(options.errorCode, "Predicate operand must be an object");
  }
  if (operand.kind === "literal") {
    return Object.freeze({ kind: "literal", value: cloneJsonValue(operand.value) });
  }
  if (operand.kind === "field") {
    assertScopeAvailable(operand.scope, options.availableScopes, options.errorCode);
    if (typeof operand.field !== "string" || operand.field.trim().length === 0) {
      throw invalid(options.errorCode, "Predicate field must be a non-empty string");
    }
    requirePredicateField(doctype, operand.field, options.errorCode);
    return Object.freeze({ kind: "field", scope: operand.scope, field: operand.field });
  }
  if (operand.kind === "path") {
    assertScopeAvailable(operand.scope, options.availableScopes, options.errorCode);
    if (!Array.isArray(operand.path) || operand.path.length === 0 || operand.path.length > 16) {
      throw invalid(options.errorCode, "Predicate path must contain between 1 and 16 segments");
    }
    const path = operand.path.map((segment) => {
      if (typeof segment !== "string" || segment.trim().length === 0) {
        throw invalid(options.errorCode, "Predicate path segments must be non-empty strings");
      }
      if (UNSAFE_PATH_SEGMENTS.has(segment)) {
        throw invalid(options.errorCode, `Predicate path contains unsafe segment '${segment}'`);
      }
      return segment;
    });
    return Object.freeze({ kind: "path", scope: operand.scope, path: Object.freeze(path) });
  }
  throw invalid(options.errorCode, `Unsupported predicate operand '${String((operand as { kind?: unknown }).kind)}'`);
}

function consumeBudget(options: {
  readonly budget: { remaining: number };
  readonly errorCode: FrameworkErrorCode;
  readonly maxDepth: number;
  readonly maxNodes: number;
}): void {
  options.budget.remaining -= 1;
  if (options.budget.remaining < 0) {
    throw invalid(
      options.errorCode,
      `Predicate expression cannot exceed ${options.maxDepth} levels or ${options.maxNodes} nodes`
    );
  }
}

function assertScopeAvailable(
  scope: PredicateScope,
  availableScopes: ReadonlySet<PredicateScope>,
  errorCode: FrameworkErrorCode
): void {
  if (!availableScopes.has(scope)) {
    throw invalid(errorCode, `Predicate scope '${scope}' is not available in this context`);
  }
}

function assertOperatorAllowedForOperand(
  doctype: DocTypeDefinition,
  operand: PredicateOperand,
  operator: PredicateOperator,
  errorCode: FrameworkErrorCode
): void {
  if (operand.kind !== "field") {
    return;
  }
  const field = requirePredicateField(doctype, operand.field, errorCode);
  const supported: PredicateOperator[] = ["eq", "ne", "in", "not_in", "is"];
  if (["text", "longText", "link"].includes(field.type)) {
    supported.push("contains", "like", "not_like");
  }
  if (["integer", "number", "date", "datetime"].includes(field.type)) {
    supported.push("gt", "gte", "lt", "lte", "between", "not_between");
  }
  if (!supported.includes(operator)) {
    throw invalid(errorCode, `Predicate field '${operand.field}' does not support ${operator}`);
  }
}

function assertStaticOperatorValue(
  operator: PredicateOperator,
  right: PredicateOperand,
  errorCode: FrameworkErrorCode
): void {
  if (right.kind !== "literal") {
    return;
  }
  if ((operator === "in" || operator === "not_in") && !Array.isArray(right.value)) {
    throw invalid(errorCode, `Predicate operator '${operator}' requires an array value`);
  }
  if ((operator === "between" || operator === "not_between") &&
    (!Array.isArray(right.value) || right.value.length !== 2)) {
    throw invalid(errorCode, `Predicate operator '${operator}' requires exactly two values`);
  }
  if (operator === "is" && right.value !== "set" && right.value !== "not set") {
    throw invalid(errorCode, "Predicate operator 'is' requires 'set' or 'not set'");
  }
}

type PredicateValueType = "array" | "boolean" | "date" | "datetime" | "null" | "number" | "object" | "string" | "unknown";

function assertOperandCompatibility(
  doctype: DocTypeDefinition,
  left: PredicateOperand,
  operator: PredicateOperator,
  right: PredicateOperand,
  errorCode: FrameworkErrorCode
): void {
  const leftType = predicateOperandType(doctype, left, errorCode);
  const rightType = predicateOperandType(doctype, right, errorCode);
  if (operator === "is") {
    if (right.kind !== "literal") {
      throw invalid(errorCode, "Predicate operator 'is' requires a literal operand");
    }
    return;
  }
  if (operator === "in" || operator === "not_in" || operator === "between" || operator === "not_between") {
    if (right.kind !== "literal" || !Array.isArray(right.value)) {
      throw invalid(errorCode, `Predicate operator '${operator}' requires a literal array operand`);
    }
    for (const value of right.value) {
      if ((leftType === "date" || leftType === "datetime") && typeof value === "string") {
        continue;
      }
      assertCompatibleTypes(leftType, literalValueType(value), operator, errorCode);
    }
    return;
  }
  if (operator === "contains" || operator === "like" || operator === "not_like") {
    assertStringCompatible(leftType, operator, "left", errorCode);
    assertStringCompatible(rightType, operator, "right", errorCode);
    return;
  }
  if (operator === "gt" || operator === "gte" || operator === "lt" || operator === "lte") {
    assertOrderedType(leftType, operator, "left", errorCode);
    if ((leftType === "date" || leftType === "datetime") &&
      right.kind === "literal" && typeof right.value === "string") {
      return;
    }
    assertOrderedType(rightType, operator, "right", errorCode);
    assertCompatibleTypes(leftType, rightType, operator, errorCode);
    return;
  }
  if ((leftType === "date" || leftType === "datetime") &&
    right.kind === "literal" && typeof right.value === "string") {
    return;
  }
  assertCompatibleTypes(leftType, rightType, operator, errorCode);
}

function predicateOperandType(
  doctype: DocTypeDefinition,
  operand: PredicateOperand,
  errorCode: FrameworkErrorCode
): PredicateValueType {
  if (operand.kind === "path") {
    return "unknown";
  }
  if (operand.kind === "literal") {
    return literalValueType(operand.value);
  }
  const field = requirePredicateField(doctype, operand.field, errorCode);
  switch (field.type) {
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "text":
    case "longText":
    case "link":
    case "select":
      return "string";
    case "json":
    case "table":
      return "unknown";
  }
}

function literalValueType(value: JsonValue): PredicateValueType {
  if (value === null) {
    return "null";
  }
  if (Array.isArray(value)) {
    return "array";
  }
  if (typeof value === "object") {
    return "object";
  }
  if (typeof value === "number") {
    return "number";
  }
  if (typeof value === "boolean") {
    return "boolean";
  }
  return "string";
}

function assertStringCompatible(
  type: PredicateValueType,
  operator: PredicateOperator,
  side: "left" | "right",
  errorCode: FrameworkErrorCode
): void {
  if (type !== "string" && type !== "unknown") {
    throw invalid(errorCode, `Predicate operator '${operator}' requires a string-compatible ${side} operand`);
  }
}

function assertOrderedType(
  type: PredicateValueType,
  operator: PredicateOperator,
  side: "left" | "right",
  errorCode: FrameworkErrorCode
): void {
  if (!["number", "date", "datetime", "unknown"].includes(type)) {
    throw invalid(errorCode, `Predicate operator '${operator}' requires an ordered ${side} operand`);
  }
}

function assertCompatibleTypes(
  left: PredicateValueType,
  right: PredicateValueType,
  operator: PredicateOperator,
  errorCode: FrameworkErrorCode
): void {
  if (left === "unknown" || right === "unknown" || right === "null" || left === right) {
    return;
  }
  throw invalid(errorCode, `Predicate operator '${operator}' has incompatible ${left} and ${right} operands`);
}

function predicateOperandValue(
  operand: PredicateOperand,
  context: PredicateEvaluationContext
): JsonValue | undefined {
  if (operand.kind === "literal") {
    return operand.value;
  }
  if (operand.kind === "field") {
    return predicateDocumentValue(operand.scope === "before" ? context.before : context.after, operand.field);
  }
  const root = operand.scope === "input"
    ? context.input
    : operand.scope === "event"
      ? context.event
      : context.actor;
  return readPredicatePath(root, operand.path);
}

function predicateDocumentValue(document: DocumentSnapshot | null, field: string): JsonValue | undefined {
  if (document === null) {
    return undefined;
  }
  switch (field) {
    case "system.name":
      return document.name;
    case "system.docstatus":
      return document.docstatus;
    case "system.createdAt":
      return document.createdAt;
    case "system.updatedAt":
      return document.updatedAt;
    case "system.version":
      return document.version;
    default:
      return document.data[field];
  }
}

function readPredicatePath(root: unknown, path: readonly string[]): JsonValue | undefined {
  let current: unknown = root;
  for (const segment of path) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return isJsonValue(current) ? current : undefined;
}

function comparePredicateValues(
  actual: JsonValue | undefined,
  operator: PredicateOperator,
  expected: JsonValue | undefined
): boolean {
  switch (operator) {
    case "eq":
      return jsonValuesEqual(actual, expected);
    case "ne":
      return actual !== undefined && actual !== null && !jsonValuesEqual(actual, expected);
    case "in":
      return actual !== undefined && actual !== null && Array.isArray(expected) &&
        expected.some((value) => jsonValuesEqual(actual, value));
    case "not_in":
      return actual !== undefined && actual !== null && Array.isArray(expected) &&
        !expected.some((value) => jsonValuesEqual(actual, value));
    case "is":
      return expected === "set"
        ? actual !== undefined && actual !== null
        : expected === "not set" && (actual === undefined || actual === null);
    case "contains":
      return actual !== undefined && actual !== null && expected !== undefined && expected !== null &&
        String(actual).toLowerCase().includes(String(expected).toLowerCase());
    case "like":
      return actual !== undefined && actual !== null && typeof expected === "string" &&
        likePatternMatches(actual, expected);
    case "not_like":
      return actual !== undefined && actual !== null && typeof expected === "string" &&
        !likePatternMatches(actual, expected);
    case "gt":
      return comparable(actual, expected) && compareValues(actual, expected) > 0;
    case "gte":
      return comparable(actual, expected) && compareValues(actual, expected) >= 0;
    case "lt":
      return comparable(actual, expected) && compareValues(actual, expected) < 0;
    case "lte":
      return comparable(actual, expected) && compareValues(actual, expected) <= 0;
    case "between":
      return actual !== undefined && actual !== null && Array.isArray(expected) && expected.length === 2 &&
        comparable(actual, expected[0]) && comparable(actual, expected[1]) &&
        compareValues(actual, expected[0]) >= 0 && compareValues(actual, expected[1]) <= 0;
    case "not_between":
      return actual !== undefined && actual !== null && Array.isArray(expected) && expected.length === 2 &&
        comparable(actual, expected[0]) && comparable(actual, expected[1]) &&
        (compareValues(actual, expected[0]) < 0 || compareValues(actual, expected[1]) > 0);
  }
}

export function jsonValuesEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === right) {
    return true;
  }
  if (left === undefined || right === undefined || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => jsonValuesEqual(value, right[index]));
  }
  if (typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  const leftObject = left as Readonly<Record<string, JsonValue>>;
  const rightObject = right as Readonly<Record<string, JsonValue>>;
  const leftKeys = Object.keys(leftObject).sort();
  const rightKeys = Object.keys(rightObject).sort();
  return leftKeys.length === rightKeys.length && leftKeys.every((key, index) =>
    key === rightKeys[index] && jsonValuesEqual(leftObject[key], rightObject[key])
  );
}

function comparable(left: JsonValue | undefined, right: JsonValue | undefined):
  left is JsonPrimitive {
  return left !== undefined && left !== null && right !== undefined && right !== null &&
    !Array.isArray(left) && !Array.isArray(right) && typeof left !== "object" && typeof right !== "object";
}

function compareValues(left: JsonPrimitive, right: JsonValue | undefined): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left).localeCompare(String(right ?? ""));
}

function likePatternMatches(actual: JsonValue, pattern: string): boolean {
  return new RegExp(`^${likePatternRegex(pattern)}$`, "i").test(String(actual));
}

function likePatternRegex(pattern: string): string {
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

function requirePredicateField(
  doctype: DocTypeDefinition,
  fieldName: string,
  errorCode: FrameworkErrorCode
): FieldDefinition {
  const field = SYSTEM_PREDICATE_FIELDS.get(fieldName) ?? doctype.fields.find((candidate) => candidate.name === fieldName);
  if (!field) {
    throw invalid(errorCode, `Predicate field '${fieldName}' is not defined on ${doctype.name}`);
  }
  if (field.type === "table" || field.type === "json") {
    throw invalid(errorCode, `Predicate field '${fieldName}' cannot be a ${field.type} field`);
  }
  return field;
}

function isPredicateOperator(value: unknown): value is PredicateOperator {
  return typeof value === "string" && PREDICATE_OPERATORS.includes(value as PredicateOperator);
}

function isListFilterGroupExpression(
  expression: ListFilterExpression
): expression is Extract<ListFilterExpression, { readonly kind: "group" }> {
  return "kind" in expression && expression.kind === "group";
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(errorCode: FrameworkErrorCode, message: string): FrameworkError {
  return new FrameworkError(errorCode, message, { status: 400 });
}
