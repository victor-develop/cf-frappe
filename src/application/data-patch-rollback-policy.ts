import type { DataPatchDefinition } from "../core/data-patch.js";
import { FrameworkError } from "../core/errors.js";
import type { RecordedDataPatch } from "../ports/data-patch-log.js";
import {
  assertDataPatchChecksumMatches,
  dataPatchRollbackRetryUnavailable,
  dataPatchRollbackUnavailable
} from "./data-patch-journal-policy.js";

export type DataPatchRollbackPlanDecision =
  | { readonly action: "include" }
  | { readonly action: "skip" }
  | { readonly action: "stop" };

export function dataPatchRollbackPlanDecision<TResources>(
  patch: DataPatchDefinition<TResources>,
  recorded: RecordedDataPatch | undefined
): DataPatchRollbackPlanDecision {
  if (recorded === undefined) {
    return { action: "skip" };
  }
  assertDataPatchChecksumMatches(patch.id, patch.checksum, recorded.checksum);
  assertDataPatchRollbackStatusReady(patch.id, recorded);
  if (recorded.status === "rolled_back") {
    return { action: "skip" };
  }
  return patch.rollback === undefined ? { action: "stop" } : { action: "include" };
}

export function assertSelectedDataPatchRollbackable<TResources>(
  patch: DataPatchDefinition<TResources>,
  recorded: RecordedDataPatch | undefined
): void {
  if (recorded === undefined) {
    throw dataPatchRollbackUnavailable(patch.id, "it has not been applied");
  }
  assertDataPatchChecksumMatches(patch.id, patch.checksum, recorded.checksum);
  assertDataPatchRollbackStatusReady(patch.id, recorded);
  if (recorded.status === "rolled_back") {
    throw new FrameworkError(
      "DATA_PATCH_ROLLBACK_UNAVAILABLE",
      `Data patch '${patch.id}' has already been rolled back`,
      { status: 409 }
    );
  }
  if (patch.rollback === undefined) {
    throw dataPatchRollbackNotDeclared(patch.id);
  }
}

export function assertDataPatchRollbackRetryable<TResources>(
  patch: DataPatchDefinition<TResources>,
  recorded: RecordedDataPatch | undefined
): void {
  if (recorded === undefined) {
    throw dataPatchRollbackRetryUnavailable(patch.id, "no failed rollback journal entry exists");
  }
  assertDataPatchChecksumMatches(patch.id, patch.checksum, recorded.checksum);
  if (recorded.status === "rollback_failed") {
    if (patch.rollback !== undefined) {
      return;
    }
    throw dataPatchRollbackNotDeclared(patch.id);
  }
  if (recorded.status === "pending") {
    throw new FrameworkError("DATA_PATCH_PENDING", `Data patch '${patch.id}' is pending`, { status: 409 });
  }
  if (recorded.status === "failed") {
    throw new FrameworkError("DATA_PATCH_FAILED", `Data patch '${patch.id}' failed and must be retried first`, {
      status: 409
    });
  }
  if (recorded.status === "rollback_pending") {
    throw new FrameworkError("DATA_PATCH_ROLLBACK_PENDING", `Data patch '${patch.id}' rollback is pending`, {
      status: 409
    });
  }
  throw dataPatchRollbackRetryUnavailable(patch.id, `journal status is '${recorded.status}'`);
}

export function planSelectedDataPatchRollback<TResources>(
  patches: readonly DataPatchDefinition<TResources>[],
  selected: readonly DataPatchDefinition<TResources>[],
  limit: number | undefined,
  recordedById: ReadonlyMap<string, RecordedDataPatch>
): readonly DataPatchDefinition<TResources>[] {
  for (const patch of selected) {
    assertSelectedDataPatchRollbackable(patch, recordedById.get(patch.id));
  }
  assertDataPatchRollbackSuccessorsRolledBack(
    patches,
    selected,
    new Set(selected.map((patch) => patch.id)),
    recordedById
  );
  const rollback = [...selected].reverse();
  return limit === undefined ? rollback : rollback.slice(0, limit);
}

