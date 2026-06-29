import type { DataPatchDefinition } from "../core/data-patch.js";
import type { JsonValue } from "../core/types.js";
import type { RecordedDataPatch } from "../ports/data-patch-log.js";
import { assertDataPatchChecksumMatches } from "./data-patch-journal-policy.js";

export type DataPatchDashboardStatus =
  | "not_applied"
  | "pending"
  | "applied"
  | "failed"
  | "rollback_pending"
  | "rolled_back"
  | "rollback_failed";

export interface DataPatchDashboardEntry {
  readonly id: string;
  readonly label?: string;
  readonly checksum: string;
  readonly status: DataPatchDashboardStatus;
  readonly rollbackable?: boolean;
  readonly rollbackLabel?: string;
  readonly claimedAt?: string;
  readonly appliedAt?: string;
  readonly failedAt?: string;
  readonly error?: string;
  readonly result?: JsonValue;
  readonly rollbackClaimedAt?: string;
  readonly rolledBackAt?: string;
  readonly rollbackFailedAt?: string;
  readonly rollbackError?: string;
  readonly rollbackResult?: JsonValue;
}

export interface DataPatchDashboard {
  readonly patches: readonly DataPatchDashboardEntry[];
  readonly totals: DataPatchDashboardTotals;
}

export interface DataPatchDashboardTotals {
  readonly total: number;
  readonly notApplied: number;
  readonly pending: number;
  readonly applied: number;
  readonly failed: number;
  readonly rollbackPending: number;
  readonly rolledBack: number;
  readonly rollbackFailed: number;
}

export function dataPatchDashboardEntry<TResources>(
  patch: DataPatchDefinition<TResources>,
  recorded: RecordedDataPatch | undefined
): DataPatchDashboardEntry {
  if (recorded === undefined) {
    return {
      id: patch.id,
      ...(patch.label === undefined ? {} : { label: patch.label }),
      checksum: patch.checksum,
      status: "not_applied"
    };
  }
  assertDataPatchChecksumMatches(patch.id, patch.checksum, recorded.checksum);
  return {
    id: patch.id,
    ...(patch.label === undefined ? {} : { label: patch.label }),
    checksum: patch.checksum,
    status: recorded.status,
    ...(recorded.status === "applied" && patch.rollback !== undefined ? { rollbackable: true } : {}),
    ...(recorded.status === "applied" && patch.rollback?.label !== undefined ? { rollbackLabel: patch.rollback.label } : {}),
    ...(recorded.status === "pending" ? { claimedAt: recorded.claimedAt } : {}),
    ...(recorded.status === "applied" ? { appliedAt: recorded.appliedAt } : {}),
    ...(recorded.status === "applied" && recorded.result !== undefined ? { result: recorded.result } : {}),
    ...(recorded.status === "failed" ? { failedAt: recorded.failedAt, error: recorded.error } : {}),
    ...(recorded.status === "rollback_pending"
      ? {
          appliedAt: recorded.appliedAt,
          ...(recorded.result === undefined ? {} : { result: recorded.result }),
          rollbackClaimedAt: recorded.rollbackClaimedAt
        }
      : {}),
    ...(recorded.status === "rolled_back"
      ? {
          appliedAt: recorded.appliedAt,
          ...(recorded.result === undefined ? {} : { result: recorded.result }),
          rolledBackAt: recorded.rolledBackAt,
          ...(recorded.rollbackResult === undefined ? {} : { rollbackResult: recorded.rollbackResult })
        }
      : {}),
    ...(recorded.status === "rollback_failed"
      ? {
          appliedAt: recorded.appliedAt,
          ...(recorded.result === undefined ? {} : { result: recorded.result }),
          rollbackFailedAt: recorded.rollbackFailedAt,
          rollbackError: recorded.rollbackError
        }
      : {})
  };
}

export function dataPatchDashboardTotals(
  patches: readonly DataPatchDashboardEntry[]
): DataPatchDashboardTotals {
  return {
    total: patches.length,
    notApplied: patches.filter((patch) => patch.status === "not_applied").length,
    pending: patches.filter((patch) => patch.status === "pending").length,
    applied: patches.filter((patch) => patch.status === "applied").length,
    failed: patches.filter((patch) => patch.status === "failed").length,
    rollbackPending: patches.filter((patch) => patch.status === "rollback_pending").length,
    rolledBack: patches.filter((patch) => patch.status === "rolled_back").length,
    rollbackFailed: patches.filter((patch) => patch.status === "rollback_failed").length
  };
}
