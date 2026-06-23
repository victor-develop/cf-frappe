import { DataPatchRunner, type DataPatchRollbackRunResult, type DataPatchRunResult } from "./data-patch-runner.js";
import { FrameworkError, badRequest, notFound, permissionDenied } from "../core/errors.js";
import { assertDataPatchId, defineDataPatch, type DataPatchDefinition } from "../core/data-patch.js";
import { SYSTEM_MANAGER_ROLE, type Actor, type JsonValue } from "../core/types.js";
import type { Clock } from "../ports/clock.js";
import type { DataPatchLog, RecordedDataPatch } from "../ports/data-patch-log.js";
import type { IdGenerator } from "../ports/id-generator.js";

export type DataPatchDashboardStatus =
  | "not_applied"
  | "pending"
  | "applied"
  | "failed"
  | "rollback_pending"
  | "rolled_back"
  | "rollback_failed";

export interface DataPatchDashboardEntry {
  readonly id: string;
  readonly label?: string;
  readonly checksum: string;
  readonly status: DataPatchDashboardStatus;
  readonly rollbackable?: boolean;
  readonly rollbackLabel?: string;
  readonly claimedAt?: string;
  readonly appliedAt?: string;
  readonly failedAt?: string;
  readonly error?: string;
  readonly result?: JsonValue;
  readonly rollbackClaimedAt?: string;
  readonly rolledBackAt?: string;
  readonly rollbackFailedAt?: string;
  readonly rollbackError?: string;
  readonly rollbackResult?: JsonValue;
}

