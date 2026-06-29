import type { JobPayload } from "../core/jobs.js";
import type { Actor, DocumentData } from "../core/types.js";
import type { DispatchJobCommand } from "../ports/job-queue.js";

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

export interface DataPatchQueueDeliveryOptions {
  readonly delaySeconds?: number;
  readonly idempotencyKey?: string;
  readonly metadata?: DocumentData;
}

export function dataPatchApplyDispatchCommand(
  jobName: string,
  actor: Actor,
  patchIds: readonly string[],
  options: DataPatchQueueDeliveryOptions
): DispatchJobCommand<DataPatchApplyJobPayload> {
  return dataPatchDispatchCommand(jobName, actor, options, {
    actor: dataPatchJobActor(actor),
    patchIds: [...patchIds]
  });
}

export function dataPatchRollbackDispatchCommand(
  jobName: string,
  actor: Actor,
  patchIds: readonly string[],
  options: DataPatchQueueDeliveryOptions
): DispatchJobCommand<DataPatchRollbackJobPayload> {
  return dataPatchDispatchCommand(jobName, actor, options, {
    actor: dataPatchJobActor(actor),
    patchIds: [...patchIds]
  });
}

export function dataPatchRollbackRetryDispatchCommand(
  jobName: string,
  actor: Actor,
  patchId: string,
  options: DataPatchQueueDeliveryOptions
): DispatchJobCommand<DataPatchRollbackRetryJobPayload> {
  return dataPatchDispatchCommand(jobName, actor, options, {
    actor: dataPatchJobActor(actor),
    patchId
  });
}

export function dataPatchJobActor(actor: Actor): DataPatchJobActor {
  return {
    id: actor.id,
    roles: [...actor.roles],
    ...(actor.tenantId === undefined ? {} : { tenantId: actor.tenantId }),
    ...(actor.email === undefined ? {} : { email: actor.email })
  };
}

function dataPatchDispatchCommand<TPayload extends JobPayload>(
  jobName: string,
  actor: Actor,
  options: DataPatchQueueDeliveryOptions,
  payload: TPayload
): DispatchJobCommand<TPayload> {
  return {
    jobName,
    payload,
    ...(actor.tenantId === undefined ? {} : { tenantId: actor.tenantId }),
    ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
    ...(options.delaySeconds === undefined ? {} : { delaySeconds: options.delaySeconds }),
    metadata: {
      ...(options.metadata ?? {}),
      dispatchSource: "data-patches",
      requestedBy: actor.id
    }
  };
}
