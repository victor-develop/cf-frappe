import {
  requestRemoteAdminPayload,
  requestRemoteAdminResponse,
  type RemoteAdminIo,
  type RemoteHeaderOption
} from "./remote-admin.js";

export type ReportRemoteAction = "export" | "get" | "list" | "run";

export type ReportHeaderOption = RemoteHeaderOption;

export interface ReportFilterOption {
  readonly name: string;
  readonly value: string;
}

export interface RemoteReportQueryOptions {
  readonly filters: readonly ReportFilterOption[];
  readonly filterExpression?: Record<string, unknown>;
  readonly limit?: number;
  readonly offset?: number;
  readonly order?: "asc" | "desc";
  readonly orderBy?: string;
}

export interface ReportRemoteCommand {
  readonly kind: "reports";
  readonly action: ReportRemoteAction;
  readonly url: string;
  readonly headers: readonly ReportHeaderOption[];
  readonly filters: readonly ReportFilterOption[];
  readonly filterExpression?: Record<string, unknown>;
  readonly limit?: number;
  readonly offset?: number;
  readonly order?: "asc" | "desc";
  readonly orderBy?: string;
  readonly report?: string;
}

export type ReportRemoteIo = RemoteAdminIo;

export class ReportRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportRemoteError";
  }
}

interface ReportResponse {
  readonly name?: string;
  readonly label?: string;
  readonly module?: string;
  readonly description?: string;
  readonly doctype?: string;
  readonly source?: { readonly kind?: string; readonly provider?: string };
  readonly columns?: readonly unknown[];
  readonly filters?: readonly unknown[];
  readonly summaries?: readonly unknown[];
  readonly groups?: readonly unknown[];
  readonly charts?: readonly unknown[];
  readonly roles?: readonly string[];
  readonly permissionAction?: string;
}

export interface ReportRunResponse {
  readonly report?: ReportResponse;
  readonly columns?: readonly unknown[];
  readonly filters?: readonly unknown[];
  readonly summary?: readonly ReportSummaryResponse[];
  readonly groups?: readonly ReportGroupResponse[];
  readonly charts?: readonly ReportChartResponse[];
  readonly rows?: readonly Record<string, unknown>[];
  readonly limit?: number;
  readonly offset?: number;
  readonly total?: number;
}

interface ReportSummaryResponse {
  readonly name?: string;
  readonly label?: string;
  readonly aggregate?: string;
  readonly value?: unknown;
  readonly indicator?: string;
}

interface ReportGroupResponse {
  readonly name?: string;
  readonly rows?: readonly unknown[];
}

interface ReportChartResponse {
  readonly name?: string;
  readonly points?: readonly unknown[];
}

interface RemoteDataPayload {
  readonly data?: unknown;
}

export async function runRemoteReportCommand(
  command: ReportRemoteCommand,
  io: ReportRemoteIo = {}
): Promise<string> {
  if (command.action === "list") {
    const data = await requestRemoteReportPayload(command, io, {
      method: "GET",
      path: "/api/meta/reports"
    });
    return formatReportList(command.url, arrayData<ReportResponse>(data.data, "reports"));
  }
  if (command.action === "get") {
    const data = await requestRemoteReportPayload(command, io, {
      method: "GET",
      path: `/api/meta/reports/${encodeURIComponent(requiredReport(command))}`
    });
    return formatReport(command.url, objectData<ReportResponse>(data.data, "report"));
  }
  if (command.action === "export") {
    const query = remoteReportQuery(command, { includeOffset: false });
    const response = await requestRemoteReportResponse(command, io, {
      method: "GET",
      path: `/api/report/${encodeURIComponent(requiredReport(command))}/export.csv`,
      ...(query === undefined ? {} : { query })
    }, { accept: "text/csv" });
    return response.text();
  }
  const query = remoteReportQuery(command, { includeOffset: true });
  const data = await requestRemoteReportPayload(command, io, {
    method: "GET",
    path: `/api/report/${encodeURIComponent(requiredReport(command))}/run`,
    ...(query === undefined ? {} : { query })
  });
  return formatReportRun(command.url, objectData<ReportRunResponse>(data, "report run"));
}

