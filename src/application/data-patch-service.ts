import { DataPatchRunner, type DataPatchRollbackRunResult, type DataPatchRunResult } from "./data-patch-runner.js";
import { assertSelectedDataPatchPredecessorsApplied } from "./data-patch-apply-policy.js";
import {
  assertDataPatchApplyLimit,
  selectDataPatch,
  selectDataPatches,
  snapshotUniqueDataPatchDefinitions
} from "./data-patch-definition-policy.js";
import {
  dataPatchDashboardEntry,
  dataPatchDashboardTotals,
  type DataPatchDashboard,
  type DataPatchDashboardEntry,
  type DataPatchDashboardStatus
} from "./data-patch-dashboard-policy.js";
import {
  assertDataPatchRollbackRetryableWithSuccessors,
  planAutomaticDataPatchRollback,
  planSelectedDataPatchRollback
} from "./data-patch-rollback-policy.js";
import { permissionDenied } from "../core/errors.js";
import type { DataPatchDefinition } from "../core/data-patch.js";
import { SYSTEM_MANAGER_ROLE, type Actor } from "../core/types.js";
import type { Clock } from "../ports/clock.js";
import type { DataPatchLog } from "../ports/data-patch-log.js";
import type { IdGenerator } from "../ports/id-generator.js";

export type { DataPatchDashboard, DataPatchDashboardEntry, DataPatchDashboardStatus };

export interface DataPatchAdminPort {
  dashboard(actor: Actor): Promise<DataPatchDashboard>;
  planApply(actor: Actor, options?: DataPatchApplyOptions): Promise<DataPatchApplyPlan>;
  planRollback(actor: Actor, options?: DataPatchRollbackOptions): Promise<DataPatchRollbackPlan>;
  planRollbackRetry(actor: Actor, patchId: string): Promise<DataPatchRollbackRetryPlan>;
  apply(actor: Actor, options?: DataPatchApplyOptions): Promise<DataPatchRunResult>;
  rollback(actor: Actor, options?: DataPatchRollbackOptions): Promise<DataPatchRollbackRunResult>;
  retryFailed(actor: Actor, patchId: string): Promise<DataPatchRunResult>;
  retryRollbackFailed(actor: Actor, patchId: string): Promise<DataPatchRollbackRunResult>;
}

export interface DataPatchApplyOptions {
  readonly patchIds?: readonly string[];
  readonly limit?: number;
}

export interface DataPatchRollbackOptions {
  readonly patchIds?: readonly string[];
  readonly limit?: number;
}

export interface DataPatchApplyPlan {
  readonly patchIds: readonly string[];
  readonly requestedPatchIds?: readonly string[];
  readonly limit?: number;
}

export interface DataPatchRollbackPlan {
  readonly patchIds: readonly string[];
  readonly requestedPatchIds?: readonly string[];
  readonly limit?: number;
}

export interface DataPatchRollbackRetryPlan {
  readonly patchId: string;
}

export interface DataPatchServiceOptions<TResources = unknown> {
  readonly patches: readonly DataPatchDefinition<TResources>[];
  readonly log: DataPatchLog;
  readonly resources: TResources;
  readonly adminRoles?: readonly string[];
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}

export class DataPatchService<TResources = unknown> {
  private readonly adminRoles: readonly string[];
  private readonly clock: Clock | undefined;
  private readonly ids: IdGenerator | undefined;
  private readonly log: DataPatchLog;
  private readonly patches: readonly DataPatchDefinition<TResources>[];
  private readonly resources: TResources;

  constructor(options: DataPatchServiceOptions<TResources>) {
    this.adminRoles = options.adminRoles ?? [SYSTEM_MANAGER_ROLE];
    this.clock = options.clock;
    this.ids = options.ids;
    this.log = options.log;
    this.patches = snapshotUniqueDataPatchDefinitions(options.patches);
    this.resources = options.resources;
  }

  async dashboard(actor: Actor): Promise<DataPatchDashboard> {
    this.authorize(actor);
    const recordedById = new Map((await this.log.recordedDataPatches()).map((patch) => [patch.id, patch]));
    const patches = this.patches.map((patch) => dataPatchDashboardEntry(patch, recordedById.get(patch.id)));
    return { patches, totals: dataPatchDashboardTotals(patches) };
  }

  async apply(actor: Actor, options: DataPatchApplyOptions = {}): Promise<DataPatchRunResult> {
    this.authorize(actor);
    return this.runner().apply(await this.patchesForApply(options));
  }

  async rollback(actor: Actor, options: DataPatchRollbackOptions = {}): Promise<DataPatchRollbackRunResult> {
    this.authorize(actor);
    return this.runner().rollback(await this.patchesForRollbackPlan(options));
  }

