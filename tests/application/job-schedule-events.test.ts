import {
  createJobScheduleDeletedEvent,
  createJobScheduleOverrideClearedEvent,
  createJobScheduleOverrideSetEvent,
  createJobSchedulePausedEvent,
  createJobScheduleSavedEvent,
  foldJobScheduleDefinitions,
  foldJobScheduleOverrides,
  isJobScheduleEventPayloadKind,
  jobScheduleDeletedPayload,
  jobScheduleDefinitionKey,
  jobScheduleDefinitionsStream,
  jobScheduleOverrideClearedPayload,
  jobScheduleOverrideSetPayload,
  jobScheduleOverridesStream,
  jobSchedulePausedPayload,
  jobScheduleSavedPayload,
  requireSavedRuntimeJobSchedule,
  runtimeJobScheduleForTenant,
  runtimeJobScheduleIndex,
  runtimeJobSchedules,
  type DomainEvent,
  type JobScheduleEventPayload
} from "../../src";

describe("job schedule events", () => {
  it("builds runtime schedule definition payloads", () => {
    expect(jobSchedulePayload(jobScheduleSavedPayload({
      scheduleId: "runtime-daily",
      cron: "0 0 * * *",
      jobName: "reports.daily",
      tenantId: "acme",
      enabled: true,
      payload: { scope: "daily" },
      metadata: { owner: "ops" },
      idempotencyKey: "daily-acme",
      delaySeconds: 30
    }))).toEqual({
      kind: "JobScheduleSaved",
      scheduleId: "runtime-daily",
      cron: "0 0 * * *",
      jobName: "reports.daily",
      tenantId: "acme",
      enabled: true,
      payload: { scope: "daily" },
      metadata: { owner: "ops" },
      idempotencyKey: "daily-acme",
      delaySeconds: 30
    });

    expect(jobSchedulePayload(jobScheduleDeletedPayload({
      scheduleId: "runtime-daily",
      tenantId: "acme"
    }))).toEqual({
      kind: "JobScheduleDeleted",
      scheduleId: "runtime-daily",
      tenantId: "acme"
    });
  });

  it("builds runtime schedule override payloads", () => {
    expect(jobSchedulePayload(jobScheduleOverrideSetPayload({
      scheduleId: "daily",
      enabled: false
    }))).toEqual({
      kind: "JobScheduleOverrideSet",
      scheduleId: "daily",
      enabled: false
    });

    expect(jobSchedulePayload(jobSchedulePausedPayload({
      scheduleId: "daily",
      pausedUntil: "2026-01-02T00:00:00.000Z"
    }))).toEqual({
      kind: "JobSchedulePaused",
      scheduleId: "daily",
      pausedUntil: "2026-01-02T00:00:00.000Z"
    });

    expect(jobSchedulePayload(jobScheduleOverrideClearedPayload({ scheduleId: "daily" }))).toEqual({
      kind: "JobScheduleOverrideCleared",
      scheduleId: "daily"
    });
  });

  it("creates runtime schedule definition events with the definitions stream envelope", () => {
    expect(createJobScheduleSavedEvent({
      ...eventEnvelope(),
      schedule: {
        id: "runtime-daily",
        cron: "0 0 * * *",
        jobName: "reports.daily",
        enabled: true,
        payload: { scope: "daily" },
        metadata: { owner: "ops" },
        idempotencyKey: "daily-acme",
        delaySeconds: 30
      }
    })).toEqual({
      ...expectedEnvelope("evt_1", jobScheduleDefinitionsStream(), "JobScheduleSaved", "definitions"),
      payload: {
        kind: "JobScheduleSaved",
        scheduleId: "runtime-daily",
        cron: "0 0 * * *",
        jobName: "reports.daily",
        tenantId: "acme",
        enabled: true,
        payload: { scope: "daily" },
        metadata: { owner: "ops" },
        idempotencyKey: "daily-acme",
        delaySeconds: 30
      }
    });

    expect(createJobScheduleDeletedEvent({
      ...eventEnvelope({ id: "evt_2" }),
      scheduleId: "runtime-daily"
    })).toEqual({
      ...expectedEnvelope("evt_2", jobScheduleDefinitionsStream(), "JobScheduleDeleted", "definitions"),
      payload: {
        kind: "JobScheduleDeleted",
        scheduleId: "runtime-daily",
        tenantId: "acme"
      }
    });
  });

  it("creates override events with tenant-scoped override stream envelopes", () => {
    expect(createJobScheduleOverrideSetEvent({
      ...eventEnvelope(),
      scheduleId: "daily",
      enabled: false
    })).toEqual({
      ...expectedEnvelope("evt_1", jobScheduleOverridesStream("acme"), "JobScheduleOverrideSet", "overrides"),
      payload: {
        kind: "JobScheduleOverrideSet",
        scheduleId: "daily",
        enabled: false
      }
    });

    expect(createJobSchedulePausedEvent({
      ...eventEnvelope({ id: "evt_2" }),
      scheduleId: "daily",
      pausedUntil: "2026-01-02T00:00:00.000Z"
    })).toEqual({
      ...expectedEnvelope("evt_2", jobScheduleOverridesStream("acme"), "JobSchedulePaused", "overrides"),
      payload: {
        kind: "JobSchedulePaused",
        scheduleId: "daily",
        pausedUntil: "2026-01-02T00:00:00.000Z"
      }
    });

    expect(createJobScheduleOverrideClearedEvent({
      ...eventEnvelope({ id: "evt_3" }),
      scheduleId: "daily"
    })).toEqual({
      ...expectedEnvelope("evt_3", jobScheduleOverridesStream("acme"), "JobScheduleOverrideCleared", "overrides"),
      payload: {
        kind: "JobScheduleOverrideCleared",
        scheduleId: "daily"
      }
    });
  });

  it("matches runtime schedule event payload kinds independently from event type names", () => {
    const event = scheduleEvent(1, "CustomScheduleSaved", {
      kind: "JobScheduleSaved",
      scheduleId: "runtime-daily",
      cron: "0 0 * * *",
      jobName: "reports.daily",
      tenantId: "acme",
      enabled: true
    });

    expect(isJobScheduleEventPayloadKind(event, "JobScheduleSaved")).toBe(true);
    expect(isJobScheduleEventPayloadKind(event, "JobScheduleDeleted")).toBe(false);
    expect(foldJobScheduleDefinitions([event]).schedules.get(jobScheduleDefinitionKey("acme", "runtime-daily"))).toMatchObject({
      id: "runtime-daily",
      jobName: "reports.daily"
    });
  });

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

  it("selects runtime schedules deterministically and by tenant key", () => {
    const state = foldJobScheduleDefinitions([
      scheduleEvent(1, "JobScheduleSaved", {
        kind: "JobScheduleSaved",
        scheduleId: "z-last",
        cron: "0 2 * * *",
        jobName: "reports.daily",
        tenantId: "beta",
        enabled: true
      }),
      scheduleEvent(2, "JobScheduleSaved", {
        kind: "JobScheduleSaved",
        scheduleId: "a-first",
        cron: "0 0 * * *",
        jobName: "reports.daily",
        tenantId: "acme",
        enabled: true
      }),
      scheduleEvent(3, "JobScheduleSaved", {
        kind: "JobScheduleSaved",
        scheduleId: "m-middle",
        cron: "0 1 * * *",
        jobName: "reports.daily",
        tenantId: "acme",
        enabled: true
      })
    ]);

    expect(runtimeJobSchedules(state).map((schedule) => `${schedule.tenantId}:${schedule.id}`)).toEqual([
      "acme:a-first",
      "acme:m-middle",
      "beta:z-last"
    ]);
    expect(runtimeJobScheduleForTenant(state, "acme", "m-middle")).toMatchObject({
      id: "m-middle",
      tenantId: "acme"
    });
    expect(runtimeJobScheduleIndex(state, "acme", "m-middle")).toBe(1);
    expect(runtimeJobScheduleIndex(state, "missing", "nope")).toBe(0);
  });

  it("requires saved runtime schedules after replay", () => {
    const state = foldJobScheduleDefinitions([
      scheduleEvent(1, "JobScheduleSaved", {
        kind: "JobScheduleSaved",
        scheduleId: "runtime-daily",
        cron: "0 0 * * *",
        jobName: "reports.daily",
        tenantId: "acme",
        enabled: true
      })
    ]);

    expect(requireSavedRuntimeJobSchedule(state, "acme", "runtime-daily")).toMatchObject({
      id: "runtime-daily"
    });
    expect(() => requireSavedRuntimeJobSchedule(state, "acme", "missing")).toThrow(
      "Saved job schedule 'missing' for tenant 'acme' was not found after replay"
    );
  });
});

function jobSchedulePayload(payload: JobScheduleEventPayload): JobScheduleEventPayload {
  return payload;
}

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

function eventEnvelope(overrides: { readonly id?: string } = {}) {
  return {
    id: overrides.id ?? "evt_1",
    tenantId: "acme",
    actorId: "admin@example.com",
    occurredAt: "2026-01-01T00:00:00.000Z",
    metadata: { source: "test" }
  };
}

function expectedEnvelope(
  id: string,
  stream: string,
  type: string,
  documentName: string
) {
  return {
    id,
    tenantId: "acme",
    stream,
    type,
    doctype: "__JobSchedules",
    documentName,
    actorId: "admin@example.com",
    occurredAt: "2026-01-01T00:00:00.000Z",
    metadata: { source: "test" }
  };
}
