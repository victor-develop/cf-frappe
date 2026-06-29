import {
  canInspectJobSchedule,
  planJobScheduleAccess,
  planJobScheduleDefinitionDelete,
  planJobScheduleDefinitionSave,
  planJobScheduleDispatch,
  planJobScheduleEnabledOverride,
  planJobScheduleOverride,
  planJobScheduleOverrideClear,
  planJobSchedulePauseOverride,
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
