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
/**
 * Tenant sharding (issue #14). The directory and the move journal are read and
 * written only on the directory database (`DB`); the fence table exists on
 * every shard, because the trigger that enforces it does. All three exist in
 * every database the shared migrations reach and stay empty until sharding is
 * switched on.
 */
export const D1_TENANT_SHARDS_TABLE = "cf_frappe_tenant_shards";
export const D1_TENANT_MOVES_TABLE = "cf_frappe_tenant_moves";
export const D1_TENANT_FENCES_TABLE = "cf_frappe_tenant_fences";
/** The trigger that refuses event inserts for a fenced tenant. Not a table; named here so SQL refers to one constant. */
export const D1_TENANT_FENCE_TRIGGER = "cf_frappe_events_tenant_fence";

/** Every framework-owned table, in migration order. */
export const D1_TABLES: readonly string[] = [
  D1_DOCUMENTS_TABLE,
  D1_EVENTS_TABLE,
  D1_MIGRATIONS_TABLE,
  D1_JOB_EXECUTIONS_TABLE,
  D1_DATA_PATCHES_TABLE,
  D1_AUTOMATION_RUNS_TABLE,
  D1_FOLD_SNAPSHOTS_TABLE,
  D1_TENANT_SHARDS_TABLE,
  D1_TENANT_MOVES_TABLE,
  D1_TENANT_FENCES_TABLE
];

/**
 * Tables that carry query load, and therefore the ones worth pointing planner
 * diagnostics at.
 *
 * The three tenant-sharding tables are excluded with the same reasoning as the
 * snapshots below: each is read by primary key or by one prefix of one index,
 * holds a row per tenant or per move rather than per write, and has no
 * alternative plan for statistics to choose between.
 *
 * Two more are excluded. `cf_frappe_migrations` is read once per migrate and never
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
