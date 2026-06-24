import { requestRemoteAdmin, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type JobRemoteAction =
  | "list"
  | "get"
  | "retry"
  | "schedules"
  | "schedule-run"
  | "schedule-enable"
  | "schedule-disable"
  | "schedule-pause"
  | "schedule-reset"
  | "schedule-save"
  | "schedule-delete";

export type JobHeaderOption = RemoteHeaderOption;

export interface JobRemoteCommand {
  readonly kind: "jobs";
  readonly action: JobRemoteAction;
  readonly url: string;
  readonly headers: readonly JobHeaderOption[];
  readonly jobName?: string;
  readonly runId?: string;
  readonly status?: JobExecutionStatusResponse;
  readonly limit?: number;
  readonly idempotencyKey?: string;
  readonly scheduleId?: string;
  readonly cron?: string;
  readonly scheduleEnabled?: boolean;
  readonly pauseUntil?: string;
  readonly payload?: JsonRecord;
  readonly metadata?: JsonRecord;
  readonly scheduleIdempotencyKey?: string;
  readonly delaySeconds?: number;
}

export type JobRemoteIo = RemoteAdminIo;

export class JobRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JobRemoteError";
  }
}

type JsonRecord = Record<string, unknown>;

type JobExecutionStatusResponse = "failed" | "running" | "succeeded";

interface JobDashboardResponse {
  readonly jobs: readonly JobDefinitionResponse[];
  readonly executions: readonly JobExecutionResponse[];
  readonly filters?: {
    readonly jobName?: string;
    readonly runId?: string;
    readonly status?: JobExecutionStatusResponse;
  };
  readonly limit?: number;
}

interface JobDefinitionResponse {
  readonly name: string;
  readonly description?: string;
  readonly pool?: string;
}

interface JobExecutionResponse {
  readonly tenantId?: string;
  readonly idempotencyKey: string;
  readonly jobName: string;
  readonly runId: string;
  readonly status: JobExecutionStatusResponse;
  readonly enqueuedAt?: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly error?: string;
}

interface JobRetryResponse {
  readonly message: JobMessageResponse;
}

interface JobScheduleDashboardResponse {
  readonly schedules: readonly JobScheduleResponse[];
  readonly filters?: {
    readonly cron?: string;
    readonly jobName?: string;
  };
}

interface JobScheduleActionResponse {
  readonly schedule: JobScheduleResponse;
  readonly message?: JobMessageResponse;
}

interface JobScheduleResponse {
  readonly id: string;
  readonly cron: string;
  readonly jobName: string;
  readonly source?: string;
  readonly enabled: boolean;
  readonly dispatchable?: boolean;
  readonly registered?: boolean;
  readonly overridden?: boolean;
  readonly editable?: boolean;
  readonly deleted?: boolean;
  readonly delaySeconds?: number;
  readonly pausedUntil?: string;
  readonly tenantId?: string;
}

interface JobMessageResponse {
  readonly tenantId?: string;
  readonly jobName?: string;
  readonly runId?: string;
  readonly idempotencyKey?: string;
}