  async retryFailed(actor: Actor, patchId: string): Promise<DataPatchRunResult> {
    this.authorize(actor);
    const patch = selectDataPatch(this.patches, patchId);
    await this.assertPredecessorsApplied([patch]);
    await this.log.retryFailedDataPatch({ id: patch.id, checksum: patch.checksum });
    return this.runner().apply([patch]);
  }

  async retryRollbackFailed(actor: Actor, patchId: string): Promise<DataPatchRollbackRunResult> {
    this.authorize(actor);
    return this.runner().retryRollbackFailed(await this.patchForRollbackRetry(patchId));
  }

  async planApply(actor: Actor, options: DataPatchApplyOptions = {}): Promise<DataPatchApplyPlan> {
    this.authorize(actor);
    const patches = await this.patchesForPlan(options);
    return {
      patchIds: patches.map((patch) => patch.id),
      ...(options.patchIds === undefined ? {} : { requestedPatchIds: [...options.patchIds] }),
      ...(options.limit === undefined ? {} : { limit: options.limit })
    };
  }

  async planRollback(actor: Actor, options: DataPatchRollbackOptions = {}): Promise<DataPatchRollbackPlan> {
    this.authorize(actor);
    const patches = await this.patchesForRollbackPlan(options);
    return {
      patchIds: patches.map((patch) => patch.id),
      ...(options.patchIds === undefined ? {} : { requestedPatchIds: [...options.patchIds] }),
      ...(options.limit === undefined ? {} : { limit: options.limit })
    };
  }

  async planRollbackRetry(actor: Actor, patchId: string): Promise<DataPatchRollbackRetryPlan> {
    this.authorize(actor);
    const patch = await this.patchForRollbackRetry(patchId);
    return { patchId: patch.id };
  }

  private async patchesForApply(options: DataPatchApplyOptions): Promise<readonly DataPatchDefinition<TResources>[]> {
    assertDataPatchApplyLimit(options.limit);
    const runner = this.runner();
    const selected = selectDataPatches(this.patches, options.patchIds);
    if (options.patchIds !== undefined) {
      await this.assertPredecessorsApplied(selected);
    }
    if (options.limit === undefined) {
      return selected;
    }
    const pending = await runner.pendingPatches(selected);
    return pending.slice(0, options.limit);
  }

  private async patchesForPlan(options: DataPatchApplyOptions): Promise<readonly DataPatchDefinition<TResources>[]> {
    assertDataPatchApplyLimit(options.limit);
    const runner = this.runner();
    const selected = selectDataPatches(this.patches, options.patchIds);
    if (options.patchIds !== undefined) {
      await this.assertPredecessorsApplied(selected);
    }
    const pending = await runner.pendingPatches(selected);
    return options.limit === undefined ? pending : pending.slice(0, options.limit);
  }

  private async patchesForRollbackPlan(
    options: DataPatchRollbackOptions
  ): Promise<readonly DataPatchDefinition<TResources>[]> {
    assertDataPatchApplyLimit(options.limit);
    const recordedById = new Map((await this.log.recordedDataPatches()).map((patch) => [patch.id, patch]));
    if (options.patchIds !== undefined) {
      const selected = selectDataPatches(this.patches, options.patchIds);
      return planSelectedDataPatchRollback(this.patches, selected, options.limit, recordedById);
    }
    return planAutomaticDataPatchRollback(this.patches, options.limit, recordedById);
  }

  private async patchForRollbackRetry(patchId: string): Promise<DataPatchDefinition<TResources>> {
    const patch = selectDataPatch(this.patches, patchId);
    const recordedById = new Map((await this.log.recordedDataPatches()).map((recorded) => [recorded.id, recorded]));
    assertDataPatchRollbackRetryableWithSuccessors(this.patches, patch, recordedById);
    return patch;
  }

  private runner(): DataPatchRunner<TResources> {
    return new DataPatchRunner({
      log: this.log,
      patches: this.patches,
      resources: this.resources,
      ...(this.clock === undefined ? {} : { clock: this.clock }),
      ...(this.ids === undefined ? {} : { ids: this.ids })
    });
  }

  authorize(actor: Actor): void {
    if (!this.adminRoles.some((role) => actor.roles.includes(role))) {
      throw permissionDenied(`Actor '${actor.id}' cannot manage data patches`);
    }
  }

  private async assertPredecessorsApplied(selected: readonly DataPatchDefinition<TResources>[]): Promise<void> {
    const recordedById = new Map((await this.log.recordedDataPatches()).map((patch) => [patch.id, patch]));
    assertSelectedDataPatchPredecessorsApplied(this.patches, selected, recordedById);
  }

}
