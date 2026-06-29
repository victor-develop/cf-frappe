import { DataPatchRunner, type DataPatchRollbackRunResult, type DataPatchRunResult } from "./data-patch-runner.js";
import { assertSelectedDataPatchPredecessorsApplied } from "./data-patch-apply-policy.js";
import {
  dataPatchDashboardEntry,
  dataPatchDashboardTotals,
  type DataPatchDashboard,
  type DataPatchDashboardEntry,
  type DataPatchDashboardStatus
} from "./data-patch-dashboard-policy.js";
import { assertDataPatchChecksumMatches } from "./data-patch-journal-policy.js";
import {
  assertDataPatchRollbackRetryable,
  assertDataPatchRollbackSuccessorSafe,
  assertSelectedDataPatchRollbackable,
  dataPatchRollbackPlanDecision
} from "./data-patch-rollback-policy.js";
import { FrameworkError, badRequest, notFound, permissionDenied } from "../core/errors.js";
import { assertDataPatchId, defineDataPatch, type DataPatchDefinition } from "../core/data-patch.js";
import { SYSTEM_MANAGER_ROLE, type Actor } from "../core/types.js";
import type { Clock } from "../ports/clock.js";
import type { DataPatchLog, RecordedDataPatch } from "../ports/data-patch-log.js";
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
    this.patches = normalizePatches(options.patches);
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
    const patch = selectPatch(this.patches, patchId);
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
    assertApplyLimit(options.limit);
    const runner = this.runner();
    const selected = selectPatches(this.patches, options.patchIds);
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
    assertApplyLimit(options.limit);
    const runner = this.runner();
    const selected = selectPatches(this.patches, options.patchIds);
    if (options.patchIds !== undefined) {
      await this.assertPredecessorsApplied(selected);
    }
    const pending = await runner.pendingPatches(selected);
    return options.limit === undefined ? pending : pending.slice(0, options.limit);
  }

  private async patchesForRollbackPlan(
    options: DataPatchRollbackOptions
  ): Promise<readonly DataPatchDefinition<TResources>[]> {
    assertApplyLimit(options.limit);
    const recordedById = new Map((await this.log.recordedDataPatches()).map((patch) => [patch.id, patch]));
    if (options.patchIds !== undefined) {
      const selected = selectPatches(this.patches, options.patchIds);
      this.assertSelectedPatchesRollbackable(selected, recordedById);
      const selectedIds = new Set(selected.map((patch) => patch.id));
      this.assertNoUnsafeSuccessorsOutsideSelection(selected, selectedIds, recordedById);
      const rollback = [...selected].reverse();
      return options.limit === undefined ? rollback : rollback.slice(0, options.limit);
    }
    const rollback: DataPatchDefinition<TResources>[] = [];
    for (const patch of [...this.patches].reverse()) {
      const recorded = recordedById.get(patch.id);
      const decision = dataPatchRollbackPlanDecision(patch, recorded);
      if (decision.action === "skip") {
        continue;
      }
      if (decision.action === "stop") {
        break;
      }
      rollback.push(patch);
      if (options.limit !== undefined && rollback.length >= options.limit) {
        break;
      }
    }
    return rollback;
  }

  private async patchForRollbackRetry(patchId: string): Promise<DataPatchDefinition<TResources>> {
    const patch = selectPatch(this.patches, patchId);
    const recordedById = new Map((await this.log.recordedDataPatches()).map((recorded) => [recorded.id, recorded]));
    this.assertSelectedPatchRollbackRetryable(patch, recordedById);
    this.assertNoUnsafeSuccessorsOutsideSelection([patch], new Set([patch.id]), recordedById);
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

  private assertSelectedPatchesRollbackable(
    selected: readonly DataPatchDefinition<TResources>[],
    recordedById: ReadonlyMap<string, RecordedDataPatch>
  ): void {
    for (const patch of selected) {
      const recorded = recordedById.get(patch.id);
      assertSelectedDataPatchRollbackable(patch, recorded);
    }
  }

  private assertSelectedPatchRollbackRetryable(
    patch: DataPatchDefinition<TResources>,
    recordedById: ReadonlyMap<string, RecordedDataPatch>
  ): void {
    const recorded = recordedById.get(patch.id);
    assertDataPatchRollbackRetryable(patch, recorded);
  }

  private assertNoUnsafeSuccessorsOutsideSelection(
    selected: readonly DataPatchDefinition<TResources>[],
    selectedIds: ReadonlySet<string>,
    recordedById: ReadonlyMap<string, RecordedDataPatch>
  ): void {
    const earliestSelectedIndex = Math.min(...selected.map((patch) => this.patches.indexOf(patch)));
    for (const patch of this.patches.slice(earliestSelectedIndex + 1)) {
      if (selectedIds.has(patch.id)) {
        continue;
      }
      const recorded = recordedById.get(patch.id);
      if (recorded === undefined) {
        continue;
      }
      assertChecksumMatches(patch, recorded);
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
}

function normalizePatches<TResources>(
  patches: readonly DataPatchDefinition<TResources>[]
): readonly DataPatchDefinition<TResources>[] {
  const seen = new Set<string>();
  return Object.freeze(patches.map((patch) => {
    const definition = defineDataPatch(patch);
    if (seen.has(definition.id)) {
      throw new FrameworkError("DATA_PATCH_DUPLICATE", `Data patch '${definition.id}' is defined more than once`, {
        status: 409
      });
    }
    seen.add(definition.id);
    return definition;
  }));
}

function selectPatches<TResources>(
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

function selectPatch<TResources>(
  patches: readonly DataPatchDefinition<TResources>[],
  patchId: string
): DataPatchDefinition<TResources> {
  const patch = selectPatches(patches, [patchId])[0];
  if (patch === undefined) {
    throw notFound(`Data patch '${patchId}' is not registered`, "DATA_PATCH_NOT_FOUND");
  }
  return patch;
}

function assertApplyLimit(limit: number | undefined): void {
  if (limit === undefined) {
    return;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest("Data patch apply limit must be a positive integer");
  }
}

function assertChecksumMatches<TResources>(
  patch: DataPatchDefinition<TResources>,
  recorded: RecordedDataPatch
): void {
  assertDataPatchChecksumMatches(patch.id, patch.checksum, recorded.checksum);
}
