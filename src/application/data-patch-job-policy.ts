import type { JobPayload } from "../core/jobs.js";
import { badRequest } from "../core/errors.js";
import type { Actor, DocumentData } from "../core/types.js";
import type { DispatchJobCommand } from "../ports/job-queue.js";
import type { DataPatchRollbackRunResult, DataPatchRunResult } from "./data-patch-runner.js";

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

export function parseDataPatchJobActor(value: unknown): Actor {
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

export function parseDataPatchJobPatchIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.every((id) => typeof id === "string" && id.length > 0)) {
    throw badRequest("Data patch apply job patchIds are invalid");
  }
  return [...value];
}

export function parseDataPatchRollbackRetryJobPatchId(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw badRequest("Data patch rollback retry job patchId is invalid");
  }
  return value;
}

export function dataPatchRunResultJson(result: DataPatchRunResult): DocumentData {
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

export function dataPatchRollbackResultJson(result: DataPatchRollbackRunResult): DocumentData {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
