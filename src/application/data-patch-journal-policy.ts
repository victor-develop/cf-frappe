import { FrameworkError } from "../core/errors.js";

export type DataPatchJournalStatus =
  | "pending"
  | "applied"
  | "failed"
  | "rollback_pending"
  | "rolled_back"
  | "rollback_failed";

export interface DataPatchJournalState {
  readonly id: string;
  readonly checksum: string;
  readonly status: string;
}

export function assertRetryableFailedJournal<TJournal extends DataPatchJournalState>(
  journal: TJournal | undefined,
  id: string,
  checksum: string
): asserts journal is TJournal & { readonly status: "failed" } {
  if (journal === undefined) {
    throw dataPatchRetryUnavailable(id, "no failed journal entry exists");
  }
  assertDataPatchChecksumMatches(id, checksum, journal.checksum);
  if (journal.status === "failed") {
    return;
  }
  if (journal.status === "pending") {
    throw new FrameworkError(
      "DATA_PATCH_PENDING",
      `Data patch '${id}' is already claimed and has not completed`,
      { status: 409 }
    );
  }
  if (journal.status === "applied") {
    throw dataPatchRetryUnavailable(id, "journal status is 'applied'");
  }
  if (
    journal.status === "rollback_pending" ||
    journal.status === "rolled_back" ||
    journal.status === "rollback_failed"
  ) {
    throw dataPatchRetryUnavailable(id, `journal status is '${journal.status}'`);
  }
  throw invalidDataPatchJournalStatus(journal);
}

export function assertRetryableRollbackFailedJournal<TJournal extends DataPatchJournalState>(
  journal: TJournal | undefined,
  id: string,
  checksum: string
): asserts journal is TJournal & { readonly status: "rollback_failed" } {
  if (journal === undefined) {
    throw dataPatchRollbackRetryUnavailable(id, "no failed rollback journal entry exists");
  }
  assertDataPatchChecksumMatches(id, checksum, journal.checksum);
  if (journal.status === "rollback_failed") {
    return;
  }
  if (journal.status === "pending") {
    throw new FrameworkError(
      "DATA_PATCH_PENDING",
      `Data patch '${id}' is already claimed and has not completed`,
      { status: 409 }
    );
  }
  if (journal.status === "failed") {
    throw new FrameworkError("DATA_PATCH_FAILED", `Data patch '${id}' failed and must be retried first`, {
      status: 409
    });
  }
  if (journal.status === "rollback_pending") {
    throw new FrameworkError("DATA_PATCH_ROLLBACK_PENDING", `Data patch '${id}' rollback is pending`, {
      status: 409
    });
  }
  if (journal.status === "applied" || journal.status === "rolled_back") {
    throw dataPatchRollbackRetryUnavailable(id, `journal status is '${journal.status}'`);
  }
  throw invalidDataPatchJournalStatus(journal);
}

export function assertRollbackClaimableJournal<TJournal extends DataPatchJournalState>(
  journal: TJournal | undefined,
  id: string,
  checksum: string
): asserts journal is TJournal {
  if (journal === undefined) {
    throw dataPatchRollbackUnavailable(id, "no applied journal entry exists");
  }
  assertDataPatchChecksumMatches(id, checksum, journal.checksum);
  if (
    journal.status === "applied" ||
    journal.status === "pending" ||
    journal.status === "failed" ||
    journal.status === "rollback_pending" ||
    journal.status === "rolled_back" ||
    journal.status === "rollback_failed"
  ) {
    return;
  }
  throw invalidDataPatchJournalStatus(journal);
}

export function assertDataPatchChecksumMatches(id: string, plannedChecksum: string, recordedChecksum: string): void {
  if (plannedChecksum === recordedChecksum) {
    return;
  }
  throw new FrameworkError(
    "DATA_PATCH_CHECKSUM_MISMATCH",
    `Recorded data patch '${id}' has checksum '${recordedChecksum}' but planned '${plannedChecksum}'`,
    { status: 409 }
  );
}

export function assertAppliedDataPatchChecksumMatches(
  id: string,
  plannedChecksum: string,
  appliedChecksum: string
): void {
  if (plannedChecksum === appliedChecksum) {
    return;
  }
  throw new FrameworkError(
    "DATA_PATCH_CHECKSUM_MISMATCH",
    `Applied data patch '${id}' has checksum '${appliedChecksum}' but planned '${plannedChecksum}'`,
    { status: 409 }
  );
}

export function invalidDataPatchJournalStatus(journal: DataPatchJournalState): FrameworkError {
  return new FrameworkError(
    "DATA_PATCH_INVALID",
    `Data patch '${journal.id}' has invalid journal status '${journal.status}'`,
    { status: 409 }
  );
}

export function dataPatchRetryUnavailable(id: string, reason: string): FrameworkError {
  return new FrameworkError(
    "DATA_PATCH_RETRY_UNAVAILABLE",
    `Data patch '${id}' cannot be retried because ${reason}`,
    { status: 409 }
  );
}

export function dataPatchApplyUnavailable(id: string, reason: string): FrameworkError {
  return new FrameworkError(
    "DATA_PATCH_APPLY_UNAVAILABLE",
    `Data patch '${id}' cannot be applied because ${reason}`,
    { status: 409 }
  );
}

export function dataPatchRollbackRetryUnavailable(id: string, reason: string): FrameworkError {
  return new FrameworkError(
    "DATA_PATCH_ROLLBACK_RETRY_UNAVAILABLE",
    `Data patch '${id}' rollback cannot be retried because ${reason}`,
    { status: 409 }
  );
}

export function dataPatchRollbackUnavailable(id: string, reason: string): FrameworkError {
  return new FrameworkError(
    "DATA_PATCH_ROLLBACK_UNAVAILABLE",
    `Data patch '${id}' cannot be rolled back because ${reason}`,
    { status: 409 }
  );
}
