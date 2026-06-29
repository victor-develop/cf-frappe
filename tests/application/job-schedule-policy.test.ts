import {
  canInspectJobSchedule,
  planJobScheduleAccess,
  planJobScheduleDispatch,
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
});

function scheduleSummary(overrides: {
  readonly tenantId?: string;
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