export async function runRemoteJobCommand(command: JobRemoteCommand, io: JobRemoteIo = {}): Promise<string> {
  if (command.action === "list") {
    const query = queryParams({
      ...(command.jobName === undefined ? {} : { job: command.jobName }),
      ...(command.runId === undefined ? {} : { run_id: command.runId }),
      ...(command.status === undefined ? {} : { status: command.status }),
      ...(command.limit === undefined ? {} : { limit: String(command.limit) })
    });
    const data = await requestRemoteJob<JobDashboardResponse>(command, io, {
      method: "GET",
      path: "/api/jobs",
      ...(query === undefined ? {} : { query })
    });
    return formatJobs(command.url, data);
  }
  if (command.action === "get") {
    const data = await requestRemoteJob<JobExecutionResponse>(command, io, {
      method: "GET",
      path: `/api/jobs/executions/${encodeURIComponent(requiredIdempotencyKey(command, "get"))}`
    });
    return formatExecution(command.url, data);
  }
  if (command.action === "retry") {
    const data = await requestRemoteJob<JobRetryResponse>(command, io, {
      method: "POST",
      path: `/api/jobs/executions/${encodeURIComponent(requiredIdempotencyKey(command, "retry"))}/retry`
    });
    return formatJobRetry(command.url, data);
  }
  if (command.action === "schedules") {
    const query = queryParams({
      ...(command.jobName === undefined ? {} : { job: command.jobName }),
      ...(command.cron === undefined ? {} : { cron: command.cron })
    });
    const data = await requestRemoteJob<JobScheduleDashboardResponse>(command, io, {
      method: "GET",
      path: "/api/jobs/schedules",
      ...(query === undefined ? {} : { query })
    });
    return formatSchedules(command.url, data);
  }
  if (command.action === "schedule-save") {
    const body = scheduleSaveBody(command);
    const data = await requestRemoteJob<JobScheduleActionResponse>(command, io, {
      body,
      method: command.scheduleId === undefined ? "POST" : "PUT",
      path: command.scheduleId === undefined
        ? "/api/jobs/schedules"
        : `/api/jobs/schedules/${encodeURIComponent(command.scheduleId)}`
    });
    return formatScheduleAction(command.url, "Saved job schedule", data);
  }
  if (command.action === "schedule-delete") {
    const data = await requestRemoteJob<JobScheduleActionResponse>(command, io, {
      method: "DELETE",
      path: `/api/jobs/schedules/${encodeURIComponent(requiredScheduleId(command, "delete"))}`
    });
    return formatScheduleAction(command.url, "Deleted job schedule", data);
  }
  if (command.action === "schedule-pause") {
    const data = await requestRemoteJob<JobScheduleActionResponse>(command, io, {
      body: { pauseUntil: requiredPauseUntil(command) },
      method: "POST",
      path: `/api/jobs/schedules/${encodeURIComponent(requiredScheduleId(command, "pause"))}/pause`
    });
    return formatScheduleAction(command.url, "Paused job schedule", data);
  }
  const data = await requestRemoteJob<JobScheduleActionResponse>(command, io, {
    method: "POST",
    path: `/api/jobs/schedules/${encodeURIComponent(requiredScheduleId(command, scheduleActionLabel(command.action)))}/${scheduleRouteAction(command.action)}`
  });
  return formatScheduleAction(command.url, schedulePastTense(command.action), data);
}

