import { domainEventPayloadKind } from "../core/domain-events.js";
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

export type JobSchedulePayloadKind = JobScheduleEventPayload["kind"];
export type JobScheduleOverridePayloadKind = Extract<
  JobSchedulePayloadKind,
  "JobScheduleOverrideSet" | "JobSchedulePaused" | "JobScheduleOverrideCleared"
>;
export type JobScheduleDefinitionPayloadKind = Extract<
  JobSchedulePayloadKind,
  "JobScheduleSaved" | "JobScheduleDeleted"
>;

export const JOB_SCHEDULE_OVERRIDE_PAYLOAD_KINDS = Object.freeze([
  "JobScheduleOverrideSet",
  "JobSchedulePaused",
  "JobScheduleOverrideCleared"
] as const satisfies readonly JobScheduleOverridePayloadKind[]);

export const JOB_SCHEDULE_DEFINITION_PAYLOAD_KINDS = Object.freeze([
  "JobScheduleSaved",
  "JobScheduleDeleted"
] as const satisfies readonly JobScheduleDefinitionPayloadKind[]);

export const JOB_SCHEDULE_PAYLOAD_KINDS = Object.freeze([
  ...JOB_SCHEDULE_OVERRIDE_PAYLOAD_KINDS,
  ...JOB_SCHEDULE_DEFINITION_PAYLOAD_KINDS
] as const satisfies readonly JobSchedulePayloadKind[]);

const JOB_SCHEDULE_PAYLOAD_KIND_SET = new Set<string>(JOB_SCHEDULE_PAYLOAD_KINDS);

