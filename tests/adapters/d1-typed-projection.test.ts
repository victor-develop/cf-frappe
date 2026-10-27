import {
  D1DocumentStore,
  D1ProjectionStore,
  D1TypedProjectionStore,
  D1_MAX_COLUMNS_PER_TABLE,
  D1_TYPED_PROJECTION_COLUMN_BUDGET,
  D1_TYPED_PROJECTION_SYSTEM_COLUMNS,
  D1_TYPED_PROJECTION_TABLE_PREFIX,
  FrameworkError,
  d1TypedProjectionDdl,
  defineDocType,
  planD1Migrations,
  planD1TypedProjectionLayout,
  planD1TypedProjectionMigrations,
  planD1TypedProjections,
  renderD1Migration,
  type D1TypedProjectionShadowWriteFailure,
  type DocTypeDefinition,
  type DocumentData,
  type DocumentSnapshot,
  type FieldDefinition,
  type ListDocumentsQuery,
  type NewDomainEvent,
  type PredicateExpression
} from "../../src";
import { afterField, predicateGroup } from "../predicate-fixtures";
import { createTestD1, frameworkSchema, type TestD1 } from "../d1-engine";

/**
 * Typed per-DocType projection tables (issue #15), on the real SQLite engine.
 *
 * The acceptance criteria, in the order the issue lists them:
 *
 * 1. a per-DocType table is generated from DocType metadata;
 * 2. which fields are hot is declared once;
 * 3. approaching D1's 100-column limit is a named error, never a truncation;
 * 4. the query compiler answers promoted and unpromoted fields identically,
 *    so `application` cannot tell which table served it;
 * 5. the typed table runs beside the shared one and is compared row by row.
 *
 * (5) is also exercised end to end by the golden replays in
 * tests/golden/replay.test.ts and by the rebuild flow in
 * tests/application/typed-projection-rebuild.test.ts.
 */

const TENANT = "acme";

const Ticket = defineDocType({
  name: "Ticket",
  fields: [
    { name: "title", type: "text" },
    { name: "status", type: "select", options: ["Open", "Closed"] },
    { name: "priority", type: "integer" },
    { name: "estimate", type: "number" },
    { name: "urgent", type: "boolean" },
    { name: "due", type: "date" },
    { name: "customer id", type: "text" },
    { name: "notes", type: "longText" },
    { name: "meta", type: "json" }
  ],
  indexes: [["status"], ["status", "priority"]],
  promotedFields: ["title", "estimate", "urgent", "due", "customer id"]
});

function snapshot(name: string, data: DocumentData, updatedAt: string, version = 1): DocumentSnapshot {
  return {
    tenantId: TENANT,
    doctype: "Ticket",
    name,
    version,
    docstatus: "draft",
    data,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt
  };
}

/**
 * Rows chosen for the places where a column and `json_extract` could part ways:
 * a missing key, a JSON null, `''` in a non-text field, booleans, integers next
 * to reals, mixed case and non-ASCII text, and a tie on `updatedAt`.
 */
const ROWS: readonly DocumentSnapshot[] = [
  snapshot("T-01", { title: "Ärger", status: "Open", priority: 1, estimate: 1.5, urgent: true, due: "2026-02-01", "customer id": "C-1", notes: "alpha", meta: { a: 1 } }, "2026-01-02T00:00:00.000Z"),
  snapshot("T-02", { title: "apple pie", status: "Open", priority: 3, estimate: 2, urgent: false, due: "2026-03-01", "customer id": "C-2", notes: "beta" }, "2026-01-03T00:00:00.000Z"),
  snapshot("T-03", { title: "Banana", status: "Closed", priority: 2, estimate: 10, urgent: true, "customer id": "C-1" }, "2026-01-04T00:00:00.000Z"),
  snapshot("T-04", { title: null, status: "Open", priority: null, estimate: null, urgent: null, due: null }, "2026-01-05T00:00:00.000Z"),
  snapshot("T-05", { status: "Closed" }, "2026-01-06T00:00:00.000Z"),
  snapshot("T-06", { title: "", status: "", priority: "", estimate: "", urgent: "", due: "" }, "2026-01-07T00:00:00.000Z"),
  snapshot("T-07", { title: "value 100% ready", status: "Open", priority: 3, estimate: 2.0000001, urgent: false, due: "2026-02-01", notes: "Ärger" }, "2026-01-07T00:00:00.000Z"),
  snapshot("T-08", { title: "B", status: "Closed", priority: -4, estimate: -0.5, urgent: false, due: "2025-12-31", "customer id": "C-3" }, "2026-01-08T00:00:00.000Z")
];

function typedSchema(doctypes: readonly DocTypeDefinition[]): readonly string[] {
  return [...frameworkSchema(), ...planD1TypedProjectionMigrations(doctypes).map(renderD1Migration)];
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof FrameworkError ? error.code : `not a FrameworkError: ${String(error)}`;
  }
  return undefined;
}

function fields(count: number): readonly FieldDefinition[] {
  return Array.from({ length: count }, (_, index) => ({ name: `f${String(index).padStart(3, "0")}`, type: "text" as const }));
}

