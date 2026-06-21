CREATE TABLE IF NOT EXISTS cf_frappe_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  stream TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  type TEXT NOT NULL,
  doctype TEXT NOT NULL,
  document_name TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(stream, sequence)
);

CREATE INDEX IF NOT EXISTS idx_cf_frappe_events_stream_sequence
  ON cf_frappe_events(stream, sequence);

CREATE INDEX IF NOT EXISTS idx_cf_frappe_events_doctype_time
  ON cf_frappe_events(tenant_id, doctype, occurred_at);

CREATE TABLE IF NOT EXISTS cf_frappe_documents (
  tenant_id TEXT NOT NULL,
  doctype TEXT NOT NULL,
  name TEXT NOT NULL,
  version INTEGER NOT NULL,
  docstatus TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, doctype, name)
);

CREATE INDEX IF NOT EXISTS idx_cf_frappe_documents_list
  ON cf_frappe_documents(tenant_id, doctype, updated_at);

CREATE TABLE IF NOT EXISTS cf_frappe_migrations (
  id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  statement_count INTEGER NOT NULL,
  applied_at TEXT NOT NULL
);
