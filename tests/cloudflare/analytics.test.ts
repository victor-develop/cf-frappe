import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  ANALYTICS_PIPELINE_STREAM_SCHEMA,
  PipelinesAnalyticsSink,
  R2SqlAnalyticsReader,
  analyticsPipelineRecord,
  parseR2SqlRows,
  r2SqlAnalyticsScanSql,
  sqlStringLiteral,
  type AnalyticsPipelineRecord,
  type AnalyticsSqlDialect
} from "../../src/cloudflare/analytics.js";
import {
  AnalyticsExportService,
  InMemoryAnalyticsExportCursorStore,
  InMemoryProjectionStore,
  SYSTEM_MANAGER_ROLE,
  analyticsRowFromSnapshot,
  createRegistry,
  defineDocType,
  defineReport,
  type AnalyticsDocumentRow,
  type AnalyticsSink,
  type DocumentSnapshot
} from "../../src";

const ENDPOINT = "https://api.sql.cloudflarestorage.com/api/v1/accounts/abc123/basin-sql/query/cf-frappe-analytics";

function row(name: string, version: number, overrides: Partial<DocumentSnapshot> = {}): AnalyticsDocumentRow {
  return analyticsRowFromSnapshot(
    {
      tenantId: "acme",
      doctype: "Ticket",
      name,
      version,
      docstatus: "draft",
      data: { status: "Open" },
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: `2026-03-01T00:00:0${version}.000Z`,
      ...overrides
    },
    "2026-03-02T00:00:00.000Z"
  );
}

function reader(respond: (request: { url: string; init: RequestInit; body: { query: string } }) => Response | Promise<Response>) {
  const requests: { url: string; init: RequestInit; body: { query: string } }[] = [];
  const instance = new R2SqlAnalyticsReader({
    accountId: "abc123",
    bucket: "cf-frappe-analytics",
    table: "cf_frappe.documents",
    token: () => "secret-token",
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = { url: String(input), init: init ?? {}, body: JSON.parse(String(init?.body)) as { query: string } };
      requests.push(request);
      return respond(request);
    }) as typeof fetch
  });
  return { instance, requests };
}

function okRows(rows: readonly Record<string, unknown>[]): Response {
  return Response.json({ success: true, errors: [], messages: [], result: { rows } });
}

describe("R2 SQL scan statement", () => {
  it("ranks every version inside the derived table and filters only the winner outside it", () => {
    const sql = r2SqlAnalyticsScanSql(
      { tenantId: "acme", doctype: "Ticket", limit: 100, prefilters: [{ field: "status", value: "Open" }] },
      { table: "cf_frappe.documents", offset: 200 }
    );

    expect(sql).toBe(
      [
        "SELECT name, version, docstatus, data_json, created_at, updated_at",
        "FROM (",
        "  SELECT name, version, docstatus, data_json, created_at, updated_at,",
        "    ROW_NUMBER() OVER (PARTITION BY name ORDER BY version DESC, export_generation DESC, exported_at DESC) AS cf_rank",
        "  FROM cf_frappe.documents",
        "  WHERE tenant_id = 'acme' AND doctype = 'Ticket'",
        ") AS latest",
        "WHERE cf_rank = 1 AND docstatus <> 'deleted' AND json_get_str(data_json, 'status') = 'Open'",
        "ORDER BY name ASC",
        "LIMIT 100 OFFSET 200"
      ].join("\n")
    );
  });

  it("escapes quotes and refuses values it would have to trust the parser with", () => {
    expect(sqlStringLiteral("O'Brien")).toBe("'O''Brien'");
    expect(sqlStringLiteral("a\\b")).toBeUndefined();
    expect(sqlStringLiteral("line\nbreak")).toBeUndefined();
    expect(sqlStringLiteral("nul\u0000")).toBeUndefined();

    const sql = r2SqlAnalyticsScanSql(
      {
        tenantId: "acme",
        doctype: "Ticket",
        limit: 10,
        prefilters: [
          { field: "status", value: "x' OR '1'='1" },
          { field: "status", value: "back\\slash" },
          { field: "bad') OR 1=1 --", value: "x" }
        ]
      },
      { table: "cf_frappe.documents", offset: 0 }
    );

    // The quote is doubled, so it stays inside the literal...
    expect(sql).toContain("json_get_str(data_json, 'status') = 'x'' OR ''1''=''1'");
    // ...and the two it cannot write safely are simply not pushed down.
    expect(sql).not.toContain("back");
    expect(sql).not.toContain("OR 1=1");
  });

  it("fails as unavailable rather than inlining a tenant it cannot write safely", () => {
    expect(() =>
      r2SqlAnalyticsScanSql({ tenantId: "acme\\", doctype: "Ticket", limit: 10 }, { table: "cf_frappe.documents", offset: 0 })
    ).toThrow(expect.objectContaining({ code: "ANALYTICS_UNAVAILABLE" }));
  });

  it("only accepts a namespace.table of plain identifiers and an R2 SQL-sized limit", () => {
    for (const table of ["documents", "a.b.c", "cf.docs; DROP", "cf.\"docs\""]) {
      expect(() => r2SqlAnalyticsScanSql({ tenantId: "acme", doctype: "Ticket", limit: 10 }, { table, offset: 0 }), table).toThrow();
    }
    expect(() => r2SqlAnalyticsScanSql({ tenantId: "acme", doctype: "Ticket", limit: 10_001 }, { table: "a.b", offset: 0 })).toThrow();
  });
});

