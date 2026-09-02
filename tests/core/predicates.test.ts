import { describe, expect, it } from "vitest";
import {
  evaluatePredicateExpression,
  normalizePredicateExpression,
  predicateExpressionFromListFilterExpression
} from "../../src/core/predicates.js";
import type {
  Actor,
  DocTypeDefinition,
  DocumentSnapshot,
  PredicateExpression,
  PredicateOperand
} from "../../src/core/types.js";

const doctype: DocTypeDefinition = {
  name: "Task",
  fields: [
    { name: "status", type: "select", options: ["Open", "Done"] },
    { name: "score", type: "number" },
    { name: "owner", type: "text" }
  ]
};

describe("predicate kernel", () => {
  it("evaluates before, after, input, event, and actor scopes deterministically", () => {
    const expression: PredicateExpression = {
      kind: "group",
      match: "all",
      predicates: [
        compare(field("before", "status"), "eq", literal("Open")),
        compare(field("after", "status"), "eq", literal("Done")),
        compare(path("input", "reason"), "contains", literal("ship")),
        compare(path("event", "payload.kind"), "eq", literal("DocumentUpdated")),
        compare(path("actor", "id"), "eq", field("after", "owner"))
      ]
    };

    expect(evaluatePredicateExpression(expression, {
      before: snapshot({ status: "Open", score: 1, owner: "owner@example.com" }),
      after: snapshot({ status: "Done", score: 2, owner: "owner@example.com" }, 2),
      input: { reason: "ship release" },
      event: {
        id: "evt_1",
        tenantId: "default",
        stream: "default:Task:TASK-1",
        sequence: 2,
        type: "TaskUpdated",
        doctype: "Task",
        documentName: "TASK-1",
        actorId: "owner@example.com",
        occurredAt: "2026-08-05T00:00:00.000Z",
        payload: { kind: "DocumentUpdated", patch: { status: "Done" } },
        metadata: {}
      },
      actor: actor()
    })).toBe(true);
  });

  it("normalizes and freezes bounded expressions while rejecting unavailable scopes", () => {
    const normalized = normalizePredicateExpression(doctype, compare(
      field("after", "score"),
      "gte",
      literal(10)
    ), { availableScopes: ["after"] });

    expect(normalized).toEqual(compare(field("after", "score"), "gte", literal(10)));
    expect(Object.isFrozen(normalized)).toBe(true);
    expect(() => normalizePredicateExpression(doctype, compare(
      field("before", "status"),
      "eq",
      literal("Open")
    ), { availableScopes: ["after"] })).toThrow("scope 'before' is not available");
  });

  it("rejects invalid paths, fields, operators, and over-depth trees", () => {
    expect(() => normalizePredicateExpression(doctype, compare(
      path("input", "__proto__.polluted"),
      "eq",
      literal(true)
    ), { availableScopes: ["input"] })).toThrow("unsafe segment");

    expect(() => normalizePredicateExpression(doctype, compare(
      field("after", "missing"),
      "eq",
      literal("x")
    ))).toThrow("is not defined on Task");

    expect(() => normalizePredicateExpression(doctype, compare(
      field("after", "score"),
      "contains",
      literal("1")
    ))).toThrow("does not support contains");

    const nested: PredicateExpression = {
      kind: "not",
      predicate: {
        kind: "not",
        predicate: compare(field("after", "status"), "eq", literal("Open"))
      }
    };
    expect(() => normalizePredicateExpression(doctype, nested, { maxDepth: 1 })).toThrow("cannot exceed 1 levels");
  });

  it("rejects malformed predicate grammar at every public AST boundary", () => {
    const cases: ReadonlyArray<readonly [unknown, string]> = [
      [null, "must be an object"],
      [{ kind: "group", match: "none", predicates: [compare(field("after", "status"), "eq", literal("Open"))] }, "match must be all or any"],
      [{ kind: "group", match: "all", predicates: [] }, "at least one predicate"],
      [{ kind: "unknown" }, "Unsupported predicate kind"],
      [{ kind: "compare", left: field("after", "status"), operator: "unknown", right: literal("Open") }, "Unsupported predicate operator"],
      [{ kind: "compare", left: null, operator: "eq", right: literal("Open") }, "operand must be an object"],
      [{ kind: "compare", left: { kind: "field", scope: "after", field: "" }, operator: "eq", right: literal("Open") }, "field must be a non-empty string"],
      [{ kind: "compare", left: { kind: "path", scope: "input", path: [] }, operator: "eq", right: literal("Open") }, "between 1 and 16 segments"],
      [{ kind: "compare", left: { kind: "path", scope: "input", path: [1] }, operator: "eq", right: literal("Open") }, "segments must be non-empty strings"],
      [{ kind: "compare", left: { kind: "path", scope: "input", path: ["constructor"] }, operator: "eq", right: literal("Open") }, "unsafe segment"],
      [{ kind: "compare", left: { kind: "unknown" }, operator: "eq", right: literal("Open") }, "Unsupported predicate operand"],
      [{ kind: "compare", left: field("after", "status"), operator: "in", right: literal("Open") }, "requires an array value"],
      [{ kind: "compare", left: field("after", "score"), operator: "between", right: { kind: "literal", value: [1] } }, "requires exactly two values"],
      [{ kind: "compare", left: field("after", "status"), operator: "is", right: literal("missing") }, "requires 'set' or 'not set'"],
      [{ kind: "compare", left: field("after", "status"), operator: "is", right: field("after", "owner") }, "requires a literal operand"]
    ];

    for (const [expression, message] of cases) {
      expect(() => normalizePredicateExpression(
        doctype,
        expression as PredicateExpression,
        { availableScopes: ["after", "input"] }
      )).toThrow(message);
    }
  });

  it("validates operators against both operand types", () => {
    expect(() => normalizePredicateExpression(doctype, compare(
      field("after", "score"),
      "eq",
      literal("10")
    ))).toThrow("incompatible number and string operands");

    expect(() => normalizePredicateExpression(doctype, compare(
      field("after", "score"),
      "eq",
      field("after", "status")
    ))).toThrow("incompatible number and string operands");

    expect(() => normalizePredicateExpression(doctype, compare(
      field("after", "owner"),
      "contains",
      literal(10)
    ))).toThrow("requires a string-compatible right operand");

    expect(() => normalizePredicateExpression(doctype, {
      kind: "compare",
      left: field("after", "status"),
      operator: "in",
      right: field("after", "owner")
    })).toThrow("requires a literal array operand");
  });

  it("uses the predicate evaluator for normalized query filter expressions", () => {
    const expression = predicateExpressionFromListFilterExpression({
      kind: "group",
      match: "all",
      filters: [
        { field: "status", value: "Done" },
        { field: "score", operator: "gte", value: 2 }
      ]
    });

    expect(evaluatePredicateExpression(expression, {
      before: null,
      after: snapshot({ status: "Done", score: 2, owner: "owner@example.com" }),
      input: {}
    })).toBe(true);
  });

  it("folds case in contains and like by the regexp Canonicalize rule", () => {
    // Absolute expectations, not `contains === like`. An equality assertion only
    // pins the delegation: swapping the *shared* rule to `toLowerCase` keeps
    // both operators agreeing and passes. These values are what the ES `i`-flag
    // Canonicalize does, and the rule itself is what issue #41's SQL pushdown
    // depends on being reproducible.
    //
    // Each row below is a case where the two operators disagreed before #53.
    const expectations: ReadonlyArray<readonly [string, string, boolean]> = [
      // Greek variant letters: folded by the regexp, not by `toLowerCase`.
      ["\u03c3igma", "\u03c2", true],
      ["\u03c2igma", "\u03c3", true],
      ["\u03a3igma", "\u03c2", true],
      ["\u00b5 meter", "\u03bc", true],
      ["\u03d1eta", "\u03b8", true],
      // Canonicalize refuses any mapping that reaches ASCII from outside it, so
      // these are *not* folded even though `toLowerCase` folds them.
      ["\u0130stanbul", "i", false],
      ["\u212a" + "lvin", "k", false],
      // Nor any mapping that changes length.
      ["Stra\u00dfe", "SS", false],
      // Plain ASCII and Latin-1 fold as expected.
      ["\u00c4rger", "\u00e4", true],
      ["OPENED", "pen", true]
    ];

    for (const [value, needle, expected] of expectations) {
      expect(evaluate("contains", value, needle), `contains ${JSON.stringify(value)} / ${JSON.stringify(needle)}`).toBe(
        expected
      );
      expect(evaluate("like", value, `%${needle}%`), `like ${JSON.stringify(value)} / ${JSON.stringify(needle)}`).toBe(
        expected
      );
    }
  });

  it("keeps matching correctly past the compiled-pattern cache bound", () => {
    // The cache is cleared wholesale when it fills, so a workload that cycles
    // through more distinct patterns than the bound must still match correctly
    // rather than serve a stale or missing compilation.
    for (let index = 0; index < 600; index += 1) {
      expect(evaluate("like", `value-${index}`, `%${index}`)).toBe(true);
      expect(evaluate("like", `value-${index}`, `%${index}x`)).toBe(false);
    }
    expect(evaluate("contains", "50% off", "50%")).toBe(true);
  });

  it("does not fold case outside the BMP", () => {
    // The `i` flag without `u` canonicalizes per UTF-16 code unit, so cased
    // astral scripts — Deseret here, and also Adlam, Osage, Vithkuqi, Warang
    // Citi, Medefaidrin and Old Hungarian — are matched case-sensitively. 614
    // codepoint pairs are affected. This is a real narrowing against the old
    // `toLowerCase` rule for `contains`, and it is the price of having one rule
    // that SQL can reproduce; it is called out in docs rather than papered over.
    expect(evaluate("contains", "x\u{10400}y", "\u{10400}")).toBe(true);
    expect(evaluate("contains", "x\u{10400}y", "\u{10428}")).toBe(false);
    expect(evaluate("like", "x\u{10400}y", "%\u{10428}%")).toBe(false);
  });

  it("treats like wildcards in a contains needle as literal text", () => {
    // `contains` builds a `like` pattern, so an unescaped needle would turn a
    // user's "50%" into a prefix match and "a_b" into a single-character
    // wildcard.
    expect(evaluate("contains", "50% off", "50%")).toBe(true);
    expect(evaluate("contains", "500 off", "50%")).toBe(false);
    expect(evaluate("contains", "a_b", "a_b")).toBe(true);
    expect(evaluate("contains", "axb", "a_b")).toBe(false);
    expect(evaluate("contains", "back\\slash", "ck\\sl")).toBe(true);
    expect(evaluate("contains", "cksl", "ck\\sl")).toBe(false);
    // A trailing backslash is literal in a needle, unlike in a `like` pattern
    // where it escapes nothing and can never match.
    expect(evaluate("contains", "trailing\\", "ing\\")).toBe(true);
    expect(evaluate("like", "trailing\\", "%ing\\")).toBe(false);
  });
});

function evaluate(operator: "contains" | "like", value: string, needle: string): boolean {
  return evaluatePredicateExpression(
    { kind: "compare", left: field("after", "owner"), operator, right: literal(needle) },
    { before: null, after: snapshot({ status: "Done", score: 1, owner: value }), input: {} }
  );
}

function compare(
  left: PredicateOperand,
  operator: "eq" | "gte" | "contains",
  right: PredicateOperand
): PredicateExpression {
  return { kind: "compare", left, operator, right };
}

function field(scope: "before" | "after", name: string) {
  return { kind: "field" as const, scope, field: name };
}

function path(scope: "input" | "event" | "actor", value: string) {
  return { kind: "path" as const, scope, path: value.split(".") };
}

function literal(value: string | number | boolean) {
  return { kind: "literal" as const, value };
}

function actor(): Actor {
  return { id: "owner@example.com", roles: ["User"] };
}

function snapshot(data: Record<string, string | number>, version = 1): DocumentSnapshot {
  return {
    tenantId: "default",
    doctype: "Task",
    name: "TASK-1",
    version,
    docstatus: "draft",
    data,
    createdAt: "2026-08-05T00:00:00.000Z",
    updatedAt: "2026-08-05T00:00:00.000Z"
  };
}
