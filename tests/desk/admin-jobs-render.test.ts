import { type DataPatchDashboard, type DataPatchDashboardEntry } from "../../src/application/data-patch-service.js";
import { type JobExecutionDashboard } from "../../src/application/job-history-service.js";
import { type JobScheduleDashboard } from "../../src/application/job-schedule-service.js";
import {
  renderDataPatchAdmin,
  renderJobAdmin,
  renderJobScheduleAdmin
} from "../../src/adapters/desk/views/admin-jobs.js";

type ScheduleSummary = JobScheduleDashboard["schedules"][number];

function patch(overrides: Partial<DataPatchDashboardEntry> = {}): DataPatchDashboardEntry {
  return {
    id: "p-1",
    checksum: "abc123",
    status: "not_applied",
    ...overrides
  };
}

function patchDashboard(patches: readonly DataPatchDashboardEntry[]): DataPatchDashboard {
  return {
    patches,
    totals: {
      total: patches.length,
      notApplied: 1,
      pending: 0,
      applied: 0,
      failed: 0,
      rollbackPending: 0,
      rolledBack: 0,
      rollbackFailed: 0
    }
  };
}

function schedule(overrides: Partial<ScheduleSummary> = {}): ScheduleSummary {
  return {
    id: "s-1",
    cron: "0 * * * *",
    jobName: "sync",
    source: "configured",
    editable: false,
    enabled: true,
    configuredEnabled: true,
    overridden: false,
    overrideable: false,
    registered: true,
    dispatchable: false,
    dynamic: { enabled: false, tenantId: false, payload: false, metadata: false, idempotencyKey: false },
    ...overrides
  };
}

describe("Desk job admin", () => {
  it("renders empty dashboards without optional toolbars", () => {
    const html = renderJobAdmin({ jobs: [], executions: [], filters: {}, limit: 20 });
    expect(html).toContain("No jobs registered.");
    expect(html).toContain("No executions recorded.");
    expect(html).not.toContain(">Schedules</a>");
    expect(html).toContain('<option value="" selected>Any status</option>');
  });

  it("renders job definitions and executions with retry gating", () => {
    const dashboard: JobExecutionDashboard = {
      jobs: [
        { name: "sync", pool: "default", description: "Sync things", retry: { maxAttempts: 3 } },
        { name: "cleanup", pool: "slow" }
      ],
      executions: [
        {
          tenantId: "tenant-a",
          idempotencyKey: "run-ok",
          jobName: "sync",
          runId: "r1",
          status: "succeeded",
          startedAt: "2026-08-01T00:00:00Z",
          finishedAt: "2026-08-01T00:01:00Z",
          result: { moved: 3 }
        },
        {
          tenantId: "tenant-a",
          idempotencyKey: "run-bad",
          jobName: "sync",
          runId: "r2",
          status: "failed",
          startedAt: "2026-08-01T01:00:00Z",
          error: "boom"
        },
        {
          tenantId: "tenant-a",
          idempotencyKey: "run-live",
          jobName: "cleanup",
          runId: "r3",
          status: "running",
          startedAt: "2026-08-01T02:00:00Z"
        }
      ],
      filters: { jobName: "sync", runId: "r2", status: "failed" },
      limit: 10
    };
    const html = renderJobAdmin(dashboard, { allowRetry: true, showSchedulesLink: true });
    expect(html).toContain(">Schedules</a>");
    expect(html).toContain("Sync things");
    expect(html).toContain("maxAttempts");
    expect(html).toContain("{&quot;moved&quot;:3}");
    expect(html).toContain(">boom</td>");
    expect(html).toContain("/desk/admin/jobs/run-bad/retry");
    expect(html).not.toContain("/desk/admin/jobs/run-ok/retry");
    expect(html).toContain('<option value="failed" selected>failed</option>');
  });
});

