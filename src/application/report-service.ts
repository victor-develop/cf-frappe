import { permissionDenied } from "../core/errors.js";
import {
  projectDocTypeForFieldAccess,
  projectDocTypeForFieldQueries
} from "./document-field-access-policy.js";
import {
  assertReportDefinition,
  assertReportMatchesDocType,
  isCustomReport,
  type ReportColumnDefinition,
  type ReportDefinition,
  type ReportFilterExpression,
  type ReportFilterValue,
  type ReportOrder
} from "../core/reports.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Actor, DocTypeDefinition, DocumentSnapshot } from "../core/types.js";
import { QueryService } from "./query-service.js";
import type { AnalyticsQueryService, AnalyticsResultMetadata } from "./analytics-query-service.js";
import {
  isAnalyticsUnavailableError,
  planAnalyticsQueryPath,
  reportAnalyticsPrefilters
} from "./analytics-policy.js";
import { CSV_CONTENT_TYPE, filenamePart } from "./csv.js";
import {
  BoundedOrderedReportRows,
  buildReportFilterControls,
  buildReportCharts,
  buildReportGroups,
  buildReportSummary,
  clampReportCsvExportLimit,
  clampReportRunLimit,
  combineReportFilterExpression,
  customReportProviderName,
  ensureCustomReportProviderConfigured,
  limitReportGroups,
  materializeReportFilterExpression,
  materializeReportFilters,
  matchesReportFilters,
  matchesReportRowFilters,
  planReportReadAccess,
  projectReportDocumentRow,
  projectReportRow,
  reportCsvHeader,
  restrictedReportFieldReferences,
  restrictedReportQueryFieldReferences,
  reportRowToCsv,
  resolveReportOrder,
  sortReportDocuments,
  sortReportRows,
  type ReportChartResult,
  type ReportFilterControlResult,
  type ReportFilters,
  type ReportGroupResult,
  type ReportOrderControlResult,
  type ReportRow,
  type ReportSummaryValue
} from "./report-policy.js";

export type {
  ReportChartResult,
  ReportChartDrilldown,
  ReportChartPoint,
  ReportFilterControlResult,
  ReportFilters,
  ReportGroupResult,
  ReportGroupRow,
  ReportOrderControlResult,
  ReportOrderOptionResult,
  ReportRow,
  ReportSummaryValue
} from "./report-policy.js";

export interface ReportRunOptions {
  readonly filters?: ReportFilters;
  readonly filterExpression?: ReportFilterExpression;
  readonly limit?: number;
  readonly offset?: number;
  readonly orderBy?: string;
  readonly order?: ReportOrder;
}

export interface ReportRunResult {
  readonly report: ReportDefinition;
  readonly columns: readonly ReportColumnDefinition[];
  readonly filters: readonly ReportFilterControlResult[];
  readonly order: ReportOrderControlResult;
  readonly summary: readonly ReportSummaryValue[];
  readonly groups: readonly ReportGroupResult[];
  readonly charts: readonly ReportChartResult[];
  readonly rows: readonly ReportRow[];
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
  /**
   * Present only when the rows came from the analytics copy (#16), so an
   * operational result is byte-for-byte what it was before analytics existed.
   */
  readonly analytics?: AnalyticsResultMetadata;
}

export interface ReportCsvExportOptions extends Pick<ReportRunOptions, "filters" | "filterExpression"> {
  readonly limit?: number;
  readonly orderBy?: string;
  readonly order?: ReportOrder;
}

export interface ReportCsvExport {
  readonly filename: string;
  readonly contentType: "text/csv; charset=utf-8";
  readonly body: string;
  readonly exported: number;
  readonly total: number;
  readonly truncated: boolean;
  readonly limit: number;
}

export interface ReportRowProviderContext {
  readonly actor: Actor;
  readonly report: ReportDefinition;
  readonly filters: ReportFilters;
  readonly filterExpression?: ReportFilterExpression;
}

export interface ReportRowProvider {
  rows(context: ReportRowProviderContext): Promise<readonly ReportRow[]>;
}

export interface ReportServiceOptions {
  readonly registry: ModelRegistry;
  readonly queries: QueryService;
  readonly rowProviders?: Readonly<Record<string, ReportRowProvider>>;
  /**
   * The analytics copy (#16). Reports declaring `queryPath: "analytical"` read
   * from it when this is set; without it every report reads the operational
   * projection, whatever it declares.
   */
  readonly analytics?: AnalyticsQueryService;
}

