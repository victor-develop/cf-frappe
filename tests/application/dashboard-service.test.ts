import {
  DashboardService,
  createRegistry,
  defineDashboard,
  defineDocType,
  defineReport,
  DocumentService,
  fixedClock,
  InMemoryDocumentStore,
  QueryService,
  ReportService
} from "../../src";
import { data, noteDocType, now, openNotesReport, owner } from "../helpers";

describe("DashboardService", () => {
  it("runs metadata cards through query and report services", async () => {
    const registry = createRegistry({
      doctypes: [noteDocType],
      reports: [openNotesReport],
      dashboards: [
        defineDashboard({
          name: "Operations",
          label: "Operations",
          roles: ["User"],
          cards: [
            {
              name: "open_notes",
              label: "Open Notes",
              source: {
                kind: "documentCount",
                doctype: "Note",
                filters: [{ field: "workflow_state", value: "Open" }]
              }
            },
            {
              name: "total_count",
              label: "Total Count",
              source: {
                kind: "reportSummary",
                report: "Open Notes",
                summary: "total_count",
                filters: { priority: "High" }
              }
            }
          ]
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const documents = new DocumentService({
      registry,
      store,
      clock: fixedClock(now)
    });
    const queries = new QueryService({ registry, projections: store });
    const reports = new ReportService({ registry, queries });
    const dashboards = new DashboardService({ registry, queries, reports });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Visible High", priority: "High", workflow_state: "Open", count: 7 })
    });
    await documents.create({
      actor: { ...owner, id: "other@example.com" },
      doctype: "Note",
      data: data({ title: "Hidden High", priority: "High", workflow_state: "Open", count: 99 })
    });
    await documents.create({
      actor: owner,
      doctype: "Note",
      data: data({ title: "Visible Closed", priority: "High", workflow_state: "Closed", count: 3 })
    });

    await expect(dashboards.listDashboards(owner)).resolves.toMatchObject([{ name: "Operations" }]);
    await expect(dashboards.runDashboard(owner, "Operations")).resolves.toMatchObject({
      dashboard: { name: "Operations" },
      cards: [
        {
          name: "open_notes",
          label: "Open Notes",
          value: 1,
          source: { kind: "documentCount", doctype: "Note" }
        },
        {
          name: "total_count",
          label: "Total Count",
          value: 10,
          source: { kind: "reportSummary", report: "Open Notes", summary: "total_count" }
        }
      ]
    });
  });

  it("rejects dashboards hidden by dashboard roles", async () => {
    const registry = createRegistry({
      doctypes: [noteDocType],
      dashboards: [
        defineDashboard({
          name: "Managers",
          roles: ["Task Manager"],
          cards: [{ name: "notes", source: { kind: "documentCount", doctype: "Note" } }]
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const queries = new QueryService({ registry, projections: store });
    const reports = new ReportService({ registry, queries });
    const dashboards = new DashboardService({ registry, queries, reports });

    await expect(dashboards.listDashboards(owner)).resolves.toEqual([]);
    await expect(dashboards.runDashboard(owner, "Managers")).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
  });

  it("hides dashboards when card targets are not readable", async () => {
    const Secret = defineDocType({
      name: "Secret",
      fields: [{ name: "title", type: "text" }],
      permissions: [{ roles: ["Task Manager"], actions: ["read"] }]
    });
    const managerReport = defineReport({
      name: "Manager Notes",
      doctype: "Note",
      columns: [{ name: "title" }],
      summaries: [{ name: "note_count", aggregate: "count" }],
      roles: ["Task Manager"]
    });
    const registry = createRegistry({
      doctypes: [noteDocType, Secret],
      reports: [openNotesReport, managerReport],
      dashboards: [
        defineDashboard({
          name: "Visible",
          roles: ["User"],
          cards: [{ name: "notes", source: { kind: "documentCount", doctype: "Note" } }]
        }),
        defineDashboard({
          name: "Secret Documents",
          roles: ["User"],
          cards: [{ name: "secrets", source: { kind: "documentCount", doctype: "Secret" } }]
        }),
        defineDashboard({
          name: "Manager Report",
          roles: ["User"],
          cards: [{ name: "notes", source: { kind: "reportSummary", report: "Manager Notes", summary: "note_count" } }]
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const queries = new QueryService({ registry, projections: store });
    const reports = new ReportService({ registry, queries });
    const dashboards = new DashboardService({ registry, queries, reports });

    await expect(dashboards.listDashboards(owner)).resolves.toMatchObject([{ name: "Visible" }]);
    await expect(dashboards.getDashboard(owner, "Secret Documents")).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
    await expect(dashboards.runDashboard(owner, "Manager Report")).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
  });
});
