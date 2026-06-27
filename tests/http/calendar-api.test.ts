import {
  CalendarService,
  createRegistry,
  createResourceApi,
  defineCalendar,
  defineDocType,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  QueryService,
  unsafeHeaderActorResolver
} from "../../src";
import { now, owner } from "../helpers";

const eventDocType = defineDocType({
  name: "Event",
  naming: { kind: "field", field: "title" },
  fields: [
    { name: "title", type: "text", required: true },
    { name: "starts_on", type: "date" },
    { name: "category", type: "select", options: ["Customer", "Internal"] },
    { name: "created_by", type: "text", readOnly: true, defaultValue: ({ actor }) => actor.id }
  ],
  permissions: [
    {
      roles: ["User"],
      actions: ["read", "create"],
      when: ({ actor, document }) => !document || document.data.created_by === actor.id
    }
  ]
});

describe("calendar api", () => {
  const userHeaders = {
    "content-type": "application/json",
    "x-cf-frappe-user": "owner@example.com",
    "x-cf-frappe-roles": "User",
    "x-cf-frappe-tenant": "acme"
  };

  it("serves metadata calendars and executed events", async () => {
    const registry = createRegistry({
      doctypes: [eventDocType],
      calendars: [
        defineCalendar({
          name: "Event Calendar",
          label: "Event Calendar",
          roles: ["User"],
          doctype: "Event",
          startField: "starts_on",
          titleField: "title",
          colorField: "category"
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({ registry, store, clock: fixedClock(now) });
    const queries = new QueryService({ registry, projections: store });
    await documents.create({
      actor: owner,
      doctype: "Event",
      data: { title: "HTTP Event", starts_on: "2026-01-10", category: "Customer" }
    });
    const calendars = new CalendarService({ registry, queries });
    const app = createResourceApi({
      registry,
      documents,
      queries,
      calendars,
      actor: unsafeHeaderActorResolver
    });

    const listed = await app.request("/api/meta/calendars", { headers: userHeaders });
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      data: [{ name: "Event Calendar", doctype: "Event", startField: "starts_on" }]
    });

    const single = await app.request("/api/meta/calendars/Event%20Calendar", { headers: userHeaders });
    expect(single.status).toBe(200);
    await expect(single.json()).resolves.toMatchObject({ data: { name: "Event Calendar" } });

    const run = await app.request("/api/calendar/Event%20Calendar/run?from=2026-01-01&to=2026-01-31&limit=5", {
      headers: userHeaders
    });
    expect(run.status).toBe(200);
    await expect(run.json()).resolves.toMatchObject({
      data: {
        calendar: { name: "Event Calendar" },
        from: "2026-01-01",
        to: "2026-01-31",
        total: 1,
        events: [{ title: "HTTP Event", start: "2026-01-10", color: "Customer" }]
      }
    });
  });
});
