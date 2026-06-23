import type { JsonValue } from "../core/types.js";

export type DataPatchStatus =
  | "pending"
  | "applied"
  | "failed"
  | "rollback_pending"
  | "rolled_back"
  | "rollback_failed";

export interface AppliedDataPatch {
  readonly id: string;
  readonly checksum: string;
  readonly appliedAt: string;
  readonly result?: JsonValue;
}

export interface ClaimDataPatch {
  readonly id: string;
  readonly checksum: string;
  readonly claimId: string;
  readonly claimedAt: string;
}

export interface ClaimedDataPatch {
  readonly id: string;
  readonly checksum: string;
  readonly claimId: string;
  readonly claimedAt: string;
}

export interface PendingDataPatch {
  readonly id: string;
  readonly checksum: string;
  readonly claimedAt: string;
}

export interface FailedDataPatch {
  readonly id: string;
  readonly checksum: string;
  readonly failedAt: string;
  readonly error: string;
}

export interface ClaimRollbackDataPatch {
  readonly id: string;
  readonly checksum: string;
  readonly claimId: string;
  readonly claimedAt: string;
}

export interface ClaimedRollbackDataPatch {
  readonly id: string;
  readonly checksum: string;
  readonly claimId: string;
  readonly claimedAt: string;
}

export interface RollbackPendingDataPatch extends AppliedDataPatch {
  readonly rollbackClaimedAt: string;
}

export interface RolledBackDataPatch extends AppliedDataPatch {
  readonly rolledBackAt: string;
  readonly rollbackResult?: JsonValue;
}

export interface RollbackFailedDataPatch extends AppliedDataPatch {
  readonly rollbackFailedAt: string;
  readonly rollbackError: string;
}

export type DataPatchClaimResult =
  | { readonly kind: "claimed"; readonly claim: ClaimedDataPatch }
  | { readonly kind: "applied"; readonly patch: AppliedDataPatch }
  | { readonly kind: "pending"; readonly patch: PendingDataPatch }
  | { readonly kind: "failed"; readonly patch: FailedDataPatch };

export type DataPatchRollbackClaimResult =
  | { readonly kind: "claimed"; readonly claim: ClaimedRollbackDataPatch }
  | { readonly kind: "pending"; readonly patch: PendingDataPatch }
  | { readonly kind: "failed"; readonly patch: FailedDataPatch }
  | { readonly kind: "rollback_pending"; readonly patch: RollbackPendingDataPatch }
  | { readonly kind: "rolled_back"; readonly patch: RolledBackDataPatch }
  | { readonly kind: "rollback_failed"; readonly patch: RollbackFailedDataPatch };

export type RecordedDataPatch =
  | ({ readonly status: "pending" } & PendingDataPatch)
  | ({ readonly status: "applied" } & AppliedDataPatch)
  | ({ readonly status: "failed" } & FailedDataPatch)
  | ({ readonly status: "rollback_pending" } & RollbackPendingDataPatch)
  | ({ readonly status: "rolled_back" } & RolledBackDataPatch)
  | ({ readonly status: "rollback_failed" } & RollbackFailedDataPatch);

export interface CompleteDataPatch {
  readonly id: string;
  readonly checksum: string;
  readonly claimId: string;
  readonly appliedAt: string;
  readonly result?: JsonValue;
}

export interface FailDataPatch {
  readonly id: string;
  readonly checksum: string;
  readonly claimId: string;
  readonly failedAt: string;
  readonly error: string;
}

export interface RetryFailedDataPatch {
  readonly id: string;
  readonly checksum: string;
}

export interface RetryFailedDataPatchRollback {
  readonly id: string;
  readonly checksum: string;
  readonly claimId: string;
  readonly claimedAt: string;
}

export interface CompleteRollbackDataPatch {
  readonly id: string;
  readonly checksum: string;
  readonly claimId: string;
  readonly rolledBackAt: string;
  readonly result?: JsonValue;
}

export interface FailRollbackDataPatch {
  readonly id: string;
  readonly checksum: string;
  readonly claimId: string;
  readonly failedAt: string;
  readonly error: string;
}

export interface DataPatchLog {
  recordedDataPatches(): Promise<readonly RecordedDataPatch[]>;
  appliedDataPatches(): Promise<readonly AppliedDataPatch[]>;
  claimDataPatch(patch: ClaimDataPatch): Promise<DataPatchClaimResult>;
  completeDataPatch(patch: CompleteDataPatch): Promise<void>;
  failDataPatch(patch: FailDataPatch): Promise<void>;
  retryFailedDataPatch(patch: RetryFailedDataPatch): Promise<void>;
  retryFailedDataPatchRollback(patch: RetryFailedDataPatchRollback): Promise<ClaimedRollbackDataPatch>;
  claimDataPatchRollback(patch: ClaimRollbackDataPatch): Promise<DataPatchRollbackClaimResult>;
  completeDataPatchRollback(patch: CompleteRollbackDataPatch): Promise<void>;
  failDataPatchRollback(patch: FailRollbackDataPatch): Promise<void>;
}
