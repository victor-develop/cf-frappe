import type {
  JobExecutionBeginResult,
  JobExecutionLog,
  JobExecutionRecord
} from "../../ports/job-execution-log";
import type { JobMessage } from "../../ports/job-queue";

export class InMemoryJobExecutionLog implements JobExecutionLog {
  private readonly records = new Map<string, JobExecutionRecord>();

  async begin(message: JobMessage, startedAt: string): Promise<JobExecutionBeginResult> {
    const existing = this.records.get(message.idempotencyKey);
    if (existing?.status === "running" || existing?.status === "succeeded") {
      return { status: "duplicate", record: existing };
    }

    const record: JobExecutionRecord = {
      idempotencyKey: message.idempotencyKey,
      jobName: message.jobName,
      runId: message.runId,
      status: "running",
      startedAt
    };
    this.records.set(message.idempotencyKey, record);
    return { status: "started", record };
  }

  async complete(message: JobMessage, finishedAt: string, result: JobExecutionRecord["result"]): Promise<void> {
    const previous = this.records.get(message.idempotencyKey);
    const record: JobExecutionRecord = {
      idempotencyKey: message.idempotencyKey,
      jobName: message.jobName,
      runId: message.runId,
      status: "succeeded",
      startedAt: previous?.startedAt ?? finishedAt,
      finishedAt,
      ...(result === undefined ? {} : { result })
    };
    this.records.set(message.idempotencyKey, record);
  }

  async fail(message: JobMessage, finishedAt: string, error: unknown): Promise<void> {
    const previous = this.records.get(message.idempotencyKey);
    const record: JobExecutionRecord = {
      idempotencyKey: message.idempotencyKey,
      jobName: message.jobName,
      runId: message.runId,
      status: "failed",
      startedAt: previous?.startedAt ?? finishedAt,
      finishedAt,
      error: error instanceof Error ? error.message : String(error)
    };
    this.records.set(message.idempotencyKey, record);
  }

  get(idempotencyKey: string): JobExecutionRecord | undefined {
    return this.records.get(idempotencyKey);
  }

  list(): readonly JobExecutionRecord[] {
    return [...this.records.values()];
  }
}
