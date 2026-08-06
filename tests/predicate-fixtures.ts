import type {
  JsonValue,
  PredicateExpression,
  PredicateOperator
} from "../src/core/types.js";

export function afterField(
  field: string,
  value: JsonValue,
  operator: PredicateOperator = "eq"
): PredicateExpression {
  return {
    kind: "compare",
    left: { kind: "field", scope: "after", field },
    operator,
    right: { kind: "literal", value }
  };
}

export function beforeField(
  field: string,
  value: JsonValue,
  operator: PredicateOperator = "eq"
): PredicateExpression {
  return {
    kind: "compare",
    left: { kind: "field", scope: "before", field },
    operator,
    right: { kind: "literal", value }
  };
}

export function predicateGroup(
  match: "all" | "any",
  ...predicates: readonly PredicateExpression[]
): PredicateExpression {
  return { kind: "group", match, predicates };
}
