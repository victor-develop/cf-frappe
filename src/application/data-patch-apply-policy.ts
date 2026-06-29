import type { DataPatchDefinition } from "../core/data-patch.js";
import { FrameworkError } from "../core/errors.js";
import type { RecordedDataPatch } from "../ports/data-patch-log.js";
import { assertDataPatchChecksumMatches } from "./data-patch-journal-policy.js";

export function assertSelectedDataPatchPredecessorsApplied<TResources>(
  patches: readonly DataPatchDefinition<TResources>[],
  selected: readonly DataPatchDefinition<TResources>[],
  recordedById: ReadonlyMap<string, RecordedDataPatch>
): void {
  const selectedIds = new Set(selected.map((patch) => patch.id));
  let blocker: DataPatchDefinition<TResources> | undefined;
  for (const patch of patches) {
    if (selectedIds.has(patch.id)) {
      if (blocker !== undefined) {
        throw new FrameworkError(
          "DATA_PATCH_ORDER_VIOLATION",
          `Data patch '${patch.id}' cannot run before earlier patch '${blocker.id}' is applied`,
          { status: 409 }
        );
      }
      continue;
    }
    const recorded = recordedById.get(patch.id);
    if (recorded === undefined) {
      blocker ??= patch;
      continue;
    }
    assertDataPatchChecksumMatches(patch.id, patch.checksum, recorded.checksum);
    if (recorded.status !== "applied") {
      blocker ??= patch;
    }
  }
}
