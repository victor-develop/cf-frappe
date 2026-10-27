CREATE TABLE IF NOT EXISTS cf_frappe_tenant_shards (
  tenant_id TEXT PRIMARY KEY,
  shard_id TEXT NOT NULL,
  epoch INTEGER NOT NULL,
  move_id TEXT,
  assigned_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cf_frappe_tenant_shards_shard
  ON cf_frappe_tenant_shards(shard_id, tenant_id);

CREATE TABLE IF NOT EXISTS cf_frappe_tenant_moves (
  move_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  source_shard_id TEXT NOT NULL,
  target_shard_id TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('copying', 'building', 'catching-up', 'cutover', 'completed', 'aborted')),
  revision INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_cf_frappe_tenant_moves_tenant
  ON cf_frappe_tenant_moves(tenant_id, started_at);

CREATE TABLE IF NOT EXISTS cf_frappe_tenant_fences (
  tenant_id TEXT PRIMARY KEY,
  move_id TEXT NOT NULL,
  fenced_at TEXT NOT NULL
);

CREATE TRIGGER IF NOT EXISTS cf_frappe_events_tenant_fence
  BEFORE INSERT ON cf_frappe_events
  WHEN substr(NEW.stream, 1, 11) <> '__global__:'
  AND EXISTS (SELECT 1 FROM cf_frappe_tenant_fences WHERE tenant_id = NEW.tenant_id)
  BEGIN
    SELECT RAISE(ABORT, 'CF_FRAPPE_TENANT_FENCED');
  END;
