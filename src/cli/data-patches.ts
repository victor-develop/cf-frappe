import { requestRemoteAdmin, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type DataPatchRemoteAction =
  | "status"
  | "plan"
  | "rollback-plan"
  | "apply"
  | "rollback"
  | "enqueue"
  | "rollback-enqueue"
  | "retry"
  | "rollback-retry"
  | "rollback-retry-enqueue";

export type DataPatchHeaderOption = RemoteHeaderOption;

export interface DataPatchRemoteCommand {
  readonly kind: "data-patches";
  readonly action: DataPatchRemoteAction;
  readonly url: string;
  readonly headers: readonly DataPatchHeaderOption[];
  readonly patchIds?: readonly string[];
  readonly limit?: number;
  readonly idempotencyKey?: string;
  readonly delaySeconds?: number;
}

export type DataPatchRemoteIo = RemoteAdminIo;

export class DataPatchRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataPatchRemoteError";
  }
}

interface DataPatchDashboardResponse {
  readonly totals: {
    readonly total: number;
    readonly notApplied: number;
    readonly pending: number;
    readonly applied: number;
    readonly failed: number;
    readonly rollbackPending?: number;
    readonly rolledBack?: number;
    readonly rollbackFailed?: number;
  };
  readonly patches: readonly DataPatchDashboardEntryResponse[];
}

interface DataPatchDashboardEntryResponse {
  readonly id: string;
  readonly label?: string;
  readonly checksum: string;
  readonly status: string;
}

interface DataPatchRunResponse {
  readonly applied: readonly DataPatchRecordResponse[];
  readonly skipped: readonly DataPatchRecordResponse[];
}

interface DataPatchRollbackResponse {
  readonly rolledBack: readonly DataPatchRollbackRecordResponse[];
  readonly skipped: readonly DataPatchRollbackRecordResponse[];
}

interface DataPatchPlanResponse {
  readonly patchIds: readonly string[];
  readonly requestedPatchIds?: readonly string[];
  readonly limit?: number;
}

interface DataPatchRollbackRetryPlanResponse {
  readonly patchId: string;
}

interface DataPatchRecordResponse {
  readonly id: string;
  readonly checksum: string;
}

interface DataPatchRollbackRecordResponse {
  readonly id: string;
  readonly checksum: string;
}

interface DataPatchQueueResponse<TPlan = DataPatchPlanResponse> {
  readonly plan: TPlan;
  readonly message: {
    readonly jobName?: string;
    readonly runId?: string;
    readonly idempotencyKey?: string;
  };
}

export async function runRemoteDataPatchCommand(
  command: DataPatchRemoteCommand,
  io: DataPatchRemoteIo = {}
): Promise<string> {
  if (command.action === "status") {
    const data = await requestRemoteDataPatch<DataPatchDashboardResponse>(command, io, {
      method: "GET",
      path: "/api/data-patches"
    });
    return formatDashboard(command.url, data);
  }
  if (command.action === "enqueue") {
    const data = await requestRemoteDataPatch<DataPatchQueueResponse>(command, io, {
      body: commandBody(command, { includeQueueOptions: true }),
      method: "POST",
      path: "/api/data-patches/enqueue"
    });
    return formatEnqueue(command.url, data);
  }
  if (command.action === "rollback-enqueue") {
    const data = await requestRemoteDataPatch<DataPatchQueueResponse>(command, io, {
      body: commandBody(command, { includeQueueOptions: true }),
      method: "POST",
      path: "/api/data-patches/rollback-enqueue"
    });
    return formatRollbackEnqueue(command.url, data);
  }
  if (command.action === "rollback-retry-enqueue") {
    const data = await requestRemoteDataPatch<DataPatchQueueResponse<DataPatchRollbackRetryPlanResponse>>(command, io, {
      body: commandBody(command, { includePatchIds: false, includeQueueOptions: true }),
      method: "POST",
      path: `/api/data-patches/${encodeURIComponent(singlePatchId(command, "rollback retry enqueue"))}/rollback-retry-enqueue`
    });
    return formatRollbackRetryEnqueue(command.url, data);
  }
  if (command.action === "plan") {
    const data = await requestRemoteDataPatch<DataPatchPlanResponse>(command, io, {
      body: commandBody(command, { includeQueueOptions: false }),
      method: "POST",
      path: "/api/data-patches/plan"
    });
    return formatPlan(command.url, data);
  }
  if (command.action === "rollback-plan") {
    const data = await requestRemoteDataPatch<DataPatchPlanResponse>(command, io, {
      body: commandBody(command, { includeQueueOptions: false }),
      method: "POST",
      path: "/api/data-patches/rollback-plan"
    });
    return formatRollbackPlan(command.url, data);
  }
  if (command.action === "retry") {
    const data = await requestRemoteDataPatch<DataPatchRunResponse>(command, io, {
      method: "POST",
      path: `/api/data-patches/${encodeURIComponent(singlePatchId(command))}/retry`
    });
    return formatRetry(command.url, data);
  }
  if (command.action === "rollback-retry") {
    const data = await requestRemoteDataPatch<DataPatchRollbackResponse>(command, io, {
      method: "POST",
      path: `/api/data-patches/${encodeURIComponent(singlePatchId(command, "rollback retry"))}/rollback-retry`
    });
    return formatRollbackRetry(command.url, data);
  }
  if (command.action === "rollback") {
    const data = await requestRemoteDataPatch<DataPatchRollbackResponse>(command, io, {
      body: commandBody(command, { includeQueueOptions: false }),
      method: "POST",
      path: "/api/data-patches/rollback"
    });
    return formatRollback(command.url, data);
  }
  const data = await requestRemoteDataPatch<DataPatchRunResponse>(command, io, {
    body: commandBody(command, { includeQueueOptions: false }),
    method: "POST",
    path: "/api/data-patches/apply"
  });
  return formatRun(command.url, data);
}

