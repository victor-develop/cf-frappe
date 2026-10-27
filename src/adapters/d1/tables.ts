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
export const D1_EVENT_ARCHIVE_SEGMENTS_TABLE = "cf_frappe_event_archive_segments";
export const D1_EVENT_ARCHIVE_DOCUMENTS_TABLE = "cf_frappe_event_archive_documents";

/** Every framework-owned table, in migration order. */
export const D1_TABLES: readonly string[] = [
  D1_DOCUMENTS_TABLE,
  D1_EVENTS_TABLE,
  D1_MIGRATIONS_TABLE,
  D1_JOB_EXECUTIONS_TABLE,
  D1_DATA_PATCHES_TABLE,
  D1_AUTOMATION_RUNS_TABLE,
  D1_FOLD_SNAPSHOTS_TABLE,
  D1_EVENT_ARCHIVE_SEGMENTS_TABLE,
  D1_EVENT_ARCHIVE_DOCUMENTS_TABLE
];

/**
 * Tables that carry query load, and therefore the ones worth pointing planner
 * diagnostics at.
 *
 * Four are excluded. `cf_frappe_migrations` is read once per migrate and never
 * filtered. `cf_frappe_fold_snapshots` is only ever a point read or an upsert on
 * its full primary key, so there is no alternative plan for statistics to choose
 * between — an ANALYZE target there would cost a statement and buy nothing.
 *
 * The two event-archive tables are excluded for the same reason, and they are
 * empty unless the archive is switched on. Every query against them pins a
 * primary-key prefix (`stream = ?`) or the one secondary index whose leading
 * column it filters on, so no query has two plans to choose between.
 */
export const D1_QUERIED_TABLES: readonly string[] = [
  D1_DOCUMENTS_TABLE,
  D1_EVENTS_TABLE,
  D1_JOB_EXECUTIONS_TABLE,
  D1_DATA_PATCHES_TABLE,
  D1_AUTOMATION_RUNS_TABLE
];
