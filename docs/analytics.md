# Analytical Query Path

How reports and dashboards can read an exported copy of the projection instead of D1, what that copy is, how fresh it is, and what turning it on costs. Issue #16, phase T4 of #5.

**It is off by default.** Without the `analytics` Worker option every report and dashboard reads the operational projection exactly as before, whatever it declares. The trigger in #5 — reports and dashboards slowing down operational queries — has not been reached; this exists so that turning it on is a configuration change, not a project.

## The problem

Desk lists, link options and global search share `cf_frappe_documents` with reports, dashboards and Kanban aggregates. The two loads have opposite shapes:

| | Operational lists | Analytical reads |
| --- | --- | --- |
| Rows touched | a page | the whole DocType |
| Latency | sub-second | seconds are fine |
| Consistency | read-your-write | a minute behind is fine |
| Shape | predictable, indexed | ad hoc, multi-dimensional |

Today a report reads every readable document of its DocType page by page through `QueryService.listDocuments` and aggregates in the Worker. On D1 — one database, one writer — a single wide report competes with every list and every write.

## The shape

```
write path (unchanged)                       analytical read
──────────────────────                       ───────────────
command → events → cf_frappe_documents       report / dashboard (queryPath: "analytical")
                         │                          │
            export job (per tenant, cron)           ▼
                         │                   AnalyticsDocumentReader ── R2 SQL / second D1 / memory
                         ▼                          │
                 AnalyticsSink ─────────────► the copy (append-only, keyed by version)
       (Pipelines → R2 Iceberg / second D1)          │
                                                     ▼
                         same QueryService access checks + same report code → result + freshness
```

Four ports in `src/ports/analytics.ts`, each with an in-memory adapter, a D1 adapter tested on a real SQLite engine, and a thin Cloudflare adapter:

| Port | In memory | D1 | Cloudflare |
| --- | --- | --- | --- |
| `ProjectionChangeFeed` — the projection in `(updatedAt, name)` order | `InMemoryProjectionStore`, `InMemoryDocumentStore` | `D1ProjectionStore` | — |
| `AnalyticsSink` — append exported rows | `InMemoryAnalyticsStore` | `D1AnalyticsStore` (a second database) | `PipelinesAnalyticsSink` |
| `AnalyticsDocumentReader` — newest version per document | `InMemoryAnalyticsStore` | `D1AnalyticsStore` | `R2SqlAnalyticsReader` |
| `AnalyticsExportCursorStore` — how far each DocType is exported | `InMemoryAnalyticsExportCursorStore` | `D1AnalyticsExportCursorStore` (migration `0009`) | — |

## Declaring which path a report takes

```ts
defineReport({
  name: "Returns Finance Queue",
  doctype: "Return Request",
  queryPath: "analytical",   // default: "operational"
  // ...
});

defineDashboard({
  name: "Returns Operations",
  queryPath: "analytical",   // governs documentCount / documentAggregate cards
  cards: [/* ... */]
});
```

- A report card on a dashboard follows **its report's** `queryPath`, so one report reads one store whether it is opened directly or through a dashboard.
- A custom-source report cannot be analytical (`REPORT_INVALID`): its rows come from its provider, not the projection.
- Small, live reports should stay operational. Moving them buys nothing and costs freshness.

The ReturnsOS example's `Returns Finance Queue` is declared analytical. With the example's Worker (no `analytics` option) it still runs on the projection.

## Turning it on

```ts
import { D1AnalyticsStore, createAnalyticsExportJob, ANALYTICS_EXPORT_JOB_NAME } from "cf-frappe";
import { createCloudFrappeWorker, PipelinesAnalyticsSink, R2SqlAnalyticsReader } from "cf-frappe/cloudflare";

createCloudFrappeWorker<Env>({
  registry,
  actor,
  analytics: {
    // rollIntervalSeconds: what the Pipelines sink was created with (default 300)
    sink: (env) => new PipelinesAnalyticsSink(env.ANALYTICS_STREAM, { rollIntervalSeconds: 300 }),
    reader: (env) => new R2SqlAnalyticsReader({
      accountId: env.CF_ACCOUNT_ID,
      bucket: "my-analytics-bucket",
      table: "cf_frappe.documents",
      token: () => env.R2_SQL_TOKEN          // a Worker secret
    }),
    // optional: onUnavailable, settleSeconds, batchSize, maxRowsPerRun, scanPageSize, doctypes, clock
  },
  jobs: {
    registry: createJobRegistry({ jobs: [createAnalyticsExportJob()] }),
    queue: (env) => new CloudflareJobQueue(env.JOBS),
    schedules: [{ cron: "* * * * *", jobName: ANALYTICS_EXPORT_JOB_NAME, tenantId: "default" }]
  }
});
```

