CREATE TABLE IF NOT EXISTS cf_frappe_job_executions (
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  job_name TEXT NOT NULL,
  run_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  result_json TEXT,
  error TEXT,
  PRIMARY KEY (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_cf_frappe_job_executions_history
  ON cf_frappe_job_executions(tenant_id, job_name, status, started_at);

CREATE INDEX IF NOT EXISTS idx_cf_frappe_job_executions_started_at
  ON cf_frappe_job_executions(tenant_id, started_at);