describe("typed projection layout: generated from DocType metadata", () => {
  it("plans a per-DocType table whose promoted columns are generated from data_json", () => {
    const layout = planD1TypedProjectionLayout(Ticket);

    expect(layout.table).toMatch(new RegExp(`^${D1_TYPED_PROJECTION_TABLE_PREFIX}ticket_[0-9a-f]{8}$`));
    expect(layout.columns.map((column) => [column.field, column.column, column.fieldType])).toEqual([
      ["customer id", "f_customer_id", "text"],
      ["due", "f_due", "date"],
      ["estimate", "f_estimate", "number"],
      ["priority", "f_priority", "integer"],
      ["status", "f_status", "select"],
      ["title", "f_title", "text"],
      ["urgent", "f_urgent", "boolean"]
    ]);
    expect(layout.columnCount).toBe(D1_TYPED_PROJECTION_SYSTEM_COLUMNS.length + 7);

    const ddl = d1TypedProjectionDdl(layout).map((statement) => statement.sql).join("\n");
    expect(ddl).toContain("f_status AS (json_extract(data_json, '$.status')) STORED");
    expect(ddl).toContain("f_customer_id AS (json_extract(data_json, '$.customer id')) STORED");
    // Cold fields are not columns; they stay in data_json.
    expect(ddl).not.toContain("f_notes");
    expect(ddl).not.toContain("f_meta");
    // One table per DocType: indexes need no doctype column or partial predicate.
    expect(ddl).toContain(`ON ${layout.table} (tenant_id, f_status, updated_at)`);
    expect(ddl).toContain(`ON ${layout.table} (tenant_id, f_status, f_priority, updated_at)`);
    expect(ddl).not.toContain("WHERE doctype");
  });

  it("creates on a real engine, with generated columns SQLite computes itself", () => {
    const d1 = createTestD1({ schema: typedSchema([Ticket]) });
    const layout = planD1TypedProjectionLayout(Ticket);
    const info = d1.query(`PRAGMA table_xinfo(${layout.table})`);
    // `hidden` 3 is a STORED generated column.
    expect(info.filter((column) => column.hidden === 3).map((column) => column.name)).toEqual(
      layout.columns.map((column) => column.column)
    );
    // No declared type, so no affinity: see the layout module's comment.
    expect(info.filter((column) => column.hidden === 3).every((column) => column.type === "")).toBe(true);
    d1.close();
  });

  it("is off by default: the migration plan is unchanged unless typed tables are asked for", () => {
    const plain = planD1Migrations([Ticket]);
    expect(planD1Migrations([Ticket], { typedProjections: false })).toEqual(plain);
    expect(plain.some((migration) => migration.id.includes("_typed_"))).toBe(false);

    const typed = planD1Migrations([Ticket], { typedProjections: true });
    expect(typed.slice(0, plain.length)).toEqual(plain);
    const added = typed.slice(plain.length);
    expect(added.map((migration) => migration.id)).toEqual([
      `doctype_ticket_typed_${planD1TypedProjectionLayout(Ticket).digest}`
    ]);
  });

  it("moves the digest when the layout moves, and only then", () => {
    const base = planD1TypedProjectionLayout(Ticket);
    const reordered = planD1TypedProjectionLayout(defineDocType({ ...Ticket, fields: [...Ticket.fields].reverse() }));
    const relabelled = planD1TypedProjectionLayout(defineDocType({ ...Ticket, version: 7, label: "Tickets" }));
    expect(reordered.table).toBe(base.table);
    expect(relabelled.table).toBe(base.table);

    const retyped = planD1TypedProjectionLayout(defineDocType({
      ...Ticket,
      fields: Ticket.fields.map((field) => field.name === "due" ? { ...field, type: "datetime" as const } : field)
    }));
    const demoted = planD1TypedProjectionLayout(defineDocType({ ...Ticket, promotedFields: ["title"] }));
    const reindexed = planD1TypedProjectionLayout(defineDocType({ ...Ticket, indexes: [["priority", "status"], ["status"]] }));
    for (const changed of [retyped, demoted, reindexed]) {
      expect(changed.table).not.toBe(base.table);
    }
  });

  it("keeps generated table names inside the reserved prefix and away from framework tables", () => {
    const table = planD1TypedProjectionLayout(defineDocType({ name: "Documents", fields: [] })).table;
    expect(table.startsWith(D1_TYPED_PROJECTION_TABLE_PREFIX)).toBe(true);
    expect(table).not.toBe("cf_frappe_documents");
  });
});

