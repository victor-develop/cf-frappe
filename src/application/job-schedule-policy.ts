import { DEFAULT_TENANT_ID, type Actor, type TenantId } from "../core/types.js";

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
