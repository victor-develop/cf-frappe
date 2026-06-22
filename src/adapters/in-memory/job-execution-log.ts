import type {
  JobExecutionBeginResult,
  JobExecutionLog,
  JobExecutionRecord,
  ListJobExecutionsOptions
} from "../../ports/job-execution-log";
import type { JobMessage } from "../../ports/job-queue";
import { DEFAULT_TENANT_ID } from "../../core/types";

export class InMemoryJobExecutionLog implements JobExecutionLog {
  private readonly records = new Map<string, JobExecutionRecord>();

  async begin(message: JobMessage, startedAt: string): Promise<JobExecutionBeginResult> {
    const tenantId = message.tenantId ?? DEFAULT_TENANT_ID;
    const key = recordKey(tenantId, message.idempotencyKey);
    const existing = this.records.get(key);
    if (existing?.status === "running" || existing?.status === "succeeded") {
      return { status: "duplicate", record: existing };
    }

    const record: JobExecutionRecord = {
      tenantId,
      idempotencyKey: message.idempotencyKey,
      jobName: message.jobName,
      runId: message.runId,
      status: "running",
      startedAt
    };
    this.records.set(key, record);
    return { status: "started", record };
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
      status: "succeeded",
      startedAt: previous?.startedAt ?? finishedAt,
      finishedAt,
      ...(result === undefined ? {} : { result })
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
      return this.records.get(recordKey(options.tenantId, idempotencyKey));
    }
    return [...this.records.values()].find((record) => record.idempotencyKey === idempotencyKey);
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
      .slice(0, limit);
  }
}

function recordKey(tenantId: string, idempotencyKey: string): string {
  return `${tenantId}\0${idempotencyKey}`;
}
