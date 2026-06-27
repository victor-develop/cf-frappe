import { permissionDenied } from "../core/errors.js";
import { andListFilterExpressions } from "../core/list-view.js";
import { canReadCalendar, type CalendarDefinition } from "../core/calendar.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Actor, DocumentSnapshot, JsonValue, ListFilterExpression } from "../core/types.js";
import type { QueryService } from "./query-service.js";

const DEFAULT_MAX_EVENTS = 100;
const PAGE_SIZE = 200;

export interface CalendarRunOptions {
  readonly from?: string;
  readonly to?: string;
  readonly limit?: number;
}

export interface CalendarEventResult {
  readonly name: string;
  readonly title: string;
  readonly doctype: string;
  readonly docstatus: string;
  readonly version: number;
  readonly start: string;
  readonly end?: string;
  readonly allDay?: boolean;
  readonly color?: string;
  readonly updatedAt: string;
  readonly data: Readonly<Record<string, JsonValue>>;
}

export interface CalendarRunResult {
  readonly calendar: CalendarDefinition;
  readonly from?: string;
  readonly to?: string;
  readonly total: number;
  readonly hasMore: boolean;
  readonly events: readonly CalendarEventResult[];
}

export interface CalendarServiceOptions {
  readonly registry: ModelRegistry;
  readonly queries: QueryService;
}

export class CalendarService {
  private readonly registry: ModelRegistry;
  private readonly queries: QueryService;

  constructor(options: CalendarServiceOptions) {
    this.registry = options.registry;
    this.queries = options.queries;
  }

  async listCalendars(actor: Actor): Promise<readonly CalendarDefinition[]> {
    const readable: CalendarDefinition[] = [];
    for (const calendar of this.registry.listCalendars()) {
      if (await this.canAccessCalendar(actor, calendar)) {
        readable.push(calendar);
      }
    }
    return readable;
  }

  async getCalendar(actor: Actor, calendarName: string): Promise<CalendarDefinition> {
    const calendar = this.registry.getCalendar(calendarName);
    if (!(await this.canAccessCalendar(actor, calendar))) {
      throw permissionDenied(`Actor '${actor.id}' cannot read calendar '${calendar.name}'`);
    }
    return calendar;
  }

  async runCalendar(
    actor: Actor,
    calendarName: string,
    options: CalendarRunOptions = {}
  ): Promise<CalendarRunResult> {
    const calendar = await this.getCalendar(actor, calendarName);
    const limit = calendarEventLimit(options.limit, calendar.maxEvents ?? DEFAULT_MAX_EVENTS);
    const filterExpression = calendarWindowExpression(calendar, options);
    let total = 0;
    const events: CalendarEventResult[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await this.queries.listDocuments(actor, calendar.doctype, {
        filters: calendar.filters ?? [],
        ...(filterExpression === undefined ? {} : { filterExpression }),
        orderBy: calendar.startField,
        order: "asc",
        limit: PAGE_SIZE,
        offset,
        maxLimit: PAGE_SIZE
      });
      for (const document of page.data) {
        const event = calendarEvent(calendar, document);
        if (event === undefined) {
          continue;
        }
        total += 1;
        if (events.length < limit) {
          events.push(event);
        }
      }
      if (offset + page.limit >= page.total) {
        break;
      }
    }
    return {
      calendar,
      ...(options.from === undefined ? {} : { from: options.from }),
      ...(options.to === undefined ? {} : { to: options.to }),
      total,
      hasMore: total > events.length,
      events
    };
  }

  private async canAccessCalendar(actor: Actor, calendar: CalendarDefinition): Promise<boolean> {
    if (!canReadCalendar(actor, calendar)) {
      return false;
    }
    try {
      this.queries.getMeta(actor, calendar.doctype);
      return true;
    } catch (error) {
      if (isPermissionDenied(error)) {
        return false;
      }
      throw error;
    }
  }
}

function calendarWindowExpression(
  calendar: CalendarDefinition,
  options: CalendarRunOptions
): ListFilterExpression | undefined {
  return andListFilterExpressions([
    options.to === undefined
      ? undefined
      : { field: calendar.startField, operator: "lte", value: options.to },
    calendarFromExpression(calendar, options.from)
  ]);
}

function calendarFromExpression(calendar: CalendarDefinition, from: string | undefined): ListFilterExpression | undefined {
  if (from === undefined) {
    return undefined;
  }
  if (calendar.endField === undefined) {
    return { field: calendar.startField, operator: "gte", value: from };
  }
  return {
    kind: "group",
    match: "any",
    filters: [
      { field: calendar.endField, operator: "gte", value: from },
      {
        kind: "group",
        match: "all",
        filters: [
          { field: calendar.endField, operator: "is", value: "not set" },
          { field: calendar.startField, operator: "gte", value: from }
        ]
      }
    ]
  };
}

function calendarEvent(calendar: CalendarDefinition, document: DocumentSnapshot): CalendarEventResult | undefined {
  const start = scalarString(document.data[calendar.startField]);
  if (start === undefined) {
    return undefined;
  }
  const end = calendar.endField === undefined ? undefined : scalarString(document.data[calendar.endField]);
  const allDay = calendar.allDayField === undefined ? undefined : booleanValue(document.data[calendar.allDayField]);
  const color = calendar.colorField === undefined ? undefined : scalarString(document.data[calendar.colorField]);
  return {
    name: document.name,
    title: calendarEventTitle(calendar, document),
    doctype: document.doctype,
    docstatus: document.docstatus,
    version: document.version,
    start,
    ...(end === undefined ? {} : { end }),
    ...(allDay === undefined ? {} : { allDay }),
    ...(color === undefined ? {} : { color }),
    updatedAt: document.updatedAt,
    data: document.data
  };
}

function calendarEventTitle(calendar: CalendarDefinition, document: DocumentSnapshot): string {
  if (calendar.titleField === undefined) {
    return document.name;
  }
  return scalarString(document.data[calendar.titleField]) ?? document.name;
}

function scalarString(value: JsonValue | undefined): string | undefined {
  return value === undefined || value === null || typeof value === "object" ? undefined : String(value);
}

function booleanValue(value: JsonValue | undefined): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function calendarEventLimit(requested: number | undefined, maximum: number): number {
  if (requested === undefined) {
    return maximum;
  }
  if (!Number.isInteger(requested) || requested < 1) {
    return maximum;
  }
  return Math.min(requested, maximum);
}

function isPermissionDenied(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "PERMISSION_DENIED";
}
