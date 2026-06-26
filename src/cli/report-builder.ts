import {
  requestRemoteAdminPayload,
  requestRemoteAdminResponse,
  type RemoteAdminIo,
  type RemoteHeaderOption
} from "./remote-admin.js";
import {
  formatReportRun,
  remoteReportQuery,
  type RemoteReportQueryOptions,
  type ReportFilterOption,
  type ReportRunResponse
} from "./reports.js";

export type ReportBuilderRemoteAction = "create" | "delete" | "export" | "get" | "list" | "run" | "update";

export type ReportBuilderHeaderOption = RemoteHeaderOption;

export interface ReportBuilderRemoteCommand extends RemoteReportQueryOptions {
  readonly kind: "report-builder";
  readonly action: ReportBuilderRemoteAction;
  readonly url: string;
  readonly headers: readonly ReportBuilderHeaderOption[];
  readonly doctype?: string;
  readonly id?: string;
  readonly label?: string;
  readonly definition?: Record<string, unknown>;
}

export type ReportBuilderRemoteIo = RemoteAdminIo;

export class ReportBuilderRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReportBuilderRemoteError";
  }
}

interface SavedReportResponse {
  readonly id?: string;
  readonly label?: string;
  readonly doctype?: string;
  readonly ownerId?: string;
  readonly createdAt?: string;
  readonly updatedAt?: string;
  readonly definition?: {
    readonly columns?: readonly unknown[];
    readonly filters?: readonly unknown[];
    readonly summaries?: readonly unknown[];
    readonly groups?: readonly unknown[];
    readonly charts?: readonly unknown[];
    readonly orderBy?: string;
    readonly order?: string;
  };
}

interface RemoteDataPayload {
  readonly data?: unknown;
}

export async function runRemoteReportBuilderCommand(
  command: ReportBuilderRemoteCommand,
  io: ReportBuilderRemoteIo = {}
): Promise<string> {
  if (command.action === "list") {
    const data = await requestRemoteReportBuilderPayload(command, io, {
      method: "GET",
      path: `/api/report-builder/${encodeURIComponent(requiredDoctype(command))}`
    });
    return formatSavedReportList(command.url, arrayData<SavedReportResponse>(data.data, "saved reports"));
  }
  if (command.action === "get") {
    const data = await requestRemoteReportBuilderPayload(command, io, {
      method: "GET",
      path: reportBuilderItemPath(command)
    });
    return formatSavedReport(command.url, objectData<SavedReportResponse>(data.data, "saved report"));
  }
  if (command.action === "create") {
    const data = await requestRemoteReportBuilderPayload(command, io, {
      method: "POST",
      path: `/api/report-builder/${encodeURIComponent(requiredDoctype(command))}`,
      body: savedReportBody(command)
    });
    return formatSavedReport(command.url, objectData<SavedReportResponse>(data.data, "saved report"));
  }
  if (command.action === "update") {
    const data = await requestRemoteReportBuilderPayload(command, io, {
      method: "PUT",
      path: reportBuilderItemPath(command),
      body: savedReportBody(command)
    });
    return formatSavedReport(command.url, objectData<SavedReportResponse>(data.data, "saved report"));
  }
  if (command.action === "delete") {
    await requestRemoteReportBuilderResponse(command, io, {
      method: "DELETE",
      path: reportBuilderItemPath(command)
    }, { accept: "application/json" });
    return [
      `Deleted saved report at ${command.url}`,
      `- ${requiredId(command)} [${requiredDoctype(command)}]`,
      ""
    ].join("\n");
  }
  if (command.action === "export") {
    const query = remoteReportQuery(command, { includeOffset: false });
    const response = await requestRemoteReportBuilderResponse(command, io, {
      method: "GET",
      path: `${reportBuilderItemPath(command)}/export.csv`,
      ...(query === undefined ? {} : { query })
    }, { accept: "text/csv" });
    return response.text();
  }
  const query = remoteReportQuery(command, { includeOffset: true });
  const data = await requestRemoteReportBuilderPayload(command, io, {
    method: "GET",
    path: `${reportBuilderItemPath(command)}/run`,
    ...(query === undefined ? {} : { query })
  });
  return formatReportRun(command.url, objectData<ReportRunResponse>(data, "saved report run"), "Saved report run");
}

