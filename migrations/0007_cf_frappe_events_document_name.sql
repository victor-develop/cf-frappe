CREATE INDEX IF NOT EXISTS idx_cf_frappe_events_document_name
  ON cf_frappe_events(tenant_id, doctype, document_name, sequence);
