import {
  AnalyticsQueryService,
  DashboardService,
  ReportService,
  defineDashboard,
  defineReport,
  type Actor,
  type AnalyticsDocumentReader
} from "../../src";
import { createServicesWithRegistry, withoutAnalytics } from "./analytics-test-support.js";

const lead: Actor = { id: "lead", roles: ["Task Manager"], tenantId: "default" };
const guestActor: Actor = { id: "guest", roles: ["Guest"], tenantId: "default" };

const analyticalReport = defineReport({
  name: "Note Totals",
  doctype: "Note",
  queryPath: "analytical",
  columns: [{ name: "title" }, { name: "priority" }],
  filters: [{ name: "priority", field: "priority" }],
  summaries: [{ name: "notes", aggregate: "count" }],
  roles: ["Task Manager"]
});
const operationalReport = defineReport({
  name: "Note Rows",
  doctype: "Note",
  columns: [{ name: "title" }],
  summaries: [{ name: "notes", aggregate: "count" }],
  roles: ["Task Manager"]
});

async function seeded() {
  const services = createServicesWithRegistry({ reports: [analyticalReport, operationalReport] });
  for (const [title, priority] of [["One", "Low"], ["Two", "High"], ["Three", "High"]] as const) {
    await services.documents.create({ actor: lead, doctype: "Note", data: { title, priority, body: "b", created_by: lead.id } });
  }
  return services;
}

const brokenReader: AnalyticsDocumentReader = {
  async scan() {
    throw new Error("R2 SQL returned HTTP 502");
  }
};

describe("an analytics outage stays on the analytical path", () => {
  it("fails an analytical report with ANALYTICS_UNAVAILABLE and leaves operational queries working", async () => {
    const services = await seeded();
    await services.exportAll();
    const reports = new ReportService({
      registry: services.registry,
      queries: services.queries,
      analytics: new AnalyticsQueryService({ reader: brokenReader, queries: services.queries, cursors: services.cursors })
    });

    await expect(reports.runReport(lead, analyticalReport.name)).rejects.toMatchObject({
      code: "ANALYTICS_UNAVAILABLE",
      status: 503,
      message: "Analytics query for Note failed: R2 SQL returned HTTP 502"
    });
    await expect(reports.exportReportCsv(lead, analyticalReport.name)).rejects.toMatchObject({ code: "ANALYTICS_UNAVAILABLE" });

    // The same service, the same moment: the operational report, the list and
    // the form read keep answering from the projection.
    await expect(reports.runReport(lead, operationalReport.name)).resolves.toMatchObject({ total: 3 });
    await expect(services.queries.listDocuments(lead, "Note")).resolves.toMatchObject({ total: 3 });
  });

  it("falls back to the projection only when the deployment asked for it", async () => {
    const services = await seeded();
    await services.exportAll();
    const fallback = new ReportService({
      registry: services.registry,
      queries: services.queries,
      analytics: new AnalyticsQueryService({
        reader: brokenReader,
        queries: services.queries,
        cursors: services.cursors,
        onUnavailable: "operational"
      })
    });

    const result = await fallback.runReport(lead, analyticalReport.name);

    expect(result.analytics).toBeUndefined();
    expect(result).toEqual(await services.operationalReports.runReport(lead, analyticalReport.name));
  });

  it("refuses a DocType whose first export has not finished instead of reporting zero", async () => {
    const services = await seeded();

    await expect(services.analyticalReports.runReport(lead, analyticalReport.name)).rejects.toMatchObject({
      code: "ANALYTICS_UNAVAILABLE",
      message: "Analytics copy of Note has not finished its first export"
    });

    await services.exportAll();
    await expect(services.analyticalReports.runReport(lead, analyticalReport.name)).resolves.toMatchObject({ total: 3 });
  });

  it("treats a failing freshness lookup as an outage, not as a fresh copy", async () => {
    const services = await seeded();
    await services.exportAll();
    const reports = new ReportService({
      registry: services.registry,
      queries: services.queries,
      analytics: new AnalyticsQueryService({
        reader: services.analyticsStore,
        queries: services.queries,
        cursors: { ...services.cursors, get: async () => { throw new Error("D1 overloaded"); } } as never
      })
    });

    await expect(reports.runReport(lead, analyticalReport.name)).rejects.toMatchObject({
      code: "ANALYTICS_UNAVAILABLE",
      message: "Analytics freshness for Note could not be read: D1 overloaded"
    });
  });

  it("denies an actor who cannot read the DocType before touching the analytics store", async () => {
    const services = await seeded();
    await services.exportAll();
    let scanned = 0;
    const analytics = new AnalyticsQueryService({
      reader: { scan: async (query) => { scanned += 1; return services.analyticsStore.scan(query); } },
      queries: services.queries,
      cursors: services.cursors
    });
    const outsider: Actor = { id: "outsider", roles: ["Nobody"], tenantId: "default" };

    await expect(analytics.readableDocuments(outsider, "Note")).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
    expect(scanned).toBe(0);
    // The control: an actor who may read it gets through to the store.
    expect((await analytics.readableDocuments(guestActor, "Note")).documents).toHaveLength(3);
    expect(scanned).toBe(1);
  });

  it("fails an analytical dashboard card the same way, and leaves operational cards alone", async () => {
    const services = await seeded();
    await services.exportAll();
    const cards = [{ name: "notes", source: { kind: "documentCount" as const, doctype: "Note" } }];
    const { createRegistry } = await import("../../src");
    const { noteDocType } = await import("../helpers");
    const registry = createRegistry({
      doctypes: [noteDocType],
      reports: [analyticalReport, operationalReport],
      dashboards: [
        defineDashboard({ name: "Analytical", queryPath: "analytical", cards }),
        defineDashboard({ name: "Operational", cards })
      ]
    });
    const reports = new ReportService({ registry, queries: services.queries });
    const dashboards = new DashboardService({
      registry,
      queries: services.queries,
      reports,
      analytics: new AnalyticsQueryService({ reader: brokenReader, queries: services.queries, cursors: services.cursors })
    });

    await expect(dashboards.runDashboard(lead, "Analytical")).rejects.toMatchObject({ code: "ANALYTICS_UNAVAILABLE" });
    await expect(dashboards.runDashboard(lead, "Operational")).resolves.toMatchObject({ cards: [{ value: 3 }] });
  });
});

