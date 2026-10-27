import { permissionDenied } from "../core/errors.js";
import { FrameworkError } from "../core/errors.js";
import { normalizeListFilterExpression, normalizeListFilters } from "../core/list-view.js";
import {
  type DashboardCardDefinition,
  type DashboardCardSourceDefinition,
  type DashboardDefinition
} from "../core/dashboard.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Actor, DocTypeDefinition, DocumentSnapshot, JsonPrimitive, ListDocumentsFilter, ListFilterExpression } from "../core/types.js";
import {
  dashboardCardResult,
  type DashboardReadAccessDecision,
  dashboardReportCardValue,
  type DashboardCardValue,
  type DashboardCardShape,
  emptyDashboardDocumentAggregate,
  finishDashboardDocumentAggregate,
  planDashboardReadAccess,
  updateDashboardDocumentAggregate
} from "./dashboard-policy.js";
import { isPermissionDeniedError } from "./access-policy.js";
import type { QueryService } from "./query-service.js";
import type { ReportFilters, ReportService } from "./report-service.js";
import type { AnalyticsQueryService } from "./analytics-query-service.js";
import { isAnalyticsUnavailableError, planAnalyticsQueryPath } from "./analytics-policy.js";
import { andPredicateExpressions } from "../core/predicates.js";
import type { QueryPath } from "../core/analytics.js";

export type DashboardCardResult = DashboardCardShape<DashboardCardValue>;

export interface DashboardRunResult {
  readonly dashboard: DashboardDefinition;
  readonly cards: readonly DashboardCardResult[];
}

export interface DashboardServiceOptions {
  readonly registry: ModelRegistry;
  readonly queries: QueryService;
  readonly reports: ReportService;
  /**
   * The analytics copy (#16), for document cards on dashboards declaring
   * `queryPath: "analytical"`. Report cards go through {@link ReportService},
   * which has its own.
   */
  readonly analytics?: AnalyticsQueryService;
}

export class DashboardService {
  private readonly registry: ModelRegistry;
  private readonly queries: QueryService;
  private readonly reports: ReportService;
  private readonly analytics: AnalyticsQueryService | undefined;

  constructor(options: DashboardServiceOptions) {
    this.registry = options.registry;
    this.queries = options.queries;
    this.reports = options.reports;
    this.analytics = options.analytics;
  }

  async listDashboards(actor: Actor): Promise<readonly DashboardDefinition[]> {
    return this.registry
      .listDashboards()
      .filter((dashboard) => this.dashboardReadAccess(actor, dashboard).status === "allow");
  }

  async getDashboard(actor: Actor, dashboardName: string): Promise<DashboardDefinition> {
    const dashboard = this.registry.getDashboard(dashboardName);
    const decision = this.dashboardReadAccess(actor, dashboard);
    if (decision.status === "deny") {
      throw permissionDenied(decision.message);
    }
    return dashboard;
  }

  async runDashboard(actor: Actor, dashboardName: string): Promise<DashboardRunResult> {
    const dashboard = await this.getDashboard(actor, dashboardName);
    return {
      dashboard,
      cards: await Promise.all(dashboard.cards.map((card) => this.runCard(actor, card, dashboard.queryPath)))
    };
  }

  private async runCard(
    actor: Actor,
    card: DashboardCardDefinition,
    queryPath: QueryPath | undefined
  ): Promise<DashboardCardResult> {
    const value = await this.cardValue(actor, card.source, queryPath);
    return dashboardCardResult(card, value);
  }

  private async cardValue(
    actor: Actor,
    source: DashboardCardSourceDefinition,
    queryPath: QueryPath | undefined
  ): Promise<DashboardCardValue> {
    if (source.kind === "documentCount") {
      return this.countReadableDocuments(actor, source, queryPath);
    }
    if (source.kind === "documentAggregate") {
      return this.aggregateReadableDocuments(actor, source, queryPath);
    }
    const result = await this.reports.runReport(actor, source.report, {
      filters: (source.filters ?? {}) as ReportFilters,
      limit: 1
    });
    return dashboardReportCardValue(source, result);
  }

  private async countReadableDocuments(
    actor: Actor,
    source: Extract<DashboardCardSourceDefinition, { readonly kind: "documentCount" }>,
    queryPath: QueryPath | undefined
  ): Promise<number> {
    return this.foldReadableDocuments(actor, source.doctype, source.filters ?? [], source.filterExpression, queryPath, 0, (count) => count + 1);
  }