describe("R2 SQL scan statement semantics on a real SQL engine", () => {
  // R2 SQL cannot run locally. The statement's *shape* — rank in a derived
  // table, filter the winner outside it — can, by swapping the one dialect
  // function for SQLite's and running it on node:sqlite against the same rows.
  const sqliteDialect: AnalyticsSqlDialect = {
    jsonString: (column, field) => `(CASE WHEN json_type(${column}, '$.${field}') = 'text' THEN json_extract(${column}, '$.${field}') END)`
  };

  function engine(rows: readonly AnalyticsDocumentRow[]) {
    const db = new DatabaseSync(":memory:");
    db.exec("ATTACH ':memory:' AS cf_frappe");
    // No key, like the Iceberg table: every record Pipelines delivers is a row,
    // duplicates included, and only the ranking decides which one a read sees.
    db.exec(
      "CREATE TABLE cf_frappe.documents (tenant_id TEXT, doctype TEXT, name TEXT, version INTEGER, docstatus TEXT, data_json TEXT, created_at TEXT, updated_at TEXT, export_generation INTEGER, exported_at TEXT)"
    );
    const insert = db.prepare("INSERT INTO cf_frappe.documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const append = (batch: readonly AnalyticsDocumentRow[]) => {
      for (const record of batch.map(analyticsPipelineRecord)) {
        insert.run(
          record.tenant_id,
          record.doctype,
          record.name,
          record.version,
          record.docstatus,
          record.data_json,
          record.created_at,
          record.updated_at,
          record.export_generation,
          record.exported_at
        );
      }
    };
    append(rows);
    return {
      append,
      data(query: Parameters<typeof r2SqlAnalyticsScanSql>[0]) {
        const sql = r2SqlAnalyticsScanSql(query, { table: "cf_frappe.documents", offset: 0, dialect: sqliteDialect });
        return (db.prepare(sql).all() as { name: string; version: number; data_json: string }[]).map(
          (item) => `${item.name}@${item.version}:${item.data_json}`
        );
      },
      names(query: Parameters<typeof r2SqlAnalyticsScanSql>[0], offset = 0) {
        const sql = r2SqlAnalyticsScanSql(query, { table: "cf_frappe.documents", offset, dialect: sqliteDialect });
        return (db.prepare(sql).all() as { name: string; version: number }[]).map((item) => `${item.name}@${item.version}`);
      },
      close: () => db.close()
    };
  }

  it("answers with the newest version, hides deletes after choosing it, and pre-filters the winner only", () => {
    const sql = engine([
      row("T-1", 1, { data: { status: "Open" } }),
      row("T-1", 2, { data: { status: "Closed" } }),
      row("T-2", 1),
      row("T-2", 2, { docstatus: "deleted" }),
      row("T-3", 1, { data: { status: "Open" } }),
      row("T-3", 1, { data: { status: "Open" } }),
      row("T-4", 1, { tenantId: "globex" })
    ]);

    expect(sql.names({ tenantId: "acme", doctype: "Ticket", limit: 10 })).toEqual(["T-1@2", "T-3@1"]);
    expect(sql.names({ tenantId: "acme", doctype: "Ticket", limit: 10, prefilters: [{ field: "status", value: "Open" }] })).toEqual(["T-3@1"]);
    expect(sql.names({ tenantId: "acme", doctype: "Ticket", limit: 1 }, 1)).toEqual(["T-3@1"]);
    sql.close();
  });

  it("ranks a higher export generation above a later-exported older one at the same version", () => {
    const base = row("T-1", 2, { data: { total: 1 } });
    const sql = engine([
      { ...base, exportGeneration: 1, dataJson: '{"total":2}', exportedAt: "2026-03-03T00:00:00.000Z" },
      // A run in flight when the reset landed re-sends generation 0 later still.
      { ...base, exportedAt: "2026-03-04T00:00:00.000Z" },
      base,
      // Same version and generation twice: the later export wins.
      row("T-2", 1, { data: { total: 5 } }),
      { ...row("T-2", 1, { data: { total: 6 } }), exportedAt: "2026-03-03T00:00:00.000Z" }
    ]);

    expect(sql.data({ tenantId: "acme", doctype: "Ticket", limit: 10 })).toEqual(['T-1@2:{"total":2}', 'T-2@1:{"total":6}']);
    sql.close();
  });
});

