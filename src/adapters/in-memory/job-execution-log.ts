import type {
  JobExecutionBeginResult,
  JobExecutionLog,
  JobExecutionRecord,
  ListJobExecutionsOptions
} from "../../ports/job-execution-log.js";
import type { JobMessage } from "../../ports/job-queue.js";
import { FrameworkError } from "../../core/errors.js";
import { cloneJsonValue, isJsonValue } from "../../core/json.js";
import { DEFAULT_TENANT_ID, type JsonValue } from "../../core/types.js";
import type { JobPayload } from "../../core/jobs.js";

export class InMemoryJobExecutionLog implements JobExecutionLog {
  private readonly records = new Map<string, JobExecutionRecord>();

  async begin(message: JobMessage, startedAt: string): Promise<JobExecutionBeginResult> {
    const tenantId = message.tenantId ?? DEFAULT_TENANT_ID;
    const key = recordKey(tenantId, message.idempotencyKey);
    const existing = this.records.get(key);
    if (existing?.status === "running" || existing?.status === "succeeded") {
      return { status: "duplicate", record: cloneRecord(existing) };
    }

    const record: JobExecutionRecord = {
      tenantId,
      idempotencyKey: message.idempotencyKey,
      jobName: message.jobName,
      runId: message.runId,
      payload: cloneJson(message.payload),
      metadata: cloneJson(message.metadata),
      enqueuedAt: message.enqueuedAt,
      status: "running",
      startedAt
    };
    this.records.set(key, record);
    return { status: "started", record: cloneRecord(record) };
  }

  async complete(message: JobMessage, finishedAt: string, result: JobExecutionRecord["result"]): Promise<void> {
    const tenantId = message.tenantId ?? DEFAULT_TENANT_ID;
    const key = recordKey(tenantId, message.idempotencyKey);
    const previous = this.records.get(key);
    const record: JobExecutionRecord = {
      tenantId: previous?.tenantId ?? tenantId,
      idempotencyKey: message.idempotencyKey,
      jobName: message.jobName,
      runId: message.runId,
      payload: cloneJson(previous?.payload ?? message.payload),
      metadata: cloneJson(previous?.metadata ?? message.metadata),
      enqueuedAt: previous?.enqueuedAt ?? message.enqueuedAt,
      status: "succeeded",
      startedAt: previous?.startedAt ?? finishedAt,
      finishedAt,
      ...(result === undefined ? {} : { result: cloneJson(result) })
    };
    this.records.set(recordKey(record.tenantId, record.idempotencyKey), record);
  }

  async fail(message: JobMessage, finishedAt: string, error: unknown): Promise<void> {
    const tenantId = message.tenantId ?? DEFAULT_TENANT_ID;
    const key = recordKey(tenantId, message.idempotencyKey);
    const previous = this.records.get(key);
    const record: JobExecutionRecord = {
      tenantId: previous?.tenantId ?? tenantId,
      idempotencyKey: message.idempotencyKey,
      jobName: message.jobName,
      runId: message.runId,
      payload: cloneJson(previous?.payload ?? message.payload),
      metadata: cloneJson(previous?.metadata ?? message.metadata),
      enqueuedAt: previous?.enqueuedAt ?? message.enqueuedAt,
      status: "failed",
      startedAt: previous?.startedAt ?? finishedAt,
      finishedAt,
      error: error instanceof Error ? error.message : String(error)
    };
    this.records.set(recordKey(record.tenantId, record.idempotencyKey), record);
  }

  async get(
    idempotencyKey: string,
    options: { readonly tenantId?: string } = {}
  ): Promise<JobExecutionRecord | undefined> {
    if (options.tenantId !== undefined) {
      const record = this.records.get(recordKey(options.tenantId, idempotencyKey));
      return record ? cloneRecord(record) : undefined;
    }
    const record = [...this.records.values()].find((item) => item.idempotencyKey === idempotencyKey);
    return record ? cloneRecord(record) : undefined;
  }

  async list(options: ListJobExecutionsOptions = {}): Promise<readonly JobExecutionRecord[]> {
    const limit = options.limit ?? 50;
    return [...this.records.values()]
      .filter((record) => options.tenantId === undefined || record.tenantId === options.tenantId)
      .filter((record) => options.jobName === undefined || record.jobName === options.jobName)
      .filter((record) => options.runId === undefined || record.runId === options.runId)
      .filter((record) => options.status === undefined || record.status === options.status)
      .sort((left, right) => {
        const started = right.startedAt.localeCompare(left.startedAt);
        return started === 0 ? left.idempotencyKey.localeCompare(right.idempotencyKey) : started;
      })
      .slice(0, limit)
      .map(cloneRecord);
  }
}

function recordKey(tenantId: string, idempotencyKey: string): string {
  return `${tenantId}\0${idempotencyKey}`;
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

function cloneJson<TValue extends JobPayload | JsonValue>(value: TValue): TValue {
  if (!isJsonValue(value)) {
    throw new FrameworkError("JOB_EXECUTION_INVALID", "Job execution history JSON value is invalid", {
      status: 409
    });
  }
  return cloneJsonValue(value) as TValue;
}
