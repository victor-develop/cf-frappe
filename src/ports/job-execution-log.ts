import type { JsonValue } from "../core/types";
import type { JobMessage } from "./job-queue";

export type JobExecutionStatus = "running" | "succeeded" | "failed";

export interface JobExecutionRecord {
  readonly idempotencyKey: string;
  readonly jobName: string;
  readonly runId: string;
  readonly status: JobExecutionStatus;
  readonly startedAt: string;
  readonly finishedAt?: string;
  readonly result?: JsonValue;
  readonly error?: string;
}

export type JobExecutionBeginResult =
  | { readonly status: "started"; readonly record: JobExecutionRecord }
  | { readonly status: "duplicate"; readonly record: JobExecutionRecord };

export interface JobExecutionLog {
  begin(message: JobMessage, startedAt: string): Promise<JobExecutionBeginResult>;
  complete(message: JobMessage, finishedAt: string, result: JsonValue | undefined): Promise<void>;
  fail(message: JobMessage, finishedAt: string, error: unknown): Promise<void>;
}
