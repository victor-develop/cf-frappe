import { type DataPatchApplyPlan, type DataPatchDashboard, type DataPatchDashboardEntry, type DataPatchRollbackPlan } from "../../../application/data-patch-service.js";
import { type JobExecutionDashboard } from "../../../application/job-history-service.js";
import { type JobScheduleDashboard } from "../../../application/job-schedule-service.js";
import { MAX_JOB_QUEUE_DELAY_SECONDS, MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH } from "../../../ports/job-queue.js";
import { escapeHtml, renderTableCell } from "./shared.js";

type DataPatchQueueControls = {
  readonly apply: boolean;
  readonly rollback: boolean;
  readonly rollbackRetry: boolean;
};

export function renderJobAdmin(
  dashboard: JobExecutionDashboard,
  options: { readonly allowRetry?: boolean; readonly showSchedulesLink?: boolean } = {}
): string {
  const jobRows = dashboard.jobs
    .map((job) => {
      const retry = job.retry ? JSON.stringify(job.retry) : "";
      return `<tr>
        ${renderTableCell("Job", escapeHtml(job.name))}
        ${renderTableCell("Pool", escapeHtml(job.pool ?? "default"))}
        ${renderTableCell("Description", escapeHtml(job.description ?? ""))}
        ${renderTableCell("Retry", escapeHtml(retry))}
      </tr>`;
    })
    .join("");
  const executionRows = dashboard.executions
    .map(
      (record) => `<tr>
        ${renderTableCell("Idempotency Key", escapeHtml(record.idempotencyKey))}
        ${renderTableCell("Job", escapeHtml(record.jobName))}
        ${renderTableCell("Run ID", escapeHtml(record.runId))}
        ${renderTableCell("Status", escapeHtml(record.status))}
        ${renderTableCell("Started", `<time datetime="${escapeHtml(record.startedAt)}">${escapeHtml(record.startedAt)}</time>`)}
        ${renderTableCell("Finished", record.finishedAt === undefined ? "" : `<time datetime="${escapeHtml(record.finishedAt)}">${escapeHtml(record.finishedAt)}</time>`)}
        ${renderTableCell("Result / Error", escapeHtml(record.result === undefined ? record.error ?? "" : JSON.stringify(record.result)))}
        ${renderTableCell("Action", options.allowRetry ? renderJobRetryAction(record.idempotencyKey, record.status) : "")}
      </tr>`
    )
    .join("");
  return `<form class="panel form list-filters" method="get" action="/desk/admin/jobs">
    <div class="fields">
      <label class="field"><span>Job</span><input name="job" value="${escapeHtml(dashboard.filters.jobName ?? "")}"></label>
      <label class="field"><span>Status</span><select name="status">${renderJobStatusOptions(dashboard.filters.status)}</select></label>
      <label class="field"><span>Run ID</span><input name="run_id" value="${escapeHtml(dashboard.filters.runId ?? "")}"></label>
      <label class="field"><span>Limit</span><input name="limit" type="number" min="1" value="${String(dashboard.limit)}"></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Filter</button></div>
  </form>
  ${options.showSchedulesLink ? `<section class="toolbar"><a class="button" href="/desk/admin/jobs/schedules">Schedules</a></section>` : ""}
  <section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>Job</th><th>Pool</th><th>Description</th><th>Retry</th></tr></thead>
        <tbody>${jobRows || `<tr><td colspan="4" class="empty">No jobs registered.</td></tr>`}</tbody>
      </table>
    </div>
  </section>
  <section class="panel job-history">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>Idempotency Key</th><th>Job</th><th>Run ID</th><th>Status</th><th>Started</th><th>Finished</th><th>Result / Error</th><th>Action</th></tr></thead>
        <tbody>${executionRows || `<tr><td colspan="8" class="empty">No executions recorded.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

export function renderDataPatchAdmin(
  dashboard: DataPatchDashboard,
  options: {
    readonly error?: string;
    readonly plan?: DataPatchApplyPlan | DataPatchRollbackPlan;
    readonly planKind?: "apply" | "rollback";
    readonly queue?: DataPatchQueueControls;
  } = {}
): string {
  const canPlanRollback = dashboard.patches.some((patch) => patch.rollbackable === true);
  const queue = options.queue ?? { apply: false, rollback: false, rollbackRetry: false };
  const showBatchQueueOptions = queue.apply || (canPlanRollback && queue.rollback);
  const rows = dashboard.patches
    .map((patch) => `<tr>
      ${renderTableCell("Patch", escapeHtml(patch.id))}
      ${renderTableCell("Label", escapeHtml(patch.label ?? ""))}
      ${renderTableCell("Checksum", escapeHtml(patch.checksum))}
      ${renderTableCell("Status", escapeHtml(patch.status))}
      ${renderTableCell("Timestamp", escapeHtml(dataPatchTimestamp(patch)))}
      ${renderTableCell("Result / Error", escapeHtml(dataPatchDetail(patch)))}
      ${renderTableCell("Action", renderDataPatchAction(patch, queue))}
    </tr>`)
    .join("");
  return `<form class="panel form" method="post" action="/desk/admin/data-patches/apply">
    <div class="form-head"><h2>Apply Pending Patches</h2><p>${String(dashboard.totals.notApplied)} pending</p></div>
    ${options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : ""}
    ${options.plan ? renderDataPatchPlan(options.plan, options.planKind ?? "apply") : ""}
    <div class="fields">
      <label class="field"><span>Limit</span><input name="limit" type="number" min="1" value="1"></label>
      ${showBatchQueueOptions ? renderDataPatchQueueFields() : ""}
    </div>
    <div class="actions">
      <button class="button" type="submit" formaction="/desk/admin/data-patches/plan">Plan Batch</button>
      ${queue.apply ? `<button class="button" type="submit" formaction="/desk/admin/data-patches/enqueue">Enqueue Batch</button>` : ""}
      ${canPlanRollback ? `<button class="button" type="submit" formaction="/desk/admin/data-patches/rollback-plan">Plan Rollback Batch</button>` : ""}
      ${canPlanRollback && queue.rollback ? `<button class="button" type="submit" formaction="/desk/admin/data-patches/rollback-enqueue">Enqueue Rollback Batch</button>` : ""}
      ${canPlanRollback ? `<button class="button" type="submit" formaction="/desk/admin/data-patches/rollback">Rollback Batch</button>` : ""}
      <button class="button primary" type="submit">Apply Batch</button>
    </div>
  </form>
  <section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>Patch</th><th>Label</th><th>Checksum</th><th>Status</th><th>Timestamp</th><th>Result / Error</th><th>Action</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="empty">No data patches registered.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

function renderDataPatchQueueFields(): string {
  return `<label class="field"><span>Idempotency Key</span><input name="idempotencyKey" maxlength="${MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH}"></label>
      <label class="field"><span>Delay Seconds</span><input name="delaySeconds" type="number" min="0" max="${MAX_JOB_QUEUE_DELAY_SECONDS}"></label>`;
}

function renderDataPatchAction(
  patch: DataPatchDashboardEntry,
  queue: DataPatchQueueControls
): string {
  const patchId = encodeURIComponent(patch.id);
  if (patch.status === "not_applied") {
    return `<div class="data-patch-actions">
      <form class="inline-action data-patch-command-action" method="post">
        <button class="button" type="submit" formaction="/desk/admin/data-patches/${patchId}/plan">Plan</button>
        <button class="button" type="submit" formaction="/desk/admin/data-patches/${patchId}/apply">Apply</button>
      </form>
      ${queue.apply ? renderDataPatchQueueAction(`/desk/admin/data-patches/${patchId}/enqueue`, "Enqueue") : ""}
    </div>`;
  }
  if (patch.status === "failed") {
    return `<form class="inline-action" method="post">
      <button class="button" type="submit" formaction="/desk/admin/data-patches/${patchId}/retry">Retry</button>
    </form>`;
  }
  if (patch.status === "rollback_failed") {
    return `<div class="data-patch-actions">
      <form class="inline-action data-patch-command-action" method="post">
        <button class="button" type="submit" formaction="/desk/admin/data-patches/${patchId}/rollback-retry">Retry Rollback</button>
      </form>
      ${queue.rollbackRetry ? renderDataPatchQueueAction(`/desk/admin/data-patches/${patchId}/rollback-retry-enqueue`, "Enqueue Retry") : ""}
    </div>`;
  }
  if (patch.status === "applied" && patch.rollbackable === true) {
    const label = patch.rollbackLabel ?? "Plan Rollback";
    return `<div class="data-patch-actions">
      <form class="inline-action data-patch-command-action" method="post">
        <button class="button" type="submit" formaction="/desk/admin/data-patches/${patchId}/rollback-plan">${escapeHtml(label)}</button>
        <button class="button" type="submit" formaction="/desk/admin/data-patches/${patchId}/rollback">Rollback</button>
      </form>
      ${queue.rollback ? renderDataPatchQueueAction(`/desk/admin/data-patches/${patchId}/rollback-enqueue`, "Enqueue Rollback") : ""}
    </div>`;
  }
  return "";
}

function renderDataPatchQueueAction(action: string, label: string): string {
  return `<form class="inline-action data-patch-queue-action" method="post" action="${escapeHtml(action)}">
    <input name="idempotencyKey" maxlength="${MAX_JOB_QUEUE_IDEMPOTENCY_KEY_LENGTH}" placeholder="Idempotency Key" aria-label="Idempotency Key">
    <input name="delaySeconds" type="number" min="0" max="${MAX_JOB_QUEUE_DELAY_SECONDS}" placeholder="Delay Seconds" aria-label="Delay Seconds">
    <button class="button" type="submit">${escapeHtml(label)}</button>
  </form>`;
}

function renderDataPatchPlan(plan: DataPatchApplyPlan | DataPatchRollbackPlan, kind: "apply" | "rollback"): string {
  const planned = plan.patchIds.length === 0 ? "(none)" : plan.patchIds.join(", ");
  const requested = plan.requestedPatchIds === undefined ? "" : `<p>Requested: ${escapeHtml(plan.requestedPatchIds.join(", "))}</p>`;
  const limit = plan.limit === undefined ? "" : `<p>Limit: ${String(plan.limit)}</p>`;
  return `<section class="notice">
    <h3>${kind === "rollback" ? "Planned Rollback" : "Planned Patches"}</h3>
    <p>${escapeHtml(planned)}</p>
    ${requested}
    ${limit}
  </section>`;
}

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

function renderJobRetryAction(idempotencyKey: string, status: JobExecutionDashboard["executions"][number]["status"]): string {
  if (status !== "failed") {
    return "";
  }
  return `<form class="inline-action" method="post">
    <button class="button" type="submit" formaction="/desk/admin/jobs/${encodeURIComponent(idempotencyKey)}/retry">Retry</button>
  </form>`;
}

export function renderJobScheduleAdmin(
  dashboard: JobScheduleDashboard,
  options: {
    readonly allowRun?: boolean;
    readonly allowOverride?: boolean;
    readonly allowEdit?: boolean;
    readonly showHistoryLink?: boolean;
  } = {}
): string {
  const rows = dashboard.schedules
    .map((schedule) => `<tr>
        ${renderTableCell("Source", escapeHtml(schedule.source))}
        ${renderTableCell("ID", escapeHtml(schedule.id))}
        ${renderTableCell("Cron", escapeHtml(schedule.cron))}
        ${renderTableCell("Job", escapeHtml(schedule.jobName))}
        ${renderTableCell("Tenant", escapeHtml(schedule.tenantId ?? (schedule.dynamic.tenantId ? "dynamic" : "")))}
        ${renderTableCell("Enabled", schedule.enabled ? "yes" : "no")}
        ${renderTableCell("Override", escapeHtml(scheduleOverrideState(schedule)))}
        ${renderTableCell("Registered", schedule.registered ? "yes" : "no")}
        ${renderTableCell("Delay", escapeHtml(schedule.delaySeconds === undefined ? "" : String(schedule.delaySeconds)))}
        ${renderTableCell("Dynamic", escapeHtml(dynamicScheduleFields(schedule)))}
        ${renderTableCell("Action", `${options.allowRun ? renderScheduleRunAction(schedule.id, schedule.dispatchable, dashboard.filters) : ""}${options.allowOverride ? renderScheduleOverrideAction(schedule, dashboard.filters) : ""}${options.allowEdit ? renderScheduleDefinitionAction(schedule, dashboard.filters) : ""}`)}
      </tr>`)
    .join("");
  const editor = options.allowEdit ? renderJobScheduleEditor(dashboard.filters) : "";
  return `${editor}<form class="panel form list-filters" method="get" action="/desk/admin/jobs/schedules">
    <div class="fields">
      <label class="field"><span>Cron</span><input name="cron" value="${escapeHtml(dashboard.filters.cron ?? "")}"></label>
      <label class="field"><span>Job</span><input name="job" value="${escapeHtml(dashboard.filters.jobName ?? "")}"></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Filter</button></div>
  </form>
  ${options.showHistoryLink ? `<section class="toolbar">
    <a class="button" href="/desk/admin/jobs">Execution history</a>
  </section>` : ""}
  <section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>Source</th><th>ID</th><th>Cron</th><th>Job</th><th>Tenant</th><th>Enabled</th><th>Override</th><th>Registered</th><th>Delay</th><th>Dynamic</th><th>Action</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="11" class="empty">No schedules configured.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

function renderJobScheduleEditor(filters: JobScheduleDashboard["filters"]): string {
  return `<form class="panel form" method="post" action="/desk/admin/jobs/schedules">
    ${renderJobScheduleReturnFields(filters)}
    <div class="fields">
      <label class="field"><span>ID</span><input name="id"></label>
      <label class="field"><span>Cron</span><input name="cron" required></label>
      <label class="field"><span>Job</span><input name="jobName" required></label>
      <label class="field"><span>Delay</span><input name="delaySeconds" type="number" min="0" max="${MAX_JOB_QUEUE_DELAY_SECONDS}"></label>
      <label class="field checkbox"><input name="enabled" value="true" type="checkbox" checked><span>Enabled</span></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Save runtime schedule</button></div>
  </form>`;
}

function renderScheduleRunAction(
  scheduleId: string,
  dispatchable: boolean,
  filters: JobScheduleDashboard["filters"]
): string {
  if (!dispatchable) {
    return "";
  }
  return `<form class="inline-action" method="post">
    ${renderJobScheduleReturnFields(filters)}
    <button class="button" type="submit" formaction="/desk/admin/jobs/schedules/${encodeURIComponent(scheduleId)}/run">Run</button>
  </form>`;
}

function renderScheduleOverrideAction(
  schedule: JobScheduleDashboard["schedules"][number],
  filters: JobScheduleDashboard["filters"]
): string {
  if (!schedule.overrideable) {
    return "";
  }
  const baseEnabled = schedule.overrideEnabled ?? schedule.configuredEnabled;
  const action = baseEnabled ? "disable" : "enable";
  const label = baseEnabled ? "Disable" : "Enable";
  const reset = schedule.overridden
    ? `<button class="button" type="submit" formaction="/desk/admin/jobs/schedules/${encodeURIComponent(schedule.id)}/reset">Reset</button>`
    : "";
  return `<form class="inline-action" method="post">
    ${renderJobScheduleReturnFields(filters)}
    <button class="button" type="submit" formaction="/desk/admin/jobs/schedules/${encodeURIComponent(schedule.id)}/${action}">${label}</button>
    <input name="pauseUntil" placeholder="Pause until ISO time" value="${escapeHtml(schedule.pausedUntil ?? "")}">
    <button class="button" type="submit" formaction="/desk/admin/jobs/schedules/${encodeURIComponent(schedule.id)}/pause">Pause</button>
    ${reset}
  </form>`;
}

function scheduleOverrideState(schedule: JobScheduleDashboard["schedules"][number]): string {
  const parts = [
    schedule.overrideEnabled === undefined ? "" : schedule.overrideEnabled ? "enabled" : "disabled",
    schedule.pausedUntil === undefined ? "" : `paused until ${schedule.pausedUntil}`
  ].filter(Boolean);
  return parts.join(", ");
}

function renderScheduleDefinitionAction(
  schedule: JobScheduleDashboard["schedules"][number],
  filters: JobScheduleDashboard["filters"]
): string {
  if (!schedule.editable) {
    return "";
  }
  return `<form class="inline-action" method="post">
    ${renderJobScheduleReturnFields(filters)}
    <button class="button" type="submit" formaction="/desk/admin/jobs/schedules/${encodeURIComponent(schedule.id)}/delete">Delete</button>
  </form>`;
}

function renderJobScheduleReturnFields(filters: JobScheduleDashboard["filters"]): string {
  return [
    filters.cron === undefined ? "" : `<input type="hidden" name="returnCron" value="${escapeHtml(filters.cron)}">`,
    filters.jobName === undefined ? "" : `<input type="hidden" name="returnJob" value="${escapeHtml(filters.jobName)}">`
  ].filter(Boolean).join("");
}

function dynamicScheduleFields(schedule: JobScheduleDashboard["schedules"][number]): string {
  return [
    schedule.dynamic.enabled ? "enabled" : "",
    schedule.dynamic.tenantId ? "tenant" : "",
    schedule.dynamic.payload ? "payload" : "",
    schedule.dynamic.metadata ? "metadata" : "",
    schedule.dynamic.idempotencyKey ? "idempotency" : ""
  ].filter((field) => field !== "").join(", ");
}

function renderJobStatusOptions(status: JobExecutionDashboard["filters"]["status"]): string {
  const options = ["", "running", "succeeded", "failed"];
  return options
    .map((value) => {
      const label = value === "" ? "Any status" : value;
      const selected = value === (status ?? "") ? " selected" : "";
      return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");
}
