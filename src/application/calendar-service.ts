import { permissionDenied } from "../core/errors.js";
import type { CalendarDefinition } from "../core/calendar.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Actor } from "../core/types.js";
import type { QueryService } from "./query-service.js";
import { isPermissionDeniedError } from "./access-policy.js";
import {
  calendarEvent,
  calendarEventLimit,
  calendarFilterExpression,
  calendarRunResult,
  DEFAULT_CALENDAR_MAX_EVENTS,
  type CalendarEventResult,
  type CalendarReadAccessDecision,
  type CalendarRunOptions,
  type CalendarRunResult,
  planCalendarReadAccess
} from "./calendar-policy.js";

const PAGE_SIZE = 200;

export type { CalendarEventResult, CalendarRunOptions, CalendarRunResult } from "./calendar-policy.js";

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
      if ((await this.calendarReadAccess(actor, calendar)).status === "allow") {
        readable.push(calendar);
      }
    }
    return readable;
  }

  async getCalendar(actor: Actor, calendarName: string): Promise<CalendarDefinition> {
    const calendar = this.registry.getCalendar(calendarName);
    const decision = await this.calendarReadAccess(actor, calendar);
    if (decision.status === "deny") {
      throw permissionDenied(decision.message);
    }
    return calendar;
  }

  async runCalendar(
    actor: Actor,
    calendarName: string,
    options: CalendarRunOptions = {}
  ): Promise<CalendarRunResult> {
    const calendar = await this.getCalendar(actor, calendarName);
    const limit = calendarEventLimit(options.limit, calendar.maxEvents ?? DEFAULT_CALENDAR_MAX_EVENTS);
    const filterExpression = calendarFilterExpression(calendar, options);
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
    return calendarRunResult({
      calendar,
      run: options,
      total,
      events
    });
  }

  private async calendarReadAccess(actor: Actor, calendar: CalendarDefinition): Promise<CalendarReadAccessDecision> {
    try {
      this.queries.getMeta(actor, calendar.doctype);
      return planCalendarReadAccess({ actor, calendar, doctypeReadable: true });
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        return planCalendarReadAccess({ actor, calendar, doctypeReadable: false });
      }
      throw error;
    }
  }
}