  private async aggregateReadableDocuments(
    actor: Actor,
    source: Extract<DashboardCardSourceDefinition, { readonly kind: "documentAggregate" }>,
    queryPath: QueryPath | undefined
  ): Promise<JsonPrimitive> {
    if (source.aggregate === "count") {
      return this.foldReadableDocuments(actor, source.doctype, source.filters ?? [], source.filterExpression, queryPath, 0, (count) => count + 1);
    }
    const field = source.field;
    if (field === undefined) {
      return null;
    }
    const result = await this.foldReadableDocuments(
      actor,
      source.doctype,
      source.filters ?? [],
      source.filterExpression,
      queryPath,
      emptyDashboardDocumentAggregate(),
      (aggregate, document) => updateDashboardDocumentAggregate(aggregate, document.data[field])
    );
    return finishDashboardDocumentAggregate(result, source.aggregate);
  }

  private async foldReadableDocuments<T>(
    actor: Actor,
    doctype: string,
    filters: readonly ListDocumentsFilter[],
    filterExpression: ListFilterExpression | undefined,
    queryPath: QueryPath | undefined,
    initial: T,
    reducer: (accumulator: T, document: DocumentSnapshot) => T
  ): Promise<T> {
    const analytics = this.analytics;
    const path = planAnalyticsQueryPath({ declared: queryPath, configured: analytics !== undefined });
    if (path.status === "analytical" && analytics !== undefined) {
      try {
        const predicate = await this.analyticsPredicate(actor, doctype, filters, filterExpression);
        const { documents } = await analytics.readableDocuments(actor, doctype, predicate === undefined ? {} : { predicate });
        return documents.reduce(reducer, initial);
      } catch (error) {
        if (!(isAnalyticsUnavailableError(error) && analytics.onUnavailable === "operational")) {
          throw error;
        }
      }
    }
    const pageSize = 200;
    let accumulator = initial;
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.queries.listDocuments(actor, doctype, {
        filters,
        ...(filterExpression === undefined ? {} : { filterExpression }),
        limit: pageSize,
        offset
      });
      for (const document of page.data) {
        accumulator = reducer(accumulator, document);
      }
      if (offset + page.limit >= page.total) {
        return accumulator;
      }
    }
  }

  /**
   * The predicate the operational list would push into SQL for these filters,
   * normalised against the same tenant-resolved, field-access-projected DocType,
   * so the analytics path matches the very rows the projection query would.
   */
  private async analyticsPredicate(
    actor: Actor,
    doctype: string,
    filters: readonly ListDocumentsFilter[],
    filterExpression: ListFilterExpression | undefined
  ) {
    const queryDoctype = await this.queries.queryDocTypeFor(actor, doctype);
    const normalized = normalizeListFilters(queryDoctype, filters);
    return andPredicateExpressions([
      normalized.length === 0
        ? undefined
        : normalizeListFilterExpression(queryDoctype, { kind: "group", match: "all", filters: normalized }),
      filterExpression === undefined ? undefined : normalizeListFilterExpression(queryDoctype, filterExpression)
    ]);
  }

  private dashboardReadAccess(actor: Actor, dashboard: DashboardDefinition): DashboardReadAccessDecision {
    return planDashboardReadAccess({
      actor,
      dashboard,
      cardsReadable: dashboard.cards.every((card) => this.canAccessCard(actor, card.source))
    });
  }

  private canAccessCard(actor: Actor, source: DashboardCardSourceDefinition): boolean {
    try {
      if (source.kind === "documentCount" || source.kind === "documentAggregate") {
        assertDashboardDocumentSourceVisible(source, this.queries.getQueryMeta(actor, source.doctype));
        return true;
      }
      this.reports.getReport(actor, source.report);
      return true;
    } catch (error) {
      if (isPermissionDeniedError(error) || isActorScopedDashboardInvalid(error)) {
        return false;
      }
      throw error;
    }
  }
}

function assertDashboardDocumentSourceVisible(
  source: Extract<DashboardCardSourceDefinition, { readonly kind: "documentCount" | "documentAggregate" }>,
  queryableDoctype: DocTypeDefinition
): void {
  normalizeListFilters(queryableDoctype, source.filters ?? [], { errorCode: "DASHBOARD_INVALID" });
  if (source.filterExpression !== undefined) {
    normalizeListFilterExpression(queryableDoctype, source.filterExpression, { errorCode: "DASHBOARD_INVALID" });
  }
  if (source.kind !== "documentAggregate" || source.aggregate === "count") {
    return;
  }
  const field = queryableDoctype.fields.find((candidate) => candidate.name === source.field);
  if (field === undefined) {
    throw new FrameworkError(
      "DASHBOARD_INVALID",
      `Dashboard aggregate field '${source.field ?? ""}' is not queryable on DocType '${source.doctype}'`,
      { status: 400 }
    );
  }
  if (field.type !== "integer" && field.type !== "number") {
    throw new FrameworkError(
      "DASHBOARD_INVALID",
      `Dashboard aggregate field '${field.name}' must be an integer or number field`,
      { status: 400 }
    );
  }
}

function isActorScopedDashboardInvalid(error: unknown): boolean {
  return error instanceof FrameworkError && error.code === "DASHBOARD_INVALID";
}
