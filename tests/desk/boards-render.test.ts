import { type CalendarRunResult } from "../../src/application/calendar-service.js";
import { type KanbanCardResult, type KanbanRunResult } from "../../src/application/kanban-service.js";
import {
  renderCalendarList,
  renderCalendarView,
  renderKanbanList,
  renderKanbanView
} from "../../src/adapters/desk/views/boards.js";

function kanbanCard(overrides: Partial<KanbanCardResult> = {}): KanbanCardResult {
  return {
    name: "TASK-1",
    title: "First task",
    doctype: "Task",
    docstatus: "Draft",
    version: 3,
    updatedAt: "2026-08-01T00:00:00Z",
    data: {},
    ...overrides
  };
}

describe("Desk board views", () => {
  it("renders an empty kanban list state", () => {
    const html = renderKanbanList([]);
    expect(html).toContain("No readable kanban boards.");
  });

  it("renders kanban list rows with and without optional labels", () => {
    const html = renderKanbanList([
      { name: "tasks", doctype: "Task", columnField: "status" },
      {
        name: "bugs",
        label: "Bug Board",
        module: "QA",
        description: "Track bugs",
        doctype: "Bug",
        columnField: "state"
      }
    ]);
    expect(html).toContain(">tasks</a>");
    expect(html).toContain(">Bug Board</a>");
    expect(html).toContain("Track bugs");
    expect(html).toContain('href="/desk/kanbans/tasks"');
  });

  it("renders a kanban view with empty columns and no description", () => {
    const result: KanbanRunResult = {
      board: { name: "tasks", doctype: "Task", columnField: "status" },
      columns: []
    };
    const html = renderKanbanView(result);
    expect(html).toContain("No kanban columns.");
    expect(html).not.toContain('class="muted"');
  });

  it("renders kanban columns covering empty, overflowing, and priority-chip cards", () => {
    const result: KanbanRunResult = {
      board: { name: "tasks", description: "Board notes", doctype: "Task", columnField: "status" },
      columns: [
        { value: "open", label: "Open", total: 0, hasMore: false, cards: [] },
        {
          value: "doing",
          label: "Doing",
          total: 9,
          hasMore: true,
          cards: [
            kanbanCard({ data: { priority: "High Prio" } }),
            kanbanCard({ name: "TASK-2", data: { priority: "!!!" } }),
            kanbanCard({ name: "TASK-3", data: { priority: "" } }),
            kanbanCard({ name: "TASK-4", data: { priority: 5 } })
          ]
        }
      ]
    };
    const html = renderKanbanView(result);
    expect(html).toContain("Board notes");
    expect(html).toContain("No cards.");
    expect(html).toContain("More cards hidden by board limit.");
    expect(html).toContain("value-chip-high-prio");
    expect(html).toContain("value-chip-value");
    expect(html).toContain('href="/desk/Task/TASK-4"');
  });

  it("renders an empty calendar list state", () => {
    const html = renderCalendarList([]);
    expect(html).toContain("No readable calendars.");
  });

  it("renders calendar list rows with and without optional fields", () => {
    const html = renderCalendarList([
      { name: "events", doctype: "Event", startField: "starts_on" },
      {
        name: "reviews",
        label: "Reviews",
        module: "HR",
        description: "Review sessions",
        doctype: "Review",
        startField: "start",
        endField: "end"
      }
    ]);
    expect(html).toContain(">events</a>");
    expect(html).toContain(">Reviews</a>");
    expect(html).toContain("Review sessions");
  });

  it("renders a calendar view with no window, no events, and default heading", () => {
    const result: CalendarRunResult = {
      calendar: { name: "events", doctype: "Event", startField: "starts_on" },
      total: 0,
      hasMore: false,
      events: []
    };
    const html = renderCalendarView(result);
    expect(html).toContain("No events.");
    expect(html).toContain("<h2>events</h2>");
    expect(html).not.toContain("Window ");
  });

  it("renders half-open windows with fallback bounds", () => {
    const base = { calendar: { name: "events", doctype: "Event", startField: "starts_on" }, total: 0, hasMore: false, events: [] };
    expect(renderCalendarView({ ...base, from: "2026-01-01" })).toContain("Window 2026-01-01 to end");
    expect(renderCalendarView({ ...base, to: "2026-02-01" })).toContain("Window beginning to 2026-02-01");
  });

  it("renders calendar events covering optional end, color, and overflow notice", () => {
    const result: CalendarRunResult = {
      calendar: {
        name: "events",
        label: "Team Events",
        description: "All hands",
        doctype: "Event",
        startField: "starts_on"
      },
      from: "2026-01-01",
      to: "2026-12-31",
      total: 4,
      hasMore: true,
      events: [
        {
          name: "EV-1",
          title: "Kickoff",
          doctype: "Event",
          docstatus: "Draft",
          version: 1,
          start: "2026-01-05",
          updatedAt: "2026-01-02T00:00:00Z",
          data: {}
        },
        {
          name: "EV-2",
          title: "Retro",
          doctype: "Event",
          docstatus: "Submitted",
          version: 2,
          start: "2026-01-06",
          end: "2026-01-07",
          color: "blue",
          updatedAt: "2026-01-03T00:00:00Z",
          data: {}
        }
      ]
    };
    const html = renderCalendarView(result);
    expect(html).toContain("All hands");
    expect(html).toContain("<h2>Team Events</h2>");
    expect(html).toContain("Window 2026-01-01 to 2026-12-31");
    expect(html).toContain("2026-01-06 to 2026-01-07");
    expect(html).toContain("EV-2 - blue");
    expect(html).toContain("More events hidden by calendar limit.");
  });
});
