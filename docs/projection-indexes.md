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

## What the predicate compiler pushes down

`d1ProjectionListQuery` compiles a `PredicateExpression` into SQL. Every operator the validator accepts compiles to an exact condition; anything that could not would raise rather than return a superset.

**Pushed down exactly**: every operator. `eq`, `ne`, `in`, `not_in`, `is`, `gt`, `gte`, `lt`, `lte`, `between`, `not_between`, `contains`, `like`, `not_like`, `not`, and `all`/`any` groups of them. Nothing is evaluated in the Worker any more, and the 1000-candidate-row cap that used to reject text filters outright is gone along with the 400 it raised (issue #41).

**Negation is pushed down too**, but not as `NOT (...)`. SQL comparisons against a missing JSON key yield NULL, `NOT NULL` is NULL, and the row drops out — while the in-memory evaluator treats a missing field as a failed match, so its negation *keeps* the row. The compiler emits the null-safe form instead:

```sql
(json_extract(data_json, '$.status') = ?) IS NOT 1
```

which means "the positive condition is false or unknown" — exactly the in-memory truth table. A negation only compiles when the inner SQL is equivalent to the inner predicate; if a future operator has no exact SQL form, the compiler throws instead of negating a superset, because negating a superset does not produce a superset of the negation.

The wrapped form is not index-usable. That is inherent — a negation is rarely selective enough for an index to help — and paying a scan beats pulling every candidate row into the Worker.

**Text operators are folded into `GLOB`, not `LIKE`.** SQLite's `LIKE` folds ASCII only, so `v LIKE '%ä%'` misses `ÄRGER`. The pushdown folds the *pattern* instead of the data — the pattern is short, the data is long, and `GLOB` supports character classes:

| Filter | Bound pattern |
| --- | --- |
| `contains "ärger"` | `*[Ää][Rr][Gg][Ee][Rr]*` |
| `like "%ς%"` | `*[Σςσ]*` |
| `not_like "%ä%"` | `json_extract(...) IS NOT NULL AND (json_extract(...) GLOB '*[Ää]*') IS NOT 1` |

The pattern is always a bound parameter, never SQL text. `contains` is compiled by routing the needle through `containsLikePattern` — the same escaping the in-memory rule uses, so `50%` stays literal — and then translating that one pattern shape in `src/core/like-glob.ts`. `GLOB` has no `ESCAPE` clause, so its three metacharacters become single-member classes (`[*]`, `[?]`, `[[]`). A literal `^` is emitted **raw**: `[^]` negates a class, and measured on SQLite 3.51.3 `'a^b' GLOB '*[^]*'` is 0 while `'a^b' GLOB '*^*'` is 1.

`not_like` needs the presence check spelled out: in memory a missing or JSON-null field fails the match and the row drops, while `(NULL GLOB ?) IS NOT 1` is 1 and would keep it.

A pattern ending in a lone `\` can never match (the in-memory rule compiles it to `(?!)`). `GLOB` cannot say that, so `like` degrades to `0 = 1` — while `not_like` still keeps exactly the rows whose field is present, which is not the same as negating `0 = 1`.

The fold groups are a table generated from the ES `Canonicalize` behind the regexp `i` flag: 1144 multi-member groups over the BMP, largest 4 members, verified against regexp `i` in both directions with zero divergences (the full BMP cross-product is 2.0 billion comparisons, 18 s — run once, not in the suite; the suite regenerates the table and checks the case-related pairs). Grouping by `toLowerCase` instead diverges from regexp `i` on 72 ordered BMP pairs and would be wrong. `tests/core/like-glob.test.ts` rebuilds the table from the running engine and fails if it differs, because the in-memory side is whatever *this* runtime's regexp `i` does — a V8 Unicode data update would otherwise move one side and not the other.

That rule is **not** "case-insensitive over all of Unicode", and it is worth knowing where it stops. It never applies a case mapping that changes length or that reaches ASCII from outside ASCII, and it does not fold anything outside the BMP:

| Input | Needle | Folded? |
| --- | --- | --- |
| `Ärger` | `ä` | yes |
| `σigma` | `ς` | yes — the regexp folds Greek variant letters |
| `Straße` | `SS` | no — `ß` → `SS` changes length |
| `Kelvin` (U+212A) | `k` | no — non-ASCII may not fold to ASCII |
| `İstanbul` | `i` | no — same reason |
| `𐐀` (Deseret) | `𐐨` | no — outside the BMP |

The last row covers 614 codepoint pairs, i.e. every cased astral script: Deseret, Osage, Adlam, Vithkuqi, Warang Citi, Medefaidrin, Old Hungarian. Text in those scripts is matched **case-sensitively**. `String.toLowerCase` would fold all of them, so this rule is genuinely narrower — the trade is that Canonicalize is reproducible outside JS, which is what makes the pushdown possible at all.

### Two accepted divergences, and a length cap

**`_` on astral-plane data.** `_` is one UTF-16 *code unit* in memory and compiles to `?`, which is one *code point* in `GLOB`. Measured: `'😀' GLOB '?'` is 1 and `'😀' GLOB '??'` is 0, while in memory `__` matches 😀 and `_` does not. Neither `?` nor `??` is even a consistent superset, so no fallback saves it. The exact fix is to redefine `_` as one code point, which would also have to change the standalone browser copy in `src/adapters/desk/client-src/forms.ts`, whose parity test covers only `contains` — the drift would ship silently. Blast radius: `contains` escapes `_`, so Desk's quick filter and the file list are exact even on astral data; only a hand-written `like`/`not_like` pattern containing `_` is affected.

**Unpaired surrogates.** Two rows storing `"\ud83d"` and `"\ude00"` are stored distinctly (CESU-8, `EDA0BD` vs `EDB880`) but `GLOB` reports them equal — SQLite's UTF-8 reader collapses the malformed sequences — while in memory they are different code units. Reachable only with lone surrogates in stored data.

Both are pinned by tests in `tests/adapters/d1-projection-glob.test.ts` so they stay known boundaries rather than field reports. A third, closely related boundary: a non-string value left in a text field diverges too, because SQLite's text coercion is not JS `String()` (JSON `true` becomes the integer 1, and `1 GLOB '*[rR][uU]*'` is 0 where memory says `"true"` contains `ru`). Schema validation makes that unreachable except after a field's type changes from `number` to `text` with old rows still numeric.

**Pattern length.** Folding expands a pattern by up to 6.00x in UTF-8 bytes (`Т` → `[Ттᲄᲅ]`, 2 bytes → 12), and SQLite raises "LIKE or GLOB pattern too complex" past `SQLITE_MAX_LIKE_PATTERN_LENGTH` — measured in bytes, not characters: 49998 bytes accepted, 50001 rejected. The compiler therefore caps the compiled pattern at `D1_PROJECTION_TEXT_PATTERN_MAX_BYTES` (4096) and raises a 400 naming the field and the limit, rather than letting a user-supplied filter value surface as a raw SQLite error. The cap sits an order of magnitude under the engine's because that limit is a compile-time option and workerd's value is not published. 4096 bytes is about a thousand ASCII characters of needle.

### What it costs

Both `LIKE` and `GLOB` are full scans — a leading wildcard defeats every index — so the win here is not speed, it is that the 1000-row cap and the per-row JSON parse in the Worker both disappear. Measured at 100k rows on the real core schema (node:sqlite 3.51.3, mean of 10 after 3 warmups), `COUNT(*)` over `json_extract(data_json,'$.title')`:

| Condition | Time |
| --- | --- |
| `IS NOT NULL` (no matcher) | 29.2 ms |
| `LIKE '%needle%'` | 29.9 ms |
| `GLOB '*needle*'` | 30.2 ms |
| `GLOB '*[Nn][Ee][Ee][Dd][Ll][Ee]*'` | 38.4 ms |
| `GLOB '*[Nn]eedle*'` | 37.9 ms |

So the classes cost about 28% more than `LIKE`, and nearly all of it comes from the first element after `*` being a class — a single leading class costs the same as a fully expanded pattern.

`EXPLAIN QUERY PLAN` with bound values, with and without `ANALYZE`, still picks `idx_cf_frappe_documents_list` for the tenant/doctype seek and the `updated_at` order, so a page can still terminate early — but only when matches are dense. With 100 matching rows in 100k, `LIMIT 50 OFFSET 0` cost 28.3 ms, i.e. half the table. `COUNT(*)` is always a full scan. **A text filter therefore reads the whole doctype twice per page** (rows and total). `total` staying exact is what keeps pagination stable, so that is the trade this change accepts; bounding `total` for text filters is a separate decision.

### What this did not fix

The in-memory `like` regexp is still catastrophically backtracking, and this change only removes the D1 list path's exposure to it. Measured on one 61-character row of `"a"`: the pattern `%a%a%a%a%z` costs 27 ms, `%a%a%a%a%a%z` 256 ms, `%a%a%a%a%a%a%z` 2097 ms — polynomial in the number of `%`, for a **single row**. Patterns are user-supplied through the list API, so one row is enough to burn a Worker's CPU budget. `matchesPredicateExpression` is still reachable from `src/adapters/in-memory/list-filters.ts`, automation rules and notification rules. A pattern-complexity bound (wildcard count, not just length) belongs on both sides and is not in this change.

Parity between the D1 adapter and the in-memory adapter — including rows whose field is absent or JSON null, which is where a naive negation goes wrong — is asserted against a real SQLite engine in `tests/adapters/d1-projection-negation.test.ts` and, for the text operators, `tests/adapters/d1-projection-glob.test.ts`. The latter also runs a seeded 120000-pair differential of the compiled `GLOB` against `likePatternMatches` over an alphabet of every `GLOB` and `like` metacharacter plus the known fold groups, twice: once for `like` patterns and once for `contains` needles.

## Rules for contributors

SQLite matches expression indexes **textually**. `data_json->>'$.status'` is semantically identical to `json_extract(data_json, '$.status')` but will not match an index built with the latter, and nothing fails loudly when they diverge — the index simply stops being used and the query gets slower.

So every read of a field out of `data_json` in the D1 adapter goes through `src/adapters/d1/json-path.ts`:

```ts
d1JsonExtract("status")     // json_extract(data_json, '$.status')
d1JsonType("status")        // json_type(data_json, '$.status')
d1JsonPathLiteral("status") // '$.status'
```

Index DDL (`planD1ProjectionIndexes`) and query predicates (`d1ProjectionListQuery`) both call it, so they cannot drift. Two tests in `tests/adapters/d1-json-path.test.ts` hold that:

- the expression appearing in the generated index DDL is byte-identical to the one in the generated `WHERE`, for plain and space-containing field names
- no file under `src/adapters/d1/` contains a `->` or `->>` operator in code (comments may name them)

Both were checked by mutation: hand-writing `->>` in the query builder, and hand-writing a `json_extract` that differs by a single space, each turn a test red with the offending file and line.

These two builders previously escaped quotes differently — `''` on the query side and a backslash on the index side, the latter not even valid SQLite. Metadata validation happens to forbid quotes in field names today, so it was unreachable; it was still one field-name rule away from an index that silently never matched.

## Running two projections side by side

`RoutedProjectionStore` (`src/application/projection-targets.ts`) mounts several `ProjectionStore` implementations at once so a projection can be reshaped without a stop-the-world switch.

```ts
const router = new RoutedProjectionStore({
  targets: [
    { name: "v1", state: "active", store: new D1ProjectionStore(env.DB) },
    { name: "v2", state: "building", store: new D1ProjectionStore(env.PROJECTIONS_V2) }
  ],
  onFollowerFailure: (failure) => console.error("projection follower diverged", failure)
});

const documents = withProjectionFollowers(new D1DocumentStore(env.DB), router);
```

A target moves `building` → `caught-up` → `active`, and the one it replaces becomes `retired`. `building` and `caught-up` receive writes but are not read from; `retired` receives nothing. Reads switch at runtime with `router.readFrom("v2")`, which is how a candidate projection is compared against the live one before it is promoted.

`core` and `application` never see any of this. The router satisfies `ProjectionStore`, and the read source is chosen here rather than threaded through queries — so a projection version is a deployment concern, not part of the query contract.

**Followers are written outside the commit's atomic boundary, deliberately.** The active projection is written inside `commitBatch`'s batch together with the events; a projection that is still being built must not be able to fail a document write, and widening the transaction to cover it would do exactly that. So follower writes happen after the commit succeeds, each failure isolated and handed to `onFollowerFailure`. Without wiring that callback the router drifts silently, which is the one way to use it wrong.

`withProjectionFollowers` also forwards the auxiliary snapshots that `commitBatch` produces — naming counters and unique-value reservations — because a follower missing those is not a usable projection.

## Rebuilding a projection from the event stream

A projection is a cache folded from events. Change the fold — add a derived field, fix a projection bug, reshape the physical layout — and every existing row is stale. This is not a problem a CRUD system has: its rows *are* the truth, so a logic change only affects the future. An event-sourced row is a derivation, so a logic change has to recompute history.

`ProjectionRebuildService` (`src/application/projection-rebuild-service.ts`) does that recomputation:

```ts
const rebuild = new ProjectionRebuildService({ events, streams, router, targetStore, clock, ids });

const run = await rebuild.start({ tenantId, doctype: "Task", target: "v2", batchSize: 50 });
// driven from a Cron Trigger or a queue consumer:
const { state, more } = await rebuild.advance(tenantId, run.runId);
```

Three properties make it safe to run against live traffic:

- **It never writes the projection that is serving reads.** `start` and `advance` both refuse a target equal to the router's current read source, so live reads keep answering from the projection that was already correct. Rebuild into a `building` target, compare, then promote it with `router.readFrom(...)`.
- **It is resumable and idempotent.** Progress is a cursor over the lexicographically ordered stream list, so a stream created mid-rebuild sorts into place instead of shifting everything after it, and `ProjectionStore.save` upserts — replaying a batch rewrites the same rows rather than duplicating them. Zero-pad document names if you want that order to match the numeric one.
- **It is externally paced.** `advance` does one batch and returns. Batch size times call frequency is the rate limit, which matters because a rebuild competes with live writes for the same single-writer database.

A stream that fails to rebuild is recorded and skipped rather than stalling the run, and a stream that folds to `null` (a deleted document) advances the cursor with nothing written.

Run state lives in its own event stream, one per run, and folds to counts plus a bounded sample of recent errors. That shape is deliberate: a state folded from a stream must not grow with the length of that stream — see issue #28 for what the alternative costs.
