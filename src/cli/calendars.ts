import { requestRemoteAdminPayload, type RemoteAdminIo, type RemoteHeaderOption } from "./remote-admin.js";

export type CalendarRemoteAction = "get" | "list" | "run";

export type CalendarHeaderOption = RemoteHeaderOption;

export interface CalendarRemoteCommand {
  readonly kind: "calendars";
  readonly action: CalendarRemoteAction;
  readonly url: string;
  readonly headers: readonly CalendarHeaderOption[];
  readonly calendar?: string;
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
}

export type CalendarRemoteIo = RemoteAdminIo;

export class CalendarRemoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalendarRemoteError";
  }
}

interface CalendarResponse {
  readonly name?: string;
  readonly label?: string;
  readonly module?: string;
  readonly description?: string;
  readonly doctype?: string;
  readonly startField?: string;
  readonly endField?: string;
}

interface CalendarRunResponse {
  readonly calendar?: CalendarResponse;
  readonly from?: string;
  readonly to?: string;
  readonly total?: number;
  readonly hasMore?: boolean;
  readonly events?: readonly CalendarEventResponse[];
}

interface CalendarEventResponse {
  readonly name?: string;
  readonly title?: string;
  readonly start?: string;
  readonly end?: string;
  readonly color?: string;
}

interface RemoteDataPayload {
  readonly data?: unknown;
}

export async function runRemoteCalendarCommand(
  command: CalendarRemoteCommand,
  io: CalendarRemoteIo = {}
): Promise<string> {
  if (command.action === "list") {
    const data = await requestRemoteCalendar(command, io, {
      method: "GET",
      path: "/api/meta/calendars"
    });
    return formatCalendarList(command.url, arrayData<CalendarResponse>(data.data, "calendars"));
  }
  if (command.action === "get") {
    const data = await requestRemoteCalendar(command, io, {
      method: "GET",
      path: `/api/meta/calendars/${encodeURIComponent(requiredCalendar(command))}`
    });
    return formatCalendar(command.url, objectData<CalendarResponse>(data.data, "calendar"));
  }
  const query = calendarRunQuery(command);
  const data = await requestRemoteCalendar(command, io, {
    method: "GET",
    path: `/api/calendar/${encodeURIComponent(requiredCalendar(command))}/run`,
    ...(query === undefined ? {} : { query })
  });
  return formatCalendarRun(command.url, objectData<CalendarRunResponse>(data.data, "calendar run"));
}

function requestRemoteCalendar(
  command: CalendarRemoteCommand,
  io: CalendarRemoteIo,
  request: {
    readonly method: "GET";
    readonly path: string;
    readonly query?: URLSearchParams;
  }
): Promise<RemoteDataPayload> {
  return requestRemoteAdminPayload<RemoteDataPayload, CalendarRemoteError>(command, io, request, {
    error: CalendarRemoteError,
    fetchLabel: "remote calendar commands",
    resourceLabel: "Remote calendars",
    urlLabel: "Remote calendars"
  });
}

function calendarRunQuery(command: CalendarRemoteCommand): URLSearchParams | undefined {
  const params = new URLSearchParams();
  if (command.from !== undefined) {
    params.set("from", command.from);
  }
  if (command.to !== undefined) {
    params.set("to", command.to);
  }
  if (command.limit !== undefined) {
    params.set("limit", String(command.limit));
  }
  return params.toString() ? params : undefined;
}

function formatCalendarList(baseUrl: string, calendars: readonly CalendarResponse[]): string {
  return [
    `Calendars at ${baseUrl}`,
    `Total: ${String(calendars.length)}`,
    ...calendarLines(calendars),
    ""
  ].join("\n");
}

function formatCalendar(baseUrl: string, calendar: CalendarResponse): string {
  return [
    `Calendar at ${baseUrl}`,
    calendarLine(calendar),
    ...(calendar.module === undefined ? [] : [`Module: ${calendar.module}`]),
    ...(calendar.description === undefined ? [] : [`Description: ${calendar.description}`]),
    ""
  ].join("\n");
}

function formatCalendarRun(baseUrl: string, result: CalendarRunResponse): string {
  const calendar = result.calendar ?? {};
  const events = result.events ?? [];
  return [
    `Calendar run at ${baseUrl}`,
    calendarLine(calendar),
    `Window: ${result.from ?? "(beginning)"} to ${result.to ?? "(end)"}`,
    `Total: ${String(result.total ?? events.length)} Events: ${String(events.length)}${result.hasMore ? " more" : ""}`,
    ...events.map(calendarEventLine),
    ""
  ].join("\n");
}

function calendarLines(calendars: readonly CalendarResponse[]): readonly string[] {
  if (calendars.length === 0) {
    return ["- (none)"];
  }
  return calendars.map(calendarLine);
}

function calendarLine(calendar: CalendarResponse): string {
  const label = calendar.label === undefined ? "" : ` - ${calendar.label}`;
  const end = calendar.endField === undefined ? "" : ` end=${calendar.endField}`;
  return `- ${calendar.name ?? "(unknown)"} ${calendar.doctype ?? "(unknown)"}.${calendar.startField ?? "(unknown)"}${end}${label}`;
}

function calendarEventLine(event: CalendarEventResponse): string {
  const end = event.end === undefined ? "" : ` to ${event.end}`;
  const color = event.color === undefined ? "" : ` ${event.color}`;
  return `- ${event.start ?? "(unknown)"}${end} ${event.title ?? event.name ?? "(unknown)"} (${event.name ?? "(unknown)"})${color}`;
}

function arrayData<T>(data: unknown, label: string): readonly T[] {
  if (Array.isArray(data)) {
    return data as readonly T[];
  }
  throw new CalendarRemoteError(`Remote ${label} response did not include a data array`);
}

function objectData<T>(data: unknown, label: string): T {
  if (isRecord(data)) {
    return data as T;
  }
  throw new CalendarRemoteError(`Remote ${label} response did not include a data object`);
}

function requiredCalendar(command: CalendarRemoteCommand): string {
  if (command.calendar) {
    return command.calendar;
  }
  throw new CalendarRemoteError(`Calendar ${command.action} requires --calendar`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
