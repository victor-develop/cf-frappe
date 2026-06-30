import { notFound } from "../core/errors.js";

export function ensureDataPatchAdminAvailable<T>(dataPatches: T | undefined): asserts dataPatches is T {
  if (dataPatches === undefined) {
    throw notFound("Data patches are not enabled", "DATA_PATCH_NOT_FOUND");
  }
}

export function ensureDataPatchQueueAvailable<T>(queue: T | undefined): asserts queue is T {
  if (queue === undefined) {
    throw notFound("Data patch queue is not enabled", "DATA_PATCH_NOT_FOUND");
  }
}

export function ensureDataPatchRollbackQueueAvailable<T>(queue: T | undefined): asserts queue is T {
  if (queue === undefined) {
    throw notFound("Data patch rollback queue is not enabled", "DATA_PATCH_NOT_FOUND");
  }
}

export function ensureDataPatchRollbackRetryQueueAvailable<T>(queue: T | undefined): asserts queue is T {
  if (queue === undefined) {
    throw notFound("Data patch rollback retry queue is not enabled", "DATA_PATCH_NOT_FOUND");
  }
}
