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
              name: "visible_high_notes",
              label: "Visible High Notes",
              source: {
                kind: "documentAggregate",
                doctype: "Note",
                aggregate: "count",
                filters: [{ field: "priority", value: "High" }]
              }
            },
            {
              name: "open_count_sum",
              label: "Open Count Sum",
              source: {
                kind: "documentAggregate",
                doctype: "Note",
                aggregate: "sum",
                field: "count",
                filters: [{ field: "workflow_state", value: "Open" }]
              }
            },
            {
              name: "high_count_avg",
              label: "High Count Avg",
              source: {
                kind: "documentAggregate",
                doctype: "Note",
                aggregate: "avg",
                field: "count",
                filters: [{ field: "priority", value: "High" }]
              }
            },
            {
              name: "high_count_min",
              label: "High Count Min",
              source: {
                kind: "documentAggregate",
                doctype: "Note",
                aggregate: "min",
                field: "count",
                filters: [{ field: "priority", value: "High" }]
              }
            },
            {
              name: "high_count_max",
              label: "High Count Max",
              source: {
                kind: "documentAggregate",
                doctype: "Note",
                aggregate: "max",
                field: "count",
                filters: [{ field: "priority", value: "High" }]
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
            },
            {
              name: "priority_chart",
              label: "Priority Chart",
              source: {
                kind: "reportChart",
                report: "Open Notes",
                chart: "notes_by_priority",
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
          name: "visible_high_notes",
          label: "Visible High Notes",
          value: 2,
          source: { kind: "documentAggregate", doctype: "Note", aggregate: "count" }
        },
        {
          name: "open_count_sum",
          label: "Open Count Sum",
          value: 7,
          source: { kind: "documentAggregate", doctype: "Note", aggregate: "sum", field: "count" }
        },
        {
          name: "high_count_avg",
          label: "High Count Avg",
          value: 5,
          source: { kind: "documentAggregate", doctype: "Note", aggregate: "avg", field: "count" }
        },
        {
          name: "high_count_min",
          label: "High Count Min",
          value: 3,
          source: { kind: "documentAggregate", doctype: "Note", aggregate: "min", field: "count" }
        },
        {
          name: "high_count_max",
          label: "High Count Max",
          value: 7,
          source: { kind: "documentAggregate", doctype: "Note", aggregate: "max", field: "count" }
        },
        {
          name: "total_count",
          label: "Total Count",
          value: 10,
          source: { kind: "reportSummary", report: "Open Notes", summary: "total_count" }
        },
        {
          name: "priority_chart",
          label: "Priority Chart",
          value: {
            name: "notes_by_priority",
            points: [{ key: "High", label: "High", value: 2 }]
          },
          source: { kind: "reportChart", report: "Open Notes", chart: "notes_by_priority" }
        }
      ]
    });
  });

  it("returns deterministic empty values for document aggregate cards", async () => {
    const registry = createRegistry({
      doctypes: [noteDocType],
      dashboards: [
        defineDashboard({
          name: "Empty Aggregates",
          roles: ["User"],
          cards: [
            {
              name: "sum",
              source: { kind: "documentAggregate", doctype: "Note", aggregate: "sum", field: "count" }
            },
            {
              name: "avg",
              source: { kind: "documentAggregate", doctype: "Note", aggregate: "avg", field: "count" }
            },
            {
              name: "min",
              source: { kind: "documentAggregate", doctype: "Note", aggregate: "min", field: "count" }
            },
            {
              name: "max",
              source: { kind: "documentAggregate", doctype: "Note", aggregate: "max", field: "count" }
            }
          ]
        })
      ]
    });
    const store = new InMemoryDocumentStore();
    const queries = new QueryService({ registry, projections: store });
    const reports = new ReportService({ registry, queries });
    const dashboards = new DashboardService({ registry, queries, reports });

    await expect(dashboards.runDashboard(owner, "Empty Aggregates")).resolves.toMatchObject({
      cards: [
        { name: "sum", value: 0 },
        { name: "avg", value: null },
        { name: "min", value: null },
        { name: "max", value: null }
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
      groups: [{ name: "by_title", field: "title", summaries: [{ name: "note_count", aggregate: "count" }] }],
      charts: [{ name: "notes_by_title", type: "bar", group: "by_title", summary: "note_count" }],
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
          name: "Secret Aggregate",
          roles: ["User"],
          cards: [{ name: "secrets", source: { kind: "documentAggregate", doctype: "Secret", aggregate: "count" } }]
        }),
        defineDashboard({
          name: "Manager Report",
          roles: ["User"],
          cards: [{ name: "notes", source: { kind: "reportSummary", report: "Manager Notes", summary: "note_count" } }]
        }),
        defineDashboard({
          name: "Manager Chart",
          roles: ["User"],
          cards: [{ name: "notes", source: { kind: "reportChart", report: "Manager Notes", chart: "notes_by_title" } }]
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
    await expect(dashboards.runDashboard(owner, "Secret Aggregate")).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
    await expect(dashboards.runDashboard(owner, "Manager Report")).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
    await expect(dashboards.runDashboard(owner, "Manager Chart")).rejects.toMatchObject({
      code: "PERMISSION_DENIED"
    });
  });
});