function requestRemoteJob<TData>(
  command: JobRemoteCommand,
  io: JobRemoteIo,
  request: {
    readonly body?: Record<string, unknown>;
    readonly method: "DELETE" | "GET" | "POST" | "PUT";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<TData> {
  return requestRemoteAdmin<TData, JobRemoteError>(command, io, request, {
    error: JobRemoteError,
    fetchLabel: "remote job commands",
    resourceLabel: "Remote job",
    urlLabel: "Remote job"
  });
}

function scheduleSaveBody(command: JobRemoteCommand): Record<string, unknown> {
  if (command.cron === undefined) {
    throw new JobRemoteError("Job schedule save requires --cron");
  }
  if (command.jobName === undefined) {
    throw new JobRemoteError("Job schedule save requires --job");
  }
  return {
    cron: command.cron,
    jobName: command.jobName,
    ...(command.scheduleEnabled === undefined ? {} : { enabled: command.scheduleEnabled }),
    ...(command.payload === undefined ? {} : { payload: command.payload }),
    ...(command.metadata === undefined ? {} : { metadata: command.metadata }),
    ...(command.scheduleIdempotencyKey === undefined ? {} : { idempotencyKey: command.scheduleIdempotencyKey }),
    ...(command.delaySeconds === undefined ? {} : { delaySeconds: command.delaySeconds })
  };
}

function queryParams(values: Record<string, string>): URLSearchParams | undefined {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    params.set(key, value);
  }
  return params.toString().length === 0 ? undefined : params;
}

function requiredIdempotencyKey(command: JobRemoteCommand, action: string): string {
  if (command.idempotencyKey === undefined) {
    throw new JobRemoteError(`Job ${action} requires --idempotency-key`);
  }
  return command.idempotencyKey;
}

function requiredScheduleId(command: JobRemoteCommand, action: string): string {
  if (command.scheduleId === undefined) {
    throw new JobRemoteError(`Job schedule ${action} requires --id`);
  }
  return command.scheduleId;
}

function requiredPauseUntil(command: JobRemoteCommand): string {
  if (command.pauseUntil === undefined) {
    throw new JobRemoteError("Job schedule pause requires --until");
  }
  return command.pauseUntil;
}

function scheduleRouteAction(action: JobRemoteAction): "disable" | "enable" | "reset" | "run" {
  if (action === "schedule-enable") {
    return "enable";
  }
  if (action === "schedule-disable") {
    return "disable";
  }
  if (action === "schedule-reset") {
    return "reset";
  }
  return "run";
}

function scheduleActionLabel(action: JobRemoteAction): string {
  return scheduleRouteAction(action);
}

function schedulePastTense(action: JobRemoteAction): string {
  if (action === "schedule-enable") {
    return "Enabled job schedule";
  }
  if (action === "schedule-disable") {
    return "Disabled job schedule";
  }
  if (action === "schedule-reset") {
    return "Reset job schedule";
  }
  return "Ran job schedule";
}

function formatJobs(baseUrl: string, dashboard: JobDashboardResponse): string {
  return [
    `Jobs at ${baseUrl}`,
    dashboard.limit === undefined ? undefined : `Limit: ${dashboard.limit}`,
    "Definitions:",
    ...definitionLines(dashboard.jobs),
    "Executions:",
    ...executionLines(dashboard.executions),
    ""
  ].filter((line): line is string => line !== undefined).join("\n");
}

function formatExecution(baseUrl: string, execution: JobExecutionResponse): string {
  return [
    `Job execution at ${baseUrl}`,
    ...executionLines([execution]),
    ""
  ].join("\n");
}

function formatJobRetry(baseUrl: string, result: JobRetryResponse): string {
  return [
    `Retried job execution at ${baseUrl}`,
    messageLine(result.message),
    ""
  ].join("\n");
}

function formatSchedules(baseUrl: string, dashboard: JobScheduleDashboardResponse): string {
  return [
    `Job schedules at ${baseUrl}`,
    ...scheduleLines(dashboard.schedules),
    ""
  ].join("\n");
}

function formatScheduleAction(baseUrl: string, label: string, result: JobScheduleActionResponse): string {
  return [
    `${label} at ${baseUrl}`,
    scheduleLine(result.schedule),
    ...(result.message === undefined ? [] : [messageLine(result.message)]),
    ""
  ].join("\n");
}

function definitionLines(jobs: readonly JobDefinitionResponse[]): readonly string[] {
  return jobs.length === 0
    ? ["- (none)"]
    : jobs.map((job) =>
        `- ${job.name} [${job.pool ?? "default"}]${job.description === undefined ? "" : ` - ${job.description}`}`
      );
}

function executionLines(executions: readonly JobExecutionResponse[]): readonly string[] {
  return executions.length === 0 ? ["- (none)"] : executions.map(executionLine);
}

function executionLine(execution: JobExecutionResponse): string {
  const tenant = execution.tenantId === undefined ? "" : ` tenant ${execution.tenantId}`;
  const finished = execution.finishedAt === undefined ? "" : ` finished ${execution.finishedAt}`;
  const error = execution.error === undefined ? "" : ` error ${execution.error}`;
  return `- ${execution.idempotencyKey} [${execution.status}] ${execution.jobName}/${execution.runId}${tenant}${finished}${error}`;
}

function scheduleLines(schedules: readonly JobScheduleResponse[]): readonly string[] {
  return schedules.length === 0 ? ["- (none)"] : schedules.map(scheduleLine);
}

function scheduleLine(schedule: JobScheduleResponse): string {
  const source = schedule.source === undefined ? "" : ` source ${schedule.source}`;
  const tenant = schedule.tenantId === undefined ? "" : ` tenant ${schedule.tenantId}`;
  const registered = schedule.registered === undefined ? "" : ` registered ${String(schedule.registered)}`;
  const dispatchable = schedule.dispatchable === undefined ? "" : ` dispatchable ${String(schedule.dispatchable)}`;
  const overridden = schedule.overridden ? " overridden" : "";
  const deleted = schedule.deleted ? " deleted" : "";
  const delay = schedule.delaySeconds === undefined ? "" : ` delay ${schedule.delaySeconds}s`;
  const paused = schedule.pausedUntil === undefined ? "" : ` paused until ${schedule.pausedUntil}`;
  return `- ${schedule.id} [${schedule.enabled ? "enabled" : "disabled"}] ${schedule.cron} ${schedule.jobName}${source}${tenant}${registered}${dispatchable}${overridden}${deleted}${delay}${paused}`;
}

function messageLine(message: JobMessageResponse): string {
  return `Message: ${message.jobName ?? "(unknown)"} / ${message.runId ?? "(unknown)"} (${message.idempotencyKey ?? "(unknown)"})`;
}
