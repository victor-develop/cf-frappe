export type DataPatchRemoteAction = "status" | "plan" | "rollback-plan" | "apply" | "rollback" | "enqueue" | "retry";

export interface DataPatchHeaderLiteral {
  readonly kind: "literal";
  readonly name: string;
  readonly value: string;
}

export interface DataPatchHeaderEnv {
  readonly kind: "env";
  readonly name: string;
  readonly envName: string;
}

export type DataPatchHeaderOption = DataPatchHeaderLiteral | DataPatchHeaderEnv;

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

export interface DataPatchRemoteIo {
  readonly env?: (name: string) => string | undefined;
  readonly fetch?: typeof fetch;
}

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

interface DataPatchRecordResponse {
  readonly id: string;
  readonly checksum: string;
}

interface DataPatchRollbackRecordResponse {
  readonly id: string;
  readonly checksum: string;
}

interface DataPatchQueueResponse {
  readonly plan: DataPatchPlanResponse;
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
  const runFetch = io.fetch ?? globalThis.fetch;
  if (typeof runFetch !== "function") {
    throw new DataPatchRemoteError("No fetch implementation is available for remote data patch commands");
  }
  const headers = resolveHeaders(command.headers, io.env);
  headers.set("accept", "application/json");
  const init: RequestInit = {
    method: request.method,
    headers
  };
  if (request.body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(request.body);
  }
  const response = await runFetch(dataPatchApiUrl(command.url, request.path), init);
  const payload = await readJsonResponse(response);
  if (!response.ok) {
    throw new DataPatchRemoteError(`Remote data patch request failed (${response.status}): ${remoteErrorMessage(payload)}`);
  }
  const data = payload.data;
  if (!isRecord(data)) {
    throw new DataPatchRemoteError("Remote data patch response did not include a data object");
  }
  return data as TData;
}

function commandBody(
  command: DataPatchRemoteCommand,
  options: { readonly includeQueueOptions: boolean }
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (command.patchIds !== undefined) {
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

function resolveHeaders(
  options: readonly DataPatchHeaderOption[],
  readEnv: ((name: string) => string | undefined) | undefined
): Headers {
  const headers = new Headers();
  for (const option of options) {
    if (option.kind === "literal") {
      headers.set(option.name, option.value);
      continue;
    }
    const value = readEnv?.(option.envName);
    if (value === undefined || value === "") {
      throw new DataPatchRemoteError(`Environment variable '${option.envName}' is not set for header '${option.name}'`);
    }
    headers.set(option.name, value);
  }
  return headers;
}

function dataPatchApiUrl(baseUrl: string, path: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new DataPatchRemoteError(`Remote data patch URL '${baseUrl}' is not a valid absolute URL`);
  }
  url.pathname = `${url.pathname.replace(/\/+$/, "")}${path}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return {};
  }
  try {
    const payload = JSON.parse(text) as unknown;
    return isRecord(payload) ? payload : {};
  } catch {
    throw new DataPatchRemoteError(`Remote data patch response was not valid JSON (${response.status})`);
  }
}

function remoteErrorMessage(payload: Record<string, unknown>): string {
  const error = payload.error;
  if (!isRecord(error)) {
    return "remote endpoint returned an error";
  }
  const code = typeof error.code === "string" ? error.code : "ERROR";
  const message = typeof error.message === "string" ? error.message : "remote endpoint returned an error";
  return `${code}: ${message}`;
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

function recordLines(records: readonly DataPatchRecordResponse[]): readonly string[] {
  return records.length === 0 ? ["- (none)"] : records.map((record) => `- ${record.id} (${record.checksum})`);
}

function singlePatchId(command: DataPatchRemoteCommand): string {
  const patchIds = command.patchIds ?? [];
  if (patchIds.length !== 1) {
    throw new DataPatchRemoteError("Data patch retry requires exactly one --id");
  }
  return patchIds[0]!;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
