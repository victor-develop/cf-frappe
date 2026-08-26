import { defineDocType } from "../../src";
import type { ListDocumentsQuery, PredicateExpression } from "../../src";
import { afterField, predicateGroup } from "../predicate-fixtures";
import { createProjectionEngine, projectionRows, type ProjectionEngine } from "../sqlite-engine";

// These assertions run against a real SQLite engine so the claims in
// docs/projection-indexes.md are asserted rather than re-probed by hand.
// node:sqlite is not D1's SQLite build, so assert index reachability and result
// correctness, never cost estimates or choices between close candidates.

const Task = defineDocType({
  name: "Task",
  fields: [
    { name: "status", type: "text" },
    { name: "priority", type: "text" },
    { name: "assignee", type: "text" }
  ],
  indexes: [["status"], ["status", "priority"]]
});

const Project = defineDocType({
  name: "Project",
  fields: [{ name: "status", type: "text" }]
});

const TASK_STATUS_INDEX = /idx_cf_frappe_documents_task_status_[a-f0-9]{8}/;
const TASK_STATUS_PRIORITY_INDEX = /idx_cf_frappe_documents_task_status_priority_[a-f0-9]{8}/;

function listQuery(overrides: Partial<ListDocumentsQuery> = {}): ListDocumentsQuery {
  return { tenantId: "t1", doctype: "Task", limit: 50, ...overrides };
}

describe("D1 projection plans on a real SQLite engine", () => {
  let engine: ProjectionEngine;

  beforeEach(() => {
    engine = createProjectionEngine([Task, Project]);
    engine.insert(projectionRows({ doctype: "Task", count: 2000, statusCount: 50, prefix: "T" }));
    engine.insert(projectionRows({ doctype: "Project", count: 400, statusCount: 50, prefix: "P" }));
  });

  afterEach(() => {
    engine.close();
  });

  it("accepts the planned schema and index DDL", () => {
    // createProjectionEngine applies migrations/0001 plus every planned index;
    // reaching here means real SQLite accepted the partial expression indexes.
    expect(engine.total(listQuery())).toBe(2000);
    expect(engine.total(listQuery({ doctype: "Project" }))).toBe(400);
  });

  it("serves an eq filter with the default order from the declared index, without sorting", () => {
    const query = listQuery({ predicate: afterField("status", "S7") });

    expect(engine.plan(query)).toMatch(TASK_STATUS_INDEX);
    expect(engine.sorts(query)).toBe(false);
    expect(engine.total(query)).toBe(40);
  });

  it("serves an eq filter on every indexed field from the two-field index", () => {
    const query = listQuery({
      predicate: predicateGroup("all", afterField("status", "S7"), afterField("priority", "Med"))
    });

    expect(engine.plan(query)).toMatch(TASK_STATUS_PRIORITY_INDEX);
    expect(engine.sorts(query)).toBe(false);
  });

  it("never applies one DocType's partial index to another DocType", () => {
    const query = listQuery({ doctype: "Project", predicate: afterField("status", "S7") });

    expect(engine.plan(query)).not.toMatch(TASK_STATUS_INDEX);
    expect(engine.plan(query)).not.toMatch(TASK_STATUS_PRIORITY_INDEX);
    // Correctness, not just plan shape: every returned row is a Project row.
    const names = engine.names(query);
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((name) => name.startsWith("P-"))).toBe(true);
  });

  it("orders by the default updatedAt without a sort, in both directions", () => {
    for (const order of ["asc", "desc"] as const) {
      const query = listQuery({ predicate: afterField("status", "S7"), order });
      expect(engine.sorts(query)).toBe(false);
    }
  });

  it("sorts for the ordering shapes the index cannot serve", () => {
    // Documented in docs/projection-indexes.md: only the default `updatedAt`
    // ordering is covered. `name` is served by the primary key instead.
    expect(engine.sorts(listQuery({ predicate: afterField("status", "S7"), orderBy: "name" }))).toBe(false);
    for (const orderBy of ["createdAt", "version", "status"]) {
      const query = listQuery({ predicate: afterField("status", "S7"), orderBy });
      expect(engine.sorts(query)).toBe(true);
    }
  });

  it("reads an in filter off the list index, and gathering statistics makes it sort", () => {
    // Called out in the docs: the Desk multi-select status filter generates `in`.
    // Unanalyzed it streams from the list index in order; statistics push it onto
    // the declared index and add the sort it did not previously need.
    const query = listQuery({ predicate: afterField("status", ["S1", "S2", "S3"], "in") });

    expect(engine.plan(query)).toContain("idx_cf_frappe_documents_list");
    expect(engine.sorts(query)).toBe(false);
    const names = engine.names(query);

    engine.analyze();

    expect(engine.plan(query)).toMatch(TASK_STATUS_INDEX);
    expect(engine.sorts(query)).toBe(true);
    // The regression is in the plan, not the answer.
    expect(engine.names(query)).toEqual(names);
  });

  it("falls back to the list index when the filter is not the index prefix", () => {
    const query = listQuery({ predicate: afterField("assignee", "someone") });

    expect(engine.plan(query)).toContain("idx_cf_frappe_documents_list");
    expect(engine.plan(query)).not.toMatch(TASK_STATUS_INDEX);
  });

  it("pushes a negation into SQL instead of filtering in memory", () => {
    // `not` used to force every candidate row through an in-memory pass. It now
    // compiles to a null-safe `IS NOT 1`, so the engine answers the question.
    // Parity with the in-memory adapter, including absent and JSON-null fields,
    // is asserted in d1-projection-negation.test.ts.
    const predicate: PredicateExpression = { kind: "not", predicate: afterField("status", "S7") };
    const query = listQuery({ predicate, limit: 2000 });

    expect(engine.names(query).length).toBe(1960);
    expect(engine.total(query)).toBe(1960);
  });

  it("loses the list index for the plain list when statistics are gathered while empty", () => {
    // Why nothing in the framework runs ANALYZE, and why clearD1Statistics exists:
    // statistics gathered before the data arrives record a zero-row estimate that
    // then costs the unfiltered list its index.
    const empty = createProjectionEngine([Task, Project]);
    try {
      empty.analyze();
      empty.insert(projectionRows({ doctype: "Task", count: 2000, statusCount: 50, prefix: "T" }));

      const query = listQuery();
      expect(empty.plan(query)).not.toContain("idx_cf_frappe_documents_list");
      expect(empty.sorts(query)).toBe(true);

      // Every recorded estimate is zero — the signature of an empty-table ANALYZE.
      expect(empty.statistics().length).toBeGreaterThan(0);
      expect(empty.statistics().every((entry) => entry.stat.startsWith("0 "))).toBe(true);

      // Clearing removes them. Note that SQLite loads sqlite_stat1 when a
      // connection opens, so a connection that already read them keeps its plans
      // until it is replaced — on Workers that is the next request.
      empty.clearStatistics();
      expect(empty.statistics()).toEqual([]);
    } finally {
      empty.close();
    }
  });

  it("keeps every plan identical when statistics are gathered with data present", () => {
    // The measurement recorded in docs/projection-indexes.md: statistics change
    // no plan for the shapes served by the declared indexes.
    const queries = [
      listQuery(),
      listQuery({ predicate: afterField("status", "S7") }),
      listQuery({ predicate: predicateGroup("all", afterField("status", "S7"), afterField("priority", "Med")) }),
      listQuery({ doctype: "Project", predicate: afterField("status", "S7") })
    ];
    const before = queries.map((query) => engine.plan(query));

    engine.analyze();

    expect(queries.map((query) => engine.plan(query))).toEqual(before);
  });
});
