/**
 * The D1 tables the framework owns. Every adapter and every generated statement
 * refers to them through these constants so the schema has one source of truth;
 * `tests/adapters/d1-tables.test.ts` checks them against the checked-in
 * migrations.
 */
export const D1_DOCUMENTS_TABLE = "cf_frappe_documents";
export const D1_EVENTS_TABLE = "cf_frappe_events";
export const D1_MIGRATIONS_TABLE = "cf_frappe_migrations";
export const D1_JOB_EXECUTIONS_TABLE = "cf_frappe_job_executions";
export const D1_DATA_PATCHES_TABLE = "cf_frappe_data_patches";
export const D1_AUTOMATION_RUNS_TABLE = "cf_frappe_automation_runs";
export const D1_FOLD_SNAPSHOTS_TABLE = "cf_frappe_fold_snapshots";

/** Every framework-owned table, in migration order. */
export const D1_TABLES: readonly string[] = [
  D1_DOCUMENTS_TABLE,
  D1_EVENTS_TABLE,
  D1_MIGRATIONS_TABLE,
  D1_JOB_EXECUTIONS_TABLE,
  D1_DATA_PATCHES_TABLE,
  D1_AUTOMATION_RUNS_TABLE,
  D1_FOLD_SNAPSHOTS_TABLE
];

/**
 * Tables that carry query load, and therefore the ones worth pointing planner
 * diagnostics at.
 *
 * Two are excluded. `cf_frappe_migrations` is read once per migrate and never
 * filtered. `cf_frappe_fold_snapshots` is only ever a point read or an upsert on
 * its full primary key, so there is no alternative plan for statistics to choose
 * between — an ANALYZE target there would cost a statement and buy nothing.
 */
export const D1_QUERIED_TABLES: readonly string[] = [
  D1_DOCUMENTS_TABLE,
  D1_EVENTS_TABLE,
  D1_JOB_EXECUTIONS_TABLE,
  D1_DATA_PATCHES_TABLE,
  D1_AUTOMATION_RUNS_TABLE
];
