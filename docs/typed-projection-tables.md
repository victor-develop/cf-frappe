# Typed Projection Tables

Phase T3 of the projection roadmap (issue #15, epic #5): a real, typed table per DocType, generated from DocType metadata, kept beside the shared `cf_frappe_documents` table.

**Off by default.** With nothing configured the framework plans, writes and reads exactly what it did before this existed. The trigger the roadmap names for switching it on is *JSON parsing becoming the query bottleneck, or needing field-level constraints*. Every DocType field change is then a new table plus a rebuild, so do not turn it on before one of those is true.

## What gets generated

The shared table keeps every business field inside one `data_json` blob, so each filter, sort and aggregate parses JSON per row and no column has a type. A typed table keeps the same rows and promotes the DocType's *hot* fields to real columns:

```ts
defineDocType({
  name: "Ticket",
  fields: [
    { name: "title", type: "text" },
    { name: "status", type: "select", options: ["Open", "Closed"] },
    { name: "priority", type: "integer" },
    { name: "notes", type: "longText" }
  ],
  indexes: [["status"], ["status", "priority"]], // status and priority are hot
  promotedFields: ["title"]                      // hot without an index of its own
});
```

```sql
CREATE TABLE IF NOT EXISTS cf_frappe_p_ticket_4c1d07a2 (
  tenant_id TEXT NOT NULL, name TEXT NOT NULL, version INTEGER NOT NULL,
  docstatus TEXT NOT NULL, data_json TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  f_priority AS (json_extract(data_json, '$.priority')) STORED
    CHECK (coalesce(json_type(data_json, '$.priority'), 'null') IN ('null', 'integer') OR f_priority = ''),
  f_status AS (json_extract(data_json, '$.status')) STORED
    CHECK (coalesce(json_type(data_json, '$.status'), 'null') IN ('null', 'text')),
  f_title AS (json_extract(data_json, '$.title')) STORED
    CHECK (coalesce(json_type(data_json, '$.title'), 'null') IN ('null', 'text')),
  PRIMARY KEY (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_cf_frappe_p_ticket_4c1d07a2_list ON cf_frappe_p_ticket_4c1d07a2(tenant_id, updated_at);
CREATE INDEX IF NOT EXISTS idx_cf_frappe_p_ticket_4c1d07a2_status_... ON cf_frappe_p_ticket_4c1d07a2 (tenant_id, f_status, updated_at);
CREATE INDEX IF NOT EXISTS idx_cf_frappe_p_ticket_4c1d07a2_status_priority_... ON cf_frappe_p_ticket_4c1d07a2 (tenant_id, f_status, f_priority, updated_at);
```

The design decisions, and why:

**Hot fields are declared once.** Every field named in `indexes` is hot — an index on it can only be a real column — and `promotedFields` adds the ones that are filtered or sorted on without an index. Listing an indexed field in `promotedFields` as well is refused (`MIGRATION_TYPED_PROJECTION_INVALID`), so there is no second list that can drift from the first. `json` and `table` fields cannot be promoted; unknown fields and two names that map to one column (`customer id` / `Customer_ID` — SQLite column names fold case) are refused at plan time.

**Hybrid, because of the 100-column limit.** D1 allows 100 columns per table. A typed table has 7 system columns, so at most 93 can be promoted. The default ceiling is 90 total columns (`D1_TYPED_PROJECTION_COLUMN_BUDGET`), which keeps headroom for the field someone has to promote during an incident; `maxColumns` raises it deliberately up to 100 and never past it. Crossing the ceiling is `MIGRATION_TYPED_PROJECTION_COLUMN_LIMIT`, naming the DocType, the count and every promoted field — columns are never dropped silently. Cold fields keep working: they are read from `data_json` exactly as before.

**`data_json` keeps the whole document, and the columns are generated from it.** Promoted columns are `GENERATED ALWAYS AS (json_extract(data_json, ...)) STORED` — the very expression the shared table queries with, evaluated once at write. A column therefore cannot disagree with its document, a read returns `data_json` byte for byte, and parity with the shared table holds by construction rather than through a reassembly step that would have to restore key order. The cost is that hot values are stored twice; reads and filters no longer parse JSON for them. D1 supports `STORED` generated columns at table creation (not via `ALTER TABLE ... ADD COLUMN`), which is one reason a layout change is a new table, below.

**Typed by CHECK, not by affinity.** The promoted columns deliberately carry no declared type. A declared `INTEGER` or `TEXT` gives a column an affinity, and affinity changes comparisons: an `INTEGER` column matches `= '5'` against a stored `5`, while `json_extract` does not. That would make a promoted field answer a filter differently from an unpromoted one. The type is enforced by a `CHECK` on `json_type` of the stored value instead, admitting exactly what `validateDocumentData` admits for the field type — a value of that type, or the "missing" forms (absent, JSON null, `''`) — and rejecting everything else rather than coercing it:

| Field type | Admitted |
| --- | --- |
| `text`, `longText`, `select`, `link`, `date`, `datetime` | strings |
| `integer` | JSON integers that fit SQLite's 64 bits, or `''` |
| `number` | JSON numbers, or `''` |
| `boolean` | `true` / `false`, or `''` — not `1`, which `json_extract` alone cannot tell from `true` |

`json_type` rather than `typeof(column)`, because `json_extract` returns an object or array as *text*, so a `typeof` check would accept `{"y": 2026}` as a date. `select` options and `min`/`max` are not constrained: changing them is common, and each change would be a new table and a rebuild.

## How queries change

They do not, from the caller's side. `D1TypedProjectionStore` implements `ProjectionStore` and compiles through the same predicate compiler as the shared table (`d1ProjectionListQuery` with a table shape). The only differences in the SQL:

- a promoted field reads its column (`f_status = ?`) instead of `json_extract(data_json, '$.status') = ?`, and is index-served;
- there is no `doctype = ?` — the table is the DocType;
- `eq null` still asks `json_type(data_json, ...)`, because "present and JSON null" and "missing" are both SQL NULL in a column, and the in-memory rule distinguishes them.

Everything else — the null-safe negation, the `GLOB` case folding, the ordering fallbacks — is the same code. `tests/adapters/d1-typed-projection.test.ts` runs every operator over promoted and cold fields, every ordering and two page windows against both tables on the real engine and requires identical rows, order and totals; the golden replays run whole command histories with every DocType on a typed table and require the same transcripts.

## Turning it on

Three steps, and the order matters: tables, then writes, then reads.

**1. Generate the migrations.**

```bash
cf-frappe migrate generate --typed-projections
npm run d1:migrate:remote
```

or `planD1Migrations(doctypes, { typedProjections: true })` (with `{ maxColumns }` if you raised the ceiling). Each DocType gets a `doctype_<slug>_typed_<digest>` migration. Without the flag the plan is unchanged.

**2. Deploy in `shadow`, with the same options in both places.** The aggregate coordinator writes, the Worker reads, so they must agree:

```ts
// src/typed-projections.ts
import type { CloudFrappeTypedProjectionOptions } from "cf-frappe/cloudflare";
export const typedProjections: CloudFrappeTypedProjectionOptions = {
  mode: "off",                       // every DocType not listed
  doctypes: { Ticket: "shadow" },
  // onShadowWriteFailure: (failure) => { ... }  // defaults to console.error
};

// worker.ts
export const AggregateCoordinator = createAggregateCoordinatorClass({ registry, typedProjections });
export default createCloudFrappeWorker({ registry, actor, typedProjections });
```

| Mode | Typed table written | Typed table read | A failed typed write |
| --- | --- | --- | --- |
| `off` (default) | no | no | — |
| `shadow` | after each commit, as its own batch | no | reported, the commit stands |
| `active` | inside the commit's atomic batch | yes, for `get` and `list` | fails the command (`D1_TYPED_PROJECTION_CONSTRAINT_FAILED`, 409) |

The shared table is written in every mode, so going back to `off` is a configuration change with nothing to rebuild. Internal DocTypes (`__AutomationRuns`, naming counters, unique reservations) and DocTypes not in the registry always live in the shared table only. Unknown DocType names and modes in the options are refused when the Worker or coordinator class is created.

**3. Rebuild the history into the table and compare.** Documents written before step 2 are not in the typed table yet. The runtime services carry `typedProjections` — a `ProjectionRebuildService` targeting it and a row-by-row comparison with the shared table — for a job to drive:

```ts
const typed = services.typedProjections!;
const run = await typed.rebuild.start({ tenantId, doctype: "Ticket", target: TYPED_PROJECTION_TARGET, batchSize: 50 });
// ...call typed.rebuild.advance(tenantId, run.runId) from a job until `more` is false...
const { differences } = await typed.compare(tenantId, "Ticket");
```

The rebuild is the one from #11: resumable, paced by whoever calls `advance`, and it never touches the shared table. A historical value that does not fit the declared type — say, a field that used to be `text` and is now `integer` — is refused by the column's `CHECK`; the rebuild records it as a per-stream error and the comparison reports the row as `missing`. That is the point of the constraint: the bad row is found before anything reads the table, not afterwards.

**4. Switch the DocType to `active`** once `differences` is empty for every tenant, and deploy. From then on its lists and reads come from the typed table, and its writes are checked by the column constraints inside the commit.

## Changing a DocType's fields

The table name ends in a digest of the layout: the promoted columns, their types, and the index declarations. Field order, labels and unrelated metadata do not move it; promoting, demoting or retyping a field, or changing `indexes`, does. A layout change is therefore a **new table**, never an `ALTER` of a live one:

1. Put the DocType back in `shadow` (reads return to the shared table, which is always current), change the DocType, regenerate migrations — a new `doctype_<slug>_typed_<digest>` migration creates the new table — and deploy.
2. Rebuild into it and compare, as above.
3. Switch it to `active`.
4. Retire the superseded table: `planD1Migrations(doctypes, { typedProjections: { retiredTables: ["cf_frappe_p_ticket_4c1d07a2"] } })` plans a `typed_projection_retire_<table>` migration that drops it. A table a current layout still uses cannot be retired, and only names with the typed prefix are accepted.

## What this does not do

- **The shared table is not dropped.** It stays authoritative for internal DocTypes and is what makes `off` an instant rollback. Moving a DocType's writes off it entirely is a later step, not part of T3.
- **Per-tenant custom fields are never promoted.** They differ per tenant and the layout is per DocType; they filter correctly from `data_json`.
- **The comparison is between projections, not against events.** Both tables are folded from the same events; `tests/application/projection-replay-parity.test.ts` and the rebuild cover events-versus-projection.
- **`ANALYZE`** is no more advisable here than on the shared table — see [Projection Indexes](projection-indexes.md).
