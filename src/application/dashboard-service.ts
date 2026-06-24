import { permissionDenied } from "../core/errors.js";
import {
  canReadDashboard,
  type DashboardCardDefinition,
  type DashboardCardSourceDefinition,
  type DashboardDefinition
} from "../core/dashboard.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Actor, JsonPrimitive } from "../core/types.js";
import type { QueryService } from "./query-service.js";
import type { ReportFilters, ReportService } from "./report-service.js";

export interface DashboardCardResult {
  readonly name: string;
  readonly label: string;
  readonly value: JsonPrimitive;
  readonly source: DashboardCardSourceDefinition;
  readonly description?: string;
  readonly indicator?: string;
}

export interface DashboardRunResult {
  readonly dashboard: DashboardDefinition;
  readonly cards: readonly DashboardCardResult[];
}

export interface DashboardServiceOptions {
  readonly registry: ModelRegistry;
  readonly queries: QueryService;
  readonly reports: ReportService;
}

export class DashboardService {
  private readonly registry: ModelRegistry;
  private readonly queries: QueryService;
  private readonly reports: ReportService;

  constructor(options: DashboardServiceOptions) {
    this.registry = options.registry;
    this.queries = options.queries;
    this.reports = options.reports;
  }

  async listDashboards(actor: Actor): Promise<readonly DashboardDefinition[]> {
    return this.registry.listDashboards().filter((dashboard) => this.canAccessDashboard(actor, dashboard));
  }

  async getDashboard(actor: Actor, dashboardName: string): Promise<DashboardDefinition> {
    const dashboard = this.registry.getDashboard(dashboardName);
    if (!this.canAccessDashboard(actor, dashboard)) {
      throw permissionDenied(`Actor '${actor.id}' cannot read dashboard '${dashboard.name}'`);
    }
    return dashboard;
  }

  async runDashboard(actor: Actor, dashboardName: string): Promise<DashboardRunResult> {
    const dashboard = await this.getDashboard(actor, dashboardName);
    return {
      dashboard,
      cards: await Promise.all(dashboard.cards.map((card) => this.runCard(actor, card)))
    };
  }

  private async runCard(actor: Actor, card: DashboardCardDefinition): Promise<DashboardCardResult> {
    const value = await this.cardValue(actor, card.source);
    return {
      name: card.name,
      label: card.label ?? card.name,
      value,
      source: card.source,
      ...(card.description === undefined ? {} : { description: card.description }),
      ...(card.indicator === undefined ? {} : { indicator: card.indicator })
    };
  }

  private async cardValue(actor: Actor, source: DashboardCardSourceDefinition): Promise<JsonPrimitive> {
    if (source.kind === "documentCount") {
      return this.countReadableDocuments(actor, source);
    }
    const result = await this.reports.runReport(actor, source.report, {
      filters: (source.filters ?? {}) as ReportFilters,
      limit: 1
    });
    return result.summary.find((summary) => summary.name === source.summary)?.value ?? null;
  }

  private async countReadableDocuments(
    actor: Actor,
    source: Extract<DashboardCardSourceDefinition, { readonly kind: "documentCount" }>
  ): Promise<number> {
    const pageSize = 200;
    let count = 0;
    for (let offset = 0; ; offset += pageSize) {
      const page = await this.queries.listDocuments(actor, source.doctype, {
        filters: source.filters ?? [],
        limit: pageSize,
        offset
      });
      count += page.data.length;
      if (offset + page.limit >= page.total) {
        return count;
      }
    }
  }

  private canAccessDashboard(actor: Actor, dashboard: DashboardDefinition): boolean {
    return canReadDashboard(actor, dashboard) && dashboard.cards.every((card) => this.canAccessCard(actor, card.source));
  }

  private canAccessCard(actor: Actor, source: DashboardCardSourceDefinition): boolean {
    try {
      if (source.kind === "documentCount") {
        this.queries.getMeta(actor, source.doctype);
        return true;
      }
      this.reports.getReport(actor, source.report);
      return true;
    } catch (error) {
      if (isPermissionDenied(error)) {
        return false;
      }
      throw error;
    }
  }
}

function isPermissionDenied(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "PERMISSION_DENIED";
}