Schedule the export job once per tenant, the same way as the delivery outbox drain.

### Option A — Pipelines into R2, queried with R2 SQL

Cloudflare has renamed these products to Basin Pipelines, Basin Catalog and Basin SQL; the commands below are the current `wrangler basin …` ones, and the Workers `pipelines` binding is unchanged.

1. Create a stream whose schema is `ANALYTICS_PIPELINE_STREAM_SCHEMA` (exported from `cf-frappe/cloudflare`; ten required fields: `tenant_id`, `doctype`, `name`, `version` `int64`, `docstatus`, `data_json`, `created_at`, `updated_at`, `export_generation` `int64`, `exported_at`):
   `npx wrangler basin pipelines streams create cf_frappe_documents --schema-file analytics-schema.json`
2. Create a sink into a Data Catalog table on an R2 bucket with the catalog enabled, e.g. namespace `cf_frappe`, table `documents`, and the pipeline `INSERT INTO <sink> SELECT * FROM <stream>`. Enable catalog compaction: every export appends, so small files accumulate. Note the sink's `--roll-interval` (default 300 seconds, minimum 60) and pass the same number as `rollIntervalSeconds` — see [Freshness](#freshness--the-latency-is-observable).
3. Bind the stream to the Worker: `"pipelines": [{ "binding": "ANALYTICS_STREAM", "stream": "<stream id>" }]`.
4. Create an API token with R2 SQL read, Data Catalog read and R2 storage read on that bucket, and store it as a Worker secret (`wrangler secret put R2_SQL_TOKEN`). It is only ever sent as the bearer header and never appears in an error message.

The reader posts to `https://api.sql.cloudflarestorage.com/api/v1/accounts/{accountId}/basin-sql/query/{bucket}` and accepts an `endpoint` override for the old path.

Each page query ranks rows with `ROW_NUMBER() OVER (PARTITION BY name ORDER BY version DESC, export_generation DESC, exported_at DESC)` over the tenant's DocType. R2 SQL documents window functions as supported but budget-gated, so on a very large DocType the query can be refused, and the report then fails with `ANALYTICS_UNAVAILABLE` rather than answering. The statement's semantics are tested on SQLite; it has not been run against a live R2 SQL account in this repository's tests, so load-test a large DocType before relying on it.

Migration `0009` (the export cursor table) is part of the framework migrations and is applied whether or not `analytics` is configured — an empty table that nothing reads or writes until the option is set.

### Option B — a second D1 database

For a smaller deployment that wants the scan off its primary without running Pipelines:

```jsonc
"d1_databases": [
  { "binding": "DB", "database_name": "app", "database_id": "...", "migrations_dir": "migrations" },
  { "binding": "ANALYTICS_DB", "database_name": "app-analytics", "database_id": "...", "migrations_dir": "migrations/analytics" }
]
```

```ts
analytics: {
  sink: (env) => new D1AnalyticsStore(env.ANALYTICS_DB),
  reader: (env) => new D1AnalyticsStore(env.ANALYTICS_DB)
}
```

Apply `migrations/analytics/` to that database (`wrangler d1 migrations apply app-analytics`, or `new D1MigrationRunner(env.ANALYTICS_DB).apply(planD1AnalyticsMigrations())`). **Never point it at `DB`** — a copy in the database it is meant to relieve moves nothing, which is why the analytics table is not in the framework migrations at all (a test asserts that).

## The export

`AnalyticsExportService` reads `cf_frappe_documents` — the projection the write path already maintains — and **adds nothing to the write path**: no hook, no outbox target, no extra statement per command. An outbox target was the obvious alternative and was rejected for exactly that reason: four outbox events per document write is a write-path cost T4 is not allowed to impose.

Per tenant and DocType a cursor walks the projection in `(updatedAt, name)` order up to a **horizon**, `now − settleSeconds` (default 60):

