import {
  automationRunClaimExpired,
  automationRunClaimLeaseSeconds,
  automationRunClaimLimit,
  automationRunFailureError,
  automationRunRetryAt,
  automationRunRetryDue,
  automationRunShouldDeadLetter,
  claimableAutomationRuns,
  ensureAutomationRunClaimed,
  ensureAutomationRunServiceAvailable,
  normalizeAutomationRunRetryPolicy
} from "../../src";
import type { AutomationRunRecord } from "../../src";

describe("automation run policy", () => {
  it("normalizes claim limits, leases, failures, and retry policies", () => {
    expect(automationRunClaimLimit(undefined)).toBe(25);
    expect(automationRunClaimLimit(3)).toBe(3);
    expect(automationRunClaimLeaseSeconds(undefined)).toBe(300);
    expect(automationRunClaimLeaseSeconds(10)).toBe(10);
    expect(automationRunFailureError("  failed  ")).toBe("failed");
    expect(normalizeAutomationRunRetryPolicy()).toEqual({
      maxAttempts: 10,
      baseDelaySeconds: 30,
      maxDelaySeconds: 1800
    });
    expect(normalizeAutomationRunRetryPolicy({
      maxAttempts: 2,
      baseDelaySeconds: 5,
      maxDelaySeconds: 10
    })).toEqual({ maxAttempts: 2, baseDelaySeconds: 5, maxDelaySeconds: 10 });
  });

  it("rejects invalid policy inputs", () => {
    expect(() => ensureAutomationRunServiceAvailable(undefined)).toThrow("not enabled");
    expect(() => automationRunClaimLimit(0)).toThrow("between");
    expect(() => automationRunClaimLimit(101)).toThrow("between");
    expect(() => automationRunClaimLeaseSeconds(0)).toThrow("between");
    expect(() => automationRunClaimLeaseSeconds(3601)).toThrow("between");
    expect(() => automationRunFailureError("   ")).toThrow("required");
    expect(() => normalizeAutomationRunRetryPolicy({ maxAttempts: 0 })).toThrow("maxAttempts");
    expect(() => normalizeAutomationRunRetryPolicy({ baseDelaySeconds: 0 })).toThrow("baseDelaySeconds");
    expect(() => normalizeAutomationRunRetryPolicy({ baseDelaySeconds: 10, maxDelaySeconds: 5 })).toThrow("maxDelaySeconds");
  });

  it("selects claimable runs by status, retry time, lease expiry, and age", () => {
    const pendingLate = run({ id: "pending-late", status: "pending", enqueuedAt: "2026-01-01T00:02:00.000Z" });
    const pendingEarly = run({ id: "pending-early", status: "pending", enqueuedAt: "2026-01-01T00:01:00.000Z" });
    const failedDue = run({ id: "failed-due", status: "failed", retryAt: "2026-01-01T00:03:00.000Z" });
    const failedFuture = run({ id: "failed-future", status: "failed", retryAt: "2026-01-01T00:04:00.000Z" });
    const expired = run({
      id: "expired",
      status: "claimed",
      claimId: "claim-1",
      claimExpiresAt: "2026-01-01T00:02:59.000Z"
    });
    const claimed = run({
      id: "claimed",
      status: "claimed",
      claimId: "claim-2",
      claimExpiresAt: "2026-01-01T00:05:00.000Z"
    });
    const now = "2026-01-01T00:03:00.000Z";

    expect(automationRunRetryAt({
      now,
      attempts: 3,
      baseDelaySeconds: 10,
      maxDelaySeconds: 60
    })).toBe("2026-01-01T00:03:40.000Z");
    expect(automationRunRetryDue(failedDue, now)).toBe(true);
    expect(automationRunRetryDue(failedFuture, now)).toBe(false);
    expect(automationRunRetryDue(run({ id: "failed-without-date", status: "failed" }), now)).toBe(true);
    expect(automationRunClaimExpired(expired, now)).toBe(true);
    expect(automationRunClaimExpired(claimed, now)).toBe(false);
    expect(claimableAutomationRuns([
      pendingLate,
      failedFuture,
      claimed,
      failedDue,
      expired,
      pendingEarly
    ], now, 3).map((record) => record.id)).toEqual(["expired", "failed-due", "pending-early"]);
  });

  it("checks claim ownership and dead-letter eligibility", () => {
    const claimed = run({ status: "claimed", claimId: "claim-1", attempts: 2 });

    expect(() => ensureAutomationRunClaimed(claimed, "claim-1")).not.toThrow();
    expect(() => ensureAutomationRunClaimed(claimed, "claim-2")).toThrow("not claimed");
    expect(() => ensureAutomationRunClaimed(run({ status: "pending" }), "claim-1")).toThrow("not claimed");
    expect(automationRunShouldDeadLetter(run({ attempts: 3, retry: { maxAttempts: 3, baseDelaySeconds: 1, maxDelaySeconds: 2 } }))).toBe(true);
    expect(automationRunShouldDeadLetter(run({ attempts: 2, retry: { maxAttempts: 3, baseDelaySeconds: 1, maxDelaySeconds: 2 } }))).toBe(false);
  });
});

function run(overrides: Partial<AutomationRunRecord> = {}): AutomationRunRecord {
  return {
    id: "run-1",
    tenantId: "acme",
    sourceEventId: "evt_source",
    sourceEventType: "SourceUpdated",
    sourcePayloadKind: "DocumentUpdated",
    sourceDoctype: "Source",
    sourceDocumentName: "Source One",
    sourceActorId: "owner@example.com",
    ruleName: "Mirror",
    actionIndex: 0,
    action: {
      kind: "updateDocument",
      target: { doctype: "Target", name: "Target One" },
      patch: { title: "Done" }
    },
    retry: { maxAttempts: 3, baseDelaySeconds: 10, maxDelaySeconds: 60 },
    status: "pending",
    attempts: 0,
    enqueuedAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    ...overrides
  };
}
