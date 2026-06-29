import type { DocumentData, DomainEvent, TenantId } from "../core/types.js";

export interface JobScheduleOverrideRecord {
  readonly scheduleId: string;
  readonly enabled?: boolean;
  readonly pausedUntil?: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface JobScheduleOverrideState {
  readonly tenantId: TenantId;
  readonly version: number;
  readonly overrides: ReadonlyMap<string, JobScheduleOverrideRecord>;
}

export interface RuntimeJobScheduleRecord {
  readonly id: string;
  readonly cron: string;
  readonly jobName: string;
  readonly tenantId: TenantId;
  readonly enabled: boolean;
  readonly payload?: DocumentData;
  readonly metadata?: DocumentData;
  readonly idempotencyKey?: string;
  readonly delaySeconds?: number;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface JobScheduleDefinitionState {
  readonly version: number;
  readonly schedules: ReadonlyMap<string, RuntimeJobScheduleRecord>;
}

export type JobScheduleEventPayload =
  | {
      readonly kind: "JobScheduleOverrideSet";
      readonly scheduleId: string;
      readonly enabled: boolean;
    }
  | {
      readonly kind: "JobSchedulePaused";
      readonly scheduleId: string;
      readonly pausedUntil: string;
    }
  | {
      readonly kind: "JobScheduleOverrideCleared";
      readonly scheduleId: string;
    }
  | {
      readonly kind: "JobScheduleSaved";
      readonly scheduleId: string;
      readonly cron: string;
      readonly jobName: string;
      readonly tenantId: TenantId;
      readonly enabled: boolean;
      readonly payload?: DocumentData;
      readonly metadata?: DocumentData;
      readonly idempotencyKey?: string;
      readonly delaySeconds?: number;
    }
  | {
      readonly kind: "JobScheduleDeleted";
      readonly scheduleId: string;
      readonly tenantId: TenantId;
    };

export function jobScheduleDefinitionKey(tenantId: TenantId, scheduleId: string): string {
  return JSON.stringify([tenantId, scheduleId]);
}

export function foldJobScheduleOverrides(
  tenantId: TenantId,
  events: readonly DomainEvent[]
): JobScheduleOverrideState {
  const overrides = new Map<string, JobScheduleOverrideRecord>();
  for (const event of events) {
    if (event.payload.kind === "JobScheduleOverrideSet") {
      const current = overrides.get(event.payload.scheduleId);
      overrides.set(event.payload.scheduleId, {
        ...current,
        scheduleId: event.payload.scheduleId,
        enabled: event.payload.enabled,
        updatedAt: event.occurredAt,
        updatedBy: event.actorId
      });
      continue;
    }
    if (event.payload.kind === "JobSchedulePaused") {
      const current = overrides.get(event.payload.scheduleId);
      overrides.set(event.payload.scheduleId, {
        ...current,
        scheduleId: event.payload.scheduleId,
        pausedUntil: event.payload.pausedUntil,
        updatedAt: event.occurredAt,
        updatedBy: event.actorId
      });
      continue;
    }
    if (event.payload.kind === "JobScheduleOverrideCleared") {
      overrides.delete(event.payload.scheduleId);
    }
  }
  return {
    tenantId,
    version: events.at(-1)?.sequence ?? 0,
    overrides
  };
}

export function foldJobScheduleDefinitions(events: readonly DomainEvent[]): JobScheduleDefinitionState {
  const schedules = new Map<string, RuntimeJobScheduleRecord>();
  for (const event of events) {
    if (event.payload.kind === "JobScheduleSaved") {
      schedules.set(jobScheduleDefinitionKey(event.payload.tenantId, event.payload.scheduleId), {
        id: event.payload.scheduleId,
        cron: event.payload.cron,
        jobName: event.payload.jobName,
        tenantId: event.payload.tenantId,
        enabled: event.payload.enabled,
        ...(event.payload.payload === undefined ? {} : { payload: event.payload.payload }),
        ...(event.payload.metadata === undefined ? {} : { metadata: event.payload.metadata }),
        ...(event.payload.idempotencyKey === undefined ? {} : { idempotencyKey: event.payload.idempotencyKey }),
        ...(event.payload.delaySeconds === undefined ? {} : { delaySeconds: event.payload.delaySeconds }),
        updatedAt: event.occurredAt,
        updatedBy: event.actorId
      });
      continue;
    }
    if (event.payload.kind === "JobScheduleDeleted") {
      schedules.delete(jobScheduleDefinitionKey(event.payload.tenantId, event.payload.scheduleId));
    }
  }
  return {
    version: events.at(-1)?.sequence ?? 0,
    schedules
  };
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly JobScheduleOverrideSet: Extract<
      JobScheduleEventPayload,
      { readonly kind: "JobScheduleOverrideSet" }
    >;
    readonly JobSchedulePaused: Extract<
      JobScheduleEventPayload,
      { readonly kind: "JobSchedulePaused" }
    >;
    readonly JobScheduleOverrideCleared: Extract<
      JobScheduleEventPayload,
      { readonly kind: "JobScheduleOverrideCleared" }
    >;
    readonly JobScheduleSaved: Extract<
      JobScheduleEventPayload,
      { readonly kind: "JobScheduleSaved" }
    >;
    readonly JobScheduleDeleted: Extract<
      JobScheduleEventPayload,
      { readonly kind: "JobScheduleDeleted" }
    >;
  }
}
