CREATE TABLE IF NOT EXISTS cf_frappe_event_archive_segments (
  stream TEXT NOT NULL,
  seq_start INTEGER NOT NULL,
  seq_end INTEGER NOT NULL,
  tenant_id TEXT NOT NULL,
  doctype TEXT NOT NULL,
  first_occurred_at TEXT NOT NULL,
  last_occurred_at TEXT NOT NULL,
  event_count INTEGER NOT NULL,
  object_key TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  archived_at TEXT NOT NULL,
  PRIMARY KEY (stream, seq_start)
);

CREATE INDEX IF NOT EXISTS idx_cf_frappe_event_archive_segments_tenant_time
  ON cf_frappe_event_archive_segments(tenant_id, last_occurred_at);

CREATE INDEX IF NOT EXISTS idx_cf_frappe_event_archive_segments_doctype
  ON cf_frappe_event_archive_segments(tenant_id, doctype, stream);

CREATE TABLE IF NOT EXISTS cf_frappe_event_archive_documents (
  stream TEXT NOT NULL,
  document_name TEXT NOT NULL,
  seq_start INTEGER NOT NULL,
  PRIMARY KEY (stream, document_name, seq_start)
);