- **Why a total order.** The list ordering has no tie-breaker on `updatedAt`, and a resumable cursor needs one. `listChangedSince` resumes strictly after `(updatedAt, name)`, so a batch boundary inside a tie loses nothing. It rides `idx_cf_frappe_documents_list` as an index range; a test pins the plan.
- **Why a settle window.** The cursor only moves forward, so a row that lands *behind* it is never seen. `updatedAt` is stamped when a command is planned and becomes visible when its commit lands; not exporting anything younger than the window means the cursor is never ahead of a commit still in flight. A D1 commit takes milliseconds against a 60-second window. The window has to cover the whole time from planning to commit, though: a command whose hooks await slow external calls between the two, or a retry that reuses the planned timestamp, can take longer, and a row committed more than `settleSeconds` after its `updatedAt` is never exported. Raise `settleSeconds` above the longest such command if you have them.
- **Why it is safe to repeat.** Each batch is appended, then the position is saved. A crash between the two re-appends the batch next run; the copy is keyed `(tenant, doctype, name, version, export_generation)` so the repeat is invisible. Pipelines does not document exactly-once delivery, so nothing relies on it.
- **Which row a reader takes.** Per document: the highest `version`, then the highest `export_generation`, then the latest `exported_at`. The same order in the D1 statement, the R2 SQL statement and the in-memory store, each tested. Within one key D1 keeps the later append (an upsert), which is the same answer the R2 ranking gives over Iceberg's duplicates.
- **Deletes are rows.** A deleted document is exported with `docstatus: "deleted"`. Readers choose the newest version first and hide deletes after — filtering first would bring a deleted document back as its last live version. Both the D1 and the R2 SQL statement are tested for that on a real engine.
- **Events are never touched.** This copies the cache, not the asset.

Which DocTypes are exported defaults to every DocType an analytical report or dashboard reads (`analyticalDocTypeNames`); override with `doctypes`.

### What the settle window does not cover

