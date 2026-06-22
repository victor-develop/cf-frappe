import { DataPatchRunner, type DataPatchRunResult } from "./data-patch-runner.js";
import { FrameworkError, permissionDenied } from "../core/errors.js";
import { defineDataPatch, type DataPatchDefinition } from "../core/data-patch.js";
import { SYSTEM_MANAGER_ROLE, type Actor, type JsonValue } from "../core/types.js";
import type { Clock } from "../ports/clock.js";
import type { DataPatchLog, RecordedDataPatch } from "../ports/data-patch-log.js";
import type { IdGenerator } from "../ports/id-generator.js";

export type DataPatchDashboardStatus = "not_applied" | "pending" | "applied" | "failed";

export interface DataPatchDashboardEntry {
  readonly id: string;
  readonly label?: string;
  readonly checksum: string;
  readonly status: DataPatchDashboardStatus;
  readonly claimedAt?: string;
  readonly appliedAt?: string;
  readonly failedAt?: string;
  readonly error?: string;
  readonly result?: JsonValue;
}

export interface DataPatchDashboard {
  readonly patches: readonly DataPatchDashboardEntry[];
  readonly totals: {
    readonly total: number;
    readonly notApplied: number;
    readonly pending: number;
    readonly applied: number;
    readonly failed: number;
  };
}

export interface DataPatchAdminPort {
  dashboard(actor: Actor): Promise<DataPatchDashboard>;
  apply(actor: Actor): Promise<DataPatchRunResult>;
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

  async apply(actor: Actor): Promise<DataPatchRunResult> {
    this.authorize(actor);
    return new DataPatchRunner({
      log: this.log,
      patches: this.patches,
      resources: this.resources,
      ...(this.clock === undefined ? {} : { clock: this.clock }),
      ...(this.ids === undefined ? {} : { ids: this.ids })
    }).apply();
  }

  authorize(actor: Actor): void {
    if (!this.adminRoles.some((role) => actor.roles.includes(role))) {
      throw permissionDenied(`Actor '${actor.id}' cannot manage data patches`);
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
    ...(recorded.status === "pending" ? { claimedAt: recorded.claimedAt } : {}),
    ...(recorded.status === "applied" ? { appliedAt: recorded.appliedAt } : {}),
    ...(recorded.status === "applied" && recorded.result !== undefined ? { result: recorded.result } : {}),
    ...(recorded.status === "failed" ? { failedAt: recorded.failedAt, error: recorded.error } : {})
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
    failed: patches.filter((patch) => patch.status === "failed").length
  };
}
