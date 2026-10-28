import {
  AnalyticsExportService,
  AnalyticsQueryService,
  DocumentService,
  DocumentShareService,
  InMemoryAnalyticsExportCursorStore,
  InMemoryAnalyticsStore,
  InMemoryDocumentStore,
  ModelBackedUserPermissionGrantValidator,
  QueryService,
  ReportService,
  UserPermissionService,
  createRegistry,
  fixedClock,
  type Clock,
  type IdGenerator,
  type ReportDefinition,
  type ReportRunResult
} from "../../src";
import { noteDocType } from "../helpers";

/** One second later on every call, so `updatedAt` never ties and list order is total on both paths. */
export function advancingClock(start: string): Clock {
  let current = Date.parse(start);
  return {
    now() {
      const value = new Date(current).toISOString();
      current += 1000;
      return value;
    }
  };
}

export function sequentialIds(): IdGenerator {
  let value = 0;
  return {
    next(prefix = "") {
      value += 1;
      return `${prefix}${String(value).padStart(6, "0")}`;
    }
  };
}

export function withoutAnalytics(result: ReportRunResult): ReportRunResult {
  const { analytics: _analytics, ...rest } = result;
  return rest;
}

/** Note DocType services with an operational and an analytical report service over the same data. */
export function createServicesWithRegistry(options: { readonly reports: readonly ReportDefinition[] }) {
  const registry = createRegistry({ doctypes: [noteDocType], reports: options.reports });
  const store = new InMemoryDocumentStore();
  const documentShares = new DocumentShareService({ events: store });
  const userPermissions = new UserPermissionService({
    events: store,
    clock: fixedClock("2026-01-01T00:00:00.000Z"),
    ids: sequentialIds(),
    validator: new ModelBackedUserPermissionGrantValidator({ registry, events: store })
  });
  const documents = new DocumentService({
    registry,
    store,
    userPermissions,
    documentShares,
    clock: advancingClock("2026-01-01T00:00:00.000Z"),
    ids: sequentialIds()
  });
  const queries = new QueryService({ registry, projections: store, userPermissions, documentShares });
  const analyticsStore = new InMemoryAnalyticsStore();
  const cursors = new InMemoryAnalyticsExportCursorStore();
  const exporter = new AnalyticsExportService({
    registry,
    feed: store,
    sink: analyticsStore,
    cursors,
    clock: fixedClock("2026-02-01T00:00:00.000Z")
  });
  return {
    registry,
    store,
    documents,
    documentShares,
    userPermissions,
    queries,
    analyticsStore,
    cursors,
    exporter,
    operationalReports: new ReportService({ registry, queries }),
    analyticalReports: new ReportService({
      registry,
      queries,
      analytics: new AnalyticsQueryService({ reader: analyticsStore, queries, cursors })
    }),
    async exportAll() {
      const result = await exporter.exportTenant({ tenantId: "default" });
      if (result.failed > 0) {
        throw new Error(`export failed: ${JSON.stringify(result)}`);
      }
      return result;
    }
  };
}