describe("Desk data patch admin", () => {
  it("renders an empty dashboard without plan, error, or queue controls", () => {
    const html = renderDataPatchAdmin(patchDashboard([]));
    expect(html).toContain("No data patches registered.");
    expect(html).not.toContain("Planned Patches");
    expect(html).not.toContain("Enqueue Batch");
    expect(html).not.toContain("Plan Rollback Batch");
  });

  it("renders every patch status action with queue controls enabled", () => {
    const html = renderDataPatchAdmin(
      patchDashboard([
        patch({ id: "p-new", label: "New patch", claimedAt: "2026-08-01T00:00:00Z" }),
        patch({ id: "p-failed", status: "failed", error: "kapow", failedAt: "2026-08-01T01:00:00Z" }),
        patch({ id: "p-rbfail", status: "rollback_failed", rollbackError: "undo failed", rollbackFailedAt: "2026-08-01T02:00:00Z" }),
        patch({
          id: "p-applied",
          status: "applied",
          rollbackable: true,
          rollbackLabel: "Undo carefully",
          result: { rows: 2 },
          appliedAt: "2026-08-01T03:00:00Z"
        }),
        patch({ id: "p-rb", status: "rolled_back", rollbackResult: { rows: 1 }, rolledBackAt: "2026-08-01T04:00:00Z" }),
        patch({ id: "p-pending", status: "pending", rollbackClaimedAt: "2026-08-01T05:00:00Z" })
      ]),
      {
        error: "Checksum drift",
        plan: { patchIds: ["p-new"], requestedPatchIds: ["p-new"], limit: 1 },
        planKind: "apply",
        queue: { apply: true, rollback: true, rollbackRetry: true }
      }
    );
    expect(html).toContain("Checksum drift");
    expect(html).toContain("Planned Patches");
    expect(html).toContain("Requested: p-new");
    expect(html).toContain("Limit: 1");
    expect(html).toContain("Enqueue Batch");
    expect(html).toContain("Enqueue Rollback Batch");
    expect(html).toContain("/desk/admin/data-patches/p-new/enqueue");
    expect(html).toContain("/desk/admin/data-patches/p-failed/retry");
    expect(html).toContain("/desk/admin/data-patches/p-rbfail/rollback-retry-enqueue");
    expect(html).toContain(">Undo carefully</button>");
    expect(html).toContain("/desk/admin/data-patches/p-applied/rollback-enqueue");
    expect(html).toContain("{&quot;rows&quot;:1}");
  });

  it("renders an empty rollback plan without queue actions", () => {
    const html = renderDataPatchAdmin(
      patchDashboard([patch({ id: "p-applied", status: "applied", rollbackable: true })]),
      { plan: { patchIds: [] }, planKind: "rollback" }
    );
    expect(html).toContain("Planned Rollback");
    expect(html).toContain("(none)");
    expect(html).toContain("Plan Rollback Batch");
    expect(html).not.toContain("Enqueue Rollback Batch");
    expect(html).not.toContain("p-applied/rollback-enqueue");
  });
});

describe("Desk job schedule admin", () => {
  it("renders an empty schedule dashboard without editor or history link", () => {
    const html = renderJobScheduleAdmin({ schedules: [], filters: {} });
    expect(html).toContain("No schedules configured.");
    expect(html).not.toContain("Save runtime schedule");
    expect(html).not.toContain("Execution history");
  });

  it("renders schedules covering override, dynamic, and action branches", () => {
    const dashboard: JobScheduleDashboard = {
      schedules: [
        schedule({
          id: "s-run",
          dispatchable: true,
          overrideable: true,
          overridden: true,
          overrideEnabled: false,
          pausedUntil: "2026-09-01T00:00:00Z",
          editable: true,
          delaySeconds: 30,
          tenantId: "tenant-a",
          dynamic: { enabled: true, tenantId: true, payload: true, metadata: true, idempotencyKey: true }
        }),
        schedule({ id: "s-static", enabled: false, registered: false })
      ],
      filters: { cron: "0 * * * *", jobName: "sync" }
    };
    const html = renderJobScheduleAdmin(dashboard, {
      allowRun: true,
      allowOverride: true,
      allowEdit: true,
      showHistoryLink: true
    });
    expect(html).toContain("Save runtime schedule");
    expect(html).toContain("Execution history");
    expect(html).toContain("/desk/admin/jobs/schedules/s-run/run");
    expect(html).toContain("/desk/admin/jobs/schedules/s-run/enable");
    expect(html).toContain("/desk/admin/jobs/schedules/s-run/reset");
    expect(html).toContain("disabled, paused until 2026-09-01T00:00:00Z");
    expect(html).toContain("enabled, tenant, payload, metadata, idempotency");
    expect(html).toContain('name="returnCron" value="0 * * * *"');
    expect(html).toContain('name="returnJob" value="sync"');
    expect(html).not.toContain("/desk/admin/jobs/schedules/s-static/run");
    expect(html).toContain(">no</td>");
  });

  it("labels the override action disable when the schedule is enabled", () => {
    const html = renderJobScheduleAdmin(
      { schedules: [schedule({ id: "s-on", overrideable: true })], filters: {} },
      { allowOverride: true }
    );
    expect(html).toContain("/desk/admin/jobs/schedules/s-on/disable");
    expect(html).not.toContain("/desk/admin/jobs/schedules/s-on/reset");
  });

  it("marks dynamic tenant schedules without a fixed tenant", () => {
    const html = renderJobScheduleAdmin(
      {
        schedules: [schedule({ id: "s-dyn", dynamic: { enabled: false, tenantId: true, payload: false, metadata: false, idempotencyKey: false } })],
        filters: {}
      }
    );
    expect(html).toContain(">dynamic</td>");
  });
});
