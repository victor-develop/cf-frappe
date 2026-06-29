import {
  calendarEvent,
  calendarEventLimit,
  calendarFilterExpression,
  calendarRunResult,
  defineCalendar,
  type DocumentSnapshot
} from "../../src";

const baseCalendar = defineCalendar({
  name: "Event Calendar",
  doctype: "Event",
  startField: "starts_on",
  titleField: "title"
});

describe("calendar policy", () => {
  it("bounds calendar event limits by the configured maximum", () => {
    expect(calendarEventLimit(undefined, 100)).toBe(100);
    expect(calendarEventLimit(0, 100)).toBe(100);
    expect(calendarEventLimit(1.5, 100)).toBe(100);
    expect(calendarEventLimit(20, 100)).toBe(20);
    expect(calendarEventLimit(200, 100)).toBe(100);
  });

  it("builds start-only calendar window filters", () => {
    expect(calendarFilterExpression(baseCalendar, {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-31T23:59:59.999Z"
    })).toEqual({
      kind: "group",
      match: "all",
      filters: [
        { field: "starts_on", operator: "lte", value: "2026-01-31T23:59:59.999Z" },
        { field: "starts_on", operator: "gte", value: "2026-01-01T00:00:00.000Z" }
      ]
    });
  });

  it("keeps ranged calendars visible when events overlap the requested window", () => {
    const ranged = defineCalendar({
      ...baseCalendar,
      endField: "ends_on"
    });

    expect(calendarFilterExpression(ranged, { from: "2026-01-01T00:00:00.000Z" })).toEqual({
      kind: "group",
      match: "any",
      filters: [
        { field: "ends_on", operator: "gte", value: "2026-01-01T00:00:00.000Z" },
        {
          kind: "group",
          match: "all",
          filters: [
            { field: "ends_on", operator: "is", value: "not set" },
            { field: "starts_on", operator: "gte", value: "2026-01-01T00:00:00.000Z" }
          ]
        }
      ]
    });
  });

  it("combines metadata filters with calendar window filters", () => {
    const filtered = defineCalendar({
      ...baseCalendar,
      filterExpression: {
        kind: "group",
        match: "all",
        filters: [
          { field: "category", operator: "eq", value: "Customer" },
          { field: "title", operator: "contains", value: "Visible" }
        ]
      }
    });

    expect(calendarFilterExpression(filtered, { to: "2026-01-31T23:59:59.999Z" })).toEqual({
      kind: "group",
      match: "all",
      filters: [
        { field: "category", operator: "eq", value: "Customer" },
        { field: "title", operator: "contains", value: "Visible" },
        { field: "starts_on", operator: "lte", value: "2026-01-31T23:59:59.999Z" }
      ]
    });
  });

  it("projects calendar events from scalar document fields", () => {
    const calendar = defineCalendar({
      ...baseCalendar,
      endField: "ends_on",
      allDayField: "all_day",
      colorField: "category"
    });

    expect(calendarEvent(calendar, document({
      title: "Planning",
      starts_on: "2026-01-10T09:00:00.000Z",
      ends_on: "2026-01-10T10:00:00.000Z",
      all_day: false,
      category: "Customer"
    }))).toEqual({
      name: "EVT-001",
      title: "Planning",
      doctype: "Event",
      docstatus: "draft",
      version: 1,
      start: "2026-01-10T09:00:00.000Z",
      end: "2026-01-10T10:00:00.000Z",
      allDay: false,
      color: "Customer",
      updatedAt: "2026-01-01T00:00:00.000Z",
      data: {
        title: "Planning",
        starts_on: "2026-01-10T09:00:00.000Z",
        ends_on: "2026-01-10T10:00:00.000Z",
        all_day: false,
        category: "Customer"
      }
    });
  });

  it("omits events without scalar start values and falls back to document names for non-scalar titles", () => {
    expect(calendarEvent(baseCalendar, document({ title: "Missing Start" }))).toBeUndefined();
    expect(calendarEvent(baseCalendar, document({
      title: { nested: true },
      starts_on: "2026-01-10"
    }))).toMatchObject({
      name: "EVT-001",
      title: "EVT-001",
      start: "2026-01-10"
    });
  });

  it("shapes run results with requested bounds and hasMore from collected events", () => {
    const event = calendarEvent(baseCalendar, document({
      title: "Planning",
      starts_on: "2026-01-10"
    }))!;

    expect(calendarRunResult({
      calendar: baseCalendar,
      run: { from: "2026-01-01", to: "2026-01-31" },
      total: 3,
      events: [event]
    })).toEqual({
      calendar: baseCalendar,
      from: "2026-01-01",
      to: "2026-01-31",
      total: 3,
      hasMore: true,
      events: [event]
    });
  });
});

function document(data: DocumentSnapshot["data"]): DocumentSnapshot {
  return {
    tenantId: "acme",
    doctype: "Event",
    name: "EVT-001",
    version: 1,
    docstatus: "draft",
    data,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}
