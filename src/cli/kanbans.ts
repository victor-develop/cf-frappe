import { requestRemoteAdminPayload, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type KanbanRemoteAction = "get" | "list" | "run";

export type KanbanHeaderOption = RemoteHeaderOption;

export interface KanbanRemoteCommand {
  readonly kind: "kanbans";
  readonly action: KanbanRemoteAction;
  readonly url: string;
  readonly headers: readonly KanbanHeaderOption[];
  readonly kanban?: string;
}

export type KanbanRemoteIo = RemoteAdminIo;

export class KanbanRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KanbanRemoteError";
  }
}

interface KanbanResponse {
  readonly name?: string;
  readonly label?: string;
  readonly module?: string;
  readonly description?: string;
  readonly doctype?: string;
  readonly columnField?: string;
  readonly columns?: readonly { readonly value?: string; readonly label?: string }[];
}

interface KanbanRunResponse {
  readonly board?: KanbanResponse;
  readonly columns?: readonly KanbanColumnRunResponse[];
}

interface KanbanColumnRunResponse {
  readonly value?: string;
  readonly label?: string;
  readonly total?: number;
  readonly hasMore?: boolean;
  readonly cards?: readonly KanbanCardResponse[];
}

interface KanbanCardResponse {
  readonly name?: string;
  readonly title?: string;
  readonly updatedAt?: string;
}

interface RemoteDataPayload {
  readonly data?: unknown;
}

export async function runRemoteKanbanCommand(
  command: KanbanRemoteCommand,
  io: KanbanRemoteIo = {}
): Promise<string> {
  if (command.action === "list") {
    const data = await requestRemoteKanban(command, io, {
      method: "GET",
      path: "/api/meta/kanbans"
    });
    return formatKanbanList(command.url, arrayData<KanbanResponse>(data.data, "kanbans"));
  }
  if (command.action === "get") {
    const data = await requestRemoteKanban(command, io, {
      method: "GET",
      path: `/api/meta/kanbans/${encodeURIComponent(requiredKanban(command))}`
    });
    return formatKanban(command.url, objectData<KanbanResponse>(data.data, "kanban"));
  }
  const data = await requestRemoteKanban(command, io, {
    method: "GET",
    path: `/api/kanban/${encodeURIComponent(requiredKanban(command))}/run`
  });
  return formatKanbanRun(command.url, objectData<KanbanRunResponse>(data.data, "kanban run"));
}

function requestRemoteKanban(
  command: KanbanRemoteCommand,
  io: KanbanRemoteIo,
  request: {
    readonly method: "GET";
    readonly path: string;
  }
): Promise<RemoteDataPayload> {
  return requestRemoteAdminPayload<RemoteDataPayload, KanbanRemoteError>(command, io, request, {
    error: KanbanRemoteError,
    fetchLabel: "remote kanban commands",
    resourceLabel: "Remote kanbans",
    urlLabel: "Remote kanbans"
  });
}

function formatKanbanList(baseUrl: string, kanbans: readonly KanbanResponse[]): string {
  return [
    `Kanbans at ${baseUrl}`,
    `Total: ${String(kanbans.length)}`,
    ...kanbanLines(kanbans),
    ""
  ].join("\n");
}

function formatKanban(baseUrl: string, kanban: KanbanResponse): string {
  return [
    `Kanban at ${baseUrl}`,
    kanbanLine(kanban),
    ...(kanban.module === undefined ? [] : [`Module: ${kanban.module}`]),
    ...(kanban.description === undefined ? [] : [`Description: ${kanban.description}`]),
    `Columns: ${String(kanban.columns?.length ?? 0)}`,
    ...(kanban.columns ?? []).map((column) => `- ${column.value ?? "(unknown)"}${column.label === undefined ? "" : ` - ${column.label}`}`),
    ""
  ].join("\n");
}

function formatKanbanRun(baseUrl: string, result: KanbanRunResponse): string {
  const board = result.board ?? {};
  const columns = result.columns ?? [];
  return [
    `Kanban run at ${baseUrl}`,
    kanbanLine(board),
    `Columns: ${String(columns.length)}`,
    ...columns.flatMap(kanbanRunColumnLines),
    ""
  ].join("\n");
}

function kanbanLines(kanbans: readonly KanbanResponse[]): readonly string[] {
  if (kanbans.length === 0) {
    return ["- (none)"];
  }
  return kanbans.map(kanbanLine);
}

function kanbanLine(kanban: KanbanResponse): string {
  const label = kanban.label === undefined ? "" : ` - ${kanban.label}`;
  return `- ${kanban.name ?? "(unknown)"} ${kanban.doctype ?? "(unknown)"}.${kanban.columnField ?? "(unknown)"} columns=${String(kanban.columns?.length ?? 0)}${label}`;
}

function kanbanRunColumnLines(column: KanbanColumnRunResponse): readonly string[] {
  const cards = column.cards ?? [];
  return [
    `- ${column.label ?? column.value ?? "(unknown)"} total=${String(column.total ?? 0)} cards=${String(cards.length)}${column.hasMore ? " more" : ""}`,
    ...cards.map((card) => `  - ${card.title ?? card.name ?? "(unknown)"} (${card.name ?? "(unknown)"})`)
  ];
}

function arrayData<T>(data: unknown, label: string): readonly T[] {
  if (Array.isArray(data)) {
    return data as readonly T[];
  }
  throw new KanbanRemoteError(`Remote ${label} response did not include a data array`);
}

function objectData<T>(data: unknown, label: string): T {
  if (isRecord(data)) {
    return data as T;
  }
  throw new KanbanRemoteError(`Remote ${label} response did not include a data object`);
}

function requiredKanban(command: KanbanRemoteCommand): string {
  if (command.kanban) {
    return command.kanban;
  }
  throw new KanbanRemoteError(`Kanban ${command.action} requires --kanban`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
