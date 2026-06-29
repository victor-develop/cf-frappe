import { jobScheduleDefinitionsStream, jobScheduleOverridesStream } from "../core/streams.js";
import type { DocumentData, DomainEvent, NewDomainEvent, TenantId } from "../core/types.js";

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

interface JobScheduleEventEnvelopeOptions {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly actorId: string;
  readonly occurredAt: string;
  readonly metadata: DocumentData;
}

interface JobScheduleSavedEventSchedule {
  readonly id: string;
  readonly cron: string;
  readonly jobName: string;
  readonly enabled: boolean;
  readonly payload?: DocumentData;
  readonly metadata?: DocumentData;
  readonly idempotencyKey?: string;
  readonly delaySeconds?: number;
}

export function createJobScheduleSavedEvent(
  options: JobScheduleEventEnvelopeOptions & {
    readonly schedule: JobScheduleSavedEventSchedule;
  }
): NewDomainEvent<JobScheduleEventPayload> {
  return {
    ...jobScheduleEventEnvelope(options, jobScheduleDefinitionsStream(), "JobScheduleSaved", "definitions"),
    payload: {
      kind: "JobScheduleSaved",
      scheduleId: options.schedule.id,
      cron: options.schedule.cron,
      jobName: options.schedule.jobName,
      tenantId: options.tenantId,
      enabled: options.schedule.enabled,
      ...(options.schedule.payload === undefined ? {} : { payload: options.schedule.payload }),
      ...(options.schedule.metadata === undefined ? {} : { metadata: options.schedule.metadata }),
      ...(options.schedule.idempotencyKey === undefined ? {} : { idempotencyKey: options.schedule.idempotencyKey }),
      ...(options.schedule.delaySeconds === undefined ? {} : { delaySeconds: options.schedule.delaySeconds })
    }
  };
}

export function createJobScheduleDeletedEvent(
  options: JobScheduleEventEnvelopeOptions & {
    readonly scheduleId: string;
  }
): NewDomainEvent<JobScheduleEventPayload> {
  return {
    ...jobScheduleEventEnvelope(options, jobScheduleDefinitionsStream(), "JobScheduleDeleted", "definitions"),
    payload: {
      kind: "JobScheduleDeleted",
      scheduleId: options.scheduleId,
      tenantId: options.tenantId
    }
  };
}

export function createJobScheduleOverrideSetEvent(
  options: JobScheduleEventEnvelopeOptions & {
    readonly scheduleId: string;
    readonly enabled: boolean;
  }
): NewDomainEvent<JobScheduleEventPayload> {
  return {
    ...jobScheduleEventEnvelope(options, jobScheduleOverridesStream(options.tenantId), "JobScheduleOverrideSet", "overrides"),
    payload: {
      kind: "JobScheduleOverrideSet",
      scheduleId: options.scheduleId,
      enabled: options.enabled
    }
  };
}

export function createJobSchedulePausedEvent(
  options: JobScheduleEventEnvelopeOptions & {
    readonly scheduleId: string;
    readonly pausedUntil: string;
  }
): NewDomainEvent<JobScheduleEventPayload> {
  return {
    ...jobScheduleEventEnvelope(options, jobScheduleOverridesStream(options.tenantId), "JobSchedulePaused", "overrides"),
    payload: {
      kind: "JobSchedulePaused",
      scheduleId: options.scheduleId,
      pausedUntil: options.pausedUntil
    }
  };
}

export function createJobScheduleOverrideClearedEvent(
  options: JobScheduleEventEnvelopeOptions & {
    readonly scheduleId: string;
  }
): NewDomainEvent<JobScheduleEventPayload> {
  return {
    ...jobScheduleEventEnvelope(options, jobScheduleOverridesStream(options.tenantId), "JobScheduleOverrideCleared", "overrides"),
    payload: {
      kind: "JobScheduleOverrideCleared",
      scheduleId: options.scheduleId
    }
  };
}

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

export function runtimeJobSchedules(state: JobScheduleDefinitionState): readonly RuntimeJobScheduleRecord[] {
  return [...state.schedules.values()].sort(
    (left, right) => left.tenantId.localeCompare(right.tenantId) || left.id.localeCompare(right.id)
  );
}

export function runtimeJobScheduleForTenant(
  state: JobScheduleDefinitionState,
  tenantId: TenantId,
  scheduleId: string
): RuntimeJobScheduleRecord | undefined {
  return state.schedules.get(jobScheduleDefinitionKey(tenantId, scheduleId));
}

export function requireSavedRuntimeJobSchedule(
  state: JobScheduleDefinitionState,
  tenantId: TenantId,
  scheduleId: string
): RuntimeJobScheduleRecord {
  const schedule = runtimeJobScheduleForTenant(state, tenantId, scheduleId);
  if (schedule === undefined) {
    throw new Error(`Saved job schedule '${scheduleId}' for tenant '${tenantId}' was not found after replay`);
  }
  return schedule;
}

export function runtimeJobScheduleIndex(
  state: JobScheduleDefinitionState,
  tenantId: TenantId,
  scheduleId: string
): number {
  const index = runtimeJobSchedules(state).findIndex(
    (schedule) => schedule.tenantId === tenantId && schedule.id === scheduleId
  );
  return index < 0 ? 0 : index;
}

function jobScheduleEventEnvelope(
  options: JobScheduleEventEnvelopeOptions,
  stream: string,
  type: string,
  documentName: string
): Omit<NewDomainEvent<JobScheduleEventPayload>, "payload"> {
  return {
    id: options.id,
    tenantId: options.tenantId,
    stream,
    type,
    doctype: "__JobSchedules",
    documentName,
    actorId: options.actorId,
    occurredAt: options.occurredAt,
    metadata: options.metadata
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
