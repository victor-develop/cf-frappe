import {
  assertAppliedDataPatchChecksumMatches,
  assertDataPatchChecksumMatches,
  assertRetryableFailedJournal,
  assertRetryableRollbackFailedJournal,
  assertRollbackClaimableJournal
} from "../../src/application/data-patch-journal-policy.js";

describe("data patch journal policy", () => {
  it("accepts only failed journals for apply retry", () => {
    const failed = journal("failed");

    expect(() => assertRetryableFailedJournal(failed, "accounts.seed", "v1")).not.toThrow();
    expect(() => assertRetryableFailedJournal(undefined, "accounts.seed", "v1")).toThrow(
      "cannot be retried because no failed journal entry exists"
    );
    expect(() => assertRetryableFailedJournal(journal("pending"), "accounts.seed", "v1")).toThrow(
      "already claimed and has not completed"
    );
    expect(() => assertRetryableFailedJournal(journal("applied"), "accounts.seed", "v1")).toThrow(
      "cannot be retried because journal status is 'applied'"
    );
    expect(() => assertRetryableFailedJournal(journal("failed", "v2"), "accounts.seed", "v1")).toThrow(
      "has checksum 'v2' but planned 'v1'"
    );
  });

  it("accepts only rollback-failed journals for rollback retry", () => {
    const failedRollback = journal("rollback_failed");

    expect(() => assertRetryableRollbackFailedJournal(failedRollback, "accounts.seed", "v1")).not.toThrow();
    expect(() => assertRetryableRollbackFailedJournal(undefined, "accounts.seed", "v1")).toThrow(
      "rollback cannot be retried because no failed rollback journal entry exists"
    );
    expect(() => assertRetryableRollbackFailedJournal(journal("failed"), "accounts.seed", "v1")).toThrow(
      "failed and must be retried first"
    );
    expect(() => assertRetryableRollbackFailedJournal(journal("rollback_pending"), "accounts.seed", "v1")).toThrow(
      "rollback is pending"
    );
    expect(() => assertRetryableRollbackFailedJournal(journal("rolled_back"), "accounts.seed", "v1")).toThrow(
      "rollback cannot be retried because journal status is 'rolled_back'"
    );
  });

  it("accepts existing known journals for rollback claims", () => {
    expect(() => assertRollbackClaimableJournal(journal("applied"), "accounts.seed", "v1")).not.toThrow();
    expect(() => assertRollbackClaimableJournal(journal("pending"), "accounts.seed", "v1")).not.toThrow();
    expect(() => assertRollbackClaimableJournal(undefined, "accounts.seed", "v1")).toThrow(
      "cannot be rolled back because no applied journal entry exists"
    );
    expect(() => assertRollbackClaimableJournal(journal("corrupt"), "accounts.seed", "v1")).toThrow(
      "invalid journal status 'corrupt'"
    );
  });

  it("formats recorded and applied checksum mismatches for their callers", () => {
    expect(() => assertDataPatchChecksumMatches("accounts.seed", "v1", "v2")).toThrow(
      "Recorded data patch 'accounts.seed' has checksum 'v2' but planned 'v1'"
    );
    expect(() => assertAppliedDataPatchChecksumMatches("accounts.seed", "v1", "v2")).toThrow(
      "Applied data patch 'accounts.seed' has checksum 'v2' but planned 'v1'"
    );
  });
});

function journal(status: string, checksum = "v1") {
  return {
    id: "accounts.seed",
    checksum,
    status
  };
}
