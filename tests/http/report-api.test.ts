import { createResourceApi, defineReport, unsafeHeaderActorResolver } from "../../src";
import { createServices, data } from "../helpers";

describe("report api", () => {
  const userHeaders = {
    "x-cf-frappe-user": "owner@example.com",
    "x-cf-frappe-roles": "User",
    "x-cf-frappe-tenant": "acme"
  };

  function makeApp() {
    const services = createServices(["e1", "e2", "e3"]);
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      reports: services.reports,
      actor: unsafeHeaderActorResolver
    });
    return { app, services };
  }

  it("lists report metadata", async () => {
    const { app } = makeApp();

    const response = await app.request("/api/meta/reports", { headers: userHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ name: "Open Notes", doctype: "Note" }]
    });
  });

  it("runs a report with query-string filters", async () => {
    const { app, services } = makeApp();
    await services.documents.create({ actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" }, doctype: "Note", data: data({ title: "Low Note", priority: "Low", count: 2 }) });
    await services.documents.create({ actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" }, doctype: "Note", data: data({ title: "High Note", priority: "High", body: "Needs care", count: 7 }) });

    const response = await app.request("/api/report/Open%20Notes/run?filter_priority=High", { headers: userHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      rows: [{ title: "High Note", priority: "High", body: "Needs care" }],
      summary: [
        { name: "note_count", value: 1 },
        { name: "total_count", value: 7 }
      ],
      groups: [{ name: "by_priority", rows: [{ key: "High" }] }],
      charts: [{ name: "notes_by_priority", points: [{ key: "High", value: 1 }] }],
      total: 1
    });
  });

  it("returns report chart controls through the JSON API", async () => {
    const { app, services } = makeApp();
    services.registry.registerReport(
      defineReport({
        name: "Priority Leaderboard",
        doctype: "Note",
        columns: [{ name: "title" }],
        groups: [
          {
            name: "by_priority",
            field: "priority",
            summaries: [{ name: "rows", aggregate: "count" }]
          }
        ],
        charts: [
          {
            name: "priority_counts",
            type: "bar",
            group: "by_priority",
            summary: "rows",
            maxPoints: 1,
            orderBy: "value",
            order: "desc",
            colors: ["#123456"],
            showValues: false
          }
        ],
        roles: ["User"]
      })
    );
    await services.documents.create({ actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" }, doctype: "Note", data: data({ title: "Low Note", priority: "Low" }) });
    await services.documents.create({ actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" }, doctype: "Note", data: data({ title: "High Note A", priority: "High" }) });
    await services.documents.create({ actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" }, doctype: "Note", data: data({ title: "High Note B", priority: "High" }) });

    const response = await app.request("/api/report/Priority%20Leaderboard/run", { headers: userHeaders });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      charts: [
        {
          name: "priority_counts",
          orderBy: "value",
          order: "desc",
          colors: ["#123456"],
          showValues: false,
          points: [{ key: "High", value: 2 }]
        }
      ]
    });
  });

  it("exports a report as filtered CSV", async () => {
    const { app, services } = makeApp();
    await services.documents.create({ actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" }, doctype: "Note", data: data({ title: "Low Note", priority: "Low", count: 2 }) });
    await services.documents.create({ actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" }, doctype: "Note", data: data({ title: "High Note A", priority: "High", body: "Needs care", count: 7 }) });
    await services.documents.create({ actor: { id: "owner@example.com", roles: ["User"], tenantId: "acme" }, doctype: "Note", data: data({ title: "High Note B", priority: "High", body: "Later", count: 3 }) });

    const response = await app.request("/api/report/Open%20Notes/export.csv?filter_priority=High&limit=1", { headers: userHeaders });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="Open-Notes.csv"');
    expect(response.headers.get("x-cf-frappe-export-total")).toBe("2");
    expect(response.headers.get("x-cf-frappe-exported")).toBe("1");
    expect(response.headers.get("x-cf-frappe-export-limit")).toBe("1");
    expect(response.headers.get("x-cf-frappe-export-truncated")).toBe("true");
    await expect(response.text()).resolves.toBe("Title,Priority,Body\nHigh Note A,High,Needs care");
  });

  it("hides reports from actors without report roles", async () => {
    const { app } = makeApp();

    const response = await app.request("/api/meta/reports", {
      headers: { ...userHeaders, "x-cf-frappe-user": "guest", "x-cf-frappe-roles": "Guest" }
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: [] });
  });
});
