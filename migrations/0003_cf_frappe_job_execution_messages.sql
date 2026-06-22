ALTER TABLE cf_frappe_job_executions ADD COLUMN payload_json TEXT;

ALTER TABLE cf_frappe_job_executions ADD COLUMN metadata_json TEXT;

ALTER TABLE cf_frappe_job_executions ADD COLUMN enqueued_at TEXT;
