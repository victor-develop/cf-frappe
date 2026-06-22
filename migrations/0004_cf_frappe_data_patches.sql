CREATE TABLE IF NOT EXISTS cf_frappe_data_patches (
  id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'failed')),
  claim_id TEXT,
  claimed_at TEXT,
  applied_at TEXT,
  failed_at TEXT,
  error TEXT,
  result_json TEXT,
  result_present INTEGER NOT NULL DEFAULT 0
);
