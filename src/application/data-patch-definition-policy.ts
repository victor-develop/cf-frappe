import { assertDataPatchId, defineDataPatch, type DataPatchDefinition } from "../core/data-patch.js";
import { badRequest, FrameworkError, notFound } from "../core/errors.js";
import type { Actor } from "../core/types.js";

export type DataPatchAdministrationDecision =
  | { readonly status: "allow" }
  | { readonly status: "deny"; readonly message: string };

export function planDataPatchAdministrationAccess(options: {
  readonly actor: Actor;
  readonly adminRoles: readonly string[];
}): DataPatchAdministrationDecision {
  if (options.adminRoles.some((role) => options.actor.roles.includes(role))) {
    return { status: "allow" };
  }
  return { status: "deny", message: `Actor '${options.actor.id}' cannot manage data patches` };
}

export function snapshotDataPatchDefinitions<TResources>(
  patches: readonly DataPatchDefinition<TResources>[]
): readonly DataPatchDefinition<TResources>[] {
  return Object.freeze(patches.map((patch) => defineDataPatch(patch)));
}

export function snapshotUniqueDataPatchDefinitions<TResources>(
  patches: readonly DataPatchDefinition<TResources>[]
): readonly DataPatchDefinition<TResources>[] {
  return Object.freeze(normalizeDataPatchDefinitions(patches));
}

export function normalizeDataPatchDefinitions<TResources>(
  patches: readonly DataPatchDefinition<TResources>[]
): readonly DataPatchDefinition<TResources>[] {
  const seen = new Set<string>();
  return patches.map((patch) => {
    const definition = defineDataPatch(patch);
    if (seen.has(definition.id)) {
      throw new FrameworkError("DATA_PATCH_DUPLICATE", `Data patch '${definition.id}' is defined more than once`, {
        status: 409
      });
    }
    seen.add(definition.id);
    return definition;
  });
}

export function normalizeSingleDataPatchDefinition<TResources>(
  patch: DataPatchDefinition<TResources>
): DataPatchDefinition<TResources> {
  return defineDataPatch(patch);
}

export function selectDataPatches<TResources>(
  patches: readonly DataPatchDefinition<TResources>[],
  patchIds: readonly string[] | undefined
): readonly DataPatchDefinition<TResources>[] {
  if (patchIds === undefined) {
    return patches;
  }
  if (patchIds.length === 0) {
    throw badRequest("At least one data patch id is required");
  }
  const requested = new Set<string>();
  for (const id of patchIds) {
    assertDataPatchId(id);
    requested.add(id);
  }
  const selected = patches.filter((patch) => requested.has(patch.id));
  const known = new Set(selected.map((patch) => patch.id));
  const missing = [...requested].filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw notFound(`Data patch '${missing[0]}' is not registered`, "DATA_PATCH_NOT_FOUND");
  }
  return selected;
}

export function selectDataPatch<TResources>(
  patches: readonly DataPatchDefinition<TResources>[],
  patchId: string
): DataPatchDefinition<TResources> {
  const patch = selectDataPatches(patches, [patchId])[0];
  if (patch === undefined) {
    throw notFound(`Data patch '${patchId}' is not registered`, "DATA_PATCH_NOT_FOUND");
  }
  return patch;
}

export function assertDataPatchApplyLimit(limit: number | undefined): void {
  if (limit === undefined) {
    return;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest("Data patch apply limit must be a positive integer");
  }
}
