import type { JsonValue } from "../core/types.js";

export type DataPatchStatus = "pending" | "applied" | "failed";

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

export type DataPatchClaimResult =
  | { readonly kind: "claimed"; readonly claim: ClaimedDataPatch }
  | { readonly kind: "applied"; readonly patch: AppliedDataPatch }
  | { readonly kind: "pending"; readonly patch: PendingDataPatch }
  | { readonly kind: "failed"; readonly patch: FailedDataPatch };

export type RecordedDataPatch =
  | ({ readonly status: "pending" } & PendingDataPatch)
  | ({ readonly status: "applied" } & AppliedDataPatch)
  | ({ readonly status: "failed" } & FailedDataPatch);

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

export interface DataPatchLog {
  recordedDataPatches(): Promise<readonly RecordedDataPatch[]>;
  appliedDataPatches(): Promise<readonly AppliedDataPatch[]>;
  claimDataPatch(patch: ClaimDataPatch): Promise<DataPatchClaimResult>;
  completeDataPatch(patch: CompleteDataPatch): Promise<void>;
  failDataPatch(patch: FailDataPatch): Promise<void>;
  retryFailedDataPatch(patch: RetryFailedDataPatch): Promise<void>;
}
