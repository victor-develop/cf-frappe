import type {
  DataPatchAdminPort,
  DataPatchApplyOptions,
  DataPatchApplyPlan,
  DataPatchRollbackOptions,
  DataPatchRollbackPlan,
  DataPatchRollbackRetryPlan
} from "./data-patch-service.js";
import {
  dataPatchApplyDispatchCommand,
  dataPatchRollbackResultJson,
  dataPatchRollbackDispatchCommand,
  dataPatchRollbackRetryDispatchCommand,
  dataPatchRunResultJson,
  ensureDataPatchJobServiceAvailable,
  parseDataPatchJobActor,
  parseDataPatchJobPatchIds,
  parseDataPatchRollbackRetryJobPatchId,
  type DataPatchApplyJobPayload,
  type DataPatchJobActor,
  type DataPatchQueueDeliveryOptions,
  type DataPatchRollbackJobPayload,
  type DataPatchRollbackRetryJobPayload
} from "./data-patch-job-policy.js";
import { badRequest } from "../core/errors.js";
import type { JobDefinition, JobPayload } from "../core/jobs.js";
import type { Actor } from "../core/types.js";
import type { JobDispatcher } from "./job-dispatcher.js";
import type { JobMessage } from "../ports/job-queue.js";

export const DATA_PATCH_APPLY_JOB_NAME = "cf-frappe.data-patches.apply";
export const DATA_PATCH_ROLLBACK_JOB_NAME = "cf-frappe.data-patches.rollback";
export const DATA_PATCH_ROLLBACK_RETRY_JOB_NAME = "cf-frappe.data-patches.rollback-retry";

export type {
  DataPatchApplyJobPayload,
  DataPatchJobActor,
  DataPatchRollbackJobPayload,
  DataPatchRollbackRetryJobPayload
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
    const message = await this.dispatcher.dispatch<DataPatchApplyJobPayload>(
      dataPatchApplyDispatchCommand(this.applyJobName, actor, plan.patchIds, options)
    );
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
    const message = await this.dispatcher.dispatch<DataPatchRollbackJobPayload>(
      dataPatchRollbackDispatchCommand(this.rollbackJobName, actor, plan.patchIds, options)
    );
    return { plan, message };
  }

  async enqueueRollbackRetry(
    actor: Actor,
    patchId: string,
    options: DataPatchRollbackRetryQueueOptions = {}
  ): Promise<DataPatchRollbackRetryQueueResult> {
    const plan = await this.dataPatches.planRollbackRetry(actor, patchId);
    const message = await this.dispatcher.dispatch<DataPatchRollbackRetryJobPayload>(
      dataPatchRollbackRetryDispatchCommand(this.rollbackRetryJobName, actor, plan.patchId, options)
    );
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
      ensureDataPatchJobServiceAvailable(dataPatches);
      const patchIds = parseDataPatchJobPatchIds(payload.patchIds);
      if (patchIds.length === 0) {
        throw badRequest("Data patch apply job requires at least one patch id");
      }
      return dataPatchRunResultJson(await dataPatches.apply(parseDataPatchJobActor(payload.actor), { patchIds }));
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
      ensureDataPatchJobServiceAvailable(dataPatches);
      const patchIds = parseDataPatchJobPatchIds(payload.patchIds);
      if (patchIds.length === 0) {
        throw badRequest("Data patch rollback job requires at least one patch id");
      }
      return dataPatchRollbackResultJson(
        await dataPatches.rollback(parseDataPatchJobActor(payload.actor), { patchIds })
      );
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
      ensureDataPatchJobServiceAvailable(dataPatches);
      const patchId = parseDataPatchRollbackRetryJobPatchId(payload.patchId);
      return dataPatchRollbackResultJson(
        await dataPatches.retryRollbackFailed(parseDataPatchJobActor(payload.actor), patchId)
      );
    }
  };
}