async function requestRemoteDataPatch<TData>(
  command: DataPatchRemoteCommand,
  io: DataPatchRemoteIo,
  request: {
    readonly body?: Record<string, unknown>;
    readonly method: "GET" | "POST";
    readonly path: string;
  }
): Promise<TData> {
  return requestRemoteAdmin<TData, DataPatchRemoteError>(command, io, request, {
    error: DataPatchRemoteError,
    fetchLabel: "remote data patch commands",
    resourceLabel: "Remote data patch",
    urlLabel: "Remote data patch"
  });
}

function commandBody(
  command: DataPatchRemoteCommand,
  options: { readonly includePatchIds?: boolean; readonly includeQueueOptions: boolean }
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if ((options.includePatchIds ?? true) && command.patchIds !== undefined) {
    body.patchIds = [...command.patchIds];
  }
  if (command.limit !== undefined) {
    body.limit = command.limit;
  }
  if (options.includeQueueOptions) {
    if (command.idempotencyKey !== undefined) {
      body.idempotencyKey = command.idempotencyKey;
    }
    if (command.delaySeconds !== undefined) {
      body.delaySeconds = command.delaySeconds;
    }
  }
  return body;
}

function formatDashboard(baseUrl: string, dashboard: DataPatchDashboardResponse): string {
  return [
    `Data patches at ${baseUrl}`,
    `total ${dashboard.totals.total}, not applied ${dashboard.totals.notApplied}, pending ${dashboard.totals.pending}, applied ${dashboard.totals.applied}, failed ${dashboard.totals.failed}, rollback pending ${dashboard.totals.rollbackPending ?? 0}, rolled back ${dashboard.totals.rolledBack ?? 0}, rollback failed ${dashboard.totals.rollbackFailed ?? 0}`,
    ...dashboard.patches.map((patch) =>
      `- ${patch.id} [${patch.status}] checksum ${patch.checksum}${patch.label === undefined ? "" : ` - ${patch.label}`}`
    ),
    ""
  ].join("\n");
}

function formatRun(baseUrl: string, result: DataPatchRunResponse): string {
  return [
    `Applied data patches at ${baseUrl}`,
    "Applied:",
    ...recordLines(result.applied),
    "Skipped:",
    ...recordLines(result.skipped),
    ""
  ].join("\n");
}

function formatRetry(baseUrl: string, result: DataPatchRunResponse): string {
  return [
    `Retried data patch at ${baseUrl}`,
    "Applied:",
    ...recordLines(result.applied),
    "Skipped:",
    ...recordLines(result.skipped),
    ""
  ].join("\n");
}

function formatRollback(baseUrl: string, result: DataPatchRollbackResponse): string {
  return [
    `Rolled back data patches at ${baseUrl}`,
    "Rolled back:",
    ...recordLines(result.rolledBack),
    "Skipped:",
    ...recordLines(result.skipped),
    ""
  ].join("\n");
}