export interface DataPatchDashboard {
  readonly patches: readonly DataPatchDashboardEntry[];
  readonly totals: {
    readonly total: number;
    readonly notApplied: number;
    readonly pending: number;
    readonly applied: number;
    readonly failed: number;
    readonly rollbackPending: number;
    readonly rolledBack: number;
    readonly rollbackFailed: number;
  };
}

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
    const patches = this.patches.map((patch) => dashboardEntry(patch, recordedById.get(patch.id)));
    return { patches, totals: dashboardTotals(patches) };
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
    const patch = selectPatches(this.patches, [patchId])[0]!;
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
      if (recorded === undefined) {
        continue;
      }
      assertChecksumMatches(patch, recorded);
      if (recorded.status === "pending") {
        throw new FrameworkError("DATA_PATCH_PENDING", `Data patch '${patch.id}' is pending`, { status: 409 });
      }
      if (recorded.status === "failed") {
        throw new FrameworkError("DATA_PATCH_FAILED", `Data patch '${patch.id}' failed and must be retried first`, {
          status: 409
        });
      }
      if (recorded.status === "rollback_pending") {
        throw new FrameworkError(
          "DATA_PATCH_ROLLBACK_PENDING",
          `Data patch '${patch.id}' rollback is pending`,
          { status: 409 }
        );
      }
      if (recorded.status === "rollback_failed") {
        throw new FrameworkError(
          "DATA_PATCH_ROLLBACK_FAILED",
          `Data patch '${patch.id}' rollback failed and must be investigated first`,
          { status: 409 }
        );
      }
      if (recorded.status === "rolled_back") {
        continue;
      }
      if (patch.rollback === undefined) {
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
    const patch = selectPatches(this.patches, [patchId])[0]!;
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
    const selectedIds = new Set(selected.map((patch) => patch.id));
    const recordedById = new Map((await this.log.recordedDataPatches()).map((patch) => [patch.id, patch]));
    let blocker: DataPatchDefinition<TResources> | undefined;
    for (const patch of this.patches) {
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
      assertChecksumMatches(patch, recorded);
      if (recorded.status !== "applied") {
        blocker ??= patch;
      }
    }
  }

  private assertSelectedPatchesRollbackable(
    selected: readonly DataPatchDefinition<TResources>[],
    recordedById: ReadonlyMap<string, RecordedDataPatch>
  ): void {
    for (const patch of selected) {
      const recorded = recordedById.get(patch.id);
      if (recorded === undefined) {
        throw new FrameworkError(
          "DATA_PATCH_ROLLBACK_UNAVAILABLE",
          `Data patch '${patch.id}' cannot be rolled back because it has not been applied`,
          { status: 409 }
        );
      }
      assertChecksumMatches(patch, recorded);
      if (recorded.status === "pending") {
        throw new FrameworkError("DATA_PATCH_PENDING", `Data patch '${patch.id}' is pending`, { status: 409 });
      }
      if (recorded.status === "failed") {
        throw new FrameworkError("DATA_PATCH_FAILED", `Data patch '${patch.id}' failed and must be retried first`, {
          status: 409
        });
      }
      if (recorded.status === "rollback_pending") {
        throw new FrameworkError(
          "DATA_PATCH_ROLLBACK_PENDING",
          `Data patch '${patch.id}' rollback is pending`,
          { status: 409 }
        );
      }
      if (recorded.status === "rollback_failed") {
        throw new FrameworkError(
          "DATA_PATCH_ROLLBACK_FAILED",
          `Data patch '${patch.id}' rollback failed and must be investigated first`,
          { status: 409 }
        );
      }
      if (recorded.status === "rolled_back") {
        throw new FrameworkError(
          "DATA_PATCH_ROLLBACK_UNAVAILABLE",
          `Data patch '${patch.id}' has already been rolled back`,
          { status: 409 }
        );
      }
      if (patch.rollback === undefined) {
        throw new FrameworkError(
          "DATA_PATCH_ROLLBACK_UNAVAILABLE",
          `Data patch '${patch.id}' does not declare a rollback`,
          { status: 409 }
        );
      }
    }
  }

  private assertSelectedPatchRollbackRetryable(
    patch: DataPatchDefinition<TResources>,
    recordedById: ReadonlyMap<string, RecordedDataPatch>
  ): void {
    const recorded = recordedById.get(patch.id);
    if (recorded === undefined) {
      throw new FrameworkError(
        "DATA_PATCH_ROLLBACK_RETRY_UNAVAILABLE",
        `Data patch '${patch.id}' rollback cannot be retried because no failed rollback journal entry exists`,
        { status: 409 }
      );
    }
    assertChecksumMatches(patch, recorded);
    if (recorded.status === "rollback_failed") {
      if (patch.rollback !== undefined) {
        return;
      }
      throw new FrameworkError(
        "DATA_PATCH_ROLLBACK_UNAVAILABLE",
        `Data patch '${patch.id}' does not declare a rollback`,
        { status: 409 }
      );
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
      throw new FrameworkError(
        "DATA_PATCH_ROLLBACK_PENDING",
        `Data patch '${patch.id}' rollback is pending`,
        { status: 409 }
      );
    }
    throw new FrameworkError(
      "DATA_PATCH_ROLLBACK_RETRY_UNAVAILABLE",
      `Data patch '${patch.id}' rollback cannot be retried because journal status is '${recorded.status}'`,
      { status: 409 }
    );
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
      if (recorded.status === "pending") {
        throw new FrameworkError("DATA_PATCH_PENDING", `Data patch '${patch.id}' is pending`, { status: 409 });
      }
      if (recorded.status === "failed") {
        throw new FrameworkError("DATA_PATCH_FAILED", `Data patch '${patch.id}' failed and must be retried first`, {
          status: 409
        });
      }
      if (recorded.status === "rollback_pending") {
        throw new FrameworkError(
          "DATA_PATCH_ROLLBACK_PENDING",
          `Data patch '${patch.id}' rollback is pending`,
          { status: 409 }
        );
      }
      if (recorded.status === "rollback_failed") {
        throw new FrameworkError(
          "DATA_PATCH_ROLLBACK_FAILED",
          `Data patch '${patch.id}' rollback failed and must be investigated first`,
          { status: 409 }
        );
      }
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

function assertApplyLimit(limit: number | undefined): void {
  if (limit === undefined) {
    return;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest("Data patch apply limit must be a positive integer");
  }
}

function dashboardEntry<TResources>(
  patch: DataPatchDefinition<TResources>,
  recorded: RecordedDataPatch | undefined
): DataPatchDashboardEntry {
  if (recorded === undefined) {
    return {
      id: patch.id,
      ...(patch.label === undefined ? {} : { label: patch.label }),
      checksum: patch.checksum,
      status: "not_applied"
    };
  }
  assertChecksumMatches(patch, recorded);
  return {
    id: patch.id,
    ...(patch.label === undefined ? {} : { label: patch.label }),
    checksum: patch.checksum,
    status: recorded.status,
    ...(recorded.status === "applied" && patch.rollback !== undefined ? { rollbackable: true } : {}),
    ...(recorded.status === "applied" && patch.rollback?.label !== undefined ? { rollbackLabel: patch.rollback.label } : {}),
    ...(recorded.status === "pending" ? { claimedAt: recorded.claimedAt } : {}),
    ...(recorded.status === "applied" ? { appliedAt: recorded.appliedAt } : {}),
    ...(recorded.status === "applied" && recorded.result !== undefined ? { result: recorded.result } : {}),
    ...(recorded.status === "failed" ? { failedAt: recorded.failedAt, error: recorded.error } : {}),
    ...(recorded.status === "rollback_pending"
      ? {
          appliedAt: recorded.appliedAt,
          ...(recorded.result === undefined ? {} : { result: recorded.result }),
          rollbackClaimedAt: recorded.rollbackClaimedAt
        }
      : {}),
    ...(recorded.status === "rolled_back"
      ? {
          appliedAt: recorded.appliedAt,
          ...(recorded.result === undefined ? {} : { result: recorded.result }),
          rolledBackAt: recorded.rolledBackAt,
          ...(recorded.rollbackResult === undefined ? {} : { rollbackResult: recorded.rollbackResult })
        }
      : {}),
    ...(recorded.status === "rollback_failed"
      ? {
          appliedAt: recorded.appliedAt,
          ...(recorded.result === undefined ? {} : { result: recorded.result }),
          rollbackFailedAt: recorded.rollbackFailedAt,
          rollbackError: recorded.rollbackError
        }
      : {})
  };
}

function assertChecksumMatches<TResources>(
  patch: DataPatchDefinition<TResources>,
  recorded: RecordedDataPatch
): void {
  if (patch.checksum === recorded.checksum) {
    return;
  }
  throw new FrameworkError(
    "DATA_PATCH_CHECKSUM_MISMATCH",
    `Recorded data patch '${patch.id}' has checksum '${recorded.checksum}' but planned '${patch.checksum}'`,
    { status: 409 }
  );
}

function dashboardTotals(patches: readonly DataPatchDashboardEntry[]): DataPatchDashboard["totals"] {
  return {
    total: patches.length,
    notApplied: patches.filter((patch) => patch.status === "not_applied").length,
    pending: patches.filter((patch) => patch.status === "pending").length,
    applied: patches.filter((patch) => patch.status === "applied").length,
    failed: patches.filter((patch) => patch.status === "failed").length,
    rollbackPending: patches.filter((patch) => patch.status === "rollback_pending").length,
    rolledBack: patches.filter((patch) => patch.status === "rolled_back").length,
    rollbackFailed: patches.filter((patch) => patch.status === "rollback_failed").length
  };
}
