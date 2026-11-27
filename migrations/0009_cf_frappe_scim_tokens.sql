CREATE TABLE IF NOT EXISTS cf_frappe_scim_tokens (
  tenant_id TEXT NOT NULL,
  token_id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_cf_frappe_scim_tokens_tenant_created
  ON cf_frappe_scim_tokens(tenant_id, created_at, token_id);
