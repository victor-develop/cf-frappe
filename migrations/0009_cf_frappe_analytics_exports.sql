CREATE TABLE IF NOT EXISTS cf_frappe_analytics_exports (
  tenant_id TEXT NOT NULL,
  doctype TEXT NOT NULL,
  position_updated_at TEXT,
  position_name TEXT,
  complete_through TEXT,
  pending_through TEXT,
  pending_visible_at TEXT,
  generation INTEGER NOT NULL DEFAULT 0,
  reexporting INTEGER NOT NULL DEFAULT 0,
  exported_rows INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT,
  last_error TEXT,
  PRIMARY KEY (tenant_id, doctype)
);