describe("typed projection layout: hot fields are declared once", () => {
  it("refuses an empty index or one that repeats a field, as the shared-table planner does", () => {
    expect(codeOf(() => planD1TypedProjectionLayout(defineDocType({ ...Ticket, indexes: [[]] }))))
      .toBe("MIGRATION_INDEX_INVALID");
    expect(codeOf(() => planD1TypedProjectionLayout(defineDocType({ ...Ticket, indexes: [["status", "status"]] }))))
      .toBe("MIGRATION_INDEX_DUPLICATE");
  });

  it("derives hot fields from indexes, so an indexed field needs no second declaration", () => {
    const Only = defineDocType({
      name: "Only",
      fields: [{ name: "a", type: "text" }, { name: "b", type: "text" }],
      indexes: [["a"]]
    });
    expect(planD1TypedProjectionLayout(Only).columns.map((column) => column.field)).toEqual(["a"]);
  });

  it("refuses an indexed field listed again in promotedFields", () => {
    expect(codeOf(() => planD1TypedProjectionLayout(defineDocType({ ...Ticket, promotedFields: ["status"] }))))
      .toBe("MIGRATION_TYPED_PROJECTION_INVALID");
  });

  it("refuses unknown, json, table, repeated and colliding promotions", () => {
    const cases: readonly Partial<DocTypeDefinition>[] = [
      { promotedFields: ["missing"] },
      { promotedFields: ["meta"] },
      { promotedFields: ["title", "title"] },
      { indexes: [["missing"]] },
      {
        fields: [...Ticket.fields, { name: "customer_id", type: "text" }],
        promotedFields: ["customer id", "customer_id"]
      },
      {
        fields: [...Ticket.fields, { name: "Title", type: "text" }],
        promotedFields: ["title", "Title"]
      }
    ];
    for (const change of cases) {
      expect(codeOf(() => planD1TypedProjectionLayout(defineDocType({ ...Ticket, ...change }))), JSON.stringify(change))
        .toBe("MIGRATION_TYPED_PROJECTION_INVALID");
    }
  });
});

