import type {
  DataPatchAdminPort,
  DataPatchApplyOptions,
  DataPatchApplyPlan,
  DataPatchRollbackOptions,
  DataPatchRollbackPlan,
  DataPatchRollbackRetryPlan
} from "./data-patch-service.js";
import type { DataPatchRollbackRunResult, DataPatchRunResult } from "./data-patch-runner.js";
import { badRequest, notFound } from "../core/errors.js";
import type { JobDefinition, JobPayload } from "../core/jobs.js";
import type { Actor, DocumentData } from "../core/types.js";
import type { JobDispatcher } from "./job-dispatcher.js";
import type { JobMessage } from "../ports/job-queue.js";

export const DATA_PATCH_APPLY_JOB_NAME = "cf-frappe.data-patches.apply";
export const DATA_PATCH_ROLLBACK_JOB_NAME = "cf-frappe.data-patches.rollback";
export const DATA_PATCH_ROLLBACK_RETRY_JOB_NAME = "cf-frappe.data-patches.rollback-retry";

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

export type DataPatchRollbackJobPayload = DocumentData & {
  readonly actor: DataPatchJobActor;
  readonly patchIds: readonly string[];
};

export type DataPatchRollbackRetryJobPayload = DocumentData & {
  readonly actor: DataPatchJobActor;
  readonly patchId: string;
};

export interface DataPatchApplyJobResources {
  readonly dataPatches?: DataPatchAdminPort;
}

export interface DataPatchRollbackJobResources {
  readonly dataPatches?: DataPatchAdminPort;
}

export interface DataPatchRollbackRetryJobResources {
  readonly dataPatches?: DataPatchAdminPort;
}

export interface DataPatchApplyJobOptions {
  readonly name?: string;
}

export interface DataPatchRollbackJobOptions {
  readonly name?: string;
}

export interface DataPatchRollbackRetryJobOptions {
  readonly name?: string;
}

interface DataPatchQueueDeliveryOptions {
  readonly delaySeconds?: number;
  readonly idempotencyKey?: string;
  readonly metadata?: DocumentData;
}

export interface DataPatchQueueOptions extends DataPatchApplyOptions, DataPatchQueueDeliveryOptions {}

export interface DataPatchRollbackQueueOptions extends DataPatchRollbackOptions, DataPatchQueueDeliveryOptions {}

export interface DataPatchRollbackRetryQueueOptions extends DataPatchQueueDeliveryOptions {}

export interface DataPatchQueueResult {
  readonly plan: DataPatchApplyPlan;
  readonly message: JobMessage<DataPatchApplyJobPayload>;
}

export interface DataPatchRollbackQueueResult {
  readonly plan: DataPatchRollbackPlan;
  readonly message: JobMessage<DataPatchRollbackJobPayload>;
}

export interface DataPatchRollbackRetryQueueResult {
  readonly plan: DataPatchRollbackRetryPlan;
  readonly message: JobMessage<DataPatchRollbackRetryJobPayload>;
}

export interface DataPatchQueuePort {
  enqueue(actor: Actor, options?: DataPatchQueueOptions): Promise<DataPatchQueueResult>;
}

export interface DataPatchRollbackQueuePort {
  enqueueRollback(actor: Actor, options?: DataPatchRollbackQueueOptions): Promise<DataPatchRollbackQueueResult>;
}

export interface DataPatchRollbackRetryQueuePort {
  enqueueRollbackRetry(
    actor: Actor,
    patchId: string,
    options?: DataPatchRollbackRetryQueueOptions
  ): Promise<DataPatchRollbackRetryQueueResult>;
}

export interface DataPatchQueueServiceOptions<TResources> {
  readonly dataPatches: DataPatchAdminPort;
  readonly dispatcher: JobDispatcher<TResources>;
  readonly applyJobName?: string;
  readonly jobName?: string;
  readonly rollbackJobName?: string;
  readonly rollbackRetryJobName?: string;
}