describe("R2 SQL statement after a reset, on a real SQL engine", () => {
  const sqliteDialect: AnalyticsSqlDialect = {
    jsonString: (column, field) => `json_extract(${column}, '$.${field}')`
  };

  it("shows the re-exported data when a rebuild rewrote a row at the same version", async () => {
    // The scenario: a projection bug computed `total` wrong; a rebuild (#11)
    // fixes the row in place, same version, same updatedAt; the operator resets
    // the export. Iceberg keeps both rows, and the corrected one must win every
    // time, not whichever the engine happens to number first.
    const db = new DatabaseSync(":memory:");
    db.exec("ATTACH ':memory:' AS cf_frappe");
    db.exec(
      "CREATE TABLE cf_frappe.documents (tenant_id TEXT, doctype TEXT, name TEXT, version INTEGER, docstatus TEXT, data_json TEXT, created_at TEXT, updated_at TEXT, export_generation INTEGER, exported_at TEXT)"
    );
    const insert = db.prepare("INSERT INTO cf_frappe.documents VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const sink: AnalyticsSink = {
      async append(rows) {
        for (const record of rows.map(analyticsPipelineRecord)) {
          insert.run(record.tenant_id, record.doctype, record.name, record.version, record.docstatus, record.data_json, record.created_at, record.updated_at, record.export_generation, record.exported_at);
        }
      }
    };
    const projections = new InMemoryProjectionStore();
    const cursors = new InMemoryAnalyticsExportCursorStore();
    let now = "2026-03-01T00:10:00.000Z";
    const exporter = new AnalyticsExportService({
      registry: createRegistry({
        doctypes: [defineDocType({ name: "Ticket", fields: [{ name: "total", type: "integer" }] })],
        reports: [defineReport({ name: "Totals", doctype: "Ticket", queryPath: "analytical", columns: [{ name: "total" }] })]
      }),
      feed: projections,
      sink,
      cursors,
      clock: { now: () => now }
    });
    const document: DocumentSnapshot = {
      tenantId: "acme",
      doctype: "Ticket",
      name: "T-1",
      version: 4,
      docstatus: "draft",
      data: { total: 10 },
      createdAt: "2026-03-01T00:00:00.000Z",
      updatedAt: "2026-03-01T00:00:00.000Z"
    };
    await projections.save(document);
    await exporter.exportTenant({ tenantId: "acme" });
    await projections.save({ ...document, data: { total: 12 } });
    await exporter.reset({ id: "admin", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" }, "Ticket");
    now = "2026-03-01T00:11:00.000Z";
    await exporter.exportTenant({ tenantId: "acme" });

    const sql = r2SqlAnalyticsScanSql({ tenantId: "acme", doctype: "Ticket", limit: 10 }, { table: "cf_frappe.documents", offset: 0, dialect: sqliteDialect });
    // Both physical orders: the winner must not depend on which row the engine reads first.
    const ascending = db.prepare(sql).all() as { data_json: string }[];
    db.exec("CREATE TABLE cf_frappe.reordered AS SELECT * FROM cf_frappe.documents ORDER BY export_generation DESC");
    const descending = db.prepare(sql.replace("cf_frappe.documents", "cf_frappe.reordered")).all() as { data_json: string }[];

    expect(ascending.map((item) => item.data_json)).toEqual(['{"total":12}']);
    expect(descending.map((item) => item.data_json)).toEqual(['{"total":12}']);
    expect((db.prepare("SELECT COUNT(*) AS total FROM cf_frappe.documents").get() as { total: number }).total).toBe(2);
    db.close();
  });
});

describe("R2SqlAnalyticsReader", () => {
  it("posts the statement with the bearer token and maps rows back to snapshots", async () => {
    const { instance, requests } = reader(() =>
      okRows([
        { name: "T-1", version: "3", docstatus: "draft", data_json: "{\"status\":\"Open\"}", created_at: "c", updated_at: "u" }
      ])
    );

    const page = await instance.scan({ tenantId: "acme", doctype: "Ticket", limit: 2 });

    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(ENDPOINT);
    expect(requests[0]!.init.method).toBe("POST");
    expect(new Headers(requests[0]!.init.headers).get("authorization")).toBe("Bearer secret-token");
    expect(requests[0]!.body.query).toContain("LIMIT 2 OFFSET 0");
    expect(page).toEqual({
      documents: [
        { tenantId: "acme", doctype: "Ticket", name: "T-1", version: 3, docstatus: "draft", data: { status: "Open" }, createdAt: "c", updatedAt: "u" }
      ]
    });
  });

  it("pages by offset while pages come back full", async () => {
    const full = [0, 1].map((index) => ({ name: `T-${index}`, version: 1, docstatus: "draft", data_json: "{}", created_at: "c", updated_at: "u" }));
    const { instance, requests } = reader(() => okRows(full));

    const first = await instance.scan({ tenantId: "acme", doctype: "Ticket", limit: 2 });
    await instance.scan({ tenantId: "acme", doctype: "Ticket", limit: 2, cursor: first.nextCursor! });

    expect(first.nextCursor).toBe("2");
    expect(requests[1]!.body.query).toContain("LIMIT 2 OFFSET 2");
  });

  it("reports an HTTP error, an API error, a transport failure and a malformed body as unavailable, without the token", async () => {
    const cases: readonly [string, () => Response | Promise<Response>][] = [
      ["HTTP 502", () => new Response("bad gateway", { status: 502 })],
      ["query too large", () => Response.json({ success: false, errors: [{ code: 400, message: "query too large" }] }, { status: 400 })],
      ["socket hang up", () => Promise.reject(new Error("socket hang up"))],
      ["no result.rows", () => Response.json({ success: true, result: {} })],
      ["no integer version", () => okRows([{ name: "T", version: "x", docstatus: "draft", data_json: "{}", created_at: "c", updated_at: "u" }])],
      ["column 'data_json' is not a string", () => okRows([{ name: "T", version: 1, docstatus: "draft", data_json: {}, created_at: "c", updated_at: "u" }])]
    ];
    for (const [message, respond] of cases) {
      const { instance } = reader(respond);
      const failure = await instance.scan({ tenantId: "acme", doctype: "Ticket", limit: 2 }).then(
        () => undefined,
        (error: unknown) => error as { code?: string; message?: string }
      );
      expect(failure, message).toMatchObject({ code: "ANALYTICS_UNAVAILABLE" });
      expect(failure?.message, message).toContain(message);
      expect(failure?.message, message).not.toContain("secret-token");
    }
  });

  it("rejects configuration that would be interpolated into the URL or the statement", () => {
    const base = { accountId: "abc123", bucket: "cf-frappe-analytics", table: "cf_frappe.documents", token: () => "t" };

    expect(() => new R2SqlAnalyticsReader({ ...base, accountId: "abc/../x" })).toThrow("accountId");
    expect(() => new R2SqlAnalyticsReader({ ...base, bucket: "Bad_Bucket" })).toThrow("bucket");
    expect(() => new R2SqlAnalyticsReader({ ...base, table: "documents" })).toThrow("namespace.table");
  });

  it("type-checks every column it reads", () => {
    expect(parseR2SqlRows({ result: { rows: [{ name: "T", version: 2, docstatus: "draft", data_json: "{}", created_at: "c", updated_at: "u" }] } })).toEqual([
      { name: "T", version: 2, docstatus: "draft", data_json: "{}", created_at: "c", updated_at: "u" }
    ]);
    expect(() => parseR2SqlRows({ result: { rows: [{ name: 1 }] } })).toThrow();
  });
});

describe("PipelinesAnalyticsSink", () => {
  it("sends snake_case records matching the stream schema, in chunks", async () => {
    const sent: AnalyticsPipelineRecord[][] = [];
    const sink = new PipelinesAnalyticsSink({ send: async (records) => { sent.push(records); } }, { maxRecordsPerSend: 2 });

    await sink.append([row("T-1", 1), row("T-2", 1), row("T-3", 1)]);

    expect(sent.map((chunk) => chunk.map((record) => record.name))).toEqual([["T-1", "T-2"], ["T-3"]]);
    const schemaFields = ANALYTICS_PIPELINE_STREAM_SCHEMA.fields.map((field) => field.name).sort();
    // A structured stream silently drops a record that does not match its
    // schema, so the record and the schema must name exactly the same fields.
    expect(Object.keys(sent[0]![0]!).sort()).toEqual(schemaFields);
    expect(sent[0]![0]).toEqual({
      tenant_id: "acme",
      doctype: "Ticket",
      name: "T-1",
      version: 1,
      docstatus: "draft",
      data_json: "{\"status\":\"Open\"}",
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-01T00:00:01.000Z",
      export_generation: 0,
      exported_at: "2026-03-02T00:00:00.000Z"
    });
  });

  it("tells the exporter its rows are visible only after the sink rolls a file", () => {
    const send = async () => undefined;

    expect(new PipelinesAnalyticsSink({ send }).visibleAfterSeconds).toBe(360);
    expect(new PipelinesAnalyticsSink({ send }, { rollIntervalSeconds: 60, visibilityMarginSeconds: 30 }).visibleAfterSeconds).toBe(90);
    expect(() => new PipelinesAnalyticsSink({ send }, { rollIntervalSeconds: 0 })).toThrow("rollIntervalSeconds");
    expect(() => new PipelinesAnalyticsSink({ send }, { visibilityMarginSeconds: -1 })).toThrow("visibilityMarginSeconds");
  });

  it("propagates a failed send so the exporter does not advance", async () => {
    const sink = new PipelinesAnalyticsSink({ send: async () => { throw new Error("stream unavailable"); } });

    await expect(sink.append([row("T-1", 1)])).rejects.toThrow("stream unavailable");
  });
});
