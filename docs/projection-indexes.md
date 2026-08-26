# Projection Indexes

How `DocTypeDefinition.indexes` becomes D1 SQL, what the generated indexes can and cannot serve, and the costs to plan for.

## What gets generated

A DocType declares index field lists over its own declared fields:

```ts
defineDocType({
  name: "Task",
  version: 1,
  fields: [
    { name: "status", type: "select", options: ["Open", "Done"] },
    { name: "priority", type: "text" }
  ],
  indexes: [["status"], ["status", "priority"]]
});
```

`planD1Migrations` emits one `doctype_task_v1_indexes` migration containing a partial index per declared field list:

```sql
CREATE INDEX IF NOT EXISTS idx_cf_frappe_documents_task_status_c530bb88
  ON cf_frappe_documents (tenant_id, doctype, json_extract(data_json, '$.status'), updated_at)
  WHERE doctype = 'Task';
```

The key is `(tenant_id, doctype, ...declared fields, updated_at)`. The declared fields serve the filter; the trailing `updated_at` serves the default list ordering. Authors never declare `updated_at` themselves.

`WHERE doctype = '...'` keeps each index scoped to its own DocType, so writing a `Task` row does not touch another DocType's index B-tree.

## What the sort column fixes

Without the trailing column, a filtered list ordered by the default `updatedAt` produced:

```
|--SEARCH t USING INDEX idx_... (tenant_id=? AND doctype=? AND <expr>=?)
`--USE TEMP B-TREE FOR ORDER BY
```

`LIMIT 50` does not help — every matching row must be sorted before the first 50 can be taken. With `updated_at` in the key the temp B-tree disappears (verified on a real local D1 with bound parameters, in both ASC and DESC, with and without an explicit `COLLATE BINARY`).

`listOrderExpression` in `src/adapters/d1/projection-query.ts` emits several ORDER BY shapes. Only the default one is covered:

| `orderBy` | Emitted ORDER BY | Served by the index |
| --- | --- | --- |
| `updatedAt` (the default) | `updated_at COLLATE BINARY <dir>` | **Yes**, ASC and DESC (reverse scan) |
| `name` | `name COLLATE BINARY <dir>, updated_at COLLATE BINARY DESC` | No, but not needed — `(tenant_id, doctype, name)` is the primary key |
| `createdAt` | `created_at ..., updated_at ..., name ...` | No, the leading term is not in the index |
| `version` | `version ..., updated_at ..., name ...` | No, the leading term is not in the index |
| any other field | `json_extract(...) IS NULL ASC, json_extract(...) ..., updated_at ..., name ...` | No, and no index shape can — the leading term is `<expr> IS NULL`, while the index stores `<expr>` |

The predicate shape matters too. The index serves the ordering only when the filter pins the index prefix with equality:

| Filter | Ordered by `updatedAt` |
| --- | --- |
| `eq` on the first indexed field | Served from the index |
| `eq` on every indexed field | Served from the index |
| `in` | Not served by the declared index — streams from `idx_cf_frappe_documents_list` instead, which is still ordered, so there is no sort (but see the statistics section: gathering statistics changes this) |
| `gt` / `lt` / range | Not served |
| filter on a field that is not the index prefix | Falls back to `idx_cf_frappe_documents_list` |

`in` is worth calling out: a multi-select status filter in the Desk list view generates `in`, and it is outside this shape.

## Planner statistics (do not gather them as a performance measure)

`ANALYZE` records per-index selectivity in `sqlite_stat1`. The framework never runs it, and on the query shapes it emits, gathering statistics was measured to help nothing and hurt something.

Measured on a real local D1 with bound parameters — the table from `migrations/0001_cf_frappe_core.sql`, the indexes `planD1ProjectionIndexes` generates, 120k rows across two DocTypes, 500 distinct `status` values — comparing never analyzed, analyzed while empty (what a migration would do), and analyzed with the data loaded:

| Query | Never | Analyzed empty | Analyzed with data |
| --- | --- | --- | --- |
| plain list | `idx_cf_frappe_documents_list`, no sort | narrower index + **temp B-tree** | `idx_cf_frappe_documents_list`, no sort |
| `eq` on `status` | the `status` partial index | same | same |
| `eq` on `status` + `priority` | the two-field partial index | same | same |
| `in` on `status` | `idx_cf_frappe_documents_list`, **no sort** | partial index + **temp B-tree** | partial index + **temp B-tree** |
| `eq` on a different DocType | `idx_cf_frappe_documents_list` | same | same |

Three things follow:

- **The partial indexes are chosen without any statistics.** D1 sends SQL and parameters together, so the planner knows the bound `doctype` value and can satisfy the index's `WHERE doctype = '...'` predicate. Binding a different DocType correctly stops it using that DocType's index.
- **Statistics gathered with data present improve nothing here, and make `in` worse** — they push it onto a partial index and add a sort that the unanalyzed plan did not need.
- **Statistics gathered while the table is empty are actively harmful.** The zero-row estimate persists until the next `ANALYZE`, and a planner that believes the table is empty costs the plain unfiltered list its index — the most frequently served query in the system.

So this is diagnostic tooling, not a tuning knob:

```ts
import { analyzeD1Statistics, clearD1Statistics, readD1Statistics } from "cf-frappe";

const report = await readD1Statistics(env.DB);
// report.analyzed === false  -> never analyzed, the intended state
// stat strings beginning "0 0" -> analyzed while empty, the harmful state

