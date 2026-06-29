import { badRequest } from "../core/errors.js";
import { cloneJsonValue, isJsonValue } from "../core/json.js";
import type { JsonValue } from "../core/types.js";
import type {
  AppliedDataPatch,
  CompleteDataPatch,
  CompleteRollbackDataPatch,
  FailDataPatch,
  FailRollbackDataPatch,
  RolledBackDataPatch
} from "../ports/data-patch-log.js";

export interface DataPatchRunRecord {
  readonly id: string;
  readonly checksum: string;
  readonly appliedAt: string;
  readonly result?: JsonValue;
}

export interface DataPatchRunResult {
  readonly applied: readonly DataPatchRunRecord[];
  readonly skipped: readonly AppliedDataPatch[];
}

export interface DataPatchRollbackRecord {
  readonly id: string;
  readonly checksum: string;
  readonly rolledBackAt: string;
  readonly result?: JsonValue;
}

export interface DataPatchRollbackRunResult {
  readonly rolledBack: readonly DataPatchRollbackRecord[];
  readonly skipped: readonly RolledBackDataPatch[];
}

export function normalizeDataPatchRunResult(result: JsonValue | void, label: string): JsonValue | undefined {
  if (result === undefined) {
    return undefined;
  }
  if (!isJsonValue(result)) {
    throw badRequest(`${label} must be JSON-serializable`);
  }
  return cloneJsonValue(result);
}

export function dataPatchRunRecord(
  id: string,
  checksum: string,
  appliedAt: string,
  result: JsonValue | undefined
): DataPatchRunRecord {
  return {
    id,
    checksum,
    appliedAt,
    ...(result === undefined ? {} : { result })
  };
}

export function dataPatchRunCompleteCommand(record: DataPatchRunRecord, claimId: string): CompleteDataPatch {
  return { ...record, claimId };
}

export function dataPatchRunFailureCommand(
  id: string,
  checksum: string,
  claimId: string,
  failedAt: string,
  error: unknown
): FailDataPatch {
  return {
    id,
    checksum,
    claimId,
    failedAt,
    error: dataPatchErrorMessage(error)
  };
}

export function dataPatchRollbackRecord(
  id: string,
  checksum: string,
  rolledBackAt: string,
  result: JsonValue | undefined
): DataPatchRollbackRecord {
  return {
    id,
    checksum,
    rolledBackAt,
    ...(result === undefined ? {} : { result })
  };
}

export function dataPatchRollbackCompleteCommand(
  record: DataPatchRollbackRecord,
  claimId: string
): CompleteRollbackDataPatch {
  return { ...record, claimId };
}

export function dataPatchRollbackFailureCommand(
  id: string,
  checksum: string,
  claimId: string,
  failedAt: string,
  error: unknown
): FailRollbackDataPatch {
  return {
    id,
    checksum,
    claimId,
    failedAt,
    error: dataPatchErrorMessage(error)
  };
}

export function dataPatchErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
