import { requestRemoteAdminPayload, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type DashboardRemoteAction = "get" | "list" | "run";

export type DashboardHeaderOption = RemoteHeaderOption;

export interface DashboardRemoteCommand {
  readonly kind: "dashboards";
  readonly action: DashboardRemoteAction;
  readonly url: string;
  readonly headers: readonly DashboardHeaderOption[];
  readonly dashboard?: string;
}

export type DashboardRemoteIo = RemoteAdminIo;

export class DashboardRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DashboardRemoteError";
  }
}

interface DashboardResponse {
  readonly name?: string;
  readonly label?: string;
  readonly module?: string;
  readonly description?: string;
  readonly roles?: readonly string[];
  readonly cards?: readonly DashboardCardResponse[];
}

interface DashboardCardResponse {
  readonly name?: string;
  readonly label?: string;
  readonly description?: string;
  readonly indicator?: string;
  readonly source?: { readonly kind?: string; readonly filterExpression?: unknown };
}

interface DashboardRunResponse {
  readonly dashboard?: DashboardResponse;
  readonly cards?: readonly DashboardCardRunResponse[];
}

interface DashboardCardRunResponse extends DashboardCardResponse {
  readonly value?: unknown;
}

interface RemoteDataPayload {
  readonly data?: unknown;
}

export async function runRemoteDashboardCommand(
  command: DashboardRemoteCommand,
  io: DashboardRemoteIo = {}
): Promise<string> {
  if (command.action === "list") {
    const data = await requestRemoteDashboard(command, io, {
      method: "GET",
      path: "/api/meta/dashboards"
    });
    return formatDashboardList(command.url, arrayData<DashboardResponse>(data.data, "dashboards"));
  }
  if (command.action === "get") {
    const data = await requestRemoteDashboard(command, io, {
      method: "GET",
      path: `/api/meta/dashboards/${encodeURIComponent(requiredDashboard(command))}`
    });
    return formatDashboard(command.url, objectData<DashboardResponse>(data.data, "dashboard"));
  }
  const data = await requestRemoteDashboard(command, io, {
    method: "GET",
    path: `/api/dashboard/${encodeURIComponent(requiredDashboard(command))}/run`
  });
  return formatDashboardRun(command.url, objectData<DashboardRunResponse>(data.data, "dashboard run"));
}

function requestRemoteDashboard(
  command: DashboardRemoteCommand,
  io: DashboardRemoteIo,
  request: {
    readonly method: "GET";
    readonly path: string;
  }
): Promise<RemoteDataPayload> {
  return requestRemoteAdminPayload<RemoteDataPayload, DashboardRemoteError>(command, io, request, {
    error: DashboardRemoteError,
    fetchLabel: "remote dashboard commands",
    resourceLabel: "Remote dashboards",
    urlLabel: "Remote dashboards"
  });
}

function formatDashboardList(baseUrl: string, dashboards: readonly DashboardResponse[]): string {
  return [
    `Dashboards at ${baseUrl}`,
    `Total: ${String(dashboards.length)}`,
    ...dashboardLines(dashboards),
    ""
  ].join("\n");
}

function formatDashboard(baseUrl: string, dashboard: DashboardResponse): string {
  return [
    `Dashboard at ${baseUrl}`,
    dashboardLine(dashboard),
    ...(dashboard.module === undefined ? [] : [`Module: ${dashboard.module}`]),
    ...(dashboard.description === undefined ? [] : [`Description: ${dashboard.description}`]),
    ...(dashboard.roles === undefined || dashboard.roles.length === 0 ? [] : [`Roles: ${dashboard.roles.join(", ")}`]),
    ...dashboardCardLines(dashboard.cards ?? []),
    ""
  ].join("\n");
}

function formatDashboardRun(baseUrl: string, result: DashboardRunResponse): string {
  const dashboard = result.dashboard ?? {};
  const cards = result.cards ?? [];
  return [
    `Dashboard run at ${baseUrl}`,
    dashboardLine(dashboard),
    `Cards: ${String(cards.length)}`,
    ...dashboardRunCardLines(cards),
    ""
  ].join("\n");
}

function dashboardLines(dashboards: readonly DashboardResponse[]): readonly string[] {
  if (dashboards.length === 0) {
    return ["- (none)"];
  }
  return dashboards.map(dashboardLine);
}

function dashboardLine(dashboard: DashboardResponse): string {
  const label = dashboard.label === undefined ? "" : ` - ${dashboard.label}`;
  return `- ${dashboard.name ?? "(unknown)"} cards=${String(dashboard.cards?.length ?? 0)}${label}`;
}

function dashboardCardLines(cards: readonly DashboardCardResponse[]): readonly string[] {
  if (cards.length === 0) {
    return ["Cards: 0"];
  }
  return [
    `Cards: ${String(cards.length)}`,
    ...cards.map((card) => `- ${card.name ?? "(unknown)"} ${sourceKind(card)}${sourceFilterExpression(card)}${card.indicator === undefined ? "" : ` indicator=${card.indicator}`}`)
  ];
}

function dashboardRunCardLines(cards: readonly DashboardCardRunResponse[]): readonly string[] {
  if (cards.length === 0) {
    return ["- (none)"];
  }
  return cards.map((card) =>
    `- ${card.name ?? "(unknown)"} ${sourceKind(card)} value=${formatValue(card.value)}${card.indicator === undefined ? "" : ` indicator=${card.indicator}`}`
  );
}

function sourceKind(card: DashboardCardResponse): string {
  return `[${card.source?.kind ?? "unknown"}]`;
}

function sourceFilterExpression(card: DashboardCardResponse): string {
  return card.source?.filterExpression === undefined ? "" : " filterExpression=yes";
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
  throw new DashboardRemoteError(`Remote ${label} response did not include a data array`);
}

function objectData<T>(data: unknown, label: string): T {
  if (isRecord(data)) {
    return data as T;
  }
  throw new DashboardRemoteError(`Remote ${label} response did not include a data object`);
}

function requiredDashboard(command: DashboardRemoteCommand): string {
  if (command.dashboard === undefined) {
    throw new DashboardRemoteError(`Dashboard ${command.action} requires --dashboard`);
  }
  return command.dashboard;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
