import type { DocumentData, TenantId } from "../core/types.js";

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
