import type {
  DataPatchAdminPort,
  DataPatchApplyOptions,
  DataPatchApplyPlan
} from "./data-patch-service.js";
import type { DataPatchRunResult } from "./data-patch-runner.js";
import { badRequest, notFound } from "../core/errors.js";
import type { JobDefinition, JobPayload } from "../core/jobs.js";
import type { Actor, DocumentData } from "../core/types.js";
import type { JobDispatcher } from "./job-dispatcher.js";
import type { JobMessage } from "../ports/job-queue.js";

export const DATA_PATCH_APPLY_JOB_NAME = "cf-frappe.data-patches.apply";

export type DataPatchJobActor = DocumentData & {
  readonly id: string;
  readonly roles: readonly string[];
  readonly tenantId?: string;
  readonly email?: string;
};

export type DataPatchApplyJobPayload = DocumentData & {
  readonly actor: DataPatchJobActor;
  readonly patchIds: readonly string[];
};

export interface DataPatchApplyJobResources {
  readonly dataPatches?: DataPatchAdminPort;
}

export interface DataPatchApplyJobOptions {
  readonly name?: string;
}

export interface DataPatchQueueOptions extends DataPatchApplyOptions {
  readonly delaySeconds?: number;
  readonly idempotencyKey?: string;
  readonly metadata?: DocumentData;
}

export interface DataPatchQueueResult {
  readonly plan: DataPatchApplyPlan;
  readonly message: JobMessage<DataPatchApplyJobPayload>;
}

export interface DataPatchQueuePort {
  enqueue(actor: Actor, options?: DataPatchQueueOptions): Promise<DataPatchQueueResult>;
}

export interface DataPatchQueueServiceOptions<TResources> {
  readonly dataPatches: DataPatchAdminPort;
  readonly dispatcher: JobDispatcher<TResources>;
  readonly jobName?: string;
}

export class DataPatchQueueService<TResources = unknown> implements DataPatchQueuePort {
  private readonly dataPatches: DataPatchAdminPort;
  private readonly dispatcher: JobDispatcher<TResources>;
  private readonly jobName: string;

  constructor(options: DataPatchQueueServiceOptions<TResources>) {
    this.dataPatches = options.dataPatches;
    this.dispatcher = options.dispatcher;
    this.jobName = options.jobName ?? DATA_PATCH_APPLY_JOB_NAME;
  }

  async enqueue(actor: Actor, options: DataPatchQueueOptions = {}): Promise<DataPatchQueueResult> {
    const plan = await this.dataPatches.planApply(actor, options);
    if (plan.patchIds.length === 0) {
      throw badRequest("No pending data patches to enqueue");
    }
    const message = await this.dispatcher.dispatch<DataPatchApplyJobPayload>({
      jobName: this.jobName,
      payload: {
        actor: queueActor(actor),
        patchIds: plan.patchIds
      },
      ...(actor.tenantId === undefined ? {} : { tenantId: actor.tenantId }),
      ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
      ...(options.delaySeconds === undefined ? {} : { delaySeconds: options.delaySeconds }),
      metadata: {
        ...(options.metadata ?? {}),
        dispatchSource: "data-patches",
        requestedBy: actor.id
      }
    });
    return { plan, message };
  }
}

export function createDataPatchApplyJob<TResources extends DataPatchApplyJobResources = DataPatchApplyJobResources>(
  options: DataPatchApplyJobOptions = {}
): JobDefinition<JobPayload, TResources> {
  const name = options.name ?? DATA_PATCH_APPLY_JOB_NAME;
  return {
    name,
    description: "Apply a validated cf-frappe data patch plan",
    async handler({ payload, resources }) {
      const dataPatches = resources.dataPatches;
      if (dataPatches === undefined) {
        throw notFound("Data patch service is not available", "DATA_PATCH_NOT_FOUND");
      }
      const patchIds = parseJobPatchIds(payload.patchIds);
      if (patchIds.length === 0) {
        throw badRequest("Data patch apply job requires at least one patch id");
      }
      return runResultJson(await dataPatches.apply(parseJobActor(payload.actor), { patchIds }));
    }
  };
}

function queueActor(actor: Actor): DataPatchJobActor {
  return {
    id: actor.id,
    roles: [...actor.roles],
    ...(actor.tenantId === undefined ? {} : { tenantId: actor.tenantId }),
    ...(actor.email === undefined ? {} : { email: actor.email })
  };
}

function parseJobActor(value: unknown): Actor {
  if (!isRecord(value) || typeof value.id !== "string" || !Array.isArray(value.roles)) {
    throw badRequest("Data patch apply job actor is invalid");
  }
  if (!value.roles.every((role) => typeof role === "string")) {
    throw badRequest("Data patch apply job actor roles are invalid");
  }
  if (value.tenantId !== undefined && typeof value.tenantId !== "string") {
    throw badRequest("Data patch apply job actor tenantId is invalid");
  }
  if (value.email !== undefined && typeof value.email !== "string") {
    throw badRequest("Data patch apply job actor email is invalid");
  }
  return {
    id: value.id,
    roles: [...value.roles],
    ...(value.tenantId === undefined ? {} : { tenantId: value.tenantId }),
    ...(value.email === undefined ? {} : { email: value.email })
  };
}

function parseJobPatchIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((id) => typeof id === "string" && id.length > 0)) {
    throw badRequest("Data patch apply job patchIds are invalid");
  }
  return [...value];
}

function runResultJson(result: DataPatchRunResult): DocumentData {
  return {
    applied: result.applied.map((record) => ({
      id: record.id,
      checksum: record.checksum,
      appliedAt: record.appliedAt,
      ...(record.result === undefined ? {} : { result: record.result })
    })),
    skipped: result.skipped.map((record) => ({
      id: record.id,
      checksum: record.checksum,
      appliedAt: record.appliedAt,
      ...(record.result === undefined ? {} : { result: record.result })
    }))
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
