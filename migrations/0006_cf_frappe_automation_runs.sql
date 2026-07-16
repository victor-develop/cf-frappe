CREATE TABLE IF NOT EXISTS cf_frappe_automation_runs (
  tenant_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  available_at TEXT,
  enqueued_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, run_id)
);

CREATE INDEX IF NOT EXISTS idx_cf_frappe_automation_runs_claim
  ON cf_frappe_automation_runs(tenant_id, status, available_at, enqueued_at, run_id);