/** The readable documents a report runs over, and where they came from. */
interface ReportDocumentSource {
  readonly documents: readonly DocumentSnapshot[];
  readonly analytics?: AnalyticsResultMetadata;
}

export class ReportService {
  private readonly registry: ModelRegistry;
  private readonly queries: QueryService;
  private readonly rowProviders: Readonly<Record<string, ReportRowProvider>>;
  private readonly analytics: AnalyticsQueryService | undefined;

  constructor(options: ReportServiceOptions) {
    this.registry = options.registry;
    this.queries = options.queries;
    this.rowProviders = options.rowProviders ?? {};
    this.analytics = options.analytics;
  }

  listReports(actor: Actor): readonly ReportDefinition[] {
    return this.registry.listReports().filter((report) => this.canAccess(actor, report));
  }

  getReport(actor: Actor, reportName: string): ReportDefinition {
    const report = this.registry.getReport(reportName);
    this.readableReport(actor, report);
    return report;
  }

  async runReport(actor: Actor, reportName: string, options: ReportRunOptions = {}): Promise<ReportRunResult> {
    const report = this.getReport(actor, reportName);
    return this.runReportDefinition(actor, report, options);
  }

  async runReportDefinition(
    actor: Actor,
    report: ReportDefinition,
    options: ReportRunOptions = {}
  ): Promise<ReportRunResult> {
    const doctype = this.readableReport(actor, report);
    if (isCustomReport(report)) {
      return this.runCustomReportDefinition(actor, report, doctype, options);
    }
    const limit = clampReportRunLimit(options.limit);
    const offset = Math.max(0, options.offset ?? 0);
    const filterExpression = materializeReportFilterExpression(
      report,
      doctype,
      combineReportFilterExpression(report.filterExpression, options.filterExpression)
    );
    const filters = materializeReportFilters(report, doctype, options.filters ?? {}, filterExpression);
    const order = resolveReportOrder(report, doctype, options);
    const source = await this.reportDocuments(actor, report, filters);
    const filtered = source.documents.filter((document) =>
      matchesReportFilters(document, report, filters, filterExpression)
    );
    const sorted = sortReportDocuments(filtered, report, order);
    const aggregateRows = filtered.map((document) => document.data as ReportRow);
    const groups = buildReportGroups(aggregateRows, report.groups ?? []);
    const limitedGroups = limitReportGroups(groups, report.groups ?? []);
    const rows = sorted.slice(offset, offset + limit).map((document) => projectReportDocumentRow(document, report.columns));
    return {
      report,
      columns: report.columns,
      filters: buildReportFilterControls(report, doctype, filters),
      order,
      summary: buildReportSummary(aggregateRows, report.summaries ?? []),
      groups: limitedGroups,
      charts: buildReportCharts(groups, report.charts ?? [], report.filters ?? []),
      rows,
      limit,
      offset,
      total: filtered.length,
      ...(source.analytics === undefined ? {} : { analytics: source.analytics })
    };
  }

  async exportReportCsv(
    actor: Actor,
    reportName: string,
    options: ReportCsvExportOptions = {}
  ): Promise<ReportCsvExport> {
    const report = this.getReport(actor, reportName);
    return this.exportReportDefinitionCsv(actor, report, options);
  }

  async exportReportDefinitionCsv(
    actor: Actor,
    report: ReportDefinition,
    options: ReportCsvExportOptions = {}
  ): Promise<ReportCsvExport> {
    const doctype = this.readableReport(actor, report);
    if (isCustomReport(report)) {
      return this.exportCustomReportCsv(actor, report, doctype, options);
    }
    const limit = clampReportCsvExportLimit(options.limit);
    const filterExpression = materializeReportFilterExpression(
      report,
      doctype,
      combineReportFilterExpression(report.filterExpression, options.filterExpression)
    );
    const filters = materializeReportFilters(report, doctype, options.filters ?? {}, filterExpression);
    const order = resolveReportOrder(report, doctype, options);
    if (order.orderBy === undefined) {
      return this.exportUnorderedReportCsv(actor, report, filters, filterExpression, limit);
    }
    const rows = new BoundedOrderedReportRows(report, order, limit);
    let total = 0;
    await this.visitReportDocuments(actor, report, filters, (document) => {
      if (!matchesReportFilters(document, report, filters, filterExpression)) {
        return;
      }
      rows.add(document, total);
      total += 1;
    });
    const lines = [
      reportCsvHeader(report.columns),
      ...rows.toRows().map((row) => reportRowToCsv(report.columns, row))
    ];
    const exported = Math.min(total, limit);
    return {
      filename: `${filenamePart(report.name, "report")}.csv`,
      contentType: CSV_CONTENT_TYPE,
      body: lines.join("\n"),
      exported,
      total,
      truncated: exported < total,
      limit
    };
  }