export interface JobScheduleSavedPayloadInput {
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

export interface JobScheduleDeletedPayloadInput {
  readonly scheduleId: string;
  readonly tenantId: TenantId;
}

export interface JobScheduleOverrideSetPayloadInput {
  readonly scheduleId: string;
  readonly enabled: boolean;
}

export interface JobSchedulePausedPayloadInput {
  readonly scheduleId: string;
  readonly pausedUntil: string;
}

export interface JobScheduleOverrideClearedPayloadInput {
  readonly scheduleId: string;
}

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

export function jobScheduleSavedPayload(
  input: JobScheduleSavedPayloadInput
): Extract<JobScheduleEventPayload, { readonly kind: "JobScheduleSaved" }> {
  return {
    kind: "JobScheduleSaved",
    scheduleId: input.scheduleId,
    cron: input.cron,
    jobName: input.jobName,
    tenantId: input.tenantId,
    enabled: input.enabled,
    ...(input.payload === undefined ? {} : { payload: input.payload }),
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
    ...(input.delaySeconds === undefined ? {} : { delaySeconds: input.delaySeconds })
  };
}

export function jobScheduleDeletedPayload(
  input: JobScheduleDeletedPayloadInput
): Extract<JobScheduleEventPayload, { readonly kind: "JobScheduleDeleted" }> {
  return {
    kind: "JobScheduleDeleted",
    scheduleId: input.scheduleId,
    tenantId: input.tenantId
  };
}

export function jobScheduleOverrideSetPayload(
  input: JobScheduleOverrideSetPayloadInput
): Extract<JobScheduleEventPayload, { readonly kind: "JobScheduleOverrideSet" }> {
  return {
    kind: "JobScheduleOverrideSet",
    scheduleId: input.scheduleId,
    enabled: input.enabled
  };
}

export function jobSchedulePausedPayload(
  input: JobSchedulePausedPayloadInput
): Extract<JobScheduleEventPayload, { readonly kind: "JobSchedulePaused" }> {
  return {
    kind: "JobSchedulePaused",
    scheduleId: input.scheduleId,
    pausedUntil: input.pausedUntil
  };
}

export function jobScheduleOverrideClearedPayload(
  input: JobScheduleOverrideClearedPayloadInput
): Extract<JobScheduleEventPayload, { readonly kind: "JobScheduleOverrideCleared" }> {
  return {
    kind: "JobScheduleOverrideCleared",
    scheduleId: input.scheduleId
  };
}

export function createJobScheduleSavedEvent(
  options: JobScheduleEventEnvelopeOptions & {
    readonly schedule: JobScheduleSavedEventSchedule;
  }
): NewDomainEvent<JobScheduleEventPayload> {
  return {
    ...jobScheduleEventEnvelope(options, jobScheduleDefinitionsStream(), "JobScheduleSaved", "definitions"),
    payload: jobScheduleSavedPayload({
      scheduleId: options.schedule.id,
      cron: options.schedule.cron,
      jobName: options.schedule.jobName,
      tenantId: options.tenantId,
      enabled: options.schedule.enabled,
      ...(options.schedule.payload === undefined ? {} : { payload: options.schedule.payload }),
      ...(options.schedule.metadata === undefined ? {} : { metadata: options.schedule.metadata }),
      ...(options.schedule.idempotencyKey === undefined ? {} : { idempotencyKey: options.schedule.idempotencyKey }),
      ...(options.schedule.delaySeconds === undefined ? {} : { delaySeconds: options.schedule.delaySeconds })
    })
  };
}

export function createJobScheduleDeletedEvent(
  options: JobScheduleEventEnvelopeOptions & {
    readonly scheduleId: string;
  }
): NewDomainEvent<JobScheduleEventPayload> {
  return {
    ...jobScheduleEventEnvelope(options, jobScheduleDefinitionsStream(), "JobScheduleDeleted", "definitions"),
    payload: jobScheduleDeletedPayload({
      scheduleId: options.scheduleId,
      tenantId: options.tenantId
    })
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
    payload: jobScheduleOverrideSetPayload({
      scheduleId: options.scheduleId,
      enabled: options.enabled
    })
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
    payload: jobSchedulePausedPayload({
      scheduleId: options.scheduleId,
      pausedUntil: options.pausedUntil
    })
  };
}

export function createJobScheduleOverrideClearedEvent(
  options: JobScheduleEventEnvelopeOptions & {
    readonly scheduleId: string;
  }
): NewDomainEvent<JobScheduleEventPayload> {
  return {
    ...jobScheduleEventEnvelope(options, jobScheduleOverridesStream(options.tenantId), "JobScheduleOverrideCleared", "overrides"),
    payload: jobScheduleOverrideClearedPayload({
      scheduleId: options.scheduleId
    })
  };
}

export function jobScheduleDefinitionKey(tenantId: TenantId, scheduleId: string): string {
  return JSON.stringify([tenantId, scheduleId]);
}

export function isJobSchedulePayloadKind(kind: string): kind is JobSchedulePayloadKind {
  return JOB_SCHEDULE_PAYLOAD_KIND_SET.has(kind);
}

export function isJobScheduleEvent(event: DomainEvent): event is DomainEvent<JobScheduleEventPayload> {
  return isJobSchedulePayloadKind(domainEventPayloadKind(event));
}

export function isJobScheduleEventPayloadKind<TKind extends JobSchedulePayloadKind>(
  event: DomainEvent,
  kind: TKind
): event is DomainEvent<Extract<JobScheduleEventPayload, { readonly kind: TKind }>> {
  return domainEventPayloadKind(event) === kind;
}

export function foldJobScheduleOverrides(
  tenantId: TenantId,
  events: readonly DomainEvent[]
): JobScheduleOverrideState {
  const overrides = new Map<string, JobScheduleOverrideRecord>();
  for (const event of events) {
    if (isJobScheduleEventPayloadKind(event, "JobScheduleOverrideSet")) {
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
    if (isJobScheduleEventPayloadKind(event, "JobSchedulePaused")) {
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
    if (isJobScheduleEventPayloadKind(event, "JobScheduleOverrideCleared")) {
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
    if (isJobScheduleEventPayloadKind(event, "JobScheduleSaved")) {
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
    if (isJobScheduleEventPayloadKind(event, "JobScheduleDeleted")) {
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
