import { DEFAULT_TENANT_ID, type JsonValue } from "../../core/types";
import type {
  JobExecutionBeginResult,
  JobExecutionLog,
  JobExecutionRecord,
  ListJobExecutionsOptions
} from "../../ports/job-execution-log";
import type { JobMessage } from "../../ports/job-queue";
import { jobExecutionFromRow, type JobExecutionRow } from "./serde";

export class D1JobExecutionLog implements JobExecutionLog {
  constructor(private readonly db: D1Database) {}

  async begin(message: JobMessage, startedAt: string): Promise<JobExecutionBeginResult> {
    const tenantId = message.tenantId ?? DEFAULT_TENANT_ID;
    const claimed = await this.claim(message, tenantId, startedAt);
    if (claimed) {
      return { status: "started", record: claimed };
    }
    const existing = await this.get(message.idempotencyKey, { tenantId });
    if (existing) {
      return { status: "duplicate", record: existing };
    }
    throw new Error(`Unable to claim job execution '${message.idempotencyKey}'`);
  }

  async complete(message: JobMessage, finishedAt: string, result: JsonValue | undefined): Promise<void> {
    const tenantId = message.tenantId ?? DEFAULT_TENANT_ID;
    const previous = await this.get(message.idempotencyKey, { tenantId });
    await this.save({
      tenantId: previous?.tenantId ?? tenantId,
      idempotencyKey: message.idempotencyKey,
      jobName: message.jobName,
      runId: message.runId,
      status: "succeeded",
      startedAt: previous?.startedAt ?? finishedAt,
      finishedAt,
      ...(result === undefined ? {} : { result })
    });
  }

  async fail(message: JobMessage, finishedAt: string, error: unknown): Promise<void> {
    const tenantId = message.tenantId ?? DEFAULT_TENANT_ID;
    const previous = await this.get(message.idempotencyKey, { tenantId });
    await this.save({
      tenantId: previous?.tenantId ?? tenantId,
      idempotencyKey: message.idempotencyKey,
      jobName: message.jobName,
      runId: message.runId,
      status: "failed",
      startedAt: previous?.startedAt ?? finishedAt,
      finishedAt,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  async get(
    idempotencyKey: string,
    options: { readonly tenantId?: string } = {}
  ): Promise<JobExecutionRecord | undefined> {
    const where =
      options.tenantId === undefined
        ? "idempotency_key = ?"
        : "tenant_id = ? AND idempotency_key = ?";
    const params = options.tenantId === undefined ? [idempotencyKey] : [options.tenantId, idempotencyKey];
    const row = await this.db
      .prepare(
        `SELECT tenant_id, idempotency_key, job_name, run_id, status, started_at, finished_at, result_json, error
         FROM cf_frappe_job_executions
         WHERE ${where}
         LIMIT 1`
      )
      .bind(...params)
      .first<JobExecutionRow>();
    return row ? jobExecutionFromRow(row) : undefined;
  }

  async list(options: ListJobExecutionsOptions = {}): Promise<readonly JobExecutionRecord[]> {
    const query = jobExecutionListQuery(options);
    const result = await this.db
      .prepare(query.sql)
      .bind(...query.params)
      .all<JobExecutionRow>();
    return (result.results ?? []).map(jobExecutionFromRow);
  }

  private async save(record: JobExecutionRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO cf_frappe_job_executions
         (tenant_id, idempotency_key, job_name, run_id, status, started_at, finished_at, result_json, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, idempotency_key)
         DO UPDATE SET
           job_name = excluded.job_name,
           run_id = excluded.run_id,
           status = excluded.status,
           started_at = excluded.started_at,
           finished_at = excluded.finished_at,
           result_json = excluded.result_json,
           error = excluded.error`
      )
      .bind(
        record.tenantId,
        record.idempotencyKey,
        record.jobName,
        record.runId,
        record.status,
        record.startedAt,
        record.finishedAt ?? null,
        record.result === undefined ? null : JSON.stringify(record.result),
        record.error ?? null
      )
      .run();
  }

  private async claim(
    message: JobMessage,
    tenantId: string,
    startedAt: string
  ): Promise<JobExecutionRecord | undefined> {
    const row = await this.db
      .prepare(
        `INSERT INTO cf_frappe_job_executions
         (tenant_id, idempotency_key, job_name, run_id, status, started_at, finished_at, result_json, error)
         VALUES (?, ?, ?, ?, 'running', ?, NULL, NULL, NULL)
         ON CONFLICT(tenant_id, idempotency_key)
         DO UPDATE SET
           job_name = excluded.job_name,
           run_id = excluded.run_id,
           status = excluded.status,
           started_at = excluded.started_at,
           finished_at = NULL,
           result_json = NULL,
           error = NULL
         WHERE cf_frappe_job_executions.status = 'failed'
         RETURNING tenant_id, idempotency_key, job_name, run_id, status, started_at, finished_at, result_json, error`
      )
      .bind(tenantId, message.idempotencyKey, message.jobName, message.runId, startedAt)
      .first<JobExecutionRow>();
    return row ? jobExecutionFromRow(row) : undefined;
  }
}

interface PreparedJobExecutionQuery {
  readonly sql: string;
  readonly params: readonly unknown[];
}

function jobExecutionListQuery(options: ListJobExecutionsOptions): PreparedJobExecutionQuery {
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
      `SELECT tenant_id, idempotency_key, job_name, run_id, status, started_at, finished_at, result_json, error ` +
      `FROM cf_frappe_job_executions ${where} ` +
      "ORDER BY started_at DESC, idempotency_key ASC LIMIT ?",
    params
  };
}
