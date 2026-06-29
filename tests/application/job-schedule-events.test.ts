import {
  foldJobScheduleDefinitions,
  foldJobScheduleOverrides,
  jobScheduleDefinitionKey,
  type DomainEvent,
  type JobScheduleEventPayload
} from "../../src";

describe("job schedule events", () => {
  it("folds override set, pause, and clear events into tenant override state", () => {
    const overrideEvents = [
      scheduleEvent(1, "JobScheduleOverrideSet", {
        kind: "JobScheduleOverrideSet",
        scheduleId: "daily",
        enabled: false
      }),
      scheduleEvent(2, "JobSchedulePaused", {
        kind: "JobSchedulePaused",
        scheduleId: "daily",
        pausedUntil: "2026-01-02T00:00:00.000Z"
      })
    ];
    const state = foldJobScheduleOverrides("acme", overrideEvents);

    expect(state).toMatchObject({
      tenantId: "acme",
      version: 2
    });
    expect(state.overrides.get("daily")).toEqual({
      scheduleId: "daily",
      enabled: false,
      pausedUntil: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-01T00:02:00.000Z",
      updatedBy: "admin@example.com"
    });

    const cleared = foldJobScheduleOverrides("acme", [
      ...overrideEvents,
      scheduleEvent(3, "JobScheduleOverrideCleared", {
        kind: "JobScheduleOverrideCleared",
        scheduleId: "daily"
      })
    ]);

    expect(cleared.version).toBe(3);
    expect(cleared.overrides.has("daily")).toBe(false);
  });

  it("folds runtime schedule saves and deletes into tenant-keyed definition state", () => {
    const state = foldJobScheduleDefinitions([
      scheduleEvent(1, "JobScheduleSaved", {
        kind: "JobScheduleSaved",
        scheduleId: "runtime-daily",
        cron: "0 0 * * *",
        jobName: "reports.daily",
        tenantId: "acme",
        enabled: true,
        payload: { scope: "first" }
      }),
      scheduleEvent(2, "JobScheduleSaved", {
        kind: "JobScheduleSaved",
        scheduleId: "runtime-daily",
        cron: "0 1 * * *",
        jobName: "reports.daily",
        tenantId: "acme",
        enabled: false,
        payload: { scope: "second" },
        metadata: { owner: "ops" },
        idempotencyKey: "daily-acme",
        delaySeconds: 30
      }),
      scheduleEvent(3, "JobScheduleSaved", {
        kind: "JobScheduleSaved",
        scheduleId: "runtime-daily",
        cron: "0 2 * * *",
        jobName: "reports.daily",
        tenantId: "beta",
        enabled: true
      }),
      scheduleEvent(4, "JobScheduleDeleted", {
        kind: "JobScheduleDeleted",
        scheduleId: "runtime-daily",
        tenantId: "beta"
      })
    ]);

    expect(state.version).toBe(4);
    expect(state.schedules.get(jobScheduleDefinitionKey("acme", "runtime-daily"))).toEqual({
      id: "runtime-daily",
      cron: "0 1 * * *",
      jobName: "reports.daily",
      tenantId: "acme",
      enabled: false,
      payload: { scope: "second" },
      metadata: { owner: "ops" },
      idempotencyKey: "daily-acme",
      delaySeconds: 30,
      updatedAt: "2026-01-01T00:02:00.000Z",
      updatedBy: "admin@example.com"
    });
    expect(state.schedules.has(jobScheduleDefinitionKey("beta", "runtime-daily"))).toBe(false);
  });
});

function scheduleEvent(
  sequence: number,
  type: string,
  payload: JobScheduleEventPayload
): DomainEvent<JobScheduleEventPayload> {
  return {
    id: `evt_${sequence}`,
    tenantId: "acme",
    stream: "job-schedules",
    sequence,
    type,
    doctype: "__JobSchedules",
    documentName: "definitions",
    actorId: "admin@example.com",
    occurredAt: `2026-01-01T00:0${sequence}:00.000Z`,
    payload,
    metadata: {}
  };
}
