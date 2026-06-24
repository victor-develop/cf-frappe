import {
  createResourceApi,
  DashboardService,
  defineDashboard,
  ReportService,
  unsafeHeaderActorResolver
} from "../../src";
import { createServices, data, owner } from "../helpers";

describe("dashboard api", () => {
  const userHeaders = {
    "content-type": "application/json",
    "x-cf-frappe-user": "owner@example.com",
    "x-cf-frappe-roles": "User",
    "x-cf-frappe-tenant": "acme"
  };

  it("serves metadata dashboards and executed card values", async () => {
    const services = createServices(["e1", "e2"]);
    services.registry.registerDashboard(
      defineDashboard({
        name: "Operations",
        label: "Operations",
        roles: ["User"],
        cards: [
          {
            name: "open_notes",
            source: {
              kind: "documentCount",
              doctype: "Note",
              filters: [{ field: "workflow_state", value: "Open" }]
            }
          },
          {
            name: "open_count_sum",
            source: {
              kind: "documentAggregate",
              doctype: "Note",
              aggregate: "sum",
              field: "count",
              filters: [{ field: "workflow_state", value: "Open" }]
            }
          },
          {
            name: "total_count",
            source: {
              kind: "reportSummary",
              report: "Open Notes",
              summary: "total_count",
              filters: { priority: "High" }
            }
          },
          {
            name: "priority_chart",
            source: {
              kind: "reportChart",
              report: "Open Notes",
              chart: "notes_by_priority",
              filters: { priority: "High" }
            }
          }
        ]
      })
    );
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "HTTP Dashboard High", priority: "High", workflow_state: "Open", count: 5 })
    });
    await services.documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "HTTP Dashboard Low", priority: "Low", workflow_state: "Open", count: 3 })
    });
    const reports = new ReportService({ registry: services.registry, queries: services.queries });
    const dashboards = new DashboardService({ registry: services.registry, queries: services.queries, reports });
    const app = createResourceApi({
      registry: services.registry,
      documents: services.documents,
      queries: services.queries,
      reports,
      dashboards,
      actor: unsafeHeaderActorResolver
    });

    const listed = await app.request("/api/meta/dashboards", { headers: userHeaders });
    expect(listed.status).toBe(200);
    await expect(listed.json()).resolves.toMatchObject({
      data: [
        {
          name: "Operations",
          cards: [{ name: "open_notes" }, { name: "open_count_sum" }, { name: "total_count" }, { name: "priority_chart" }]
        }
      ]
    });

    const run = await app.request("/api/dashboard/Operations/run", { headers: userHeaders });
    expect(run.status).toBe(200);
    await expect(run.json()).resolves.toMatchObject({
      data: {
        dashboard: { name: "Operations" },
        cards: [
          { name: "open_notes", value: 2 },
          { name: "open_count_sum", value: 8 },
          { name: "total_count", value: 5 },
          {
            name: "priority_chart",
            value: {
              name: "notes_by_priority",
              points: [{ key: "High", label: "High", value: 1 }]
            }
          }
        ]
      }
    });
  });
});