  private async exportUnorderedReportCsv(
    actor: Actor,
    report: ReportDefinition,
    filters: ReportFilters,
    filterExpression: ReportFilterExpression | undefined,
    limit: number
  ): Promise<ReportCsvExport> {
    const lines = [reportCsvHeader(report.columns)];
    let total = 0;
    let exported = 0;
    await this.visitReportDocuments(actor, report, filters, (document) => {
      if (!matchesReportFilters(document, report, filters, filterExpression)) {
        return;
      }
      total += 1;
      if (exported >= limit) {
        return;
      }
      lines.push(reportRowToCsv(report.columns, projectReportDocumentRow(document, report.columns)));
      exported += 1;
    });
    return {
      filename: `${filenamePart(report.name, "report")}.csv`,
      contentType: CSV_CONTENT_TYPE,
      body: lines.join("\n"),
      exported,
      total,
      truncated: exported < total,
      limit
    };
  }

  private async runCustomReportDefinition(
    actor: Actor,
    report: ReportDefinition,
    doctype: DocTypeDefinition,
    options: ReportRunOptions
  ): Promise<ReportRunResult> {
    const limit = clampReportRunLimit(options.limit);
    const offset = Math.max(0, options.offset ?? 0);
    const filterExpression = materializeReportFilterExpression(
      report,
      doctype,
      combineReportFilterExpression(report.filterExpression, options.filterExpression)
    );
    const filters = materializeReportFilters(report, doctype, options.filters ?? {}, filterExpression);
    const order = resolveReportOrder(report, doctype, options);
    const rows = await this.customReportRows(actor, report, filters, filterExpression);
    const filtered = rows.filter((row) => matchesReportRowFilters(row, report, filters, filterExpression));
    const projected = filtered.map((row) => projectReportRow(row, report.columns));
    const sorted = sortReportRows(projected, report, order);
    const groups = buildReportGroups(filtered, report.groups ?? []);
    const limitedGroups = limitReportGroups(groups, report.groups ?? []);
    return {
      report,
      columns: report.columns,
      filters: buildReportFilterControls(report, doctype, filters),
      order,
      summary: buildReportSummary(filtered, report.summaries ?? []),
      groups: limitedGroups,
      charts: buildReportCharts(groups, report.charts ?? [], report.filters ?? []),
      rows: sorted.slice(offset, offset + limit),
      limit,
      offset,
      total: filtered.length
    };
  }

  private async exportCustomReportCsv(
    actor: Actor,
    report: ReportDefinition,
    doctype: DocTypeDefinition,
    options: ReportCsvExportOptions
  ): Promise<ReportCsvExport> {
    const limit = clampReportCsvExportLimit(options.limit);
    const filterExpression = materializeReportFilterExpression(
      report,
      doctype,
      combineReportFilterExpression(report.filterExpression, options.filterExpression)
    );
    const filters = materializeReportFilters(report, doctype, options.filters ?? {}, filterExpression);
    const order = resolveReportOrder(report, doctype, options);
    const rows = await this.customReportRows(actor, report, filters, filterExpression);
    const projected = rows
      .filter((row) => matchesReportRowFilters(row, report, filters, filterExpression))
      .map((row) => projectReportRow(row, report.columns));
    const sorted = sortReportRows(projected, report, order);
    const exportedRows = sorted.slice(0, limit);
    return {
      filename: `${filenamePart(report.name, "report")}.csv`,
      contentType: CSV_CONTENT_TYPE,
      body: [reportCsvHeader(report.columns), ...exportedRows.map((row) => reportRowToCsv(report.columns, row))].join("\n"),
      exported: exportedRows.length,
      total: sorted.length,
      truncated: exportedRows.length < sorted.length,
      limit
    };
  }

