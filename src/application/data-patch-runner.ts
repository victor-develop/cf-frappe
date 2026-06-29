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
import { FrameworkError } from "../core/errors.js";
import type { JsonValue } from "../core/types.js";
import {
  dataPatchRollbackCompleteCommand,
  dataPatchRollbackFailureCommand,
  dataPatchRollbackRecord,
  dataPatchRunCompleteCommand,
  dataPatchRunFailureCommand,
  dataPatchRunRecord,
  normalizeDataPatchRunResult,
  type DataPatchRollbackRecord,
  type DataPatchRollbackRunResult,
  type DataPatchRunRecord,
  type DataPatchRunResult
} from "./data-patch-run-policy.js";
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

export type { DataPatchRollbackRecord, DataPatchRollbackRunResult, DataPatchRunRecord, DataPatchRunResult };

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
        result = normalizeDataPatchRunResult(await patch.run({ resources: this.resources }), "Data patch result");
      } catch (error) {
        await this.log.failDataPatch(
          dataPatchRunFailureCommand(patch.id, patch.checksum, decision.claim.claimId, this.clock.now(), error)
        );
        throw error;
      }

      const record = dataPatchRunRecord(patch.id, patch.checksum, this.clock.now(), result);
      await this.log.completeDataPatch(dataPatchRunCompleteCommand(record, decision.claim.claimId));
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
      result = normalizeDataPatchRunResult(
        await patch.rollback.run({ resources: this.resources }),
        "Data patch rollback result"
      );
    } catch (error) {
      await this.log.failDataPatchRollback(
        dataPatchRollbackFailureCommand(patch.id, patch.checksum, claim.claimId, this.clock.now(), error)
      );
      throw error;
    }

    const record = dataPatchRollbackRecord(patch.id, patch.checksum, this.clock.now(), result);
    await this.log.completeDataPatchRollback(dataPatchRollbackCompleteCommand(record, claim.claimId));
    return record;
  }
}