export class DataPatchQueueService<TResources = unknown>
  implements DataPatchQueuePort, DataPatchRollbackQueuePort, DataPatchRollbackRetryQueuePort {
  private readonly dataPatches: DataPatchAdminPort;
  private readonly dispatcher: JobDispatcher<TResources>;
  private readonly applyJobName: string;
  private readonly rollbackJobName: string;
  private readonly rollbackRetryJobName: string;

  constructor(options: DataPatchQueueServiceOptions<TResources>) {
    this.dataPatches = options.dataPatches;
    this.dispatcher = options.dispatcher;
    this.applyJobName = options.applyJobName ?? options.jobName ?? DATA_PATCH_APPLY_JOB_NAME;
    this.rollbackJobName = options.rollbackJobName ?? DATA_PATCH_ROLLBACK_JOB_NAME;
    this.rollbackRetryJobName = options.rollbackRetryJobName ?? DATA_PATCH_ROLLBACK_RETRY_JOB_NAME;
  }

  async enqueue(actor: Actor, options: DataPatchQueueOptions = {}): Promise<DataPatchQueueResult> {
    const plan = await this.dataPatches.planApply(actor, options);
    if (plan.patchIds.length === 0) {
      throw badRequest("No pending data patches to enqueue");
    }
    const message = await this.dispatcher.dispatch<DataPatchApplyJobPayload>({
      jobName: this.applyJobName,
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

  async enqueueRollback(
    actor: Actor,
    options: DataPatchRollbackQueueOptions = {}
  ): Promise<DataPatchRollbackQueueResult> {
    const plan = await this.dataPatches.planRollback(actor, options);
    if (plan.patchIds.length === 0) {
      throw badRequest("No rollbackable data patches to enqueue");
    }
    const message = await this.dispatcher.dispatch<DataPatchRollbackJobPayload>({
      jobName: this.rollbackJobName,
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

  async enqueueRollbackRetry(
    actor: Actor,
    patchId: string,
    options: DataPatchRollbackRetryQueueOptions = {}
  ): Promise<DataPatchRollbackRetryQueueResult> {
    const plan = await this.dataPatches.planRollbackRetry(actor, patchId);
    const message = await this.dispatcher.dispatch<DataPatchRollbackRetryJobPayload>({
      jobName: this.rollbackRetryJobName,
      payload: {
        actor: queueActor(actor),
        patchId: plan.patchId
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

export function createDataPatchRollbackJob<
  TResources extends DataPatchRollbackJobResources = DataPatchRollbackJobResources
>(options: DataPatchRollbackJobOptions = {}): JobDefinition<JobPayload, TResources> {
  const name = options.name ?? DATA_PATCH_ROLLBACK_JOB_NAME;
  return {
    name,
    description: "Roll back a validated cf-frappe data patch plan",
    async handler({ payload, resources }) {
      const dataPatches = resources.dataPatches;
      if (dataPatches === undefined) {
        throw notFound("Data patch service is not available", "DATA_PATCH_NOT_FOUND");
      }
      const patchIds = parseJobPatchIds(payload.patchIds);
      if (patchIds.length === 0) {
        throw badRequest("Data patch rollback job requires at least one patch id");
      }
      return rollbackResultJson(await dataPatches.rollback(parseJobActor(payload.actor), { patchIds }));
    }
  };
}

export function createDataPatchRollbackRetryJob<
  TResources extends DataPatchRollbackRetryJobResources = DataPatchRollbackRetryJobResources
>(options: DataPatchRollbackRetryJobOptions = {}): JobDefinition<JobPayload, TResources> {
  const name = options.name ?? DATA_PATCH_ROLLBACK_RETRY_JOB_NAME;
  return {
    name,
    description: "Retry a failed cf-frappe data patch rollback",
    async handler({ payload, resources }) {
      const dataPatches = resources.dataPatches;
      if (dataPatches === undefined) {
        throw notFound("Data patch service is not available", "DATA_PATCH_NOT_FOUND");
      }
      const patchId = parseJobPatchId(payload.patchId);
      return rollbackResultJson(await dataPatches.retryRollbackFailed(parseJobActor(payload.actor), patchId));
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

function parseJobPatchId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw badRequest("Data patch rollback retry job patchId is invalid");
  }
  return value;
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

function rollbackResultJson(result: DataPatchRollbackRunResult): DocumentData {
  return {
    rolledBack: result.rolledBack.map((record) => ({
      id: record.id,
      checksum: record.checksum,
      rolledBackAt: record.rolledBackAt,
      ...(record.result === undefined ? {} : { result: record.result })
    })),
    skipped: result.skipped.map((record) => ({
      id: record.id,
      checksum: record.checksum,
      rolledBackAt: record.rolledBackAt,
      ...(record.result === undefined ? {} : { result: record.result })
    }))
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