function requestRemoteReportPayload(
  command: ReportRemoteCommand,
  io: ReportRemoteIo,
  request: {
    readonly method: "GET";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<RemoteDataPayload> {
  return requestRemoteAdminPayload<RemoteDataPayload, ReportRemoteError>(command, io, request, {
    error: ReportRemoteError,
    fetchLabel: "remote report commands",
    resourceLabel: "Remote reports",
    urlLabel: "Remote reports"
  });
}

function requestRemoteReportResponse(
  command: ReportRemoteCommand,
  io: ReportRemoteIo,
  request: {
    readonly method: "GET";
    readonly path: string;
    readonly query?: URLSearchParams;
  },
  options: { readonly accept: string }
): Promise<Response> {
  return requestRemoteAdminResponse<ReportRemoteError>(command, io, request, {
    error: ReportRemoteError,
    fetchLabel: "remote report commands",
    resourceLabel: "Remote reports",
    urlLabel: "Remote reports",
    accept: options.accept
  });
}

export function remoteReportQuery(
  options: RemoteReportQueryOptions,
  behavior: { readonly includeOffset: boolean }
): URLSearchParams | undefined {
  const query = new URLSearchParams();
  for (const filter of options.filters) {
    query.append(`filter_${filter.name}`, filter.value);
  }
  if (options.filterExpression !== undefined) {
    query.set("filter_expression", JSON.stringify(options.filterExpression));
  }
  if (options.orderBy !== undefined) {
    query.set("order_by", options.orderBy);
  }
  if (options.order !== undefined) {
    query.set("order", options.order);
  }
  if (options.limit !== undefined) {
    query.set("limit", String(options.limit));
  }
  if (behavior.includeOffset && options.offset !== undefined) {
    query.set("offset", String(options.offset));
  }
  return query.size === 0 ? undefined : query;
}

function formatReportList(baseUrl: string, reports: readonly ReportResponse[]): string {
  return [
    `Reports at ${baseUrl}`,
    `Total: ${String(reports.length)}`,
    ...reportLines(reports),
    ""
  ].join("\n");
}

function formatReport(baseUrl: string, report: ReportResponse): string {
  return [
    `Report at ${baseUrl}`,
    reportLine(report),
    ...(report.module === undefined ? [] : [`Module: ${report.module}`]),
    ...(report.description === undefined ? [] : [`Description: ${report.description}`]),
    ...(report.roles === undefined || report.roles.length === 0 ? [] : [`Roles: ${report.roles.join(", ")}`]),
    ...(report.permissionAction === undefined ? [] : [`Permission action: ${report.permissionAction}`]),
    `Columns: ${String(report.columns?.length ?? 0)}`,
    `Filters: ${String(report.filters?.length ?? 0)}`,
    `Summaries: ${String(report.summaries?.length ?? 0)}`,
    `Groups: ${String(report.groups?.length ?? 0)}`,
    `Charts: ${String(report.charts?.length ?? 0)}`,
    ""
  ].join("\n");
}

export function formatReportRun(baseUrl: string, result: ReportRunResponse, heading = "Report run"): string {
  const rows = result.rows ?? [];
  const summary = result.summary ?? [];
  const groups = result.groups ?? [];
  const charts = result.charts ?? [];
  return [
    `${heading} at ${baseUrl}`,
    reportLine(result.report ?? {}),
    `Rows: ${String(rows.length)} of ${String(result.total ?? rows.length)} limit=${String(result.limit ?? rows.length)} offset=${String(result.offset ?? 0)}`,
    `Columns: ${String(result.columns?.length ?? 0)}`,
    `Filters: ${String(result.filters?.length ?? 0)}`,
    ...summaryLines(summary),
    ...groupLines(groups),
    ...chartLines(charts),
    ...rowLines(rows),
    ""
  ].join("\n");
}

function reportLines(reports: readonly ReportResponse[]): readonly string[] {
  if (reports.length === 0) {
    return ["- (none)"];
  }
  return reports.map(reportLine);
}

function reportLine(report: ReportResponse): string {
  const doctype = report.doctype === undefined ? "(unknown doctype)" : report.doctype;
  const source = report.source?.kind === undefined ? "" : ` source=${report.source.kind}`;
  const label = report.label === undefined ? "" : ` - ${report.label}`;
  return `- ${report.name ?? "(unknown)"} [${doctype}]${source}${label}`;
}

function summaryLines(summary: readonly ReportSummaryResponse[]): readonly string[] {
  if (summary.length === 0) {
    return ["Summary: 0"];
  }
  return [
    `Summary: ${String(summary.length)}`,
    ...summary.map((item) =>
      `- ${item.name ?? "(unknown)"} ${item.aggregate ?? "value"}=${formatValue(item.value)}${item.indicator === undefined ? "" : ` indicator=${item.indicator}`}`
    )
  ];
}

function groupLines(groups: readonly ReportGroupResponse[]): readonly string[] {
  if (groups.length === 0) {
    return ["Groups: 0"];
  }
  return [
    `Groups: ${String(groups.length)}`,
    ...groups.map((group) => `- ${group.name ?? "(unknown)"} rows=${String(group.rows?.length ?? 0)}`)
  ];
}

function chartLines(charts: readonly ReportChartResponse[]): readonly string[] {
  if (charts.length === 0) {
    return ["Charts: 0"];
  }
  return [
    `Charts: ${String(charts.length)}`,
    ...charts.map((chart) => `- ${chart.name ?? "(unknown)"} points=${String(chart.points?.length ?? 0)}`)
  ];
}

function rowLines(rows: readonly Record<string, unknown>[]): readonly string[] {
  if (rows.length === 0) {
    return ["Rows data: 0"];
  }
  return ["Rows data:", ...rows.map((row) => `- ${JSON.stringify(row)}`)];
}

function formatValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
    return String(value);
  }
  return JSON.stringify(value);
}

function arrayData<T>(data: unknown, label: string): readonly T[] {
  if (Array.isArray(data)) {
    return data as readonly T[];
  }
  throw new ReportRemoteError(`Remote ${label} response did not include a data array`);
}

function objectData<T>(data: unknown, label: string): T {
  if (isRecord(data)) {
    return data as T;
  }
  throw new ReportRemoteError(`Remote ${label} response did not include a data object`);
}

function requiredReport(command: ReportRemoteCommand): string {
  if (command.report === undefined) {
    throw new ReportRemoteError(`Report ${command.action} requires --report`);
  }
  return command.report;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
