import type { DataPatchDefinition } from "../core/data-patch.js";
import {
  assertRecordedDataPatchAllowsApplySkip,
  dataPatchApplyClaimDecision,
  dataPatchRollbackClaimDecision
} from "./data-patch-claim-policy.js";
import {
  normalizeDataPatchDefinitions,
  normalizeSingleDataPatchDefinition,
  snapshotDataPatchDefinitions
} from "./data-patch-definition-policy.js";
import { badRequest, FrameworkError } from "../core/errors.js";
import { cloneJsonValue, isJsonValue } from "../core/json.js";
import type { JsonValue } from "../core/types.js";
import type { Clock } from "../ports/clock.js";
import { systemClock } from "../ports/clock.js";
import type { IdGenerator } from "../ports/id-generator.js";
import { cryptoIdGenerator } from "../ports/id-generator.js";
import type {
  AppliedDataPatch,
  ClaimedRollbackDataPatch,
  DataPatchLog,
  RolledBackDataPatch
} from "../ports/data-patch-log.js";

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
    this.patches = snapshotDataPatchDefinitions(options.patches ?? []);
    this.resources = options.resources;
  }

  async pendingPatches(
    patches: readonly DataPatchDefinition<TResources>[] = this.patches
  ): Promise<readonly DataPatchDefinition<TResources>[]> {
    const planned = normalizeDataPatchDefinitions(patches);
    const recordedById = new Map((await this.log.recordedDataPatches()).map((patch) => [patch.id, patch]));
    const pending: DataPatchDefinition<TResources>[] = [];
    for (const patch of planned) {
      const recorded = recordedById.get(patch.id);
      if (recorded === undefined) {
        pending.push(patch);
        continue;
      }
      assertRecordedDataPatchAllowsApplySkip(patch, recorded);
    }
    return pending;
  }

  async apply(patches: readonly DataPatchDefinition<TResources>[] = this.patches): Promise<DataPatchRunResult> {
    const planned = normalizeDataPatchDefinitions(patches);
    const recordedById = new Map((await this.log.recordedDataPatches()).map((patch) => [patch.id, patch]));
    const applied: DataPatchRunRecord[] = [];
    const skipped: AppliedDataPatch[] = [];

    for (const patch of planned) {
      const existing = recordedById.get(patch.id);
      if (existing !== undefined) {
        skipped.push(assertRecordedDataPatchAllowsApplySkip(patch, existing));
        continue;
      }

      const claim = await this.log.claimDataPatch({
        id: patch.id,
        checksum: patch.checksum,
        claimId: this.ids.next(),
        claimedAt: this.clock.now()
      });
      const decision = dataPatchApplyClaimDecision(patch, claim);
      if (decision.action === "skip") {
        skipped.push(decision.patch);
        recordedById.set(decision.patch.id, { ...decision.patch, status: "applied" });
        continue;
      }

      let result: JsonValue | undefined;
      try {
        result = normalizeResult(await patch.run({ resources: this.resources }), "Data patch result");
      } catch (error) {
        await this.log.failDataPatch({
          id: patch.id,
          checksum: patch.checksum,
          claimId: decision.claim.claimId,
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
        claimId: decision.claim.claimId
      });
      applied.push(record);
      recordedById.set(record.id, { ...record, status: "applied" });
    }

    return { applied, skipped };
  }

  async rollback(
    patches?: readonly DataPatchDefinition<TResources>[]
  ): Promise<DataPatchRollbackRunResult> {
    const planned = normalizeDataPatchDefinitions(patches ?? [...this.patches].reverse());
    const rolledBack: DataPatchRollbackRecord[] = [];
    const skipped: RolledBackDataPatch[] = [];

    for (const patch of planned) {
      if (patch.rollback === undefined) {
        throw new FrameworkError(
          "DATA_PATCH_ROLLBACK_UNAVAILABLE",
          `Data patch '${patch.id}' does not declare a rollback`,
          { status: 409 }
        );
      }
      const claim = await this.log.claimDataPatchRollback({
        id: patch.id,
        checksum: patch.checksum,
        claimId: this.ids.next(),
        claimedAt: this.clock.now()
      });
      const decision = dataPatchRollbackClaimDecision(patch.id, claim);
      if (decision.action === "skip") {
        skipped.push(decision.patch);
        continue;
      }

      rolledBack.push(await this.rollbackClaimedPatch(patch, decision.claim));
    }

    return { rolledBack, skipped };
  }

  async retryRollbackFailed(patch: DataPatchDefinition<TResources>): Promise<DataPatchRollbackRunResult> {
    const planned = normalizeSingleDataPatchDefinition(patch);
    if (planned.rollback === undefined) {
      throw new FrameworkError(
        "DATA_PATCH_ROLLBACK_UNAVAILABLE",
        `Data patch '${planned.id}' does not declare a rollback`,
        { status: 409 }
      );
    }
    const claim = await this.log.retryFailedDataPatchRollback({
      id: planned.id,
      checksum: planned.checksum,
      claimId: this.ids.next(),
      claimedAt: this.clock.now()
    });
    return { rolledBack: [await this.rollbackClaimedPatch(planned, claim)], skipped: [] };
  }

  private async rollbackClaimedPatch(
    patch: DataPatchDefinition<TResources>,
    claim: ClaimedRollbackDataPatch
  ): Promise<DataPatchRollbackRecord> {
    if (patch.rollback === undefined) {
      throw new FrameworkError(
        "DATA_PATCH_ROLLBACK_UNAVAILABLE",
        `Data patch '${patch.id}' does not declare a rollback`,
        { status: 409 }
      );
    }
    let result: JsonValue | undefined;
    try {
      result = normalizeResult(await patch.rollback.run({ resources: this.resources }), "Data patch rollback result");
    } catch (error) {
      await this.log.failDataPatchRollback({
        id: patch.id,
        checksum: patch.checksum,
        claimId: claim.claimId,
        failedAt: this.clock.now(),
        error: errorMessage(error)
      });
      throw error;
    }

    const record = {
      id: patch.id,
      checksum: patch.checksum,
      rolledBackAt: this.clock.now(),
      ...(result === undefined ? {} : { result })
    };
    await this.log.completeDataPatchRollback({
      ...record,
      claimId: claim.claimId
    });
    return record;
  }
}

function normalizeResult(result: JsonValue | void, label: string): JsonValue | undefined {
  if (result === undefined) {
    return undefined;
  }
  if (!isJsonValue(result)) {
    throw badRequest(`${label} must be JSON-serializable`);
  }
  return cloneJsonValue(result);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
