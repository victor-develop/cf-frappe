import type { DocumentData, JsonValue } from "../core/types.js";
import type { JobPayload } from "../core/jobs.js";
import type { JobMessage } from "./job-queue.js";

export type JobExecutionStatus = "running" | "succeeded" | "failed";

export interface JobExecutionRecord {
  readonly tenantId: string;
  readonly idempotencyKey: string;
  readonly jobName: string;
  readonly runId: string;
  readonly payload?: JobPayload;
  readonly metadata?: DocumentData;
  readonly enqueuedAt?: string;
  readonly status: JobExecutionStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly result?: JsonValue;
  readonly error?: string;
}

export type JobExecutionBeginResult =
  | { readonly status: "started"; readonly record: JobExecutionRecord }
  | { readonly status: "duplicate"; readonly record: JobExecutionRecord };

export interface ListJobExecutionsOptions {
  readonly tenantId?: string;
  readonly jobName?: string;
  readonly runId?: string;
  readonly status?: JobExecutionStatus;
  readonly limit?: number;
}

export interface JobExecutionLogReader {
  get(idempotencyKey: string, options?: { readonly tenantId?: string }): Promise<JobExecutionRecord | undefined>;
  list(options?: ListJobExecutionsOptions): Promise<readonly JobExecutionRecord[]>;
}

export interface JobExecutionLogWriter {
  begin(message: JobMessage, startedAt: string): Promise<JobExecutionBeginResult>;
  complete(message: JobMessage, finishedAt: string, result: JsonValue | undefined): Promise<void>;
  fail(message: JobMessage, finishedAt: string, error: unknown): Promise<void>;
}

export interface JobExecutionLog extends JobExecutionLogReader, JobExecutionLogWriter {}
