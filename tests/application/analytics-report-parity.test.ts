import {
  AnalyticsExportService,
  AnalyticsQueryService,
  DashboardService,
  DocumentHistoryService,
  DocumentService,
  InMemoryAnalyticsExportCursorStore,
  InMemoryAnalyticsStore,
  InMemoryDocumentStore,
  QueryService,
  ReportService,
  createRegistryFromApps,
  createResourceApi,
  defineDashboard,
  defineReport,
  unsafeHeaderActorResolver,
  type Actor,
  type ModelRegistry,
  type ReportRunOptions,
  type ReportRunResult
} from "../../src";
import { ReturnsFinanceQueue, ReturnsOperationsDashboard, returnsApp, returnsRegistry } from "../../examples/returns/models";
import { seedReturnsDemo, type ReturnsDemoTransport } from "../../examples/returns/seed";
import { demoPersonas } from "../../examples/returns/worker";
import { advancingClock, createServicesWithRegistry, sequentialIds, withoutAnalytics } from "./analytics-test-support.js";

/**
 * Issue #16's acceptance criterion "at least one existing report moves to the
 * analytical path and gives the same result": the ReturnsOS finance queue,
 * seeded through the real HTTP API, run once on the projection and once on the
 * exported copy, for every persona and a spread of filters, orderings and
 * pages. Everything but the `analytics` metadata must be identical.
 */
