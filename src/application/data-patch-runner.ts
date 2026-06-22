import { defineDataPatch, type DataPatchDefinition } from "../core/data-patch.js";
import { FrameworkError } from "../core/errors.js";
import type { JsonValue } from "../core/types.js";
import type { Clock } from "../ports/clock.js";
import { systemClock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";
import { cryptoIdGenerator } from "../ports/id-generator.js";
import type { AppliedDataPatch, DataPatchLog, RecordedDataPatch } from "../ports/data-patch-log.js";

export interface DataPatchRunnerOptions<TResources = unknown> {
  readonly log: DataPatchLog;
  readonly patches?: readonly DataPatchDefinition<TResources>[];
  readonly resources: TResources;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}

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

export class DataPatchRunner<TResources = unknown> {
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  private readonly log: DataPatchLog;
  private readonly patches: readonly DataPatchDefinition<TResources>[];
  private readonly resources: TResources;

  constructor(options: DataPatchRunnerOptions<TResources>) {
    this.clock = options.clock ?? systemClock;
    this.ids = options.ids ?? cryptoIdGenerator;
    this.log = options.log;
    this.patches = Object.freeze([...(options.patches ?? [])]);
    this.resources = options.resources;
  }

  async pendingPatches(
    patches: readonly DataPatchDefinition<TResources>[] = this.patches
  ): Promise<readonly DataPatchDefinition<TResources>[]> {
    const planned = normalizePatches(patches);
    const recordedById = new Map((await this.log.recordedDataPatches()).map((patch) => [patch.id, patch]));
    const pending: DataPatchDefinition<TResources>[] = [];
    for (const patch of planned) {
      const recorded = recordedById.get(patch.id);
      if (recorded === undefined) {
        pending.push(patch);
        continue;
      }
      assertRecordedPatchAllowsSkip(patch, recorded);
    }
    return pending;
  }

  async apply(patches: readonly DataPatchDefinition<TResources>[] = this.patches): Promise<DataPatchRunResult> {
    const planned = normalizePatches(patches);
    const recordedById = new Map((await this.log.recordedDataPatches()).map((patch) => [patch.id, patch]));
    const applied: DataPatchRunRecord[] = [];
    const skipped: AppliedDataPatch[] = [];

    for (const patch of planned) {
      const existing = recordedById.get(patch.id);
      if (existing !== undefined) {
        skipped.push(assertRecordedPatchAllowsSkip(patch, existing));
        continue;
      }

      const claim = await this.log.claimDataPatch({
        id: patch.id,
        checksum: patch.checksum,
        claimId: this.ids.next(),
        claimedAt: this.clock.now()
      });
      if (claim.kind === "applied") {
        assertChecksumMatches(patch, claim.patch);
        skipped.push(claim.patch);
        recordedById.set(claim.patch.id, { ...claim.patch, status: "applied" });
        continue;
      }
      if (claim.kind === "pending") {
        assertChecksumValueMatches(patch, claim.patch.checksum);
        throw new FrameworkError(
          "DATA_PATCH_PENDING",
          `Data patch '${patch.id}' is already claimed and has not completed`,
          { status: 409 }
        );
      }
      if (claim.kind === "failed") {
        assertChecksumValueMatches(patch, claim.patch.checksum);
        throw new FrameworkError(
          "DATA_PATCH_FAILED",
          `Data patch '${patch.id}' previously failed at '${claim.patch.failedAt}': ${claim.patch.error}`,
          { status: 409 }
        );
      }

      let result: JsonValue | undefined;
      try {
        result = normalizeResult(await patch.run({ resources: this.resources }));
      } catch (error) {
        await this.log.failDataPatch({
          id: patch.id,
          checksum: patch.checksum,
          claimId: claim.claim.claimId,
          failedAt: this.clock.now(),
          error: errorMessage(error)
        });
        throw error;
      }

      const record = {
        id: patch.id,
        checksum: patch.checksum,
        appliedAt: this.clock.now(),
        ...(result === undefined ? {} : { result })
      };
      await this.log.completeDataPatch({
        ...record,
        claimId: claim.claim.claimId
      });
      applied.push(record);
      recordedById.set(record.id, { ...record, status: "applied" });
    }

    return { applied, skipped };
  }
}

function normalizePatches<TResources>(
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

function patchChecksum<TResources>(patch: DataPatchDefinition<TResources>): string {
  return patch.checksum;
}

function assertChecksumMatches<TResources>(patch: DataPatchDefinition<TResources>, applied: AppliedDataPatch): void {
  const checksum = patchChecksum(patch);
  if (checksum !== applied.checksum) {
    throw new FrameworkError(
      "DATA_PATCH_CHECKSUM_MISMATCH",
      `Applied data patch '${patch.id}' has checksum '${applied.checksum}' but planned '${checksum}'`,
      { status: 409 }
    );
  }
}

function assertRecordedPatchAllowsSkip<TResources>(
  patch: DataPatchDefinition<TResources>,
  recorded: RecordedDataPatch
): AppliedDataPatch {
  if (recorded.status === "applied") {
    const applied = appliedPatchFromRecord(recorded);
    assertChecksumMatches(patch, applied);
    return applied;
  }
  assertChecksumValueMatches(patch, recorded.checksum);
  if (recorded.status === "pending") {
    throw new FrameworkError(
      "DATA_PATCH_PENDING",
      `Data patch '${patch.id}' is already claimed and has not completed`,
      { status: 409 }
    );
  }
  throw new FrameworkError(
    "DATA_PATCH_FAILED",
    `Data patch '${patch.id}' previously failed at '${recorded.failedAt}': ${recorded.error}`,
    { status: 409 }
  );
}

function appliedPatchFromRecord(record: RecordedDataPatch & { readonly status: "applied" }): AppliedDataPatch {
  const { status: _status, ...patch } = record;
  return patch;
}

function assertChecksumValueMatches<TResources>(patch: DataPatchDefinition<TResources>, appliedChecksum: string): void {
  const checksum = patchChecksum(patch);
  if (checksum !== appliedChecksum) {
    throw new FrameworkError(
      "DATA_PATCH_CHECKSUM_MISMATCH",
      `Recorded data patch '${patch.id}' has checksum '${appliedChecksum}' but planned '${checksum}'`,
      { status: 409 }
    );
  }
}

function normalizeResult(result: JsonValue | void): JsonValue | undefined {
  return result === undefined ? undefined : result;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
