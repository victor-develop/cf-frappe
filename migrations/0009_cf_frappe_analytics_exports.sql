CREATE TABLE IF NOT EXISTS cf_frappe_analytics_exports (
  tenant_id TEXT NOT NULL,
  doctype TEXT NOT NULL,
  position_updated_at TEXT,
  position_name TEXT,
  complete_through TEXT,
  exported_rows INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT,
  last_error TEXT,
  PRIMARY KEY (tenant_id, doctype)
);
