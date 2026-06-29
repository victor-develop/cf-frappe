import {
  planJobExecutionRetry,
  planJobRetryAccess,
  retryMetadata,
  SYSTEM_MANAGER_ROLE
} from "../../src";
import type { JobExecutionRecord } from "../../src";
import { now } from "../helpers";

describe("job retry policy", () => {
  it("plans tenant-scoped retry access for configured admin roles", () => {
    expect(planJobRetryAccess({
      actor: { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
      adminRoles: [SYSTEM_MANAGER_ROLE]
    })).toEqual({ status: "allow", tenantId: "acme" });

    expect(planJobRetryAccess({
      actor: { id: "owner@example.com", roles: ["Support Manager"] },
      adminRoles: ["Support Manager"]
    })).toEqual({ status: "allow", tenantId: "default" });

    expect(planJobRetryAccess({
      actor: { id: "reader@example.com", roles: ["User"], tenantId: "acme" },
      adminRoles: [SYSTEM_MANAGER_ROLE]
    })).toEqual({
      status: "deny",
      message: "Actor 'reader@example.com' cannot retry jobs"
    });
  });

  it("rejects non-failed executions before building retry commands", () => {
    expect(planJobExecutionRetry({
      actor: { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
      original: execution({ status: "succeeded" }),
      retriedAt: now
    })).toEqual({
      status: "reject",
      message: "Only failed job executions can be retried"
    });
  });

  it("rejects failed executions without an original message snapshot", () => {
    expect(planJobExecutionRetry({
      actor: { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
      original: withoutPayload(execution()),
      retriedAt: now
    })).toEqual({
      status: "reject",
      message: "Job execution cannot be retried because its original message snapshot is missing"
    });

    expect(planJobExecutionRetry({
      actor: { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
      original: withoutMetadata(execution()),
      retriedAt: now
    })).toEqual({
      status: "reject",
      message: "Job execution cannot be retried because its original message snapshot is missing"
    });
  });

  it("builds deterministic retry commands from the original execution snapshot", () => {
    expect(planJobExecutionRetry({
      actor: { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
      original: execution(),
      retriedAt: now
    })).toEqual({
      status: "retry",
      command: {
        tenantId: "acme",
        jobName: "email.digest",
        payload: { account: "acme" },
        idempotencyKey: "email.digest:job_001",
        metadata: {
          source: "cron",
          retriedAt: now,
          retriedBy: "admin@example.com",
          retriedFromRunId: "job_001"
        }
      }
    });
  });

  it("derives retry metadata without mutating the original snapshot", () => {
    const metadata = { source: "cron", nested: { attempt: 1 } };

    expect(retryMetadata(
      metadata,
      { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
      "job_001",
      now
    )).toEqual({
      source: "cron",
      nested: { attempt: 1 },
      retriedAt: now,
      retriedBy: "admin@example.com",
      retriedFromRunId: "job_001"
    });
    expect(metadata).toEqual({ source: "cron", nested: { attempt: 1 } });
  });
});

function execution(overrides: Partial<JobExecutionRecord> = {}): JobExecutionRecord {
  return {
    tenantId: "acme",
    idempotencyKey: "email.digest:job_001",
    jobName: "email.digest",
    runId: "job_001",
    payload: { account: "acme" },
    metadata: { source: "cron" },
    enqueuedAt: "2026-01-01T00:00:00.000Z",
    status: "failed",
    startedAt: "2026-01-01T00:00:01.000Z",
    finishedAt: "2026-01-01T00:00:05.000Z",
    error: "smtp timeout",
    ...overrides
  };
}

function withoutPayload(record: JobExecutionRecord): JobExecutionRecord {
  const { payload: _payload, ...rest } = record;
  return rest;
}

function withoutMetadata(record: JobExecutionRecord): JobExecutionRecord {
  const { metadata: _metadata, ...rest } = record;
  return rest;
}