function formatRollbackRetry(baseUrl: string, result: DataPatchRollbackResponse): string {
  return [
    `Retried data patch rollback at ${baseUrl}`,
    "Rolled back:",
    ...recordLines(result.rolledBack),
    "Skipped:",
    ...recordLines(result.skipped),
    ""
  ].join("\n");
}

function formatPlan(baseUrl: string, plan: DataPatchPlanResponse): string {
  const lines = [
    `Planned data patches at ${baseUrl}`,
    `Plan: ${plan.patchIds.length === 0 ? "(none)" : plan.patchIds.join(", ")}`
  ];
  if (plan.requestedPatchIds !== undefined) {
    lines.push(`Requested: ${plan.requestedPatchIds.join(", ")}`);
  }
  if (plan.limit !== undefined) {
    lines.push(`Limit: ${plan.limit}`);
  }
  lines.push("");
  return lines.join("\n");
}

function formatRollbackPlan(baseUrl: string, plan: DataPatchPlanResponse): string {
  const lines = [
    `Planned data patch rollback at ${baseUrl}`,
    `Rollback plan: ${plan.patchIds.length === 0 ? "(none)" : plan.patchIds.join(", ")}`
  ];
  if (plan.requestedPatchIds !== undefined) {
    lines.push(`Requested: ${plan.requestedPatchIds.join(", ")}`);
  }
  if (plan.limit !== undefined) {
    lines.push(`Limit: ${plan.limit}`);
  }
  lines.push("");
  return lines.join("\n");
}

function formatEnqueue(baseUrl: string, result: DataPatchQueueResponse): string {
  const lines = [
    `Enqueued data patch job at ${baseUrl}`,
    `Plan: ${result.plan.patchIds.length === 0 ? "(none)" : result.plan.patchIds.join(", ")}`
  ];
  if (result.message.jobName !== undefined || result.message.runId !== undefined) {
    lines.push(`Job: ${result.message.jobName ?? "(unknown)"} / ${result.message.runId ?? "(unknown)"}`);
  }
  if (result.message.idempotencyKey !== undefined) {
    lines.push(`Idempotency key: ${result.message.idempotencyKey}`);
  }
  lines.push("");
  return lines.join("\n");
}

function formatRollbackEnqueue(baseUrl: string, result: DataPatchQueueResponse): string {
  const lines = [
    `Enqueued data patch rollback job at ${baseUrl}`,
    `Rollback plan: ${result.plan.patchIds.length === 0 ? "(none)" : result.plan.patchIds.join(", ")}`
  ];
  if (result.message.jobName !== undefined || result.message.runId !== undefined) {
    lines.push(`Job: ${result.message.jobName ?? "(unknown)"} / ${result.message.runId ?? "(unknown)"}`);
  }
  if (result.message.idempotencyKey !== undefined) {
    lines.push(`Idempotency key: ${result.message.idempotencyKey}`);
  }
  lines.push("");
  return lines.join("\n");
}

function formatRollbackRetryEnqueue(
  baseUrl: string,
  result: DataPatchQueueResponse<DataPatchRollbackRetryPlanResponse>
): string {
  const lines = [
    `Enqueued data patch rollback retry job at ${baseUrl}`,
    `Rollback retry: ${result.plan.patchId}`
  ];
  if (result.message.jobName !== undefined || result.message.runId !== undefined) {
    lines.push(`Job: ${result.message.jobName ?? "(unknown)"} / ${result.message.runId ?? "(unknown)"}`);
  }
  if (result.message.idempotencyKey !== undefined) {
    lines.push(`Idempotency key: ${result.message.idempotencyKey}`);
  }
  lines.push("");
  return lines.join("\n");
}

function recordLines(records: readonly DataPatchRecordResponse[]): readonly string[] {
  return records.length === 0 ? ["- (none)"] : records.map((record) => `- ${record.id} (${record.checksum})`);
}

function singlePatchId(command: DataPatchRemoteCommand, label = "retry"): string {
  const patchIds = command.patchIds ?? [];
  const [patchId] = patchIds;
  if (patchId === undefined || patchIds.length !== 1) {
    throw new DataPatchRemoteError(`Data patch ${label} requires exactly one --id`);
  }
  return patchId;
}