describe("analytical reports agree with their operational run", () => {
  it("declares the ReturnsOS finance queue analytical", () => {
    expect(ReturnsFinanceQueue.queryPath).toBe("analytical");
  });

  it("returns the same finance queue for every persona, filter, order and page", async () => {
    const harness = await seededReturns();
    const runs: readonly ReportRunOptions[] = [
      {},
      { filters: { refund_state: "" } },
      { filters: { refund_state: "Approved" } },
      { filters: { refund_state: "", reason: "Damaged" } },
      { filters: { refund_state: "", high_risk: true } },
      { filters: { refund_state: "Does Not Exist" } },
      { filters: { refund_state: "" }, orderBy: "requested_amount", order: "desc" },
      { filters: { refund_state: "" }, orderBy: "return_id", order: "asc", limit: 2, offset: 1 },
      { filterExpression: { kind: "group", match: "any", filters: [{ filter: "reason", value: "Damaged" }, { filter: "high_risk", value: true }] }, filters: { refund_state: "" } }
    ];
    let compared = 0;
    for (const persona of Object.values(demoPersonas)) {
      for (const options of runs) {
        const operational = await settle(() => harness.operational.reports.runReport(persona.actor, ReturnsFinanceQueue.name, options));
        const analytical = await settle(() => harness.analytical.reports.runReport(persona.actor, ReturnsFinanceQueue.name, options));
        if (operational.status === "rejected" || analytical.status === "rejected") {
          // Denied on one path means denied on both, with the same error.
          expect(analytical.status, `${persona.slug} ${JSON.stringify(options)}`).toBe(operational.status);
          expect(errorCode((analytical as PromiseRejectedResult).reason)).toBe(errorCode((operational as PromiseRejectedResult).reason));
          continue;
        }
        expect(withoutAnalytics(analytical.value), `${persona.slug} ${JSON.stringify(options)}`).toEqual(operational.value);
        expect(analytical.value.analytics).toEqual({ path: "analytical", completeThrough: harness.completeThrough });
        expect(operational.value.analytics).toBeUndefined();
        compared += 1;
      }
    }
    // The finance roles can read the report; the comparison must not pass by
    // every run being a matching denial.
    expect(compared).toBeGreaterThanOrEqual(runs.length * 2);
  });

  it("returns a non-trivial result, so agreement is not two empty reports", async () => {
    const harness = await seededReturns();
    const result = await harness.analytical.reports.runReport(demoPersonas["returns-manager"].actor, ReturnsFinanceQueue.name, {
      filters: { refund_state: "" }
    });

    expect(result.total).toBeGreaterThan(3);
    expect(result.groups[0]!.rows.length).toBeGreaterThan(1);
  });

  it("exports the same CSV on both paths", async () => {
    const harness = await seededReturns();
    const actor = demoPersonas["finance-approver"].actor;
    for (const options of [{}, { filters: { refund_state: "" } }, { filters: { refund_state: "" }, orderBy: "requested_amount", order: "desc" as const, limit: 3 }]) {
      const operational = await harness.operational.reports.exportReportCsv(actor, ReturnsFinanceQueue.name, options);
      const analytical = await harness.analytical.reports.exportReportCsv(actor, ReturnsFinanceQueue.name, options);
      expect(analytical).toEqual(operational);
    }
  });

  it("gives the same dashboard cards when the dashboard reads the copy", async () => {
    const harness = await seededReturns();
    for (const persona of Object.values(demoPersonas)) {
      const operational = await settle(() => harness.operational.dashboards.runDashboard(persona.actor, ReturnsOperationsDashboard.name));
      const analytical = await settle(() => harness.analytical.dashboards.runDashboard(persona.actor, ReturnsOperationsDashboard.name));
      expect(analytical.status).toBe(operational.status);
      if (operational.status === "fulfilled" && analytical.status === "fulfilled") {
        expect(analytical.value.cards).toEqual(operational.value.cards);
      }
    }
  });

  it("reads the copy and not the projection on the analytical path", async () => {
    const harness = await seededReturns();
    const actor = demoPersonas["returns-manager"].actor;
    harness.projectionLists.length = 0;

    await harness.analytical.reports.runReport(actor, ReturnsFinanceQueue.name, { filters: { refund_state: "" } });
    await harness.analytical.dashboards.runDashboard(actor, ReturnsOperationsDashboard.name);
    expect(harness.projectionLists).toEqual([]);

    // The control: the same calls on the operational services do list it.
    await harness.operational.reports.runReport(actor, ReturnsFinanceQueue.name, { filters: { refund_state: "" } });
    expect(harness.projectionLists).toContain("Return Request");
  });

  it("follows later edits and deletes once they are exported, and only then", async () => {
    const harness = await seededReturns();
    const admin = demoPersonas.admin.actor;
    const manager = demoPersonas["returns-manager"].actor;
    const all = await harness.seedQueries.listDocuments(admin, "Return Request", { limit: 50, orderBy: "name", order: "asc" });
    const edited = all.data.find((document) => document.data.reason !== "Other")!;
    const deleted = all.data.find((document) => document.name !== edited.name)!;
    await harness.documents.update({
      actor: admin,
      doctype: "Return Request",
      name: edited.name,
      patch: { reason: "Other" },
      expectedVersion: edited.version
    });
    await harness.documents.delete({
      actor: admin,
      doctype: "Return Request",
      name: deleted.name,
      expectedVersion: deleted.version
    });
    const options = { filters: { refund_state: "", reason: "Other" } };

    // Not exported yet: the copy still answers with the state it holds, which
    // is exactly what `completeThrough` tells the caller.
    const stale = await harness.analytical.reports.runReport(manager, ReturnsFinanceQueue.name, options);
    const live = await harness.operational.reports.runReport(manager, ReturnsFinanceQueue.name, options);
    expect(stale.total).not.toBe(live.total);

    harness.exportClock.set("2026-08-07T00:00:00.000Z");
    const second = await harness.exporter.exportTenant({ tenantId: "default" });
    expect(second.exported).toBe(2);
    expect(second.doctypes[0]!.completeThrough).toBe("2026-08-06T23:59:00.000Z");

    for (const run of [options, { filters: { refund_state: "" } }, {}]) {
      const operational = await harness.operational.reports.runReport(manager, ReturnsFinanceQueue.name, run);
      const analytical = await harness.analytical.reports.runReport(manager, ReturnsFinanceQueue.name, run);
      expect(withoutAnalytics(analytical), JSON.stringify(run)).toEqual(operational);
    }
    // Both changes landed as new versions next to the old ones, and the old
    // ones are still there: the copy is append-only.
    const rowsFor = (name: string) => harness.analyticsStore.allRows().filter((row) => row.name === name);
    expect(rowsFor(edited.name).length).toBeGreaterThan(1);
    expect(rowsFor(deleted.name).map((row) => row.docstatus)).toContain("deleted");
    expect(rowsFor(deleted.name).some((row) => row.docstatus !== "deleted")).toBe(true);
  });
});