  private async customReportRows(
    actor: Actor,
    report: ReportDefinition,
    filters: ReportFilters,
    filterExpression: ReportFilterExpression | undefined
  ): Promise<readonly ReportRow[]> {
    const providerName = customReportProviderName(report);
    const provider = providerName === undefined ? undefined : this.rowProviders[providerName];
    const lookup = { report, providerName, provider };
    ensureCustomReportProviderConfigured(lookup);
    return lookup.provider.rows({
      actor,
      report,
      filters,
      ...(filterExpression === undefined ? {} : { filterExpression })
    });
  }

  private canAccess(actor: Actor, report: ReportDefinition): boolean {
    try {
      this.readableReport(actor, report);
      return true;
    } catch (error) {
      if (isReportAccessDenied(error)) {
        return false;
      }
      throw error;
    }
  }

  private readableReport(actor: Actor, report: ReportDefinition): DocTypeDefinition {
    const doctype = this.registry.get(report.doctype);
    const decision = planReportReadAccess({ actor, report, doctype });
    if (decision.status === "deny") {
      throw permissionDenied(decision.message);
    }
    assertReportDefinition(report);
    const visibleDoctype = projectDocTypeForFieldAccess({ actor, doctype, action: "read" });
    const queryableDoctype = projectDocTypeForFieldQueries({ actor, doctype });
    const restrictedFields = restrictedReportFieldReferences({ report, sourceDoctype: doctype, visibleDoctype });
    const restrictedQueryFields = restrictedReportQueryFieldReferences({ report, sourceDoctype: doctype, queryableDoctype });
    if (restrictedFields.length > 0 || restrictedQueryFields.length > 0) {
      throw permissionDenied(`Actor '${actor.id}' cannot read report '${report.name}'`);
    }
    assertReportMatchesDocType(report, visibleDoctype);
    return visibleDoctype;
  }

  /**
   * The readable documents a report runs over, from whichever store its
   * declared query path and the deployment's configuration select.
   *
   * With `onUnavailable: "operational"` an analytics outage falls back to the
   * projection. The default is to fail instead: the fallback puts the report's
   * full scan back on D1 at exactly the moment something is already wrong, and
   * the point of the analytical path is that a report cannot do that.
   */
  private async reportDocuments(
    actor: Actor,
    report: ReportDefinition,
    filters: ReportFilters
  ): Promise<ReportDocumentSource> {
    const analytics = this.analytics;
    const path = planAnalyticsQueryPath({ declared: report.queryPath, configured: analytics !== undefined });
    if (path.status === "analytical" && analytics !== undefined) {
      try {
        return await analytics.readableDocuments(actor, report.doctype, {
          prefilters: reportAnalyticsPrefilters(report, filters)
        });
      } catch (error) {
        if (!(isAnalyticsUnavailableError(error) && analytics.onUnavailable === "operational")) {
          throw error;
        }
      }
    }
    return { documents: await this.listAllReadableDocuments(actor, report.doctype) };
  }

  private async visitReportDocuments(
    actor: Actor,
    report: ReportDefinition,
    filters: ReportFilters,
    visit: (document: DocumentSnapshot) => void
  ): Promise<void> {
    if (planAnalyticsQueryPath({ declared: report.queryPath, configured: this.analytics !== undefined }).status === "operational") {
      // Streamed page by page, as before analytics existed: the CSV export
      // never holds more than one projection page plus its bounded output.
      await this.scanReadableDocuments(actor, report.doctype, visit);
      return;
    }
    for (const document of (await this.reportDocuments(actor, report, filters)).documents) {
      visit(document);
    }
  }

  private async listAllReadableDocuments(actor: Actor, doctype: string): Promise<readonly DocumentSnapshot[]> {
    const documents: DocumentSnapshot[] = [];
    await this.scanReadableDocuments(actor, doctype, (document) => {
      documents.push(document);
    });
    return documents;
  }

  private async scanReadableDocuments(
    actor: Actor,
    doctype: string,
    visit: (document: DocumentSnapshot) => void
  ): Promise<void> {
    const pageSize = 200;
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.queries.listDocuments(actor, doctype, { limit: pageSize, offset });
      for (const document of page.data) {
        visit(document);
      }
      if (offset + page.limit >= page.total) {
        return;
      }
    }
  }
}

function isReportAccessDenied(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "PERMISSION_DENIED";
}
