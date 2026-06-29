import {
  jobHistoryDefinitionSummary,
  normalizeJobHistoryQuery,
  planJobHistoryAccess,
  planJobHistoryListOptions,
  planJobHistoryRecordAccess,
  planJobHistoryRecordLookup,
  SYSTEM_MANAGER_ROLE
} from "../../src";
import type { JobExecutionRecord } from "../../src";

describe("job history policy", () => {
  it("plans tenant-scoped history access for configured admin roles", () => {
    expect(planJobHistoryAccess({
      actor: { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
      adminRoles: [SYSTEM_MANAGER_ROLE]
    })).toEqual({ status: "allow", tenantId: "acme" });

    expect(planJobHistoryAccess({
      actor: { id: "operator@example.com", roles: ["Job Operator"] },
      adminRoles: ["Job Operator"]
    })).toEqual({ status: "allow", tenantId: "default" });

    expect(planJobHistoryAccess({
      actor: { id: "reader@example.com", roles: ["User"], tenantId: "acme" },
      adminRoles: [SYSTEM_MANAGER_ROLE]
    })).toEqual({
      status: "deny",
      message: "Actor 'reader@example.com' cannot inspect job history"
    });
  });

  it("keeps individual execution records scoped to the authorized tenant", () => {
    const actor = { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" };

    expect(planJobHistoryRecordAccess({
      actor,
      tenantId: "acme",
      record: execution({ tenantId: "acme" })
    })).toEqual({ status: "allow" });

    expect(planJobHistoryRecordAccess({
      actor,
      tenantId: "acme",
      record: execution({ tenantId: "other" })
    })).toEqual({
      status: "deny",
      message: "Actor 'admin@example.com' cannot inspect job history for tenant 'other'"
    });
  });

  it("plans individual execution record lookups before access checks", () => {
    const record = execution();

    expect(planJobHistoryRecordLookup(record.idempotencyKey, record)).toEqual({
      status: "found",
      record
    });
    expect(planJobHistoryRecordLookup("missing", null)).toEqual({
      status: "missing",
      idempotencyKey: "missing"
    });
    expect(planJobHistoryRecordLookup("missing", undefined)).toEqual({
      status: "missing",
      idempotencyKey: "missing"
    });
  });

  it("normalizes dashboard filters and list options without leaking empty fields", () => {
    const normalized = normalizeJobHistoryQuery({
      jobName: "reports.daily",
      runId: "",
      status: "failed",
      limit: 250
    });

    expect(normalized).toEqual({
      filters: { jobName: "reports.daily", status: "failed" },
      limit: 200
    });
    expect(planJobHistoryListOptions("acme", normalized)).toEqual({
      tenantId: "acme",
      jobName: "reports.daily",
      status: "failed",
      limit: 200
    });
  });

  it("rejects unknown statuses and invalid limits", () => {
    expect(() => normalizeJobHistoryQuery({ status: "waiting" })).toThrow("Unknown job execution status 'waiting'");
    expect(() => normalizeJobHistoryQuery({ limit: 0 })).toThrow("Job history limit must be a positive integer");
    expect(() => normalizeJobHistoryQuery({ limit: 1.5 })).toThrow("Job history limit must be a positive integer");
  });

  it("summarizes registered jobs with default pool and retry metadata", () => {
    expect(jobHistoryDefinitionSummary({ name: "email.digest" })).toEqual({
      name: "email.digest",
      pool: "default"
    });
    expect(jobHistoryDefinitionSummary({
      name: "reports.daily",
      description: "Build reports",
      pool: "reports",
      retry: { maxAttempts: 3, baseDelaySeconds: 30 }
    })).toEqual({
      name: "reports.daily",
      description: "Build reports",
      pool: "reports",
      retry: { maxAttempts: 3, baseDelaySeconds: 30 }
    });
  });
});

function execution(overrides: Partial<JobExecutionRecord> = {}): JobExecutionRecord {
  return {
    tenantId: "acme",
    idempotencyKey: "reports.daily:job_001",
    jobName: "reports.daily",
    runId: "job_001",
    payload: {},
    metadata: {},
    enqueuedAt: "2026-01-01T00:00:00.000Z",
    status: "failed",
    startedAt: "2026-01-01T00:00:01.000Z",
    finishedAt: "2026-01-01T00:00:05.000Z",
    error: "down",
    ...overrides
  };
}
