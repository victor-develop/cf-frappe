import { FrameworkError } from "./errors.js";
import type { JsonValue } from "./types.js";

export type DataPatchResult = JsonValue | void;
export type DataPatchRun<TResources = unknown> = (
  context: DataPatchContext<TResources>
) => DataPatchResult | Promise<DataPatchResult>;

export interface DataPatchContext<TResources = unknown> {
  readonly resources: TResources;
}

export interface DataPatchDefinition<TResources = unknown> {
  readonly id: string;
  readonly label?: string;
  readonly checksum: string;
  readonly run: DataPatchRun<TResources>;
  readonly rollback?: DataPatchRollbackDefinition<TResources>;
}

export interface DataPatchRollbackDefinition<TResources = unknown> {
  readonly label?: string;
  readonly run: DataPatchRun<TResources>;
}

export function defineDataPatch<TResources = unknown>(
  definition: DataPatchDefinition<TResources>
): DataPatchDefinition<TResources> {
  assertDataPatchId(definition.id);
  assertDataPatchChecksum(definition.checksum, definition.id);
  return Object.freeze({ ...definition });
}

export function assertDataPatchId(id: string): void {
  if (!/^[a-z0-9][a-z0-9_.-]*$/u.test(id)) {
    throw new FrameworkError("DATA_PATCH_INVALID", `Invalid data patch id '${id}'`, { status: 400 });
  }
}

function assertDataPatchChecksum(checksum: string, id: string): void {
  if (checksum.trim().length === 0) {
    throw new FrameworkError("DATA_PATCH_INVALID", `Data patch '${id}' must define a non-empty checksum`, {
      status: 400
    });
  }
}
