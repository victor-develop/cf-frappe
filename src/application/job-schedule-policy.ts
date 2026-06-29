import type { JobRetryPolicy } from "../core/jobs.js";
import { badRequest } from "../core/errors.js";
import { DEFAULT_TENANT_ID, type Actor, type DocumentData, type TenantId } from "../core/types.js";
import {
  MAX_JOB_QUEUE_DELAY_SECONDS,
  MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH
} from "../ports/job-queue.js";
import { normalizeJobDocumentData } from "./job-payload-policy.js";
import {
  runtimeJobSchedules,
  type JobScheduleDefinitionState,
  type JobScheduleOverrideState,
  type RuntimeJobScheduleRecord
} from "./job-schedule-events.js";

export interface JobScheduleVisibilitySummary {
  readonly tenantId?: string;
  readonly dynamic: {
    readonly tenantId: boolean;
  };
}

export interface JobScheduleDispatchSummary extends JobScheduleVisibilitySummary {
  readonly enabled: boolean;
  readonly registered: boolean;
  readonly jobName: string;
  readonly dynamic: JobScheduleVisibilitySummary["dynamic"] & {
    readonly enabled: boolean;
  };
}

export interface JobScheduleSummary {
  readonly id: string;
  readonly cron: string;
  readonly jobName: string;
  readonly source: "configured" | "runtime";
  readonly editable: boolean;
  readonly deleted?: boolean;
  readonly enabled: boolean;
  readonly configuredEnabled: boolean;
  readonly overridden: boolean;
  readonly overrideEnabled?: boolean;
  readonly pausedUntil?: string;
  readonly overrideUpdatedAt?: string;
  readonly overrideUpdatedBy?: string;
  readonly overrideable: boolean;
  readonly registered: boolean;
  readonly dispatchable: boolean;
  readonly description?: string;
  readonly retry?: JobRetryPolicy;
  readonly delaySeconds?: number;
  readonly tenantId?: string;
  readonly dynamic: {
    readonly enabled: boolean;
    readonly tenantId: boolean;
    readonly payload: boolean;
    readonly metadata: boolean;
    readonly idempotencyKey: boolean;
  };
}