function requestRemoteReportBuilderPayload(
  command: ReportBuilderRemoteCommand,
  io: ReportBuilderRemoteIo,
  request: {
    readonly body?: Record<string, unknown>;
    readonly method: "DELETE" | "GET" | "POST" | "PUT";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<RemoteDataPayload> {
  return requestRemoteAdminPayload<RemoteDataPayload, ReportBuilderRemoteError>(command, io, request, {
    error: ReportBuilderRemoteError,
    fetchLabel: "remote report-builder commands",
    resourceLabel: "Remote report builder",
    urlLabel: "Remote report builder"
  });
}

function requestRemoteReportBuilderResponse(
  command: ReportBuilderRemoteCommand,
  io: ReportBuilderRemoteIo,
  request: {
    readonly method: "DELETE" | "GET";
    readonly path: string;
    readonly query?: URLSearchParams;
  },
  options: { readonly accept: string }
): Promise<Response> {
  return requestRemoteAdminResponse<ReportBuilderRemoteError>(command, io, request, {
    error: ReportBuilderRemoteError,
    fetchLabel: "remote report-builder commands",
    resourceLabel: "Remote report builder",
    urlLabel: "Remote report builder",
    accept: options.accept
  });
}

function reportBuilderItemPath(command: ReportBuilderRemoteCommand): string {
  return `/api/report-builder/${encodeURIComponent(requiredDoctype(command))}/${encodeURIComponent(requiredId(command))}`;
}

function savedReportBody(command: ReportBuilderRemoteCommand): Record<string, unknown> {
  return {
    label: requiredLabel(command),
    definition: requiredDefinition(command)
  };
}

function formatSavedReportList(baseUrl: string, reports: readonly SavedReportResponse[]): string {
  return [
    `Saved reports at ${baseUrl}`,
    `Total: ${String(reports.length)}`,
    ...savedReportLines(reports),
    ""
  ].join("\n");
}

function formatSavedReport(baseUrl: string, report: SavedReportResponse): string {
  const definition = report.definition ?? {};
  return [
    `Saved report at ${baseUrl}`,
    savedReportLine(report),
    ...(report.ownerId === undefined ? [] : [`Owner: ${report.ownerId}`]),
    ...(report.createdAt === undefined ? [] : [`Created: ${report.createdAt}`]),
    ...(report.updatedAt === undefined ? [] : [`Updated: ${report.updatedAt}`]),
    `Columns: ${String(definition.columns?.length ?? 0)}`,
    `Filters: ${String(definition.filters?.length ?? 0)}`,
    `Summaries: ${String(definition.summaries?.length ?? 0)}`,
    `Groups: ${String(definition.groups?.length ?? 0)}`,
    `Charts: ${String(definition.charts?.length ?? 0)}`,
    ...(definition.orderBy === undefined ? [] : [`Order: ${definition.orderBy} ${definition.order ?? "asc"}`]),
    ""
  ].join("\n");
}

function savedReportLines(reports: readonly SavedReportResponse[]): readonly string[] {
  if (reports.length === 0) {
    return ["- (none)"];
  }
  return reports.map(savedReportLine);
}

function savedReportLine(report: SavedReportResponse): string {
  const label = report.label === undefined ? "" : ` - ${report.label}`;
  const doctype = report.doctype === undefined ? "(unknown doctype)" : report.doctype;
  return `- ${report.id ?? "(unknown)"} [${doctype}]${label}`;
}

function arrayData<T>(data: unknown, label: string): readonly T[] {
  if (Array.isArray(data)) {
    return data as readonly T[];
  }
  throw new ReportBuilderRemoteError(`Remote ${label} response did not include a data array`);
}

function objectData<T>(data: unknown, label: string): T {
  if (isRecord(data)) {
    return data as T;
  }
  throw new ReportBuilderRemoteError(`Remote ${label} response did not include a data object`);
}

function requiredDoctype(command: ReportBuilderRemoteCommand): string {
  if (command.doctype === undefined) {
    throw new ReportBuilderRemoteError(`Report builder ${command.action} requires --doctype`);
  }
  return command.doctype;
}

function requiredId(command: ReportBuilderRemoteCommand): string {
  if (command.id === undefined) {
    throw new ReportBuilderRemoteError(`Report builder ${command.action} requires --id`);
  }
  return command.id;
}

function requiredLabel(command: ReportBuilderRemoteCommand): string {
  if (command.label === undefined) {
    throw new ReportBuilderRemoteError(`Report builder ${command.action} requires --label`);
  }
  return command.label;
}

function requiredDefinition(command: ReportBuilderRemoteCommand): Record<string, unknown> {
  if (command.definition === undefined) {
    throw new ReportBuilderRemoteError(`Report builder ${command.action} requires --definition-json`);
  }
  return command.definition;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type { ReportFilterOption };
