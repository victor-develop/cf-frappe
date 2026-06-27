import { createRegistry, defineCalendar, defineDocType, defineWorkspace } from "../../src";

describe("calendar metadata", () => {
  it("freezes metadata-defined calendars", () => {
    const statuses = ["Open", "Done"] as const;
    const calendar = defineCalendar({
      name: "Task Calendar",
      label: "Task Calendar",
      roles: ["User"],
      doctype: "Task",
      startField: "starts_on",
      endField: "ends_on",
      titleField: "title",
      filters: [{ field: "status", operator: "in", value: statuses }],
      filterExpression: {
        kind: "group",
        match: "any",
        filters: [
          { field: "status", value: "Open" },
          { field: "status", operator: "in", value: statuses }
        ]
      },
      maxEvents: 25
    });

    expect(Object.isFrozen(calendar)).toBe(true);
    expect(Object.isFrozen(calendar.roles ?? [])).toBe(true);
    expect(Object.isFrozen(calendar.filters ?? [])).toBe(true);
    expect(Object.isFrozen(calendar.filters?.[0]?.value)).toBe(true);
    expect(Object.isFrozen(calendar.filterExpression)).toBe(true);
    expect(Object.isFrozen((calendar.filterExpression as { readonly filters: readonly unknown[] }).filters)).toBe(true);
    expect(Object.isFrozen((calendar.filterExpression as { readonly filters: readonly { readonly value?: unknown }[] }).filters[1]?.value)).toBe(true);
    (statuses as unknown as string[]).push("Private");
    expect(calendar.filters?.[0]?.value).toEqual(["Open", "Done"]);
    expect((calendar.filterExpression as { readonly filters: readonly { readonly value?: unknown }[] }).filters[1]?.value).toEqual([
      "Open",
      "Done"
    ]);
  });

  it("validates calendars against registered DocType metadata", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "title", type: "text" },
        { name: "starts_on", type: "datetime" },
        { name: "ends_on", type: "datetime" },
        { name: "all_day", type: "boolean" },
        { name: "status", type: "select", options: ["Open", "Done"] },
        { name: "payload", type: "json" }
      ]
    });
    const calendar = defineCalendar({
      name: "Task Calendar",
      doctype: "Task",
      startField: "starts_on",
      endField: "ends_on",
      allDayField: "all_day",
      colorField: "status",
      filters: [{ field: "status", value: "Open" }]
    });

    const registry = createRegistry({ doctypes: [Task], calendars: [calendar] });

    expect(registry.getCalendar("Task Calendar")).toEqual(calendar);
    expect(registry.listCalendars().map((item) => item.name)).toEqual(["Task Calendar"]);
    expect(() => createRegistry({ doctypes: [Task], calendars: [calendar, calendar] })).toThrow("already registered");
    expect(() =>
      createRegistry({
        doctypes: [Task],
        calendars: [defineCalendar({ name: "Broken", doctype: "Missing", startField: "starts_on" })]
      })
    ).toThrow("references unknown DocType");
    expect(() =>
      createRegistry({
        doctypes: [Task],
        calendars: [defineCalendar({ name: "Broken", doctype: "Task", startField: "payload" })]
      })
    ).toThrow("must be a date or datetime field");
    expect(() =>
      createRegistry({
        doctypes: [Task],
        calendars: [defineCalendar({ name: "Broken", doctype: "Task", startField: "starts_on", allDayField: "status" })]
      })
    ).toThrow("must be a boolean field");
    expect(() =>
      defineCalendar({
        name: "Broken",
        doctype: "Task",
        startField: "starts_on",
        filterExpression: "not-an-expression" as never
      })
    ).toThrow("filter expression must be an object");
    expect(() =>
      defineCalendar({
        name: "Broken",
        doctype: "Task",
        startField: "starts_on",
        filterExpression: deepCalendarFilterExpression(7) as never
      })
    ).toThrow("List filter expression cannot exceed 5 levels");
    expect(() =>
      defineCalendar({
        name: "Broken",
        doctype: "Task",
        startField: "starts_on",
        filterExpression: wideCalendarFilterExpression(65) as never
      })
    ).toThrow("List filter expression cannot exceed 5 levels or 64 nodes");
    expect(() =>
      createRegistry({
        doctypes: [Task],
        calendars: [
          defineCalendar({
            name: "Broken",
            doctype: "Task",
            startField: "starts_on",
            filterExpression: { field: "payload", value: "x" }
          })
        ]
      })
    ).toThrow("Filter field 'payload' cannot be a json field");
  });

  it("allows workspaces to reference registered calendars", () => {
    const Task = defineDocType({
      name: "Task",
      fields: [
        { name: "title", type: "text" },
        { name: "starts_on", type: "date" }
      ]
    });
    const calendar = defineCalendar({ name: "Task Calendar", doctype: "Task", startField: "starts_on" });
    const workspace = defineWorkspace({
      name: "Operations",
      sections: [{ name: "main", shortcuts: [{ name: "task-calendar", kind: "calendar", target: "Task Calendar" }] }]
    });

    expect(createRegistry({ doctypes: [Task], calendars: [calendar], workspaces: [workspace] }).getWorkspace("Operations"))
      .toEqual(workspace);
    expect(() => createRegistry({ doctypes: [Task], workspaces: [workspace] })).toThrow("references unknown calendar");
  });
});

function deepCalendarFilterExpression(depth: number): unknown {
  return depth <= 1
    ? { field: "status", value: "Open" }
    : { kind: "group", match: "all", filters: [deepCalendarFilterExpression(depth - 1)] };
}

function wideCalendarFilterExpression(nodes: number): unknown {
  return {
    kind: "group",
    match: "all",
    filters: Array.from({ length: nodes }, () => ({ field: "status", value: "Open" }))
  };
}