describe("analytical reports apply row-level access exactly as a list does", () => {
  it("agrees for owner-conditional rules, shares and user permissions", async () => {
    const report = defineReport({
      name: "Shared Notes",
      doctype: "Note",
      queryPath: "analytical",
      columns: [{ name: "title" }, { name: "priority" }, { name: "count" }],
      filters: [{ name: "priority", field: "priority" }],
      summaries: [{ name: "notes", aggregate: "count" }, { name: "total", aggregate: "sum", field: "count" }],
      groups: [{ name: "by_priority", field: "priority", summaries: [{ name: "notes", aggregate: "count" }] }],
      orderBy: "title",
      roles: ["User", "Task Manager"]
    });
    const services = createServicesWithRegistry({ reports: [report] });
    const alice: Actor = { id: "alice", roles: ["User"], tenantId: "default" };
    const bob: Actor = { id: "bob", roles: ["User"], tenantId: "default" };
    const lead: Actor = { id: "lead", roles: ["Task Manager"], tenantId: "default" };
    for (const [actor, title, priority, count] of [
      [alice, "Alice low", "Low", 1],
      [alice, "Alice high", "High", 5],
      [alice, "Alice shared", "Medium", 7],
      [bob, "Bob low", "Low", 2],
      [bob, "Bob high", "High", 3]
    ] as const) {
      await services.documents.create({
        actor,
        doctype: "Note",
        data: { title, priority, count, body: "body", created_by: actor.id }
      });
    }
    const shared = (await services.queries.listDocuments(lead, "Note", { limit: 50 })).data.find(
      (document) => document.data.title === "Alice shared"
    )!;
    await services.documents.share({ actor: alice, doctype: "Note", name: shared.name, userId: "bob", permissions: ["read"] });
    await services.exportAll();

    for (const actor of [alice, bob, lead]) {
      for (const options of [{}, { filters: { priority: "High" } }, { filters: { priority: "Medium" } }] satisfies ReportRunOptions[]) {
        const operational = await services.operationalReports.runReport(actor, report.name, options);
        const analytical = await services.analyticalReports.runReport(actor, report.name, options);
        expect(withoutAnalytics(analytical), `${actor.id} ${JSON.stringify(options)}`).toEqual(operational);
      }
    }
    // Bob sees his own two and the one Alice shared — the share is honoured.
    const bobs = await services.analyticalReports.runReport(bob, report.name);
    expect(bobs.rows.map((row) => row.title)).toEqual(["Alice shared", "Bob high", "Bob low"]);
  });
});

async function seededReturns() {
  const store = new InMemoryDocumentStore();
  const projectionLists: string[] = [];
  const countingProjections = new Proxy(store, {
    get(target, property, receiver) {
      if (property === "list") {
        return async (query: { readonly doctype: string }) => {
          projectionLists.push(query.doctype);
          return target.list(query as never);
        };
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    }
  });
  const documents = new DocumentService({
    registry: returnsRegistry,
    store,
    clock: advancingClock("2026-08-05T12:00:00.000Z"),
    ids: sequentialIds()
  });
  const seedQueries = new QueryService({ registry: returnsRegistry, projections: store });
  const app = createResourceApi({
    registry: returnsRegistry,
    documents,
    queries: seedQueries,
    timeline: new DocumentHistoryService({ events: store, queries: seedQueries }),
    actor: unsafeHeaderActorResolver
  });
  const transport = (actor: Actor): ReturnsDemoTransport => ({
    async request(path, init = {}) {
      const headers = new Headers(init.headers);
      headers.set("x-cf-frappe-user", actor.id);
      headers.set("x-cf-frappe-roles", actor.roles.join(","));
      headers.set("x-cf-frappe-tenant", actor.tenantId ?? "default");
      return await app.request(path, { ...init, headers });
    }
  });
  await seedReturnsDemo(transport(demoPersonas.admin.actor));

  // The same registry with the dashboard reading the copy, so its document
  // cards take the analytical path too.
  const registry = createRegistryFromApps([
    {
      ...returnsApp,
      dashboards: [defineDashboard({ ...ReturnsOperationsDashboard, queryPath: "analytical" })]
    }
  ]);
  const analyticsStore = new InMemoryAnalyticsStore();
  const cursors = new InMemoryAnalyticsExportCursorStore();
  const exportClock = settableClock("2026-08-06T00:00:00.000Z");
  const exporter = new AnalyticsExportService({ registry, feed: store, sink: analyticsStore, cursors, clock: exportClock, batchSize: 3 });
  const run = await exporter.exportTenant({ tenantId: "default" });
  expect(run.failed).toBe(0);
  expect(run.doctypes.map((item) => item.doctype)).toEqual(["Return Request"]);

  const queries = new QueryService({ registry, projections: countingProjections });
  const operational = services(registry, queries);
  const analytical = services(
    registry,
    queries,
    new AnalyticsQueryService({ reader: analyticsStore, queries, cursors, pageSize: 4 })
  );
  return {
    operational,
    analytical,
    analyticsStore,
    projectionLists,
    documents,
    exporter,
    exportClock,
    seedQueries,
    completeThrough: run.doctypes[0]!.completeThrough
  };
}

function services(registry: ModelRegistry, queries: QueryService, analytics?: AnalyticsQueryService) {
  const reports = new ReportService({ registry, queries, ...(analytics === undefined ? {} : { analytics }) });
  const dashboards = new DashboardService({ registry, queries, reports, ...(analytics === undefined ? {} : { analytics }) });
  return { reports, dashboards };
}

function settableClock(start: string) {
  let current = start;
  return {
    now: () => current,
    set(value: string) {
      current = value;
    }
  };
}

async function settle<T>(run: () => Promise<T>): Promise<PromiseSettledResult<T>> {
  return (await Promise.allSettled([run()]))[0]!;
}

function errorCode(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : error;
}
