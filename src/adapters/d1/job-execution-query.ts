import type { ListJobExecutionsOptions } from "../../ports/job-execution-log.js";

export interface PreparedJobExecutionQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

export function d1JobExecutionListQuery(options: ListJobExecutionsOptions): PreparedJobExecutionQuery {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (options.tenantId !== undefined) {
    conditions.push("tenant_id = ?");
    params.push(options.tenantId);
  }
  if (options.jobName !== undefined) {
    conditions.push("job_name = ?");
    params.push(options.jobName);
  }
  if (options.status !== undefined) {
    conditions.push("status = ?");
    params.push(options.status);
  }
  if (options.runId !== undefined) {
    conditions.push("run_id = ?");
    params.push(options.runId);
  }
  const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
  params.push(options.limit ?? 50);
  return {
    sql:
      `SELECT tenant_id, idempotency_key, job_name, run_id, payload_json, metadata_json, enqueued_at, status, started_at, finished_at, result_json, error ` +
      `FROM cf_frappe_job_executions ${where} ` +
      "ORDER BY started_at DESC, idempotency_key ASC LIMIT ?",
    params
  };
}
