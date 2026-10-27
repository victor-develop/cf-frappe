CREATE TABLE IF NOT EXISTS cf_frappe_analytics_documents (
  tenant_id TEXT NOT NULL,
  doctype TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  docstatus TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  exported_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, doctype, name, version)
);