export interface JobScheduleSummaryOverride {
  readonly enabled?: boolean;
  readonly pausedUntil?: string;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

export interface JobScheduleRuntimeDefinitionInput {
  readonly id?: string;
  readonly cron: string;
  readonly jobName: string;
  readonly enabled?: boolean;
  readonly payload?: DocumentData;
  readonly metadata?: DocumentData;
  readonly idempotencyKey?: string;
  readonly delaySeconds?: number;
}

export type DynamicJobScheduleValue = (...args: never[]) => unknown;

export interface JobScheduleDefinitionCandidate {
  readonly id?: string;
  readonly cron?: unknown;
  readonly jobName?: unknown;
  readonly enabled?: boolean | DynamicJobScheduleValue;
  readonly tenantId?: unknown;
  readonly payload?: unknown;
  readonly metadata?: unknown;
  readonly idempotencyKey?: unknown;
}

export interface JobScheduleSummaryCandidate extends JobScheduleDefinitionCandidate {
  readonly cron: string;
  readonly jobName: string;
  readonly enabled?: boolean | DynamicJobScheduleValue;
  readonly delaySeconds?: number;
}

export interface JobScheduleSummaryRegistry {
  has(name: string): boolean;
  get(name: string): {
    readonly description?: string;
    readonly retry?: JobRetryPolicy;
  };
}

export interface JobScheduleQueryInput {
  readonly cron?: string;
  readonly jobName?: string;
}

export interface NormalizedJobScheduleQuery {
  readonly cron?: string;
  readonly jobName?: string;
}

export interface JobScheduleRuntimeDefinitionPreserveOptions {
  readonly preserveExistingFields?: boolean;
  readonly payloadProvided: boolean;
  readonly metadataProvided: boolean;
  readonly idempotencyKeyProvided: boolean;
}

export type JobScheduleAccessDecision =
  | { readonly status: "allow"; readonly tenantId: TenantId }
  | { readonly status: "deny"; readonly message: string };

export type JobScheduleDispatchDecision =
  | { readonly status: "dispatch" }
  | { readonly status: "not-found"; readonly message: string }
  | { readonly status: "reject"; readonly message: string };

export type JobScheduleOverrideDecision =
  | { readonly status: "override" }
  | { readonly status: "not-found"; readonly message: string }
  | { readonly status: "reject"; readonly message: string };

export type JobScheduleDefinitionSaveDecision =
  | { readonly status: "save" }
  | { readonly status: "reject"; readonly message: string };

export type JobScheduleDefinitionDeleteDecision =
  | { readonly status: "delete" }
  | { readonly status: "not-found"; readonly message: string }
  | { readonly status: "reject"; readonly message: string };

export type JobScheduleOverrideWriteDecision =
  | { readonly status: "write" }
  | { readonly status: "noop" };

export type JobScheduleCapabilityKind = "dispatch" | "overrides" | "definitions";

export type JobScheduleCapabilityDecision =
  | { readonly status: "enabled" }
  | { readonly status: "not-found"; readonly message: string };

export type JobScheduleLookupDecision =
  | { readonly status: "found" }
  | { readonly status: "not-found"; readonly message: string };

export function planJobScheduleAccess(options: {
  readonly actor: Actor;
  readonly adminRoles: readonly string[];
  readonly explicitTenantId?: TenantId;
}): JobScheduleAccessDecision {
  if (!options.adminRoles.some((role) => options.actor.roles.includes(role))) {
    return {
      status: "deny",
      message: `Actor '${options.actor.id}' cannot inspect job schedules`
    };
  }
  const actorTenantId = options.actor.tenantId ?? DEFAULT_TENANT_ID;
  const tenantId = options.explicitTenantId ?? actorTenantId;
  if (tenantId !== actorTenantId) {
    return {
      status: "deny",
      message: `Actor '${options.actor.id}' cannot inspect job schedules for tenant '${tenantId}'`
    };
  }
  return { status: "allow", tenantId };
}

export function planJobScheduleLookup(options: {
  readonly scheduleId: string;
  readonly configuredFound: boolean;
  readonly runtimeFound: boolean;
}): JobScheduleLookupDecision {
  return options.configuredFound || options.runtimeFound
    ? { status: "found" }
    : { status: "not-found", message: `Job schedule '${options.scheduleId}' was not found` };
}

export function planJobScheduleCapability(options: {
  readonly capability: JobScheduleCapabilityKind;
  readonly enabled: boolean;
}): JobScheduleCapabilityDecision {
  if (options.enabled) {
    return { status: "enabled" };
  }
  if (options.capability === "dispatch") {
    return { status: "not-found", message: "Job schedule dispatch is not enabled" };
  }
  if (options.capability === "overrides") {
    return { status: "not-found", message: "Job schedule overrides are not enabled" };
  }
  return { status: "not-found", message: "Job schedule definitions are not enabled" };
}

export function canInspectJobSchedule(
  schedule: JobScheduleVisibilitySummary,
  tenantId: TenantId
): boolean {
  if (schedule.dynamic.tenantId) {
    return tenantId === DEFAULT_TENANT_ID;
  }
  return schedule.tenantId === tenantId;
}

export function planJobScheduleDispatch(options: {
  readonly scheduleId: string;
  readonly tenantId: TenantId;
  readonly summary: JobScheduleDispatchSummary;
}): JobScheduleDispatchDecision {
  if (!canInspectJobSchedule(options.summary, options.tenantId)) {
    return {
      status: "not-found",
      message: `Job schedule '${options.scheduleId}' was not found`
    };
  }
  if (options.summary.dynamic.tenantId) {
    return { status: "reject", message: "Dynamic tenant job schedules cannot be manually dispatched" };
  }
  if (options.summary.dynamic.enabled) {
    return { status: "reject", message: "Dynamic enabled job schedules cannot be manually dispatched" };
  }
  if (!options.summary.enabled) {
    return { status: "reject", message: "Disabled job schedules cannot be manually dispatched" };
  }
  if (!options.summary.registered) {
    return { status: "reject", message: `Scheduled job '${options.summary.jobName}' is not registered` };
  }
  return { status: "dispatch" };
}

export function planJobScheduleOverride(options: {
  readonly scheduleId: string;
  readonly tenantId: TenantId;
  readonly summary: JobScheduleVisibilitySummary & {
    readonly source: "configured" | "runtime";
    readonly dynamic: JobScheduleVisibilitySummary["dynamic"] & {
      readonly enabled: boolean;
    };
  };
  readonly hasScheduleId: boolean;
}): JobScheduleOverrideDecision {
  if (!canInspectJobSchedule(options.summary, options.tenantId)) {
    return {
      status: "not-found",
      message: `Job schedule '${options.scheduleId}' was not found`
    };
  }
  if (options.summary.source === "runtime") {
    return { status: "reject", message: "Runtime job schedules must be edited directly" };
  }
  if (options.summary.dynamic.tenantId) {
    return { status: "reject", message: "Dynamic tenant job schedules cannot be overridden" };
  }
  if (options.summary.dynamic.enabled) {
    return { status: "reject", message: "Dynamic enabled job schedules cannot be overridden" };
  }
  if (!options.hasScheduleId) {
    return { status: "reject", message: "Job schedule id is required for runtime overrides" };
  }
  return { status: "override" };
}

export function planJobScheduleDefinitionSave(options: {
  readonly scheduleId: string;
  readonly jobName: string;
  readonly configured: boolean;
  readonly registered: boolean;
}): JobScheduleDefinitionSaveDecision {
  if (options.configured) {
    return {
      status: "reject",
      message: `Configured job schedule '${options.scheduleId}' cannot be edited at runtime`
    };
  }
  if (!options.registered) {
    return {
      status: "reject",
      message: `Scheduled job '${options.jobName}' is not registered`
    };
  }
  return { status: "save" };
}

export function planJobScheduleDefinitionDelete(options: {
  readonly scheduleId: string;
  readonly configured: boolean;
  readonly exists: boolean;
}): JobScheduleDefinitionDeleteDecision {
  if (options.configured) {
    return {
      status: "reject",
      message: `Configured job schedule '${options.scheduleId}' cannot be deleted at runtime`
    };
  }
  if (!options.exists) {
    return {
      status: "not-found",
      message: `Job schedule '${options.scheduleId}' was not found`
    };
  }
  return { status: "delete" };
}

export function planJobScheduleOverrideClear(options: {
  readonly hasOverride: boolean;
}): JobScheduleOverrideWriteDecision {
  return options.hasOverride ? { status: "write" } : { status: "noop" };
}

export function planJobScheduleEnabledOverride(options: {
  readonly currentEnabled?: boolean;
  readonly configuredEnabled: boolean;
  readonly targetEnabled: boolean;
}): JobScheduleOverrideWriteDecision {
  return (options.currentEnabled ?? options.configuredEnabled) === options.targetEnabled
    ? { status: "noop" }
    : { status: "write" };
}

export function planJobSchedulePauseOverride(options: {
  readonly currentPausedUntil?: string;
  readonly pausedUntil: string;
  readonly now: string;
}): JobScheduleOverrideWriteDecision {
  return options.currentPausedUntil === options.pausedUntil && Date.parse(options.pausedUntil) > Date.parse(options.now)
    ? { status: "noop" }
    : { status: "write" };
}

export function planJobScheduleSummary(options: {
  readonly id: string;
  readonly cron: string;
  readonly jobName: string;
  readonly source: "configured" | "runtime";
  readonly hasScheduleId: boolean;
  readonly configuredEnabled: boolean;
  readonly canOverride: boolean;
  readonly canDispatch: boolean;
  readonly registered: boolean;
  readonly now: string;
  readonly dynamic: JobScheduleSummary["dynamic"];
  readonly job?: {
    readonly description?: string;
    readonly retry?: JobRetryPolicy;
  };
  readonly override?: JobScheduleSummaryOverride;
  readonly delaySeconds?: number;
  readonly tenantId?: string;
}): JobScheduleSummary {
  const overrideable =
    options.source === "configured" &&
    options.canOverride &&
    options.hasScheduleId &&
    !options.dynamic.tenantId &&
    !options.dynamic.enabled;
  const override = overrideable ? options.override : undefined;
  const pausedUntil = override?.pausedUntil;
  const paused = pausedUntil !== undefined && Date.parse(pausedUntil) > Date.parse(options.now);
  const overrideEnabled = override?.enabled;
  const baseEnabled = overrideEnabled ?? options.configuredEnabled;
  const enabled = baseEnabled && !paused;
  const overridden = overrideEnabled !== undefined || paused;
  return {
    id: options.id,
    cron: options.cron,
    jobName: options.jobName,
    source: options.source,
    editable: options.source === "runtime",
    enabled,
    configuredEnabled: options.configuredEnabled,
    overridden,
    ...(overrideEnabled === undefined ? {} : { overrideEnabled }),
    ...(paused ? { pausedUntil } : {}),
    ...(override === undefined || !overridden
      ? {}
      : {
          overrideUpdatedAt: override.updatedAt,
          overrideUpdatedBy: override.updatedBy
        }),
    overrideable,
    registered: options.registered,
    dispatchable:
      options.registered &&
      enabled &&
      options.canDispatch &&
      !options.dynamic.tenantId &&
      !options.dynamic.enabled,
    ...(options.job?.description === undefined ? {} : { description: options.job.description }),
    ...(options.job?.retry === undefined ? {} : { retry: options.job.retry }),
    ...(options.delaySeconds === undefined ? {} : { delaySeconds: options.delaySeconds }),
    ...(options.tenantId === undefined ? {} : { tenantId: options.tenantId }),
    dynamic: options.dynamic
  };
}

export function jobScheduleSummaryFor(options: {
  readonly schedule: JobScheduleSummaryCandidate;
  readonly index: number;
  readonly overrides: JobScheduleOverrideState;
  readonly registry: JobScheduleSummaryRegistry;
  readonly canOverride: boolean;
  readonly canDispatch: boolean;
  readonly now: string;
  readonly source?: "configured" | "runtime";
}): JobScheduleSummary {
  const source = options.source ?? "configured";
  const registered = options.registry.has(options.schedule.jobName);
  const job = registered ? options.registry.get(options.schedule.jobName) : undefined;
  const tenantId = staticJobScheduleTenantId(options.schedule);
  const id = jobScheduleIdentity(options.schedule, options.index);
  const dynamic = dynamicJobScheduleFields(options.schedule);
  const override = tenantId === options.overrides.tenantId ? options.overrides.overrides.get(id) : undefined;
  return planJobScheduleSummary({
    id,
    cron: options.schedule.cron,
    jobName: options.schedule.jobName,
    source,
    hasScheduleId: options.schedule.id !== undefined,
    configuredEnabled: options.schedule.enabled !== false,
    canOverride: options.canOverride,
    canDispatch: options.canDispatch,
    registered,
    now: options.now,
    dynamic,
    ...(job === undefined ? {} : { job }),
    ...(override === undefined ? {} : { override }),
    ...(options.schedule.delaySeconds === undefined ? {} : { delaySeconds: options.schedule.delaySeconds }),
    ...(tenantId === undefined ? {} : { tenantId })
  });
}

export function jobScheduleSummaries(options: {
  readonly configured: readonly JobScheduleSummaryCandidate[];
  readonly definitions: JobScheduleDefinitionState;
  readonly overrides: JobScheduleOverrideState;
  readonly registry: JobScheduleSummaryRegistry;
  readonly canOverride: boolean;
  readonly canDispatch: boolean;
  readonly now: string;
}): readonly JobScheduleSummary[] {
  const context = {
    overrides: options.overrides,
    registry: options.registry,
    canOverride: options.canOverride,
    canDispatch: options.canDispatch,
    now: options.now
  };
  return [
    ...options.configured.map((schedule, index) => jobScheduleSummaryFor({
      schedule,
      index,
      ...context
    })),
    ...runtimeJobSchedules(options.definitions).map((schedule, index) => jobScheduleSummaryFor({
      schedule,
      index: options.configured.length + index,
      source: "runtime",
      ...context
    }))
  ];
}

export function normalizeJobScheduleRuntimeDefinition(options: {
  readonly command: JobScheduleRuntimeDefinitionInput;
  readonly tenantId: TenantId;
  readonly generatedId: string;
}): RuntimeJobScheduleRecord {
  const id = normalizeJobScheduleId(options.generatedId);
  return {
    id,
    cron: normalizeJobScheduleText(options.command.cron, "cron"),
    jobName: normalizeJobScheduleText(options.command.jobName, "jobName"),
    tenantId: options.tenantId,
    enabled: options.command.enabled ?? true,
    ...(options.command.payload === undefined
      ? {}
      : { payload: normalizeJobDocumentData(options.command.payload, "Job schedule payload") }),
    ...(options.command.metadata === undefined
      ? {}
      : { metadata: normalizeJobDocumentData(options.command.metadata, "Job schedule metadata") }),
    ...(options.command.idempotencyKey === undefined
      ? {}
      : { idempotencyKey: normalizeJobScheduleIdempotencyKey(options.command.idempotencyKey) }),
    ...(options.command.delaySeconds === undefined
      ? {}
      : { delaySeconds: normalizeJobScheduleDelaySeconds(options.command.delaySeconds) }),
    updatedAt: "",
    updatedBy: ""
  };
}

export function mergePreservedJobScheduleRuntimeFields(options: {
  readonly schedule: RuntimeJobScheduleRecord;
  readonly existing?: RuntimeJobScheduleRecord;
  readonly preserve: JobScheduleRuntimeDefinitionPreserveOptions;
}): RuntimeJobScheduleRecord {
  if (!options.preserve.preserveExistingFields || options.existing === undefined) {
    return options.schedule;
  }
  return {
    ...options.schedule,
    ...(!options.preserve.payloadProvided && options.existing.payload !== undefined
      ? { payload: options.existing.payload }
      : {}),
    ...(!options.preserve.metadataProvided && options.existing.metadata !== undefined
      ? { metadata: options.existing.metadata }
      : {}),
    ...(!options.preserve.idempotencyKeyProvided && options.existing.idempotencyKey !== undefined
      ? { idempotencyKey: options.existing.idempotencyKey }
      : {})
  };
}

export function normalizeJobScheduleQuery(query: JobScheduleQueryInput): NormalizedJobScheduleQuery {
  return {
    ...(query.cron === undefined || query.cron === "" ? {} : { cron: query.cron }),
    ...(query.jobName === undefined || query.jobName === "" ? {} : { jobName: query.jobName })
  };
}

export function isDynamicJobScheduleValue(value: unknown): boolean {
  return typeof value === "function";
}

export function staticJobScheduleTenantId(schedule: JobScheduleDefinitionCandidate): TenantId | undefined {
  if (isDynamicJobScheduleValue(schedule.tenantId)) {
    return undefined;
  }
  return typeof schedule.tenantId === "string" ? schedule.tenantId : DEFAULT_TENANT_ID;
}

export function jobScheduleIdentity(schedule: JobScheduleDefinitionCandidate, index: number): string {
  return schedule.id ?? String(index + 1);
}

export function ensureUniqueJobScheduleIds(schedules: readonly JobScheduleDefinitionCandidate[]): void {
  const seen = new Set<string>();
  schedules.forEach((schedule, index) => {
    const id = jobScheduleIdentity(schedule, index);
    if (id.trim() === "") {
      throw badRequest("Job schedule id is required");
    }
    if (seen.has(id)) {
      throw badRequest(`Job schedule id '${id}' is duplicated`);
    }
    seen.add(id);
  });
}

export function configuredJobScheduleIds(
  schedules: readonly JobScheduleDefinitionCandidate[]
): ReadonlySet<string> {
  return new Set(schedules.map((schedule, index) => jobScheduleIdentity(schedule, index)));
}

export function effectiveJobSchedule<TSchedule extends JobScheduleDefinitionCandidate>(
  schedule: TSchedule,
  summary: Pick<JobScheduleSummary, "enabled" | "overridden">
): TSchedule {
  if (!summary.overridden) {
    return schedule;
  }
  return {
    ...schedule,
    enabled: summary.enabled
  };
}

export function dynamicJobScheduleFields(schedule: JobScheduleDefinitionCandidate): JobScheduleSummary["dynamic"] {
  return {
    enabled: isDynamicJobScheduleValue(schedule.enabled),
    tenantId: isDynamicJobScheduleValue(schedule.tenantId),
    payload: isDynamicJobScheduleValue(schedule.payload),
    metadata: isDynamicJobScheduleValue(schedule.metadata),
    idempotencyKey: isDynamicJobScheduleValue(schedule.idempotencyKey)
  };
}

export function normalizeJobSchedulePauseUntil(value: string, now: string): string {
  const normalized = normalizeJobScheduleText(value, "pauseUntil");
  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    throw badRequest("Job schedule pauseUntil must be a valid timestamp");
  }
  if (timestamp <= Date.parse(now)) {
    throw badRequest("Job schedule pauseUntil must be in the future");
  }
  return new Date(timestamp).toISOString();
}

export function normalizeJobScheduleId(value: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw badRequest("Job schedule id is required");
  }
  return normalized;
}

export function normalizeJobScheduleText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw badRequest(`Job schedule ${field} is required`);
  }
  return normalized;
}

export function normalizeJobScheduleIdempotencyKey(value: string): string {
  const normalized = normalizeJobScheduleText(value, "idempotencyKey");
  if (normalized.length > MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH) {
    throw badRequest(`Job schedule idempotencyKey must be at most ${MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH} characters`);
  }
  return normalized;
}

export function normalizeJobScheduleDelaySeconds(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > MAX_JOB_QUEUE_DELAY_SECONDS) {
    throw badRequest(`delaySeconds must be an integer between 0 and ${MAX_JOB_QUEUE_DELAY_SECONDS}`);
  }
  return value;
}