A projection row rewritten **without** a new `updatedAt`: a full rebuild (#11) promoted in place, or a repair after a rebuild-diff (#12). Re-export the DocType afterwards:

```http
POST /api/analytics/exports/Return%20Request/reset
```

The reset starts a new **export generation**: the next run re-exports the DocType from the start, and every row it appends outranks the rows exported before the reset. That matters because a rebuild folds the same events — the rewritten row keeps its `version` and `updatedAt`, so version alone could not tell the corrected row from the stale one, and on Iceberg either could win.

While the re-export runs:

- Analytical reads keep being served (the reset keeps `completeThrough`), but documents the re-export has not reached yet still show their pre-rebuild values. `GET /api/analytics/exports` reports `reexporting: true` until a run of the new generation drains; at `maxRowsPerRun` 10,000 and a one-minute cron, that is about one minute per 10,000 documents.
- An export run that was already in flight when the reset landed stops at its next save and reports `status: "superseded"`, rather than writing its old position back over the reset. Rows it sent carry the old generation, so they cannot outrank the re-export.

## Freshness — the latency is observable

`completeThrough` is the claim: every projection change at or before it is **visible** in the copy. It moves only when a run drains everything up to its horizon, and never backwards (enforced inside the cursor upsert, because two overlapping runs can save in either order).

**Pipelines buffers.** `send` resolving means the stream accepted the records; the sink writes them into the Iceberg table only when it rolls a file, up to its roll interval later. `PipelinesAnalyticsSink` therefore declares `visibleAfterSeconds` = `rollIntervalSeconds` + `visibilityMarginSeconds` (defaults 300 + 60). A drained horizon is held on the cursor as `pendingThrough` until that much time has passed since it was sent, and only then counts towards `completeThrough` — for reports, for `GET /api/analytics/exports`, for the job result. Two consequences:

- Lag on the Pipelines path is roughly settle window + roll interval + margin, and up to one more of that while the next pending horizon waits behind the current one. That is the real figure, not an understatement of it.
- A first export that has been sent but has not landed yet still reads as "not finished" (`ANALYTICS_UNAVAILABLE`), so an empty table is never reported as a zero.

The D1 and in-memory stores show rows on append (`visibleAfterSeconds` 0), so their claim moves with each drained run. If you change the Pipelines sink's roll interval, change `rollIntervalSeconds` with it; if lag shows rows landing later than the claim, raise `visibilityMarginSeconds`.

| Where | What |
| --- | --- |
| Every analytical report result | `analytics: { path: "analytical", completeThrough }` — absent on operational results, so those are unchanged byte for byte |
| `GET /api/analytics/exports` (admin roles) | per DocType: `completeThrough`, `lagSeconds`, `reexporting`, `exportedRows`, `lastRunAt`, `lastError` |
| The export job's result in job history | per DocType: `status` (`exported`, `failed`, `superseded`), `exported`, `drained`, `completeThrough`, `lagSeconds`, `error` |

A run that hits `maxRowsPerRun` (default 10,000) stops, saves its position and leaves `completeThrough` where it was, so a backlog shows as growing lag rather than as a run that never ends.

## Correctness — why the two paths agree

An analytical report must give the same answer as its operational run on the same data. That is achieved by construction rather than by a second implementation:

- The copy only replaces **where rows come from**. Row-level permissions, shares, user permissions and field redaction go through `QueryService.readableDocumentsFrom` — the same code a list uses — and everything that turns rows into a report (filters, formulas, sorting, summaries, groups, charts, CSV) is the same report code.
- `tests/application/analytics-report-parity.test.ts` seeds ReturnsOS through the real HTTP API and compares the finance queue on both paths for every persona and a spread of filters, orderings and pages, plus CSV export, the dashboard, and a later edit and delete. A second case covers owner-conditional permission rules and shares.

**Aggregation therefore runs in the Worker, not in R2 SQL.** The report code compares with `localeCompare` and keeps mixed-type group keys apart; no SQL engine reproduces either, so pushing `GROUP BY` down would make the two paths disagree on ordering. What moves off D1 is the scan — the load that drags the Desk down — and, where safe, part of the filter:

- An `eq` report filter with a non-empty string value is pushed into the reader as a **pre-filter**. It is a superset by construction (string equality on a JSON-extracted value keeps every row `actual === expected` keeps, in SQLite, in R2 SQL and in memory) and the exact filter is re-applied to every row. Numbers and booleans are not pushed: SQLite reads JSON `true` as `1`.
- A reader may drop any pre-filter it cannot express. Dropping one is always correct; inlining an unsafe one never is.

Rows tied on `updatedAt` are listed in an unspecified order by D1 and by name on the analytical path, so an *unordered* report's row order can differ on ties. Totals, summaries, groups, charts and every ordered report are unaffected.

## Failure isolation

| Failure | Result |
| --- | --- |
| R2 SQL / the reader errors, times out (30 s), or returns rows that do not type-check | the analytical report or card fails with `ANALYTICS_UNAVAILABLE` (503) |
| The DocType has never finished an export | `ANALYTICS_UNAVAILABLE` — an empty copy must not read as a real zero |
| The freshness lookup fails | `ANALYTICS_UNAVAILABLE` — not a silently unvouched answer |
| The sink fails during an export | that DocType's cursor records `lastError` and keeps its position; other DocTypes continue; the job fails as retryable |
| `analytics` not configured but the job is scheduled | the job fails permanently ("not configured") |

Operational lists, forms, operational reports and writes do not touch the analytics store and keep working through all of the above; `tests/application/analytics-isolation.test.ts` checks that in the same service at the same moment.

`onUnavailable: "operational"` makes an analytical read fall back to the projection instead of failing. It is not the default: falling back puts the report's full scan on D1 at exactly the moment something is already wrong, which is the thing the analytical path exists to prevent.

## Security notes

- R2 SQL takes no bound parameters, so the R2 reader writes literals. Tenant and DocType are inlined only through `sqlStringLiteral`, which doubles quotes and **refuses** backslashes and control characters rather than trusting an undocumented parser; the table name must be `namespace.table` of plain identifiers; account id and bucket are validated before they reach the URL. Paging is by `OFFSET`, so document names never become literals. The cost: a document leaving the result set (deleted, or no longer matching a pushed-down pre-filter) on an earlier page between two page queries shifts later rows back, and one document at the boundary is skipped for that read; a new document shifts rows forward and the reader de-duplicates by name. The operational report scan pages by offset too. A DocType that fits in one page (`scanPageSize`, up to 10,000) is unaffected.
- Every D1 statement binds its values.
- The copy holds full document data, including fields some actors cannot read. Nothing reads it except through the access checks above.

## What is deliberately not here

- **A row cap on the analytical scan.** The analytical path loads the readable DocType into the Worker before the report code runs, including for CSV export, which pages on the operational path. Worker memory (128 MB) therefore bounds how large a DocType an analytical report can cover; measure a large one before relying on it.
- **Aggregate pushdown into R2 SQL.** See above: collation and mixed-type keys. If a report outgrows Worker memory, the next step is a declared, SQL-native aggregate shape whose semantics are defined by the SQL engine, not a translation of the existing report code.
- **Compaction of the copy.** Every exported version is kept. Use the catalog's compaction for file counts; collapsing versions would need a rewrite job nobody needs yet.
- **Exporting events.** The events stay in D1 and are archive material for #18, not report input.
