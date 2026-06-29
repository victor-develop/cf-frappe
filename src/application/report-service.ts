import { badRequest, permissionDenied } from "../core/errors.js";
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
  limitReportGroups,
  materializeReportFilterExpression,
  materializeReportFilters,
  matchesReportFilters,
  matchesReportRowFilters,
  planReportReadAccess,
  projectReportDocumentRow,
  projectReportRow,
  reportCsvHeader,
  reportRowToCsv,
  resolveReportOrder,
  sortReportDocuments,
  sortReportRows,
  type ReportChartResult,
  type ReportFilterControlResult,
  type ReportFilters,
  type ReportGroupResult,
  type ReportOrderControlResult,
  type ReportReadAccessDecision,
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
}

export class ReportService {
  private readonly registry: ModelRegistry;
  private readonly queries: QueryService;
  private readonly rowProviders: Readonly<Record<string, ReportRowProvider>>;

  constructor(options: ReportServiceOptions) {
    this.registry = options.registry;
    this.queries = options.queries;
    this.rowProviders = options.rowProviders ?? {};
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
    const filtered = await this.filteredDocuments(actor, report, filters, filterExpression);
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
      total: filtered.length
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
    await this.scanReadableDocuments(actor, report.doctype, (document) => {
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
    await this.scanReadableDocuments(actor, report.doctype, (document) => {
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
    const providerName = report.source?.kind === "custom" ? report.source.provider : undefined;
    const provider = providerName === undefined ? undefined : this.rowProviders[providerName];
    if (!provider || providerName === undefined) {
      throw badRequest(`Custom report provider '${providerName ?? report.name}' is not configured`);
    }
    return provider.rows({
      actor,
      report,
      filters,
      ...(filterExpression === undefined ? {} : { filterExpression })
    });
  }

  private canAccess(actor: Actor, report: ReportDefinition): boolean {
    return this.reportReadAccess(actor, report).status === "allow";
  }

  private readableReport(actor: Actor, report: ReportDefinition): DocTypeDefinition {
    const doctype = this.registry.get(report.doctype);
    const decision = planReportReadAccess({ actor, report, doctype });
    if (decision.status === "deny") {
      throw permissionDenied(decision.message);
    }
    assertReportDefinition(report);
    assertReportMatchesDocType(report, doctype);
    return doctype;
  }

  private reportReadAccess(actor: Actor, report: ReportDefinition): ReportReadAccessDecision {
    const doctype = this.registry.get(report.doctype);
    return planReportReadAccess({ actor, report, doctype });
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

  private async filteredDocuments(
    actor: Actor,
    report: ReportDefinition,
    input: ReportFilters,
    filterExpression: ReportFilterExpression | undefined
  ): Promise<readonly DocumentSnapshot[]> {
    const documents = await this.listAllReadableDocuments(actor, report.doctype);
    return documents.filter((document) => matchesReportFilters(document, report, input, filterExpression));
  }
}