await clearD1Statistics(env.DB);   // the remedy: drop them, back to built-in estimates
await analyzeD1Statistics(env.DB); // refresh instead, if you have a reason to keep statistics
```

**If a list query has an unexpected plan, check for statistics first.** Recorded estimates that begin `0 0` came from an `ANALYZE` against an empty table and should be cleared. SQLite reads `sqlite_stat1` when a connection opens, so clearing takes effect on the next request rather than on the connection that is already running.

`analyzeD1Statistics` runs one statement per target so a very large table can be split by index name; if one target fails, the targets before it keep their refreshed statistics and the failure names them. Cost is not the problem — 0.22s for 500k rows across five indexes on a local SQLite, scaling linearly — the plans are.

`PRAGMA optimize` is not a better option. It does run on D1 and it does refresh stale statistics from a fresh connection, but it samples: on the fixture above it recorded a selectivity of 2001 where a full `ANALYZE` recorded 60000, a 30x error in exactly the column the planner uses to choose an index.

## Storage and write cost

`updated_at` is a 25-character ISO timestamp carried in every index entry. Measured on a 100k-row fixture with two projection indexes, `page_count` rose from 6253 to 7493 (roughly +20%) versus the filter-only shape. `COUNT(*)` also moves to the wider covering index. D1 bills on storage, so budget for it when a DocType declares several indexes.

## How many indexes the table can carry

Every insert into `cf_frappe_documents` pays for every index on the table, including the ones its own DocType can never match — `WHERE doctype = '...'` scopes which index *entries* get written, not which indexes get considered. That cost grows faster than the index count.

Measured on a real local D1, inserting into a DocType that matches no partial index:

| Partial indexes on the table | us/row | vs baseline |
| --- | --- | --- |
| 0 | 28 | 1x |
| 150 | 48 | 1.7x |
| 300 | 147 | 5.3x |
| 600 | 1422 | **51x** |

The same curve reproduces on `node:sqlite` and on the system SQLite, under both single-transaction and per-row-transaction inserts, with narrow and wide index keys, and at every page-cache size tried. The marginal cost per index rises from about 0.07us at 50 indexes to about 2.5us at 600. Reproduce it with:

```bash
node scripts/bench-projection-index-writes.mjs
node scripts/bench-projection-index-writes.mjs --indexes=0,100,200,300,400,500,600 --rows=5000
```

`planD1Migrations` therefore refuses a plan whose declared projection indexes exceed `D1_PROJECTION_INDEX_BUDGET` (300), raising `MIGRATION_INDEX_BUDGET_EXCEEDED`. 300 is where the cost stops being noise against a D1 write and starts being a visible fraction of it. It is a speed bump, not a wall:

```ts
planD1Migrations(doctypes, { maxProjectionIndexes: 500 });
```

Raise it deliberately. The cheaper answer is usually fewer indexes: one composite index that matches the query shape beats several single-field ones, and a query that needs a shape the projection table cannot serve wants its own read model rather than another index here.

Note what this is *not* an argument for. Splitting the projection table per DocType would remove this cost, and it is still not worth it at these numbers — the budget exists so the curve cannot be climbed silently, which is the actual failure mode.

## Changing an index declaration

`D1MigrationRunner` records a checksum per applied migration and throws `MIGRATION_CHECKSUM_MISMATCH` when a recorded migration's planned checksum changes. Editing a DocType's `indexes` changes the SQL of `doctype_<slug>_v<n>_indexes`, so it will not apply over a database that already ran that migration.

Bump `doctype.version` to get a fresh migration id, and add the previous field list to `retiredIndexes` so the superseded index is dropped:

```ts
defineDocType({
  name: "Task",
  version: 2,
  fields: [/* ... */],
  indexes: [["status", "priority"]],
  retiredIndexes: [["status"]]
});
```

Retired indexes are dropped before the replacements are created, within the same migration. An index cannot be both declared and retired on the same DocType, and two DocTypes cannot retire the same index — both raise `MIGRATION_INDEX_CONFLICT` / `MIGRATION_INDEX_DUPLICATE` at plan time.

For a local development database, resetting the D1 state and re-running the migrations is usually faster than staging a version bump.

## Rules for contributors

All JSON field access in the D1 adapter must go through the shared expression helpers. SQLite matches expression indexes **textually**: `data_json->>'$.status'` is semantically identical to `json_extract(data_json, '$.status')` but will not match an index built with the latter, and nothing fails loudly when it happens — the index just stops being used. See issue #9.

## How these claims are tested

Everything above about which index serves which shape is asserted in `tests/adapters/d1-projection-plans.test.ts`, which loads `migrations/0001_cf_frappe_core.sql` plus the planned index DDL into a real SQLite engine (`node:sqlite`, built into Node 22, no dependency) and reads `EXPLAIN QUERY PLAN` for the query that `d1ProjectionListQuery` actually composes, with the same bound parameters the store uses. The helper is `tests/sqlite-engine.ts`.

This layer exists because plan claims were previously settled by throwaway probes, and two probes reached opposite conclusions about whether a partial index is reachable with a bound `doctype` — the difference was the tool, not the engine. A driver that prepares before binding cannot see the bound value and so cannot satisfy the index's `WHERE doctype = '...'`; D1 sends SQL and parameters together and can. `node:sqlite` binds before stepping, so it reproduces D1's behaviour here, which is why the assertions are meaningful.

`node:sqlite` is not D1's SQLite build. Assert index *reachability* and result *correctness* in this layer. Do not assert cost estimates or choices between close candidates — those can differ between builds and data volumes, and belong in a measurement recorded in a PR, not in a test.
