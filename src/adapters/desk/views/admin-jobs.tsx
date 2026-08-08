import type { FC } from "hono/jsx";
import { type DataPatchApplyPlan, type DataPatchDashboard, type DataPatchDashboardEntry, type DataPatchRollbackPlan } from "../../../application/data-patch-service.js";
import { type JobExecutionDashboard } from "../../../application/job-history-service.js";
import { type JobScheduleDashboard } from "../../../application/job-schedule-service.js";
import { MAX_JOB_QUEUE_DELAY_SECONDS, MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH } from "../../../ports/job-queue.js";
import { Notice, SelectOptions, Toolbar, renderFragment, type SelectOptionSpec } from "../ui/primitives.js";

type DataPatchQueueControls = {
  readonly apply: boolean;
  readonly rollback: boolean;
  readonly rollbackRetry: boolean;
};

type JobAdminOptions = {
  readonly allowRetry?: boolean | undefined;
  readonly showSchedulesLink?: boolean | undefined;
};

export function renderJobAdmin(
  dashboard: JobExecutionDashboard,
  options: { readonly allowRetry?: boolean; readonly showSchedulesLink?: boolean } = {}
): string {
  return renderFragment(<JobAdmin dashboard={dashboard} options={options} />);
}

const JobAdmin: FC<{ dashboard: JobExecutionDashboard; options: JobAdminOptions }> = ({ dashboard, options }) => (
  <>
    <form class="panel form list-filters" method="get" action="/desk/admin/jobs">
      <div class="fields">
        <label class="field"><span>Job</span><input name="job" value={dashboard.filters.jobName ?? ""} /></label>
        <label class="field"><span>Status</span><select name="status"><SelectOptions options={jobStatusOptions(dashboard.filters.status)} /></select></label>
        <label class="field"><span>Run ID</span><input name="run_id" value={dashboard.filters.runId ?? ""} /></label>
        <label class="field"><span>Limit</span><input name="limit" type="number" min="1" value={String(dashboard.limit)} /></label>
      </div>
      <div class="actions"><button class="button primary" type="submit">Filter</button></div>
    </form>
    {options.showSchedulesLink ? (
      <Toolbar>
        <a class="button" href="/desk/admin/jobs/schedules">Schedules</a>
      </Toolbar>
    ) : null}
    <section class="panel">
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Job</th><th>Pool</th><th>Description</th><th>Retry</th></tr></thead>
          <tbody>
            {dashboard.jobs.length === 0 ? (
              <tr><td colspan={4} class="empty">No jobs registered.</td></tr>
            ) : (
              dashboard.jobs.map((job) => (
                <tr>
                  <td data-label="Job">{job.name}</td>
                  <td data-label="Pool">{job.pool ?? "default"}</td>
                  <td data-label="Description">{job.description ?? ""}</td>
                  <td data-label="Retry">{job.retry ? JSON.stringify(job.retry) : ""}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
    <section class="panel job-history">
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Idempotency Key</th><th>Job</th><th>Run ID</th><th>Status</th><th>Started</th><th>Finished</th><th>Result / Error</th><th>Action</th></tr></thead>
          <tbody>
            {dashboard.executions.length === 0 ? (
              <tr><td colspan={8} class="empty">No executions recorded.</td></tr>
            ) : (
              dashboard.executions.map((record) => (
                <tr>
                  <td data-label="Idempotency Key">{record.idempotencyKey}</td>
                  <td data-label="Job">{record.jobName}</td>
                  <td data-label="Run ID">{record.runId}</td>
                  <td data-label="Status">{record.status}</td>
                  <td data-label="Started"><time datetime={record.startedAt}>{record.startedAt}</time></td>
                  <td data-label="Finished">{record.finishedAt === undefined ? "" : <time datetime={record.finishedAt}>{record.finishedAt}</time>}</td>
                  <td data-label="Result / Error">{record.result === undefined ? record.error ?? "" : JSON.stringify(record.result)}</td>
                  <td data-label="Action">
                    {options.allowRetry ? <JobRetryAction idempotencyKey={record.idempotencyKey} status={record.status} /> : ""}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  </>
);

function jobStatusOptions(status: JobExecutionDashboard["filters"]["status"]): readonly SelectOptionSpec[] {
  return ["", "running", "succeeded", "failed"].map((value) => ({
    value,
    label: value === "" ? "Any status" : value,
    selected: value === (status ?? "")
  }));
}

type DataPatchAdminOptions = {
  readonly error?: string | undefined;
  readonly plan?: DataPatchApplyPlan | DataPatchRollbackPlan | undefined;
  readonly planKind?: "apply" | "rollback" | undefined;
  readonly queue?: DataPatchQueueControls | undefined;
};

export function renderDataPatchAdmin(
  dashboard: DataPatchDashboard,
  options: {
    readonly error?: string;
    readonly plan?: DataPatchApplyPlan | DataPatchRollbackPlan;
    readonly planKind?: "apply" | "rollback";
    readonly queue?: DataPatchQueueControls;
  } = {}
): string {
  return renderFragment(<DataPatchAdmin dashboard={dashboard} options={options} />);
}

const DataPatchAdmin: FC<{ dashboard: DataPatchDashboard; options: DataPatchAdminOptions }> = ({
  dashboard,
  options
}) => {
  const canPlanRollback = dashboard.patches.some((patch) => patch.rollbackable === true);
  const queue = options.queue ?? { apply: false, rollback: false, rollbackRetry: false };
  const showBatchQueueOptions = queue.apply || (canPlanRollback && queue.rollback);
  return (
    <>
      <form class="panel form" method="post" action="/desk/admin/data-patches/apply">
        <div class="form-head"><h2>Apply Pending Patches</h2><p>{String(dashboard.totals.notApplied)} pending</p></div>
        {options.error ? <Notice tone="error">{options.error}</Notice> : null}
        {options.plan ? <DataPatchPlan plan={options.plan} kind={options.planKind ?? "apply"} /> : null}
        <div class="fields">
          <label class="field"><span>Limit</span><input name="limit" type="number" min="1" value="1" /></label>
          {showBatchQueueOptions ? <DataPatchQueueFields /> : null}
        </div>
        <div class="actions">
          <button class="button" type="submit" formaction="/desk/admin/data-patches/plan">Plan Batch</button>
          {queue.apply ? (
            <button class="button" type="submit" formaction="/desk/admin/data-patches/enqueue">Enqueue Batch</button>
          ) : null}
          {canPlanRollback ? (
            <button class="button" type="submit" formaction="/desk/admin/data-patches/rollback-plan">Plan Rollback Batch</button>
          ) : null}
          {canPlanRollback && queue.rollback ? (
            <button class="button" type="submit" formaction="/desk/admin/data-patches/rollback-enqueue">Enqueue Rollback Batch</button>
          ) : null}
          {canPlanRollback ? (
            <button class="button" type="submit" formaction="/desk/admin/data-patches/rollback">Rollback Batch</button>
          ) : null}
          <button class="button primary" type="submit">Apply Batch</button>
        </div>
      </form>
      <section class="panel">
        <div class="table-wrap">
          <table class="responsive-table">
            <thead><tr><th>Patch</th><th>Label</th><th>Checksum</th><th>Status</th><th>Timestamp</th><th>Result / Error</th><th>Action</th></tr></thead>
            <tbody>
              {dashboard.patches.length === 0 ? (
                <tr><td colspan={7} class="empty">No data patches registered.</td></tr>
              ) : (
                dashboard.patches.map((patch) => (
                  <tr>
                    <td data-label="Patch">{patch.id}</td>
                    <td data-label="Label">{patch.label ?? ""}</td>
                    <td data-label="Checksum">{patch.checksum}</td>
                    <td data-label="Status">{patch.status}</td>
                    <td data-label="Timestamp">{dataPatchTimestamp(patch)}</td>
                    <td data-label="Result / Error">{dataPatchDetail(patch)}</td>
                    <td data-label="Action">
                      <DataPatchAction patch={patch} queue={queue} />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
};

const DataPatchQueueFields: FC = () => (
  <>
    <label class="field"><span>Idempotency Key</span><input name="idempotencyKey" maxlength={MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH} /></label>
    <label class="field"><span>Delay Seconds</span><input name="delaySeconds" type="number" min="0" max={MAX_JOB_QUEUE_DELAY_SECONDS} /></label>
  </>
);

const DataPatchAction: FC<{ patch: DataPatchDashboardEntry; queue: DataPatchQueueControls }> = ({
  patch,
  queue
}) => {
  const patchId = encodeURIComponent(patch.id);
  if (patch.status === "not_applied") {
    return (
      <div class="data-patch-actions">
        <form class="inline-action data-patch-command-action" method="post">
          <button class="button" type="submit" formaction={`/desk/admin/data-patches/${patchId}/plan`}>Plan</button>
          <button class="button" type="submit" formaction={`/desk/admin/data-patches/${patchId}/apply`}>Apply</button>
        </form>
        {queue.apply ? <DataPatchQueueAction action={`/desk/admin/data-patches/${patchId}/enqueue`} label="Enqueue" /> : ""}
      </div>
    );
  }
  if (patch.status === "failed") {
    return (
      <form class="inline-action" method="post">
        <button class="button" type="submit" formaction={`/desk/admin/data-patches/${patchId}/retry`}>Retry</button>
      </form>
    );
  }
  if (patch.status === "rollback_failed") {
    return (
      <div class="data-patch-actions">
        <form class="inline-action data-patch-command-action" method="post">
          <button class="button" type="submit" formaction={`/desk/admin/data-patches/${patchId}/rollback-retry`}>Retry Rollback</button>
        </form>
        {queue.rollbackRetry ? (
          <DataPatchQueueAction action={`/desk/admin/data-patches/${patchId}/rollback-retry-enqueue`} label="Enqueue Retry" />
        ) : (
          ""
        )}
      </div>
    );
  }
  if (patch.status === "applied" && patch.rollbackable === true) {
    const label = patch.rollbackLabel ?? "Plan Rollback";
    return (
      <div class="data-patch-actions">
        <form class="inline-action data-patch-command-action" method="post">
          <button class="button" type="submit" formaction={`/desk/admin/data-patches/${patchId}/rollback-plan`}>{label}</button>
          <button class="button" type="submit" formaction={`/desk/admin/data-patches/${patchId}/rollback`}>Rollback</button>
        </form>
        {queue.rollback ? (
          <DataPatchQueueAction action={`/desk/admin/data-patches/${patchId}/rollback-enqueue`} label="Enqueue Rollback" />
        ) : (
          ""
        )}
      </div>
    );
  }
  return null;
};

const DataPatchQueueAction: FC<{ action: string; label: string }> = ({ action, label }) => (
  <form class="inline-action data-patch-queue-action" method="post" action={action}>
    <input name="idempotencyKey" maxlength={MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH} placeholder="Idempotency Key" aria-label="Idempotency Key" />
    <input name="delaySeconds" type="number" min="0" max={MAX_JOB_QUEUE_DELAY_SECONDS} placeholder="Delay Seconds" aria-label="Delay Seconds" />
    <button class="button" type="submit">{label}</button>
  </form>
);

const DataPatchPlan: FC<{ plan: DataPatchApplyPlan | DataPatchRollbackPlan; kind: "apply" | "rollback" }> = ({
  plan,
  kind
}) => {
  const planned = plan.patchIds.length === 0 ? "(none)" : plan.patchIds.join(", ");
  return (
    <section class="notice">
      <h3>{kind === "rollback" ? "Planned Rollback" : "Planned Patches"}</h3>
      <p>{planned}</p>
      {plan.requestedPatchIds === undefined ? null : <p>Requested: {plan.requestedPatchIds.join(", ")}</p>}
      {plan.limit === undefined ? null : <p>Limit: {String(plan.limit)}</p>}
    </section>
  );
};

function dataPatchTimestamp(patch: DataPatchDashboardEntry): string {
  return patch.rolledBackAt ??
    patch.rollbackFailedAt ??
    patch.rollbackClaimedAt ??
    patch.appliedAt ??
    patch.failedAt ??
    patch.claimedAt ??
    "";
}

function dataPatchDetail(patch: DataPatchDashboardEntry): string {
  if (patch.status === "failed") {
    return patch.error ?? "";
  }
  if (patch.status === "rollback_failed") {
    return patch.rollbackError ?? "";
  }
  if (patch.status === "rolled_back" && patch.rollbackResult !== undefined) {
    return JSON.stringify(patch.rollbackResult);
  }
  if (patch.status === "applied" && patch.result !== undefined) {
    return JSON.stringify(patch.result);
  }
  return "";
}

const JobRetryAction: FC<{
  idempotencyKey: string;
  status: JobExecutionDashboard["executions"][number]["status"];
}> = ({ idempotencyKey, status }) => {
  if (status !== "failed") {
    return null;
  }
  return (
    <form class="inline-action" method="post">
      <button class="button" type="submit" formaction={`/desk/admin/jobs/${encodeURIComponent(idempotencyKey)}/retry`}>Retry</button>
    </form>
  );
};

type JobScheduleAdminOptions = {
  readonly allowRun?: boolean | undefined;
  readonly allowOverride?: boolean | undefined;
  readonly allowEdit?: boolean | undefined;
  readonly showHistoryLink?: boolean | undefined;
};

export function renderJobScheduleAdmin(
  dashboard: JobScheduleDashboard,
  options: {
    readonly allowRun?: boolean;
    readonly allowOverride?: boolean;
    readonly allowEdit?: boolean;
    readonly showHistoryLink?: boolean;
  } = {}
): string {
  return renderFragment(<JobScheduleAdmin dashboard={dashboard} options={options} />);
}

const JobScheduleAdmin: FC<{ dashboard: JobScheduleDashboard; options: JobScheduleAdminOptions }> = ({
  dashboard,
  options
}) => (
  <>
    {options.allowEdit ? <JobScheduleEditor filters={dashboard.filters} /> : ""}
    <form class="panel form list-filters" method="get" action="/desk/admin/jobs/schedules">
      <div class="fields">
        <label class="field"><span>Cron</span><input name="cron" value={dashboard.filters.cron ?? ""} /></label>
        <label class="field"><span>Job</span><input name="job" value={dashboard.filters.jobName ?? ""} /></label>
      </div>
      <div class="actions"><button class="button primary" type="submit">Filter</button></div>
    </form>
    {options.showHistoryLink ? (
      <Toolbar>
        <a class="button" href="/desk/admin/jobs">Execution history</a>
      </Toolbar>
    ) : null}
    <section class="panel">
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Source</th><th>ID</th><th>Cron</th><th>Job</th><th>Tenant</th><th>Enabled</th><th>Override</th><th>Registered</th><th>Delay</th><th>Dynamic</th><th>Action</th></tr></thead>
          <tbody>
            {dashboard.schedules.length === 0 ? (
              <tr><td colspan={11} class="empty">No schedules configured.</td></tr>
            ) : (
              dashboard.schedules.map((schedule) => (
                <tr>
                  <td data-label="Source">{schedule.source}</td>
                  <td data-label="ID">{schedule.id}</td>
                  <td data-label="Cron">{schedule.cron}</td>
                  <td data-label="Job">{schedule.jobName}</td>
                  <td data-label="Tenant">{schedule.tenantId ?? (schedule.dynamic.tenantId ? "dynamic" : "")}</td>
                  <td data-label="Enabled">{schedule.enabled ? "yes" : "no"}</td>
                  <td data-label="Override">{scheduleOverrideState(schedule)}</td>
                  <td data-label="Registered">{schedule.registered ? "yes" : "no"}</td>
                  <td data-label="Delay">{schedule.delaySeconds === undefined ? "" : String(schedule.delaySeconds)}</td>
                  <td data-label="Dynamic">{dynamicScheduleFields(schedule)}</td>
                  <td data-label="Action">
                    {options.allowRun ? (
                      <ScheduleRunAction scheduleId={schedule.id} dispatchable={schedule.dispatchable} filters={dashboard.filters} />
                    ) : (
                      ""
                    )}
                    {options.allowOverride ? <ScheduleOverrideAction schedule={schedule} filters={dashboard.filters} /> : ""}
                    {options.allowEdit ? <ScheduleDefinitionAction schedule={schedule} filters={dashboard.filters} /> : ""}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  </>
);

const JobScheduleEditor: FC<{ filters: JobScheduleDashboard["filters"] }> = ({ filters }) => (
  <form class="panel form" method="post" action="/desk/admin/jobs/schedules">
    <JobScheduleReturnFields filters={filters} />
    <div class="fields">
      <label class="field"><span>ID</span><input name="id" /></label>
      <label class="field"><span>Cron</span><input name="cron" required /></label>
      <label class="field"><span>Job</span><input name="jobName" required /></label>
      <label class="field"><span>Delay</span><input name="delaySeconds" type="number" min="0" max={MAX_JOB_QUEUE_DELAY_SECONDS} /></label>
      <label class="field checkbox"><input name="enabled" value="true" type="checkbox" checked /><span>Enabled</span></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Save runtime schedule</button></div>
  </form>
);

const ScheduleRunAction: FC<{
  scheduleId: string;
  dispatchable: boolean;
  filters: JobScheduleDashboard["filters"];
}> = ({ scheduleId, dispatchable, filters }) => {
  if (!dispatchable) {
    return null;
  }
  return (
    <form class="inline-action" method="post">
      <JobScheduleReturnFields filters={filters} />
      <button class="button" type="submit" formaction={`/desk/admin/jobs/schedules/${encodeURIComponent(scheduleId)}/run`}>Run</button>
    </form>
  );
};

const ScheduleOverrideAction: FC<{
  schedule: JobScheduleDashboard["schedules"][number];
  filters: JobScheduleDashboard["filters"];
}> = ({ schedule, filters }) => {
  if (!schedule.overrideable) {
    return null;
  }
  const baseEnabled = schedule.overrideEnabled ?? schedule.configuredEnabled;
  const action = baseEnabled ? "disable" : "enable";
  const label = baseEnabled ? "Disable" : "Enable";
  return (
    <form class="inline-action" method="post">
      <JobScheduleReturnFields filters={filters} />
      <button class="button" type="submit" formaction={`/desk/admin/jobs/schedules/${encodeURIComponent(schedule.id)}/${action}`}>{label}</button>
      <input name="pauseUntil" placeholder="Pause until ISO time" value={schedule.pausedUntil ?? ""} />
      <button class="button" type="submit" formaction={`/desk/admin/jobs/schedules/${encodeURIComponent(schedule.id)}/pause`}>Pause</button>
      {schedule.overridden ? (
        <button class="button" type="submit" formaction={`/desk/admin/jobs/schedules/${encodeURIComponent(schedule.id)}/reset`}>Reset</button>
      ) : (
        ""
      )}
    </form>
  );
};

function scheduleOverrideState(schedule: JobScheduleDashboard["schedules"][number]): string {
  const parts = [
    schedule.overrideEnabled === undefined ? "" : schedule.overrideEnabled ? "enabled" : "disabled",
    schedule.pausedUntil === undefined ? "" : `paused until ${schedule.pausedUntil}`
  ].filter(Boolean);
  return parts.join(", ");
}

const ScheduleDefinitionAction: FC<{
  schedule: JobScheduleDashboard["schedules"][number];
  filters: JobScheduleDashboard["filters"];
}> = ({ schedule, filters }) => {
  if (!schedule.editable) {
    return null;
  }
  return (
    <form class="inline-action" method="post">
      <JobScheduleReturnFields filters={filters} />
      <button class="button" type="submit" formaction={`/desk/admin/jobs/schedules/${encodeURIComponent(schedule.id)}/delete`}>Delete</button>
    </form>
  );
};

const JobScheduleReturnFields: FC<{ filters: JobScheduleDashboard["filters"] }> = ({ filters }) => (
  <>
    {filters.cron === undefined ? null : <input type="hidden" name="returnCron" value={filters.cron} />}
    {filters.jobName === undefined ? null : <input type="hidden" name="returnJob" value={filters.jobName} />}
  </>
);

function dynamicScheduleFields(schedule: JobScheduleDashboard["schedules"][number]): string {
  return [
    schedule.dynamic.enabled ? "enabled" : "",
    schedule.dynamic.tenantId ? "tenant" : "",
    schedule.dynamic.payload ? "payload" : "",
    schedule.dynamic.metadata ? "metadata" : "",
    schedule.dynamic.idempotencyKey ? "idempotency" : ""
  ].filter((field) => field !== "").join(", ");
}