export function planAutomaticDataPatchRollback<TResources>(
  patches: readonly DataPatchDefinition<TResources>[],
  limit: number | undefined,
  recordedById: ReadonlyMap<string, RecordedDataPatch>
): readonly DataPatchDefinition<TResources>[] {
  const rollback: DataPatchDefinition<TResources>[] = [];
  for (const patch of [...patches].reverse()) {
    const decision = dataPatchRollbackPlanDecision(patch, recordedById.get(patch.id));
    if (decision.action === "skip") {
      continue;
    }
    if (decision.action === "stop") {
      break;
    }
    rollback.push(patch);
    if (limit !== undefined && rollback.length >= limit) {
      break;
    }
  }
  return rollback;
}

export function assertDataPatchRollbackRetryableWithSuccessors<TResources>(
  patches: readonly DataPatchDefinition<TResources>[],
  patch: DataPatchDefinition<TResources>,
  recordedById: ReadonlyMap<string, RecordedDataPatch>
): void {
  assertDataPatchRollbackRetryable(patch, recordedById.get(patch.id));
  assertDataPatchRollbackSuccessorsRolledBack(patches, [patch], new Set([patch.id]), recordedById);
}

export function assertDataPatchRollbackSuccessorSafe(id: string, recorded: RecordedDataPatch): void {
  if (recorded.status === "pending") {
    throw new FrameworkError("DATA_PATCH_PENDING", `Data patch '${id}' is pending`, { status: 409 });
  }
  if (recorded.status === "failed") {
    throw new FrameworkError("DATA_PATCH_FAILED", `Data patch '${id}' failed and must be retried first`, {
      status: 409
    });
  }
  if (recorded.status === "rollback_pending") {
    throw new FrameworkError("DATA_PATCH_ROLLBACK_PENDING", `Data patch '${id}' rollback is pending`, {
      status: 409
    });
  }
  if (recorded.status === "rollback_failed") {
    throw new FrameworkError(
      "DATA_PATCH_ROLLBACK_FAILED",
      `Data patch '${id}' rollback failed and must be investigated first`,
      { status: 409 }
    );
  }
}

export function assertDataPatchRollbackSuccessorsRolledBack<TResources>(
  patches: readonly DataPatchDefinition<TResources>[],
  selected: readonly DataPatchDefinition<TResources>[],
  selectedIds: ReadonlySet<string>,
  recordedById: ReadonlyMap<string, RecordedDataPatch>
): void {
  const earliestSelectedIndex = Math.min(...selected.map((patch) => patches.indexOf(patch)));
  for (const patch of patches.slice(earliestSelectedIndex + 1)) {
    if (selectedIds.has(patch.id)) {
      continue;
    }
    const recorded = recordedById.get(patch.id);
    if (recorded === undefined) {
      continue;
    }
    assertDataPatchChecksumMatches(patch.id, patch.checksum, recorded.checksum);
    assertDataPatchRollbackSuccessorSafe(patch.id, recorded);
    if (recorded.status === "rolled_back") {
      continue;
    }
    throw new FrameworkError(
      "DATA_PATCH_ORDER_VIOLATION",
      `Data patch '${selected[0]?.id ?? ""}' cannot roll back before later patch '${patch.id}' is rolled back`,
      { status: 409 }
    );
  }
}

function dataPatchRollbackNotDeclared(id: string): FrameworkError {
  return new FrameworkError(
    "DATA_PATCH_ROLLBACK_UNAVAILABLE",
    `Data patch '${id}' does not declare a rollback`,
    { status: 409 }
  );
}

function assertDataPatchRollbackStatusReady(id: string, recorded: RecordedDataPatch): void {
  if (recorded.status === "pending") {
    throw new FrameworkError("DATA_PATCH_PENDING", `Data patch '${id}' is pending`, { status: 409 });
  }
  if (recorded.status === "failed") {
    throw new FrameworkError("DATA_PATCH_FAILED", `Data patch '${id}' failed and must be retried first`, {
      status: 409
    });
  }
  if (recorded.status === "rollback_pending") {
    throw new FrameworkError("DATA_PATCH_ROLLBACK_PENDING", `Data patch '${id}' rollback is pending`, {
      status: 409
    });
  }
  if (recorded.status === "rollback_failed") {
    throw new FrameworkError(
      "DATA_PATCH_ROLLBACK_FAILED",
      `Data patch '${id}' rollback failed and must be investigated first`,
      { status: 409 }
    );
  }
}
