import { FrameworkError } from "../../core/errors.js";
import { cloneJsonValue, isJsonValue } from "../../core/json.js";
import { DEFAULT_TENANT_ID, type JsonValue } from "../../core/types.js";
import type {
  JobExecutionBeginResult,
  JobExecutionLog,
  JobExecutionRecord,
  ListJobExecutionsOptions
} from "../../ports/job-execution-log.js";
import type { JobMessage } from "../../ports/job-queue.js";
import { jobExecutionFromRow, type JobExecutionRow } from "./serde.js";

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
      payload: previous?.payload ?? message.payload,
      metadata: previous?.metadata ?? message.metadata,
      enqueuedAt: previous?.enqueuedAt ?? message.enqueuedAt,
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
      payload: previous?.payload ?? message.payload,
      metadata: previous?.metadata ?? message.metadata,
      enqueuedAt: previous?.enqueuedAt ?? message.enqueuedAt,
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
        `SELECT tenant_id, idempotency_key, job_name, run_id, payload_json, metadata_json, enqueued_at, status, started_at, finished_at, result_json, error
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
    const normalized = cloneRecord(record);
    await this.db
      .prepare(
        `INSERT INTO cf_frappe_job_executions
         (tenant_id, idempotency_key, job_name, run_id, payload_json, metadata_json, enqueued_at, status, started_at, finished_at, result_json, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, idempotency_key)
         DO UPDATE SET
           job_name = excluded.job_name,
           run_id = excluded.run_id,
           payload_json = excluded.payload_json,
           metadata_json = excluded.metadata_json,
           enqueued_at = excluded.enqueued_at,
           status = excluded.status,
           started_at = excluded.started_at,
           finished_at = excluded.finished_at,
           result_json = excluded.result_json,
           error = excluded.error`
      )
      .bind(
        normalized.tenantId,
        normalized.idempotencyKey,
        normalized.jobName,
        normalized.runId,
        normalized.payload === undefined ? null : JSON.stringify(normalized.payload),
        normalized.metadata === undefined ? null : JSON.stringify(normalized.metadata),
        normalized.enqueuedAt ?? null,
        normalized.status,
        normalized.startedAt,
        normalized.finishedAt ?? null,
        normalized.result === undefined ? null : JSON.stringify(normalized.result),
        normalized.error ?? null
      )
      .run();
  }

  private async claim(
    message: JobMessage,
    tenantId: string,
    startedAt: string
  ): Promise<JobExecutionRecord | undefined> {
    const payload = cloneJson(message.payload);
    const metadata = cloneJson(message.metadata);
    const row = await this.db
      .prepare(
        `INSERT INTO cf_frappe_job_executions
         (tenant_id, idempotency_key, job_name, run_id, payload_json, metadata_json, enqueued_at, status, started_at, finished_at, result_json, error)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'running', ?, NULL, NULL, NULL)
         ON CONFLICT(tenant_id, idempotency_key)
         DO UPDATE SET
           job_name = excluded.job_name,
           run_id = excluded.run_id,
           payload_json = excluded.payload_json,
           metadata_json = excluded.metadata_json,
           enqueued_at = excluded.enqueued_at,
           status = excluded.status,
           started_at = excluded.started_at,
           finished_at = NULL,
           result_json = NULL,
           error = NULL
         WHERE cf_frappe_job_executions.status = 'failed'
         RETURNING tenant_id, idempotency_key, job_name, run_id, payload_json, metadata_json, enqueued_at, status, started_at, finished_at, result_json, error`
      )
      .bind(
        tenantId,
        message.idempotencyKey,
        message.jobName,
        message.runId,
        JSON.stringify(payload),
        JSON.stringify(metadata),
        message.enqueuedAt,
        startedAt
      )
      .first<JobExecutionRow>();
    return row ? jobExecutionFromRow(row) : undefined;
  }
}

function cloneRecord(record: JobExecutionRecord): JobExecutionRecord {
  return {
    tenantId: record.tenantId,
    idempotencyKey: record.idempotencyKey,
    jobName: record.jobName,
    runId: record.runId,
    ...(record.payload === undefined ? {} : { payload: cloneJson(record.payload) }),
    ...(record.metadata === undefined ? {} : { metadata: cloneJson(record.metadata) }),
    ...(record.enqueuedAt === undefined ? {} : { enqueuedAt: record.enqueuedAt }),
    status: record.status,
    startedAt: record.startedAt,
    ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
    ...(record.result === undefined ? {} : { result: cloneJson(record.result) }),
    ...(record.error === undefined ? {} : { error: record.error })
  };
}

function cloneJson<TValue extends JsonValue>(value: TValue): TValue {
  if (!isJsonValue(value)) {
    throw new FrameworkError("JOB_EXECUTION_INVALID", "Job execution history JSON value is invalid", {
      status: 409
    });
  }
  return cloneJsonValue(value) as TValue;
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
      `SELECT tenant_id, idempotency_key, job_name, run_id, payload_json, metadata_json, enqueued_at, status, started_at, finished_at, result_json, error ` +
      `FROM cf_frappe_job_executions ${where} ` +
      "ORDER BY started_at DESC, idempotency_key ASC LIMIT ?",
    params
  };
}