describe("typed projection layout: the 100-column limit", () => {
  const promotable = D1_MAX_COLUMNS_PER_TABLE - D1_TYPED_PROJECTION_SYSTEM_COLUMNS.length;

  function wide(count: number): DocTypeDefinition {
    const all = fields(count);
    return defineDocType({ name: "Wide", fields: all, promotedFields: all.map((field) => field.name) });
  }

  it("errors by name once the default budget is crossed, rather than dropping columns", () => {
    const atBudget = D1_TYPED_PROJECTION_COLUMN_BUDGET - D1_TYPED_PROJECTION_SYSTEM_COLUMNS.length;
    expect(planD1TypedProjectionLayout(wide(atBudget)).columnCount).toBe(D1_TYPED_PROJECTION_COLUMN_BUDGET);

    let error: unknown;
    try {
      planD1TypedProjectionLayout(wide(atBudget + 1));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(FrameworkError);
    expect((error as FrameworkError).code).toBe("MIGRATION_TYPED_PROJECTION_COLUMN_LIMIT");
    expect((error as FrameworkError).message).toContain("'Wide'");
    expect((error as FrameworkError).message).toContain(`needs ${D1_TYPED_PROJECTION_COLUMN_BUDGET + 1} columns`);
  });

  it("can use the headroom deliberately up to D1's limit, and the table really fits", () => {
    const layout = planD1TypedProjectionLayout(wide(promotable), { maxColumns: D1_MAX_COLUMNS_PER_TABLE });
    expect(layout.columnCount).toBe(D1_MAX_COLUMNS_PER_TABLE);
    const d1 = createTestD1({ schema: d1TypedProjectionDdl(layout).map((statement) => statement.sql) });
    expect(d1.query(`PRAGMA table_xinfo(${layout.table})`)).toHaveLength(D1_MAX_COLUMNS_PER_TABLE);
    d1.close();
  });

  it("never goes past D1's limit, whatever the option says", () => {
    expect(codeOf(() => planD1TypedProjectionLayout(wide(promotable + 1), { maxColumns: D1_MAX_COLUMNS_PER_TABLE })))
      .toBe("MIGRATION_TYPED_PROJECTION_COLUMN_LIMIT");
    expect(codeOf(() => planD1TypedProjectionLayout(wide(1), { maxColumns: D1_MAX_COLUMNS_PER_TABLE + 1 })))
      .toBe("MIGRATION_TYPED_PROJECTION_INVALID");
    expect(codeOf(() => planD1Migrations([wide(promotable)], { typedProjections: true })))
      .toBe("MIGRATION_TYPED_PROJECTION_COLUMN_LIMIT");
  });
});

describe("typed projection query compiler: transparent to callers", () => {
  let d1: TestD1;
  let shared: D1ProjectionStore;
  let typed: D1TypedProjectionStore;

  beforeEach(async () => {
    d1 = createTestD1({ schema: typedSchema([Ticket]) });
    shared = new D1ProjectionStore(d1.database);
    typed = new D1TypedProjectionStore(d1.database, { layouts: [planD1TypedProjectionLayout(Ticket)] });
    for (const row of ROWS) {
      await shared.save(row);
      await typed.save(row);
    }
  });

  afterEach(() => {
    d1.close();
  });

  const predicates: ReadonlyArray<readonly [string, PredicateExpression | undefined]> = [
    ["no predicate", undefined],
    ...(["status", "title", "notes", "customer id"] as const).flatMap((field) => [
      [`${field} eq`, afterField(field, field === "status" ? "Open" : "Ärger")],
      [`${field} eq null`, afterField(field, null)],
      [`${field} ne`, afterField(field, "Open", "ne")],
      [`${field} ne null`, afterField(field, null, "ne")],
      [`${field} in`, afterField(field, ["Open", "Banana", "C-1", "alpha", null], "in")],
      [`${field} not_in`, afterField(field, ["Open", "B"], "not_in")],
      [`${field} is set`, afterField(field, "set", "is")],
      [`${field} is not set`, afterField(field, "not set", "is")],
      [`${field} contains`, afterField(field, "ä", "contains")],
      [`${field} like`, afterField(field, "%p%", "like")],
      [`${field} not_like`, afterField(field, "%a%", "not_like")],
      [`${field} gt`, afterField(field, "B", "gt")],
      [`${field} between`, afterField(field, ["A", "C"], "between")],
      [`${field} not_between`, afterField(field, ["A", "C"], "not_between")],
      [`not ${field} eq`, { kind: "not", predicate: afterField(field, "Open") } as PredicateExpression]
    ] as const),
    ...(["priority", "estimate"] as const).flatMap((field) => [
      [`${field} eq`, afterField(field, 3)],
      [`${field} eq real`, afterField(field, 2)],
      [`${field} eq string`, afterField(field, "3")],
      [`${field} eq empty`, afterField(field, "")],
      [`${field} gt`, afterField(field, 1, "gt")],
      [`${field} lte`, afterField(field, 2, "lte")],
      [`${field} between`, afterField(field, [0, 2.5], "between")],
      [`${field} not_between`, afterField(field, [0, 2.5], "not_between")],
      [`${field} in`, afterField(field, [1, 2, "3"], "in")],
      [`not ${field} gt`, { kind: "not", predicate: afterField(field, 1, "gt") } as PredicateExpression]
    ] as const),
    ["urgent eq true", afterField("urgent", true)],
    ["urgent eq false", afterField("urgent", false)],
    ["urgent ne true", afterField("urgent", true, "ne")],
    ["urgent eq 1", afterField("urgent", 1)],
    ["due gte", afterField("due", "2026-02-01", "gte")],
    ["due lt", afterField("due", "2026-02-01", "lt")],
    ["system field", afterField("system.version", 1)],
    ["mixed group", predicateGroup("any", afterField("status", "Closed"), afterField("notes", "%ä%", "like"))],
    [
      "nested group",
      predicateGroup(
        "all",
        predicateGroup("any", afterField("priority", 3), afterField("urgent", true)),
        { kind: "not", predicate: afterField("customer id", "C-2") }
      )
    ]
  ];

  const orderings: ReadonlyArray<Pick<ListDocumentsQuery, "orderBy" | "order">> = [
    {},
    { orderBy: "name", order: "asc" },
    { orderBy: "createdAt", order: "desc" },
    { orderBy: "status", order: "asc" },
    { orderBy: "priority", order: "desc" },
    { orderBy: "estimate", order: "asc" },
    { orderBy: "title", order: "asc" },
    { orderBy: "notes", order: "desc" }
  ];

  it("answers every predicate and ordering with the same rows, order and total as the shared table", async () => {
    let checked = 0;
    for (const [label, predicate] of predicates) {
      for (const ordering of orderings) {
        for (const page of [{ limit: 50, offset: 0 }, { limit: 3, offset: 2 }]) {
          const query: ListDocumentsQuery = {
            tenantId: TENANT,
            doctype: "Ticket",
            ...(predicate === undefined ? {} : { predicate }),
            ...ordering,
            ...page
          };
          const [expected, actual] = await Promise.all([shared.list(query), typed.list(query)]);
          expect(actual, `${label} ${JSON.stringify(ordering)} ${JSON.stringify(page)}`).toEqual(expected);
          checked += 1;
        }
      }
    }
    expect(checked).toBe(predicates.length * orderings.length * 2);
  });

  it("keeps `eq null` meaning present-and-null on a promoted field, which its column alone cannot say", async () => {
    // T-04 holds JSON null, T-05 has no `title` key: both are SQL NULL in f_title.
    for (const store of [typed, shared]) {
      const result = await store.list({ tenantId: TENANT, doctype: "Ticket", predicate: afterField("title", null), orderBy: "name", order: "asc" });
      expect(result.data.map((row) => row.name)).toEqual(["T-04"]);
      const negated = await store.list({
        tenantId: TENANT,
        doctype: "Ticket",
        predicate: { kind: "not", predicate: afterField("title", null) },
        orderBy: "name",
        order: "asc"
      });
      expect(negated.data.map((row) => row.name)).not.toContain("T-04");
      expect(negated.data.map((row) => row.name)).toContain("T-05");
    }
  });

  it("reads promoted fields from their column and cold fields from data_json", async () => {
    const before = d1.statements.length;
    await typed.list({
      tenantId: TENANT,
      doctype: "Ticket",
      predicate: predicateGroup("all", afterField("status", "Open"), afterField("notes", "alpha")),
      orderBy: "priority"
    });
    const sql = d1.statements.slice(before).map((statement) => statement.sql).join("\n");
    expect(sql).toContain("f_status = ?");
    expect(sql).not.toContain("json_extract(data_json, '$.status')");
    expect(sql).toContain("json_extract(data_json, '$.notes') = ?");
    expect(sql).toContain("f_priority IS NULL ASC, f_priority COLLATE BINARY DESC");
    expect(sql).not.toContain("doctype = ?");
  });

  it("reads a field the same way in index DDL and in query predicates", async () => {
    // The typed-table counterpart of d1-json-path.test.ts: an index is only
    // used if the query names exactly what the index stores.
    const layout = planD1TypedProjectionLayout(Ticket);
    const ddl = d1TypedProjectionDdl(layout).map((statement) => statement.sql).join("\n");
    for (const fieldsOfIndex of Ticket.indexes ?? []) {
      const before = d1.statements.length;
      await typed.list({
        tenantId: TENANT,
        doctype: "Ticket",
        predicate: predicateGroup("all", ...fieldsOfIndex.map((field) => afterField(field, "x")))
      });
      const sql = d1.statements[before]!.sql;
      for (const field of fieldsOfIndex) {
        const column = layout.columns.find((candidate) => candidate.field === field)!.column;
        expect(sql).toContain(`${column} = ?`);
        expect(ddl).toContain(column);
      }
    }
  });

  it("serves an equality filter on a promoted column from its index", () => {
    const layout = planD1TypedProjectionLayout(Ticket);
    const plan = d1.query(
      `EXPLAIN QUERY PLAN SELECT name FROM ${layout.table} WHERE tenant_id = ? AND f_status = ? ORDER BY updated_at COLLATE BINARY DESC`,
      TENANT,
      "Open"
    ).map((row) => String(row.detail)).join(" | ");
    expect(plan).toContain(layout.indexes[0]!.name);
    expect(plan).not.toContain("TEMP B-TREE");
  });

  it("gets a document back byte for byte, with the table's DocType attached", async () => {
    for (const row of ROWS) {
      expect(await typed.get(TENANT, "Ticket", row.name)).toEqual(await shared.get(TENANT, "Ticket", row.name));
    }
    expect(await typed.get(TENANT, "Ticket", "nope")).toBeNull();
    expect(await typed.get("other-tenant", "Ticket", "T-01")).toBeNull();
  });

  it("scopes list and remove by tenant", async () => {
    await typed.save({ ...ROWS[0]!, tenantId: "other-tenant" });
    expect((await typed.list({ tenantId: "other-tenant", doctype: "Ticket" })).total).toBe(1);
    await typed.remove(TENANT, "Ticket", "T-01");
    expect(await typed.get(TENANT, "Ticket", "T-01")).toBeNull();
    expect(await typed.get("other-tenant", "Ticket", "T-01")).not.toBeNull();
  });

  it("never lets an older snapshot overwrite a newer one", async () => {
    await typed.save({ ...ROWS[0]!, version: 3, data: { ...ROWS[0]!.data, status: "Closed" } });
    await typed.save({ ...ROWS[0]!, version: 2, data: { ...ROWS[0]!.data, status: "Open" } });
    expect((await typed.get(TENANT, "Ticket", "T-01"))?.version).toBe(3);
    expect((await typed.get(TENANT, "Ticket", "T-01"))?.data.status).toBe("Closed");
    // Equal versions still write: a re-save is how a rebuild repairs a row.
    await typed.save({ ...ROWS[0]!, version: 3, data: { ...ROWS[0]!.data, status: "Open" } });
    expect((await typed.get(TENANT, "Ticket", "T-01"))?.data.status).toBe("Open");
  });

  it("delegates a DocType without a typed table to the fallback, or refuses to answer for it", async () => {
    const note: DocumentSnapshot = { ...ROWS[0]!, doctype: "Note", name: "N-1" };
    const withFallback = new D1TypedProjectionStore(d1.database, {
      layouts: [planD1TypedProjectionLayout(Ticket)],
      fallback: shared
    });
    await withFallback.save(note);
    expect(await shared.get(TENANT, "Note", "N-1")).toEqual(note);
    expect(await withFallback.get(TENANT, "Note", "N-1")).toEqual(note);
    expect((await withFallback.list({ tenantId: TENANT, doctype: "Note" })).total).toBe(1);

    // Without one, writes of foreign rows are ignored and reads are refused.
    await typed.save({ ...note, name: "N-2" });
    expect(await shared.get(TENANT, "Note", "N-2")).toBeNull();
    await expect(typed.list({ tenantId: TENANT, doctype: "Note" })).rejects.toMatchObject({
      code: "D1_TYPED_PROJECTION_UNKNOWN_DOCTYPE"
    });
    await expect(typed.get(TENANT, "Note", "N-1")).rejects.toMatchObject({ code: "D1_TYPED_PROJECTION_UNKNOWN_DOCTYPE" });
  });
});

describe("typed projection columns: field-level type constraints", () => {
  let d1: TestD1;
  let typed: D1TypedProjectionStore;

  beforeEach(() => {
    d1 = createTestD1({ schema: typedSchema([Ticket]) });
    typed = new D1TypedProjectionStore(d1.database, { layouts: [planD1TypedProjectionLayout(Ticket)] });
  });

  afterEach(() => {
    d1.close();
  });

  const accepted: ReadonlyArray<readonly [string, DocumentData]> = [
    ["every type's own values", ROWS[0]!.data],
    ["null and missing everywhere", {}],
    ["'' everywhere, which validation treats as missing", ROWS[5]!.data],
    ["a whole-valued number in a number field", { estimate: 2 }]
  ];
  const rejected: ReadonlyArray<readonly [string, DocumentData]> = [
    ["a number in a text field", { title: 5 }],
    ["a number in a select field", { status: 1 }],
    ["a string in an integer field", { priority: "3" }],
    ["a real in an integer field", { priority: 1.5 }],
    ["a string in a number field", { estimate: "2" }],
    ["a string in a boolean field", { urgent: "true" }],
    ["a number other than 0/1 in a boolean field", { urgent: 2 }],
    ["the number 1 in a boolean field, which json_extract cannot tell from true", { urgent: 1 }],
    ["an integer too large for SQLite, which json_extract returns as a real", { priority: 1e21 }],
    ["an object in a date field", { due: { y: 2026 } }],
    ["an array in a text field", { "customer id": ["C-1"] }]
  ];

  for (const [label, data] of accepted) {
    it(`accepts ${label}`, async () => {
      await typed.save(snapshot("T-ok", data, "2026-01-01T00:00:00.000Z"));
      expect((await typed.get(TENANT, "Ticket", "T-ok"))?.data).toEqual(data);
    });
  }

  for (const [label, data] of rejected) {
    it(`rejects ${label} instead of coercing it`, async () => {
      await expect(typed.save(snapshot("T-bad", data, "2026-01-01T00:00:00.000Z"))).rejects.toThrow(/CHECK constraint failed/);
      expect(await typed.get(TENANT, "Ticket", "T-bad")).toBeNull();
    });
  }

  it("leaves cold fields unconstrained, exactly as the shared table does", async () => {
    await typed.save(snapshot("T-cold", { notes: 42, meta: [1, 2] }, "2026-01-01T00:00:00.000Z"));
    expect((await typed.get(TENANT, "Ticket", "T-cold"))?.data).toEqual({ notes: 42, meta: [1, 2] });
  });
});

describe("D1DocumentStore with typed projections", () => {
  const STREAM = "acme:Ticket:T-01";

  function created(id: string, data: DocumentData): NewDomainEvent {
    return {
      id,
      tenantId: TENANT,
      stream: STREAM,
      type: "Ticket.created",
      doctype: "Ticket",
      documentName: "T-01",
      actorId: "u1",
      occurredAt: "2026-01-01T00:00:00.000Z",
      payload: { kind: "DocumentCreated", data } as never,
      metadata: {}
    };
  }

  function projectAt(version: number, data: DocumentData) {
    return () => snapshot("T-01", data, "2026-01-01T00:00:00.000Z", version);
  }

  const table = planD1TypedProjectionLayout(Ticket).table;
  const activeTicket = { doctypes: { Ticket: { mode: "active", table } } } as const;

  it("writes exactly what it always did when typed projections are off", async () => {
    const plain = createTestD1({ schema: typedSchema([Ticket]) });
    const off = createTestD1({ schema: typedSchema([Ticket]) });
    await new D1DocumentStore(plain.database).commit(STREAM, 0, [created("e1", { status: "Open" })], projectAt(1, { status: "Open" }));
    await new D1DocumentStore(off.database, {
      typedProjections: planD1TypedProjections([Ticket], { mode: "off" })
    }).commit(STREAM, 0, [created("e1", { status: "Open" })], projectAt(1, { status: "Open" }));

    expect(off.statements).toEqual(plain.statements);
    expect(off.query(`SELECT COUNT(*) AS n FROM ${table}`)[0]!.n).toBe(0);
    plain.close();
    off.close();
  });

  it("writes an active table inside the commit's atomic batch", async () => {
    const d1 = createTestD1({ schema: typedSchema([Ticket]) });
    const store = new D1DocumentStore(d1.database, {
      typedProjections: planD1TypedProjections([Ticket], activeTicket)
    });
    await store.commit(STREAM, 0, [created("e1", { status: "Open" })], projectAt(1, { status: "Open" }));
    expect(d1.query(`SELECT name, f_status FROM ${table}`)).toEqual([{ name: "T-01", f_status: "Open" }]);
    d1.close();

    // Atomic: a failing typed write takes the events and the shared row with it.
    const failing = createTestD1({ schema: typedSchema([Ticket]), failSqlIncludes: `INSERT INTO ${table}` });
    const failingStore = new D1DocumentStore(failing.database, {
      typedProjections: planD1TypedProjections([Ticket], activeTicket)
    });
    await expect(
      failingStore.commit(STREAM, 0, [created("e1", { status: "Open" })], projectAt(1, { status: "Open" }))
    ).rejects.toThrow(/planned statement failed/);
    expect(failing.query("SELECT COUNT(*) AS n FROM cf_frappe_events")[0]!.n).toBe(0);
    expect(failing.query("SELECT COUNT(*) AS n FROM cf_frappe_documents")[0]!.n).toBe(0);
    failing.close();
  });

  it("reports a CHECK rejection on an active table as a typed-projection error, not a concurrency conflict", async () => {
    const d1 = createTestD1({ schema: typedSchema([Ticket]) });
    const store = new D1DocumentStore(d1.database, {
      typedProjections: planD1TypedProjections([Ticket], activeTicket)
    });
    await expect(
      store.commit(STREAM, 0, [created("e1", { title: 5 })], projectAt(1, { title: 5 }))
    ).rejects.toMatchObject({
      code: "D1_TYPED_PROJECTION_CONSTRAINT_FAILED",
      status: 409,
      issues: [expect.objectContaining({ field: "title" })]
    });
    expect(d1.query("SELECT COUNT(*) AS n FROM cf_frappe_events")[0]!.n).toBe(0);
    // The caller learns the field, not the schema: D1's own message quotes the
    // CHECK expression, with the internal table, column and JSON path in it.
    const error = (await store
      .commit(STREAM, 0, [created("e1", { title: 5 })], projectAt(1, { title: 5 }))
      .catch((caught: unknown) => caught)) as Error;
    expect(error.message).toContain("field 'title'");
    expect(error.message).not.toMatch(/cf_frappe_p_|json_type|CHECK constraint/);
    d1.close();
  });

  it("writes a shadow table after the commit, and a shadow failure never fails the commit", async () => {
    const d1 = createTestD1({ schema: typedSchema([Ticket]) });
    const store = new D1DocumentStore(d1.database, {
      typedProjections: planD1TypedProjections([Ticket], { mode: "shadow" })
    });
    await store.commit(STREAM, 0, [created("e1", { status: "Open" })], projectAt(1, { status: "Open" }));
    expect(d1.query(`SELECT name, version FROM ${table}`)).toEqual([{ name: "T-01", version: 1 }]);
    // Its own statement, after the atomic batch.
    const inserts = d1.statements.filter((statement) => statement.sql.includes(`INSERT INTO ${table}`));
    expect(inserts).toHaveLength(1);
    d1.close();

    const failures: D1TypedProjectionShadowWriteFailure[] = [];
    const failing = createTestD1({ schema: typedSchema([Ticket]), failSqlIncludes: `INSERT INTO ${table}` });
    const failingStore = new D1DocumentStore(failing.database, {
      typedProjections: planD1TypedProjections([Ticket], {
        mode: "shadow",
        onShadowWriteFailure: (failure) => failures.push(failure)
      })
    });
    const commit = await failingStore.commit(STREAM, 0, [created("e1", { status: "Open" })], projectAt(1, { status: "Open" }));
    expect(commit.snapshot.version).toBe(1);
    expect(failing.query("SELECT COUNT(*) AS n FROM cf_frappe_events")[0]!.n).toBe(1);
    expect(failures).toEqual([
      expect.objectContaining({ table, tenantId: TENANT, doctype: "Ticket", name: "T-01", version: 1 })
    ]);
    failing.close();
  });

  it("leaves DocTypes without a typed table, and internal rows, on the shared table only", async () => {
    const d1 = createTestD1({ schema: typedSchema([Ticket]) });
    const store = new D1DocumentStore(d1.database, {
      typedProjections: planD1TypedProjections([Ticket], activeTicket)
    });
    await store.commitBatch(
      [{ stream: STREAM, expectedVersion: 0, events: [created("e1", { status: "Open" })] }],
      () => ({
        snapshot: snapshot("T-01", { status: "Open" }, "2026-01-01T00:00:00.000Z"),
        auxiliarySnapshots: [{ ...snapshot("seq", { current: 1 }, "2026-01-01T00:00:00.000Z"), doctype: "__NamingSeries" }]
      })
    );
    expect(d1.query(`SELECT name FROM ${table}`)).toEqual([{ name: "T-01" }]);
    expect(d1.query("SELECT doctype, name FROM cf_frappe_documents ORDER BY doctype")).toEqual([
      { doctype: "Ticket", name: "T-01" },
      { doctype: "__NamingSeries", name: "seq" }
    ]);
    d1.close();
  });
});

describe("planD1TypedProjections", () => {
  it("resolves a default mode with per-DocType overrides", () => {
    const Other = defineDocType({ name: "Other", fields: [] });
    const plan = planD1TypedProjections([Ticket, Other], {
      mode: "shadow",
      doctypes: { Ticket: { mode: "active", table: planD1TypedProjectionLayout(Ticket).table } }
    });
    expect(plan.mode("Ticket")).toBe("active");
    expect(plan.mode("Other")).toBe("shadow");
    expect(plan.mode("Unregistered")).toBe("off");
    expect(plan.active.map((layout) => layout.doctype)).toEqual(["Ticket"]);
    expect(plan.shadow.map((layout) => layout.doctype)).toEqual(["Other"]);

    const off = planD1TypedProjections([Ticket, Other]);
    expect(off.active).toEqual([]);
    expect(off.shadow).toEqual([]);
    expect(off.layout("Ticket")).toBeUndefined();
  });

  it("refuses an unknown DocType or mode at startup", () => {
    expect(codeOf(() => planD1TypedProjections([Ticket], { doctypes: { Tikcet: "active" } })))
      .toBe("D1_TYPED_PROJECTION_UNKNOWN_DOCTYPE");
    expect(codeOf(() => planD1TypedProjections([Ticket], { mode: "on" as never })))
      .toBe("MIGRATION_TYPED_PROJECTION_INVALID");
    expect(codeOf(() => planD1TypedProjections([Ticket], { doctypes: { Ticket: "yes" as never } })))
      .toBe("MIGRATION_TYPED_PROJECTION_INVALID");
    expect(codeOf(() => planD1TypedProjections([Ticket], { doctypes: { Ticket: { mode: "active", table: 7 as never } } })))
      .toBe("MIGRATION_TYPED_PROJECTION_INVALID");
  });

  it("refuses an active DocType that does not name the table it was verified on", () => {
    const v1 = planD1TypedProjectionLayout(Ticket).table;
    expect(codeOf(() => planD1TypedProjections([Ticket], { doctypes: { Ticket: "active" } })))
      .toBe("D1_TYPED_PROJECTION_ACTIVE_UNPINNED");
    // A default of `active` reaches every DocType, and each still needs its pin.
    expect(codeOf(() => planD1TypedProjections([Ticket], { mode: "active" })))
      .toBe("D1_TYPED_PROJECTION_ACTIVE_UNPINNED");
    expect(() => planD1TypedProjections([Ticket], { doctypes: { Ticket: "active" } })).toThrow(v1);
    // Shadow and off need no pin: nothing reads them.
    expect(planD1TypedProjections([Ticket], { mode: "shadow" }).layout("Ticket")?.table).toBe(v1);
    expect(planD1TypedProjections([Ticket], { doctypes: { Ticket: { mode: "off", table: "anything" } } }).mode("Ticket"))
      .toBe("off");
  });

  it("refuses to follow an active DocType onto a new layout's table", () => {
    // v1 was rebuilt, compared and pinned. Each routine layout change below
    // moves the digest, so the DocType would silently read and write a new,
    // empty table; planning must refuse instead.
    const pin = { doctypes: { Ticket: { mode: "active", table: planD1TypedProjectionLayout(Ticket).table } } } as const;
    expect(planD1TypedProjections([Ticket], pin).active.map((layout) => layout.table))
      .toEqual([pin.doctypes.Ticket.table]);
    const changed = [
      defineDocType({ ...Ticket, indexes: [...(Ticket.indexes ?? []), ["priority"]] }),
      defineDocType({ ...Ticket, promotedFields: [...(Ticket.promotedFields ?? []), "notes"] }),
      defineDocType({
        ...Ticket,
        fields: Ticket.fields.map((field) => field.name === "priority" ? { ...field, type: "number" as const } : field)
      })
    ];
    for (const doctype of changed) {
      expect(planD1TypedProjectionLayout(doctype).table).not.toBe(pin.doctypes.Ticket.table);
      expect(codeOf(() => planD1TypedProjections([doctype], pin)), JSON.stringify(doctype.indexes))
        .toBe("D1_TYPED_PROJECTION_LAYOUT_MISMATCH");
    }
    // A pinned shadow DocType is checked the same way.
    expect(codeOf(() => planD1TypedProjections([changed[0]!], {
      doctypes: { Ticket: { mode: "shadow", table: pin.doctypes.Ticket.table } }
    }))).toBe("D1_TYPED_PROJECTION_LAYOUT_MISMATCH");
  });
});

describe("retiring a superseded typed table", () => {
  it("plans a drop for a retired table and refuses to retire a live one", () => {
    const live = planD1TypedProjectionLayout(Ticket).table;
    const old = `${D1_TYPED_PROJECTION_TABLE_PREFIX}ticket_00000000`;
    const migrations = planD1TypedProjectionMigrations([Ticket], { retiredTables: [old] });
    expect(migrations.at(-1)).toMatchObject({
      id: `typed_projection_retire_${old}`,
      statements: [{ sql: `DROP TABLE IF EXISTS ${old};` }]
    });

    expect(codeOf(() => planD1TypedProjectionMigrations([Ticket], { retiredTables: [live] })))
      .toBe("MIGRATION_TYPED_PROJECTION_INVALID");
    for (const bad of ["cf_frappe_documents", `${old}; DROP TABLE cf_frappe_events`, "cf_frappe_p_X"]) {
      expect(codeOf(() => planD1TypedProjectionMigrations([Ticket], { retiredTables: [bad] })), bad)
        .toBe("MIGRATION_TYPED_PROJECTION_INVALID");
    }
    expect(codeOf(() => planD1TypedProjectionMigrations([Ticket], { retiredTables: [old, old] })))
      .toBe("MIGRATION_TYPED_PROJECTION_INVALID");
  });

  it("drops the old table on a real engine and keeps the new one", () => {
    const old = planD1TypedProjectionLayout(defineDocType({ ...Ticket, promotedFields: ["title"] }));
    const d1 = createTestD1({
      schema: [
        ...frameworkSchema(),
        ...d1TypedProjectionDdl(old).map((statement) => statement.sql),
        ...planD1TypedProjectionMigrations([Ticket], { retiredTables: [old.table] }).map(renderD1Migration)
      ]
    });
    const tables = d1.query("SELECT name FROM sqlite_schema WHERE type = 'table' AND name LIKE 'cf_frappe_p_%'");
    expect(tables).toEqual([{ name: planD1TypedProjectionLayout(Ticket).table }]);
    d1.close();
  });
});
