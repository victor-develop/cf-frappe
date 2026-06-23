ALTER TABLE cf_frappe_data_patches RENAME TO cf_frappe_data_patches_before_rollbacks;

CREATE TABLE cf_frappe_data_patches (
  id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'failed', 'rollback_pending', 'rolled_back', 'rollback_failed')),
  claim_id TEXT,
  claimed_at TEXT,
  applied_at TEXT,
  failed_at TEXT,
  error TEXT,
  result_json TEXT,
  result_present INTEGER NOT NULL DEFAULT 0,
  rollback_claim_id TEXT,
  rollback_claimed_at TEXT,
  rolled_back_at TEXT,
  rollback_failed_at TEXT,
  rollback_error TEXT,
  rollback_result_json TEXT,
  rollback_result_present INTEGER NOT NULL DEFAULT 0
);

INSERT INTO cf_frappe_data_patches (
  id,
  checksum,
  status,
  claim_id,
  claimed_at,
  applied_at,
  failed_at,
  error,
  result_json,
  result_present,
  rollback_result_present
)
SELECT
  id,
  checksum,
  status,
  claim_id,
  claimed_at,
  applied_at,
  failed_at,
  error,
  result_json,
  result_present,
  0
FROM cf_frappe_data_patches_before_rollbacks;

DROP TABLE cf_frappe_data_patches_before_rollbacks;
