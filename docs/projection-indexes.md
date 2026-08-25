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
| `in` | **Not** served — falls back to a sort |
| `gt` / `lt` / range | Not served |
| filter on a field that is not the index prefix | Falls back to `idx_cf_frappe_documents_list` |

`in` is worth calling out: a multi-select status filter in the Desk list view generates `in`, and it is outside this shape.

## The planner needs statistics

Without `sqlite_stat1` the planner will not choose a partial index at all — it falls back to `idx_cf_frappe_documents_list (tenant_id, doctype, updated_at)` and scans the doctype partition. Nothing in the framework runs `ANALYZE` today (see issue #7), so on a fresh D1 these indexes only start paying off once statistics exist.

## Storage and write cost

`updated_at` is a 25-character ISO timestamp carried in every index entry. Measured on a 100k-row fixture with two projection indexes, `page_count` rose from 6253 to 7493 (roughly +20%) versus the filter-only shape. `COUNT(*)` also moves to the wider covering index. D1 bills on storage, so budget for it when a DocType declares several indexes.

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
