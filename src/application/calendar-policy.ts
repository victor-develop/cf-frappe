import { andListFilterExpressions } from "../core/list-view.js";
import { canReadCalendar } from "../core/calendar.js";
import type { CalendarDefinition } from "../core/calendar.js";
import { notFound } from "../core/errors.js";
import type { Actor, DocumentSnapshot, JsonValue, ListFilterExpression } from "../core/types.js";

export const DEFAULT_CALENDAR_MAX_EVENTS = 100;

export type CalendarReadAccessDecision =
  | { readonly status: "allow" }
  | { readonly status: "deny"; readonly message: string };

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

export function ensureCalendarServiceAvailable<T>(calendars: T | undefined): asserts calendars is T {
  if (calendars === undefined) {
    throw notFound("Calendars are not enabled", "CALENDAR_NOT_FOUND");
  }
}

export function planCalendarReadAccess(options: {
  readonly actor: Actor;
  readonly calendar: CalendarDefinition;
  readonly doctypeReadable: boolean;
}): CalendarReadAccessDecision {
  if (!canReadCalendar(options.actor, options.calendar) || !options.doctypeReadable) {
    return {
      status: "deny",
      message: `Actor '${options.actor.id}' cannot read calendar '${options.calendar.name}'`
    };
  }
  return { status: "allow" };
}

export function calendarEventLimit(requested: number | undefined, maximum: number): number {
  if (requested === undefined) {
    return maximum;
  }
  if (!Number.isInteger(requested) || requested < 1) {
    return maximum;
  }
  return Math.min(requested, maximum);
}

export function calendarFilterExpression(
  calendar: CalendarDefinition,
  options: CalendarRunOptions
): ListFilterExpression | undefined {
  return andListFilterExpressions([
    calendar.filterExpression,
    calendarWindowExpression(calendar, options)
  ]);
}

export function calendarEvent(
  calendar: CalendarDefinition,
  document: DocumentSnapshot
): CalendarEventResult | undefined {
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

export function calendarRunResult(options: {
  readonly calendar: CalendarDefinition;
  readonly run: CalendarRunOptions;
  readonly total: number;
  readonly events: readonly CalendarEventResult[];
}): CalendarRunResult {
  return {
    calendar: options.calendar,
    ...(options.run.from === undefined ? {} : { from: options.run.from }),
    ...(options.run.to === undefined ? {} : { to: options.run.to }),
    total: options.total,
    hasMore: options.total > options.events.length,
    events: options.events
  };
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
