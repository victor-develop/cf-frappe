import {
  canInspectJobSchedule,
  configuredJobScheduleIds,
  dynamicJobScheduleFields,
  effectiveJobSchedule,
  ensureJobScheduleCapabilityResourceAvailable,
  ensureJobScheduleRuntimeCronTriggerConfigured,
  ensureUniqueJobScheduleIds,
  isDynamicJobScheduleValue,
  jobScheduleIdentity,
  jobScheduleSummaries,
  jobScheduleSummaryFor,
  mergePreservedJobScheduleRuntimeFields,
  normalizeJobSchedulePauseUntil,
  normalizeJobScheduleQuery,
  normalizeJobScheduleRuntimeDefinition,
  planJobScheduleAccess,
  planJobScheduleCapability,
  planJobScheduleDefinitionDelete,
  planJobScheduleDefinitionSave,
  planJobScheduleDispatch,
  planJobScheduleEnabledOverride,
  planJobScheduleLookup,
  planJobScheduleOverride,
  planJobScheduleOverrideClear,
  planJobSchedulePauseOverride,
  planJobScheduleSummary,
  staticJobScheduleTenantId,
  SYSTEM_MANAGER_ROLE
} from "../../src";

describe("job schedule policy", () => {
  it("plans tenant-scoped schedule access for configured admin roles", () => {
    expect(planJobScheduleAccess({
      actor: { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
      adminRoles: [SYSTEM_MANAGER_ROLE]
    })).toEqual({ status: "allow", tenantId: "acme" });

    expect(planJobScheduleAccess({
      actor: { id: "operator@example.com", roles: ["Job Operator"] },
      adminRoles: ["Job Operator"]
    })).toEqual({ status: "allow", tenantId: "default" });

    expect(planJobScheduleAccess({
      actor: { id: "reader@example.com", roles: ["User"], tenantId: "acme" },
      adminRoles: [SYSTEM_MANAGER_ROLE]
    })).toEqual({
      status: "deny",
      message: "Actor 'reader@example.com' cannot inspect job schedules"
    });
  });

  it("denies cross-tenant schedule access before reading tenant state", () => {
    expect(planJobScheduleAccess({
      actor: { id: "admin@example.com", roles: [SYSTEM_MANAGER_ROLE], tenantId: "acme" },
      adminRoles: [SYSTEM_MANAGER_ROLE],
      explicitTenantId: "other"
    })).toEqual({
      status: "deny",
      message: "Actor 'admin@example.com' cannot inspect job schedules for tenant 'other'"
    });
  });

  it("plans schedule capability availability with service error messages", () => {
    expect(planJobScheduleCapability({ capability: "dispatch", enabled: true })).toEqual({ status: "enabled" });
    expect(planJobScheduleCapability({ capability: "dispatch", enabled: false })).toEqual({
      status: "not-found",
      message: "Job schedule dispatch is not enabled"
    });
    expect(planJobScheduleCapability({ capability: "overrides", enabled: false })).toEqual({
      status: "not-found",
      message: "Job schedule overrides are not enabled"
    });
    expect(planJobScheduleCapability({ capability: "definitions", enabled: false })).toEqual({
      status: "not-found",
      message: "Job schedule definitions are not enabled"
    });
  });

  it("guards schedule capability resources before service orchestration", () => {
    expect(() =>
      ensureJobScheduleCapabilityResourceAvailable({ run: async () => ({ id: "msg" }) }, "dispatch")
    ).not.toThrow();

    for (const [capability, message] of [
      ["dispatch", "Job schedule dispatch is not enabled"],
      ["overrides", "Job schedule overrides are not enabled"],
      ["definitions", "Job schedule definitions are not enabled"]
    ] as const) {
      let error: unknown;
      try {
        ensureJobScheduleCapabilityResourceAvailable(undefined, capability);
      } catch (caught) {
        error = caught;
      }
      expect(error).toMatchObject({
        code: "JOB_SCHEDULE_NOT_FOUND",
        message,
        status: 404
      });
    }
  });

  it("guards runtime schedule cron triggers against Worker configuration", () => {
    expect(() => ensureJobScheduleRuntimeCronTriggerConfigured("0 0 * * *", undefined)).not.toThrow();
    expect(() =>
      ensureJobScheduleRuntimeCronTriggerConfigured("0 0 * * *", new Set(["0 0 * * *"]))
    ).not.toThrow();

    let error: unknown;
    try {
      ensureJobScheduleRuntimeCronTriggerConfigured("0 1 * * *", new Set(["0 0 * * *"]));
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: "BAD_REQUEST",
      message: "Job schedule cron '0 1 * * *' is not configured as a Worker Cron Trigger",
      status: 400
    });
  });

  it("plans configured and runtime schedule lookup misses before service error mapping", () => {
    expect(planJobScheduleLookup({
      scheduleId: "static-daily",
      configuredFound: true,
      runtimeFound: false
    })).toEqual({ status: "found" });
    expect(planJobScheduleLookup({
      scheduleId: "runtime-daily",
      configuredFound: false,
      runtimeFound: true
    })).toEqual({ status: "found" });
    expect(planJobScheduleLookup({
      scheduleId: "missing-daily",
      configuredFound: false,
      runtimeFound: false
    })).toEqual({
      status: "not-found",
      message: "Job schedule 'missing-daily' was not found"
    });
  });

  it("keeps static schedules visible only to their tenant and dynamic tenants visible to default admins", () => {
    const staticSchedule = scheduleSummary({ tenantId: "acme" });
    const dynamicTenant = withoutTenantId(
      scheduleSummary({ dynamic: { tenantId: true, enabled: false } })
    );

    expect(canInspectJobSchedule(staticSchedule, "acme")).toBe(true);
    expect(canInspectJobSchedule(staticSchedule, "other")).toBe(false);
    expect(canInspectJobSchedule(dynamicTenant, "default")).toBe(true);
    expect(canInspectJobSchedule(dynamicTenant, "acme")).toBe(false);
  });

  it("plans manual dispatch rejection reasons in service order", () => {
    expect(planJobScheduleDispatch({
      scheduleId: "daily",
      tenantId: "other",
      summary: scheduleSummary({ tenantId: "acme" })
    })).toEqual({
      status: "not-found",
      message: "Job schedule 'daily' was not found"
    });

    expect(planJobScheduleDispatch({
      scheduleId: "daily",
      tenantId: "default",
      summary: withoutTenantId(scheduleSummary({ dynamic: { tenantId: true, enabled: false } }))
    })).toEqual({
      status: "reject",
      message: "Dynamic tenant job schedules cannot be manually dispatched"
    });

    expect(planJobScheduleDispatch({
      scheduleId: "daily",
      tenantId: "acme",
      summary: scheduleSummary({ dynamic: { tenantId: false, enabled: true } })
    })).toEqual({
      status: "reject",
      message: "Dynamic enabled job schedules cannot be manually dispatched"
    });
  });

  it("plans disabled, unregistered, and dispatchable schedules", () => {
    expect(planJobScheduleDispatch({
      scheduleId: "daily",
      tenantId: "acme",
      summary: scheduleSummary({ enabled: false })
    })).toEqual({
      status: "reject",
      message: "Disabled job schedules cannot be manually dispatched"
    });

    expect(planJobScheduleDispatch({
      scheduleId: "daily",
      tenantId: "acme",
      summary: scheduleSummary({ registered: false, jobName: "missing.job" })
    })).toEqual({
      status: "reject",
      message: "Scheduled job 'missing.job' is not registered"
    });

    expect(planJobScheduleDispatch({
      scheduleId: "daily",
      tenantId: "acme",
      summary: scheduleSummary()
    })).toEqual({ status: "dispatch" });
  });

  it("plans override visibility before runtime and dynamic rejection", () => {
    expect(planJobScheduleOverride({
      scheduleId: "daily",
      tenantId: "other",
      summary: scheduleSummary({ tenantId: "acme" }),
      hasScheduleId: true
    })).toEqual({
      status: "not-found",
      message: "Job schedule 'daily' was not found"
    });

    expect(planJobScheduleOverride({
      scheduleId: "runtime-daily",
      tenantId: "acme",
      summary: scheduleSummary({ source: "runtime" }),
      hasScheduleId: true
    })).toEqual({
      status: "reject",
      message: "Runtime job schedules must be edited directly"
    });
  });

  it("rejects dynamic tenant and dynamic enabled schedule overrides", () => {
    expect(planJobScheduleOverride({
      scheduleId: "daily",
      tenantId: "default",
      summary: withoutTenantId(scheduleSummary({
        dynamic: { tenantId: true, enabled: false }
      })),
      hasScheduleId: true
    })).toEqual({
      status: "reject",
      message: "Dynamic tenant job schedules cannot be overridden"
    });

    expect(planJobScheduleOverride({
      scheduleId: "daily",
      tenantId: "acme",
      summary: scheduleSummary({ dynamic: { tenantId: false, enabled: true } }),
      hasScheduleId: true
    })).toEqual({
      status: "reject",
      message: "Dynamic enabled job schedules cannot be overridden"
    });
  });

  it("requires an explicit schedule id before override events can be written", () => {
    expect(planJobScheduleOverride({
      scheduleId: "1",
      tenantId: "acme",
      summary: scheduleSummary(),
      hasScheduleId: false
    })).toEqual({
      status: "reject",
      message: "Job schedule id is required for runtime overrides"
    });
  });

  it("allows tenant-visible static schedules with stable ids to be overridden", () => {
    expect(planJobScheduleOverride({
      scheduleId: "daily",
      tenantId: "acme",
      summary: scheduleSummary(),
      hasScheduleId: true
    })).toEqual({ status: "override" });
  });

  it("plans runtime schedule save rejection for configured ids and unknown jobs", () => {
    expect(planJobScheduleDefinitionSave({
      scheduleId: "static-daily",
      jobName: "reports.daily",
      configured: true,
      registered: true
    })).toEqual({
      status: "reject",
      message: "Configured job schedule 'static-daily' cannot be edited at runtime"
    });

    expect(planJobScheduleDefinitionSave({
      scheduleId: "runtime-daily",
      jobName: "missing.job",
      configured: false,
      registered: false
    })).toEqual({
      status: "reject",
      message: "Scheduled job 'missing.job' is not registered"
    });
  });

  it("allows runtime schedule saves for non-configured registered jobs", () => {
    expect(planJobScheduleDefinitionSave({
      scheduleId: "runtime-daily",
      jobName: "reports.daily",
      configured: false,
      registered: true
    })).toEqual({ status: "save" });
  });

  it("plans runtime schedule delete rejection for configured and missing ids", () => {
    expect(planJobScheduleDefinitionDelete({
      scheduleId: "static-daily",
      configured: true,
      exists: true
    })).toEqual({
      status: "reject",
      message: "Configured job schedule 'static-daily' cannot be deleted at runtime"
    });

    expect(planJobScheduleDefinitionDelete({
      scheduleId: "runtime-daily",
      configured: false,
      exists: false
    })).toEqual({
      status: "not-found",
      message: "Job schedule 'runtime-daily' was not found"
    });
  });

  it("allows runtime schedule deletes for existing non-configured ids", () => {
    expect(planJobScheduleDefinitionDelete({
      scheduleId: "runtime-daily",
      configured: false,
      exists: true
    })).toEqual({ status: "delete" });
  });

  it("plans override clear writes only when an override exists", () => {
    expect(planJobScheduleOverrideClear({ hasOverride: false })).toEqual({ status: "noop" });
    expect(planJobScheduleOverrideClear({ hasOverride: true })).toEqual({ status: "write" });
  });

  it("plans enabled override writes only when the effective enabled value changes", () => {
    expect(planJobScheduleEnabledOverride({
      configuredEnabled: true,
      targetEnabled: true
    })).toEqual({ status: "noop" });

    expect(planJobScheduleEnabledOverride({
      currentEnabled: false,
      configuredEnabled: true,
      targetEnabled: true
    })).toEqual({ status: "write" });
  });

  it("plans pause writes only when the active pause changes", () => {
    expect(planJobSchedulePauseOverride({
      currentPausedUntil: "2026-01-02T00:00:00.000Z",
      pausedUntil: "2026-01-02T00:00:00.000Z",
      now: "2026-01-01T00:00:00.000Z"
    })).toEqual({ status: "noop" });

    expect(planJobSchedulePauseOverride({
      currentPausedUntil: "2026-01-02T00:00:00.000Z",
      pausedUntil: "2026-01-02T00:00:00.000Z",
      now: "2026-01-03T00:00:00.000Z"
    })).toEqual({ status: "write" });
  });

  it("plans registered configured schedule summaries as overrideable and dispatchable", () => {
    expect(planJobScheduleSummary(summaryOptions({
      job: { description: "Daily report" },
      tenantId: "acme"
    }))).toMatchObject({
      id: "daily",
      source: "configured",
      editable: false,
      enabled: true,
      configuredEnabled: true,
      overridden: false,
      overrideable: true,
      registered: true,
      dispatchable: true,
      description: "Daily report",
      tenantId: "acme"
    });
  });

  it("plans active pause overrides as disabled summaries with audit metadata", () => {
    expect(planJobScheduleSummary(summaryOptions({
      override: {
        pausedUntil: "2026-01-02T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        updatedBy: "ops@example.com"
      }
    }))).toMatchObject({
      enabled: false,
      overridden: true,
      pausedUntil: "2026-01-02T00:00:00.000Z",
      overrideUpdatedAt: "2026-01-01T00:00:00.000Z",
      overrideUpdatedBy: "ops@example.com",
      dispatchable: false
    });
  });

  it("ignores expired pause overrides when shaping schedule summaries", () => {
    const summary = planJobScheduleSummary(summaryOptions({
      override: {
        pausedUntil: "2025-12-31T00:00:00.000Z",
        updatedAt: "2025-12-30T00:00:00.000Z",
        updatedBy: "ops@example.com"
      }
    }));

    expect(summary).toMatchObject({
      enabled: true,
      overridden: false,
      dispatchable: true
    });
    expect(summary.pausedUntil).toBeUndefined();
    expect(summary.overrideUpdatedAt).toBeUndefined();
    expect(summary.overrideUpdatedBy).toBeUndefined();
  });

  it("keeps dynamic tenant and enabled schedules non-overrideable and non-dispatchable", () => {
    expect(planJobScheduleSummary(summaryOptions({
      dynamic: {
        tenantId: true,
        enabled: true,
        payload: false,
        metadata: false,
        idempotencyKey: false
      },
      override: {
        enabled: false,
        updatedAt: "2026-01-01T00:00:00.000Z",
        updatedBy: "ops@example.com"
      }
    }))).toMatchObject({
      enabled: true,
      overridden: false,
      overrideable: false,
      dispatchable: false
    });
  });

  it("projects a schedule summary with registry metadata and active overrides", () => {
    expect(jobScheduleSummaryFor({
      schedule: {
        id: "daily",
        cron: "0 0 * * *",
        jobName: "reports.daily",
        tenantId: "acme",
        payload: () => ({ scope: "daily" }),
        delaySeconds: 15
      },
      index: 0,
      overrides: {
        tenantId: "acme",
        version: 1,
        overrides: new Map([[
          "daily",
          {
            scheduleId: "daily",
            enabled: false,
            updatedAt: "2026-01-01T01:00:00.000Z",
            updatedBy: "ops@example.com"
          }
        ]])
      },
      registry: jobRegistry({
        "reports.daily": {
          description: "Build daily reports",
          retry: { maxAttempts: 2 }
        }
      }),
      canOverride: true,
      canDispatch: true,
      now: "2026-01-01T02:00:00.000Z"
    })).toEqual({
      id: "daily",
      cron: "0 0 * * *",
      jobName: "reports.daily",
      source: "configured",
      editable: false,
      enabled: false,
      configuredEnabled: true,
      overridden: true,
      overrideEnabled: false,
      overrideUpdatedAt: "2026-01-01T01:00:00.000Z",
      overrideUpdatedBy: "ops@example.com",
      overrideable: true,
      registered: true,
      dispatchable: false,
      description: "Build daily reports",
      retry: { maxAttempts: 2 },
      delaySeconds: 15,
      tenantId: "acme",
      dynamic: {
        enabled: false,
        tenantId: false,
        payload: true,
        metadata: false,
        idempotencyKey: false
      }
    });
  });

  it("projects configured and runtime schedule summaries in a single policy pass", () => {
    expect(jobScheduleSummaries({
      configured: [
        {
          cron: "0 1 * * *",
          jobName: "reports.daily",
          tenantId: "acme"
        }
      ],
      definitions: {
        version: 2,
        schedules: new Map([[
          "runtime",
          runtimeSchedule({
            id: "runtime-nightly",
            cron: "0 2 * * *",
            jobName: "reports.nightly"
          })
        ]])
      },
      overrides: { tenantId: "acme", version: 0, overrides: new Map() },
      registry: jobRegistry({
        "reports.daily": {},
        "reports.nightly": { description: "Runtime nightly" }
      }),
      canOverride: true,
      canDispatch: true,
      now: "2026-01-01T00:00:00.000Z"
    })).toMatchObject([
      {
        id: "1",
        source: "configured",
        editable: false,
        jobName: "reports.daily",
        registered: true,
        dispatchable: true
      },
      {
        id: "runtime-nightly",
        source: "runtime",
        editable: true,
        jobName: "reports.nightly",
        description: "Runtime nightly",
        overrideable: false,
        registered: true,
        dispatchable: true
      }
    ]);
  });

  it("normalizes runtime schedule definitions from save commands", () => {
    expect(normalizeJobScheduleRuntimeDefinition({
      tenantId: "acme",
      generatedId: " runtime-daily ",
      command: {
        cron: " 0 0 * * * ",
        jobName: " reports.daily ",
        payload: { scope: "daily" },
        metadata: { owner: "ops" },
        idempotencyKey: " daily-acme ",
        delaySeconds: 30
      }
    })).toEqual({
      id: "runtime-daily",
      cron: "0 0 * * *",
      jobName: "reports.daily",
      tenantId: "acme",
      enabled: true,
      payload: { scope: "daily" },
      metadata: { owner: "ops" },
      idempotencyKey: "daily-acme",
      delaySeconds: 30,
      updatedAt: "",
      updatedBy: ""
    });
  });

  it("preserves selected existing runtime fields only when command fields are omitted", () => {
    expect(mergePreservedJobScheduleRuntimeFields({
      schedule: runtimeSchedule({
        payload: { scope: "new" }
      }),
      existing: runtimeSchedule({
        payload: { scope: "old" },
        metadata: { owner: "ops" },
        idempotencyKey: "old-key"
      }),
      preserve: {
        preserveExistingFields: true,
        payloadProvided: true,
        metadataProvided: false,
        idempotencyKeyProvided: false
      }
    })).toMatchObject({
      payload: { scope: "new" },
      metadata: { owner: "ops" },
      idempotencyKey: "old-key"
    });
  });

  it("rejects invalid runtime schedule definition command fields", () => {
    expect(() => normalizeJobScheduleRuntimeDefinition({
      tenantId: "acme",
      generatedId: " ",
      command: {
        cron: "0 0 * * *",
        jobName: "reports.daily"
      }
    })).toThrow("Job schedule id is required");

    expect(() => normalizeJobScheduleRuntimeDefinition({
      tenantId: "acme",
      generatedId: "daily",
      command: {
        cron: "0 0 * * *",
        jobName: "reports.daily",
        delaySeconds: 86_401
      }
    })).toThrow("delaySeconds must be an integer between 0 and 86400");

    expect(() => normalizeJobScheduleRuntimeDefinition({
      tenantId: "acme",
      generatedId: "daily",
      command: {
        cron: "0 0 * * *",
        jobName: "reports.daily",
        payload: [] as never
      }
    })).toThrow("Job schedule payload must be a JSON object");
  });

  it("normalizes dashboard schedule query filters without trimming literal cron or job names", () => {
    expect(normalizeJobScheduleQuery({})).toEqual({});
    expect(normalizeJobScheduleQuery({ cron: "", jobName: "" })).toEqual({});
    expect(normalizeJobScheduleQuery({ cron: " 0 0 * * * ", jobName: " reports.daily " })).toEqual({
      cron: " 0 0 * * * ",
      jobName: " reports.daily "
    });
  });

  it("derives stable schedule identities and configured id sets", () => {
    const schedules = [
      { cron: "0 0 * * *", jobName: "reports.daily", id: "daily" },
      { cron: "0 * * * *", jobName: "reports.hourly" }
    ];

    expect(jobScheduleIdentity(schedules[0]!, 0)).toBe("daily");
    expect(jobScheduleIdentity(schedules[1]!, 1)).toBe("2");
    expect([...configuredJobScheduleIds(schedules)]).toEqual(["daily", "2"]);
  });

  it("rejects blank or duplicate configured schedule ids before runtime state is read", () => {
    expect(() => ensureUniqueJobScheduleIds([{ id: " ", cron: "* * * * *", jobName: "jobs.blank" }])).toThrow(
      "Job schedule id is required"
    );
    expect(() =>
      ensureUniqueJobScheduleIds([
        { id: "daily", cron: "0 0 * * *", jobName: "reports.daily" },
        { id: "daily", cron: "0 * * * *", jobName: "reports.hourly" }
      ])
    ).toThrow("Job schedule id 'daily' is duplicated");
  });

  it("detects dynamic schedule fields and static tenant ids", () => {
    const dynamic = () => "computed";

    expect(isDynamicJobScheduleValue(dynamic)).toBe(true);
    expect(dynamicJobScheduleFields({
      enabled: dynamic,
      tenantId: dynamic,
      payload: dynamic,
      metadata: dynamic,
      idempotencyKey: dynamic
    })).toEqual({
      enabled: true,
      tenantId: true,
      payload: true,
      metadata: true,
      idempotencyKey: true
    });
    expect(staticJobScheduleTenantId({ tenantId: "acme" })).toBe("acme");
    expect(staticJobScheduleTenantId({})).toBe("default");
    expect(staticJobScheduleTenantId({ tenantId: dynamic })).toBeUndefined();
  });

  it("projects effective schedules only when overrides changed the enabled state", () => {
    const schedule = { id: "daily", cron: "0 0 * * *", jobName: "reports.daily", enabled: true };

    expect(effectiveJobSchedule(schedule, { overridden: false, enabled: false })).toBe(schedule);
    expect(effectiveJobSchedule(schedule, { overridden: true, enabled: false })).toEqual({
      ...schedule,
      enabled: false
    });
  });

  it("normalizes pauseUntil values to future ISO timestamps", () => {
    expect(normalizeJobSchedulePauseUntil(
      "2026-01-02T00:00:00+08:00",
      "2026-01-01T00:00:00.000Z"
    )).toBe("2026-01-01T16:00:00.000Z");
    expect(() => normalizeJobSchedulePauseUntil("not-a-date", "2026-01-01T00:00:00.000Z")).toThrow(
      "Job schedule pauseUntil must be a valid timestamp"
    );
    expect(() =>
      normalizeJobSchedulePauseUntil("2025-12-31T00:00:00.000Z", "2026-01-01T00:00:00.000Z")
    ).toThrow("Job schedule pauseUntil must be in the future");
  });
});