describe("a misbehaving reader", () => {
  it("fails instead of looping when a reader never advances its cursor", async () => {
    const services = await seeded();
    await services.exportAll();
    const analytics = new AnalyticsQueryService({
      reader: {
        scan: async (query) => ({ ...(await services.analyticsStore.scan({ ...query, cursor: undefined as never })), nextCursor: "stuck" })
      },
      queries: services.queries,
      cursors: services.cursors
    });

    await expect(analytics.readableDocuments(lead, "Note")).rejects.toMatchObject({
      code: "ANALYTICS_UNAVAILABLE",
      message: "Analytics query for Note did not advance past cursor 'stuck'"
    });
  });
});

describe("the analytical path is off unless configured", () => {
  it("runs a report that declares analytical on the projection when no analytics store is wired", async () => {
    const services = await seeded();

    const result = await services.operationalReports.runReport(lead, analyticalReport.name);

    expect(result.total).toBe(3);
    expect(result.analytics).toBeUndefined();
    expect(Object.keys(result)).not.toContain("analytics");
  });

  it("keeps a report that does not declare analytical on the projection even when a store is wired", async () => {
    const services = await seeded();
    await services.exportAll();
    let scanned = 0;
    const reports = new ReportService({
      registry: services.registry,
      queries: services.queries,
      analytics: new AnalyticsQueryService({
        reader: { scan: async (query) => { scanned += 1; return services.analyticsStore.scan(query); } },
        queries: services.queries,
        cursors: services.cursors
      })
    });

    const result = await reports.runReport(lead, operationalReport.name);

    expect(scanned).toBe(0);
    expect(result.analytics).toBeUndefined();
  });

  it("pushes a string equality filter down, and still re-applies the exact filter", async () => {
    const services = await seeded();
    await services.exportAll();
    const seen: unknown[] = [];
    const reports = new ReportService({
      registry: services.registry,
      queries: services.queries,
      analytics: new AnalyticsQueryService({
        // A reader that ignores the pre-filter entirely: the result must not change.
        reader: { scan: async (query) => { seen.push(query.prefilters); return services.analyticsStore.scan({ ...query, prefilters: [] }); } },
        queries: services.queries,
        cursors: services.cursors
      })
    });

    const result = await reports.runReport(lead, analyticalReport.name, { filters: { priority: "High" } });

    expect(seen).toEqual([[{ field: "priority", value: "High" }]]);
    expect(withoutAnalytics(result)).toEqual(
      await services.operationalReports.runReport(lead, analyticalReport.name, { filters: { priority: "High" } })
    );
    expect(result.total).toBe(2);
  });
});
