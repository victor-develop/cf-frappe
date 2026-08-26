import {
  D1ProjectionStore,
  InMemoryProjectionStore,
  defineDocType
} from "../../src";
import type { DocumentSnapshot, ListDocumentsQuery, PredicateExpression } from "../../src";
import { afterField, predicateGroup } from "../predicate-fixtures";
import { createProjectionEngine, type ProjectionEngine } from "../sqlite-engine";

// Parity between the D1 adapter and the in-memory adapter, asserted against a
// real SQLite engine. The fake in d1-projection-store.test.ts interprets a
// subset of SQL by hand, so it cannot judge whether a compiled predicate is
// right — it can only judge whether it recognises the shape.
//
// The interesting rows are the ones where the field is absent or JSON null: the
// in-memory evaluator treats a missing field as a failed match, so its negation
// keeps the row, while a naive `NOT (expr = ?)` in SQL drops it.

const Note = defineDocType({
  name: "Note",
  fields: [
    { name: "title", type: "text" },
    { name: "priority", type: "text" }
  ],
  indexes: [["title"], ["priority"]]
});

const SNAPSHOTS: readonly DocumentSnapshot[] = [
  snapshot("Umlaut", { title: "Ärger", priority: "Low" }),
  snapshot("Literal", { title: "Value 100% Ready", priority: "Low" }),
  snapshot("Routine", { title: "Routine", priority: "High" }),
  snapshot("JsonNull", { title: null, priority: "Low" }),
  snapshot("Missing", { priority: "Low" })
];

describe("D1 projection predicate parity on a real SQLite engine", () => {
  let engine: ProjectionEngine;
  let d1: D1ProjectionStore;
  let memory: InMemoryProjectionStore;

  beforeEach(async () => {
    engine = createProjectionEngine([Note]);
    d1 = new D1ProjectionStore(engine.asD1Database());
    memory = new InMemoryProjectionStore();
    for (const document of SNAPSHOTS) {
      await d1.save(document);
      await memory.save(document);
    }
  });

  afterEach(() => {
    engine.close();
  });

  const cases: ReadonlyArray<readonly [string, PredicateExpression, readonly string[]]> = [
    [
      "not(eq) keeps rows whose field is absent or JSON null",
      { kind: "not", predicate: afterField("title", "Routine") },
      ["JsonNull", "Literal", "Missing", "Umlaut"]
    ],
    [
      "not(ne) is not the same as eq",
      { kind: "not", predicate: afterField("title", "Routine", "ne") },
      ["JsonNull", "Missing", "Routine"]
    ],
    [
      "not(in) keeps absent and null",
      { kind: "not", predicate: afterField("title", ["Routine", "Ärger"], "in") },
      ["JsonNull", "Literal", "Missing"]
    ],
    [
      "not(is set) is presence",
      { kind: "not", predicate: afterField("title", "set", "is") },
      ["JsonNull", "Missing"]
    ],
    [
      "not(group all) via De Morgan",
      {
        kind: "not",
        predicate: predicateGroup("all", afterField("priority", "Low"), afterField("title", "Ärger"))
      },
      ["JsonNull", "Literal", "Missing", "Routine"]
    ],
    [
      "not(not(eq)) cancels",
      { kind: "not", predicate: { kind: "not", predicate: afterField("title", "Routine") } },
      ["Routine"]
    ],
    ["eq on a pushed-down field", afterField("priority", "Low"), ["JsonNull", "Literal", "Missing", "Umlaut"]],
    [
      "contains folds case over the full Unicode range",
      afterField("title", "ä", "contains"),
      ["Umlaut"]
    ],
    ["like honours escaped wildcards", afterField("title", "value 100\\%%", "like"), ["Literal"]],
    ["not_like requires the field to be present", afterField("title", "%ä%", "not_like"), ["Literal", "Routine"]],
    [
      "any-group mixing a pushed-down branch with a refined one",
      predicateGroup("any", afterField("priority", "High"), afterField("title", "ä%", "like")),
      ["Routine", "Umlaut"]
    ]
  ];

  for (const [label, predicate, expected] of cases) {
    it(label, async () => {
      const query: ListDocumentsQuery = { tenantId: "acme", doctype: "Note", predicate, orderBy: "name", order: "asc" };
      const [fromD1, fromMemory] = await Promise.all([d1.list(query), memory.list(query)]);

      expect(fromD1.data.map((document) => document.name)).toEqual(expected);
      expect(fromD1).toEqual(fromMemory);
    });
  }

  it("compiles negations into null-safe SQL rather than NOT (...)", async () => {
    // `NOT (expr = ?)` yields NULL for a missing key and drops the row, which is
    // the opposite of the in-memory evaluator. Guard the emitted form directly.
    const seen: string[] = [];
    const recording = new D1ProjectionStore(recordSql(engine.asD1Database(), seen));
    await recording.list({
      tenantId: "acme",
      doctype: "Note",
      predicate: { kind: "not", predicate: afterField("title", "Routine") }
    });

    expect(seen.some((sql) => sql.includes("IS NOT 1"))).toBe(true);
    expect(seen.every((sql) => !sql.includes("NOT ("))).toBe(true);
  });
});

function snapshot(name: string, data: Record<string, unknown>): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Note",
    name,
    version: 1,
    docstatus: "draft",
    data: data as DocumentSnapshot["data"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

function recordSql(db: D1Database, sink: string[]): D1Database {
  return {
    ...db,
    prepare: (sql: string) => {
      sink.push(sql);
      return db.prepare(sql);
    }
  } as unknown as D1Database;
}