function scheduleSummary(overrides: {
  readonly tenantId?: string;
  readonly source?: "configured" | "runtime";
  readonly jobName?: string;
  readonly enabled?: boolean;
  readonly registered?: boolean;
  readonly dynamic?: {
    readonly tenantId: boolean;
    readonly enabled: boolean;
  };
} = {}) {
  return {
    tenantId: "acme",
    source: "configured" as const,
    jobName: "reports.daily",
    enabled: true,
    registered: true,
    dynamic: { tenantId: false, enabled: false },
    ...overrides
  };
}

function withoutTenantId<TSummary extends { readonly tenantId?: string }>(
  summary: TSummary
): Omit<TSummary, "tenantId"> {
  const { tenantId: _tenantId, ...rest } = summary;
  return rest;
}

function jobRegistry(jobs: Record<string, {
  readonly description?: string;
  readonly retry?: { readonly maxAttempts: number };
}>) {
  return {
    has(name: string): boolean {
      return jobs[name] !== undefined;
    },
    get(name: string) {
      const job = jobs[name];
      if (job === undefined) {
        throw new Error(`Unexpected job '${name}'`);
      }
      return job;
    }
  };
}

function summaryOptions(overrides: Partial<Parameters<typeof planJobScheduleSummary>[0]> = {}) {
  return {
    id: "daily",
    cron: "0 0 * * *",
    jobName: "reports.daily",
    source: "configured" as const,
    hasScheduleId: true,
    configuredEnabled: true,
    canOverride: true,
    canDispatch: true,
    registered: true,
    now: "2026-01-01T00:00:00.000Z",
    dynamic: {
      tenantId: false,
      enabled: false,
      payload: false,
      metadata: false,
      idempotencyKey: false
    },
    ...overrides
  };
}

function runtimeSchedule(overrides: Partial<ReturnType<typeof normalizeJobScheduleRuntimeDefinition>> = {}) {
  return {
    id: "runtime-daily",
    cron: "0 0 * * *",
    jobName: "reports.daily",
    tenantId: "acme",
    enabled: true,
    updatedAt: "2026-01-01T00:00:00.000Z",
    updatedBy: "admin@example.com",
    ...overrides
  };
}
