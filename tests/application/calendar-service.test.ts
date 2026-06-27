import {
  CalendarService,
  createRegistry,
  defineCalendar,
  defineDocType,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  QueryService
} from "../../src";
import { now, owner } from "../helpers";

const eventDocType = defineDocType({
  name: "Event",
  naming: { kind: "field", field: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "starts_on", type: "datetime" },
    { name: "ends_on", type: "datetime" },
    { name: "all_day", type: "boolean" },
    { name: "category", type: "select", options: ["Customer", "Internal"] },
    { name: "created_by", type: "text", readOnly: true, defaultValue: ({ actor }) => actor.id }
  ],
  permissions: [
    {
      roles: ["User"],
      actions: ["read", "create", "delete"],
      when: ({ actor, document }) => !document || document.data.created_by === actor.id
    }
  ]
});

describe("CalendarService", () => {
  it("runs metadata calendars through permissioned document queries", async () => {
    const registry = createRegistry({
      doctypes: [eventDocType],
      calendars: [
        defineCalendar({
          name: "Event Calendar",
          label: "Event Calendar",
          roles: ["User"],
          doctype: "Event",
          startField: "starts_on",
          endField: "ends_on",
          titleField: "title",
          allDayField: "all_day",
          colorField: "category",
          filters: [{ field: "category", value: "Customer" }],
          maxEvents: 1
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const calendars = new CalendarService({ registry, queries });

    await documents.create({
      actor: owner,
      doctype: "Event",
      data: {
        title: "Visible One",
        starts_on: "2026-01-10T09:00:00.000Z",
        ends_on: "2026-01-10T10:00:00.000Z",
        all_day: false,
        category: "Customer"
      }
    });
    await documents.create({
      actor: owner,
      doctype: "Event",
      data: {
        title: "Visible Two",
        starts_on: "2026-01-11T09:00:00.000Z",
        ends_on: "2026-01-11T10:00:00.000Z",
        all_day: true,
        category: "Customer"
      }
    });
    await documents.create({
      actor: owner,
      doctype: "Event",
      data: {
        title: "Filtered Internal",
        starts_on: "2026-01-10T09:00:00.000Z",
        category: "Internal"
      }
    });
    await documents.create({
      actor: { ...owner, id: "other@example.com" },
      doctype: "Event",
      data: {
        title: "Hidden Other",
        starts_on: "2026-01-10T09:00:00.000Z",
        category: "Customer"
      }
    });

    await expect(calendars.listCalendars(owner)).resolves.toMatchObject([{ name: "Event Calendar" }]);
    await expect(calendars.runCalendar(owner, "Event Calendar", {
      from: "2026-01-10T00:00:00.000Z",
      to: "2026-01-31T23:59:59.999Z"
    })).resolves.toMatchObject({
      calendar: { name: "Event Calendar" },
      total: 2,
      hasMore: true,
      events: [
        {
          title: "Visible One",
          start: "2026-01-10T09:00:00.000Z",
          end: "2026-01-10T10:00:00.000Z",
          allDay: false,
          color: "Customer"
        }
      ]
    });
  });

  it("keeps point events without end values in ranged calendars with an end field", async () => {
    const registry = createRegistry({
      doctypes: [eventDocType],
      calendars: [
        defineCalendar({
          name: "Event Calendar",
          roles: ["User"],
          doctype: "Event",
          startField: "starts_on",
          endField: "ends_on",
          titleField: "title"
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    const calendars = new CalendarService({ registry, queries });

    await documents.create({
      actor: owner,
      doctype: "Event",
      data: {
        title: "Open Point",
        starts_on: "2026-01-10T09:00:00.000Z"
      }
    });
    await documents.create({
      actor: owner,
      doctype: "Event",
      data: {
        title: "Past Point",
        starts_on: "2025-12-10T09:00:00.000Z"
      }
    });
    await documents.create({
      actor: owner,
      doctype: "Event",
      data: {
        title: "Spanning Event",
        starts_on: "2025-12-31T09:00:00.000Z",
        ends_on: "2026-01-02T10:00:00.000Z"
      }
    });
    await documents.create({
      actor: owner,
      doctype: "Event",
      data: {
        title: "Deleted Point",
        starts_on: "2026-01-15T09:00:00.000Z"
      }
    });
    await documents.delete({ actor: owner, doctype: "Event", name: "Deleted Point" });

    await expect(calendars.runCalendar(owner, "Event Calendar", {
      from: "2026-01-01T00:00:00.000Z",
      to: "2026-01-31T23:59:59.999Z"
    })).resolves.toMatchObject({
      total: 2,
      hasMore: false,
      events: [
        {
          title: "Spanning Event",
          start: "2025-12-31T09:00:00.000Z",
          end: "2026-01-02T10:00:00.000Z"
        },
        {
          title: "Open Point",
          start: "2026-01-10T09:00:00.000Z"
        }
      ]
    });
  });
});
