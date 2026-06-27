import { FrameworkError } from "./errors.js";
import { assertListFilterExpressionShape, freezeListFilter, freezeListFilterExpression } from "./list-view.js";
import {
  SYSTEM_MANAGER_ROLE,
  type Actor,
  type JsonPrimitive,
  type ListDocumentsFilter,
  type ListFilterExpression
} from "./types.js";

export type DashboardReportFilters = Readonly<Record<string, JsonPrimitive | undefined>>;
export type DashboardDocumentAggregate = "count" | "sum" | "avg" | "min" | "max";
export type DashboardIndicatorOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte";

export const DASHBOARD_DOCUMENT_AGGREGATES = ["count", "sum", "avg", "min", "max"] as const satisfies readonly DashboardDocumentAggregate[];
export const DASHBOARD_INDICATOR_OPERATORS = ["eq", "ne", "gt", "gte", "lt", "lte"] as const satisfies readonly DashboardIndicatorOperator[];

export type DashboardCardSourceDefinition =
  | {
      readonly kind: "documentCount";
      readonly doctype: string;
      readonly filters?: readonly ListDocumentsFilter[];
      readonly filterExpression?: ListFilterExpression;
    }
  | {
      readonly kind: "documentAggregate";
      readonly doctype: string;
      readonly aggregate: DashboardDocumentAggregate;
      readonly field?: string;
      readonly filters?: readonly ListDocumentsFilter[];
      readonly filterExpression?: ListFilterExpression;
    }
  | {
      readonly kind: "reportSummary";
      readonly report: string;
      readonly summary: string;
      readonly filters?: DashboardReportFilters;
    }
  | {
      readonly kind: "reportChart";
      readonly report: string;
      readonly chart: string;
      readonly filters?: DashboardReportFilters;
    };

export interface DashboardCardDefinition {
  readonly name: string;
  readonly label?: string;
  readonly description?: string;
  readonly indicator?: string;
  readonly indicatorRules?: readonly DashboardIndicatorRule[];
  readonly source: DashboardCardSourceDefinition;
}

export interface DashboardIndicatorRule {
  readonly operator: DashboardIndicatorOperator;
  readonly value: number;
  readonly indicator: string;
}

export interface DashboardDefinition {
  readonly name: string;
  readonly label?: string;
  readonly module?: string;
  readonly description?: string;
  readonly roles?: readonly string[];
  readonly cards: readonly DashboardCardDefinition[];
}

export function defineDashboard(definition: DashboardDefinition): DashboardDefinition {
  assertDashboardDefinition(definition);
  return Object.freeze({
    ...definition,
    ...(definition.roles ? { roles: Object.freeze([...definition.roles]) } : {}),
    cards: Object.freeze(
      definition.cards.map((card) =>
        Object.freeze({
          ...card,
          source: freezeDashboardCardSource(card.source),
          ...(card.indicatorRules
            ? {
                indicatorRules: Object.freeze(
                  card.indicatorRules.map((rule) => Object.freeze({ ...rule }))
                )
              }
            : {})
        })
      )
    )
  });
}

export function assertDashboardDefinition(definition: DashboardDefinition): void {
  assertDashboardIdentifier(definition.name, "dashboard name");
  if (definition.cards.length === 0) {
    throw new FrameworkError(
      "DASHBOARD_INVALID",
      `Dashboard '${definition.name}' must define at least one card`,
      { status: 400 }
    );
  }
  assertUnique(definition.cards.map((card) => card.name), "card", definition.name);
  for (const card of definition.cards) {
    assertDashboardIdentifier(card.name, "dashboard card name");
    assertDashboardCardSource(definition.name, card);
    assertDashboardIndicatorRules(definition.name, card);
  }
}

export function canReadDashboard(actor: Actor, dashboard: DashboardDefinition): boolean {
  if (actor.roles.includes(SYSTEM_MANAGER_ROLE)) {
    return true;
  }
  return dashboard.roles === undefined || dashboard.roles.some((role) => actor.roles.includes(role));
}

function freezeDashboardCardSource(source: DashboardCardSourceDefinition): DashboardCardSourceDefinition {
  if (source.kind === "documentCount" || source.kind === "documentAggregate") {
    return Object.freeze({
      ...source,
      ...(source.filters
        ? {
            filters: Object.freeze(
              source.filters.map(freezeListFilter)
            )
          }
        : {}),
      ...(source.filterExpression === undefined
        ? {}
        : { filterExpression: freezeListFilterExpression(source.filterExpression) })
    });
  }
  return Object.freeze({
    ...source,
    ...(source.filters ? { filters: Object.freeze({ ...source.filters }) } : {})
  });
}

function assertDashboardCardSource(dashboardName: string, card: DashboardCardDefinition): void {
  const source = card.source;
  if (source.kind === "documentCount") {
    assertDashboardIdentifier(source.doctype, `dashboard '${dashboardName}' card '${card.name}' DocType`);
    assertDashboardDocumentFilterExpression(dashboardName, card);
    return;
  }
  if (source.kind === "documentAggregate") {
    assertDashboardIdentifier(source.doctype, `dashboard '${dashboardName}' card '${card.name}' DocType`);
    assertDashboardDocumentFilterExpression(dashboardName, card);
    if (!DASHBOARD_DOCUMENT_AGGREGATES.includes(source.aggregate)) {
      throw new FrameworkError(
        "DASHBOARD_INVALID",
        `Dashboard '${dashboardName}' card '${card.name}' has invalid document aggregate '${String(source.aggregate)}'`,
        { status: 400 }
      );
    }
    if (source.aggregate === "count") {
      if (source.field !== undefined) {
        throw new FrameworkError(
          "DASHBOARD_INVALID",
          `Dashboard '${dashboardName}' card '${card.name}' count aggregate must not define a field`,
          { status: 400 }
        );
      }
      return;
    }
    assertDashboardIdentifier(source.field ?? "", `dashboard '${dashboardName}' card '${card.name}' aggregate field`);
    return;
  }
  if (source.kind === "reportSummary") {
    assertDashboardIdentifier(source.report, `dashboard '${dashboardName}' card '${card.name}' report`);
    assertDashboardIdentifier(source.summary, `dashboard '${dashboardName}' card '${card.name}' summary`);
    return;
  }
  if (source.kind === "reportChart") {
    assertDashboardIdentifier(source.report, `dashboard '${dashboardName}' card '${card.name}' report`);
    assertDashboardIdentifier(source.chart, `dashboard '${dashboardName}' card '${card.name}' chart`);
    return;
  }
  throw new FrameworkError(
    "DASHBOARD_INVALID",
    `Dashboard '${dashboardName}' card '${card.name}' has invalid source`,
    { status: 400 }
  );
}

function assertDashboardDocumentFilterExpression(dashboardName: string, card: DashboardCardDefinition): void {
  if (
    (card.source.kind === "documentCount" || card.source.kind === "documentAggregate") &&
    card.source.filterExpression !== undefined
  ) {
    assertListFilterExpressionShape(card.source.filterExpression, {
      errorCode: "DASHBOARD_INVALID",
      label: `Dashboard '${dashboardName}' card '${card.name}' filter expression`
    });
  }
}

function assertDashboardIndicatorRules(dashboardName: string, card: DashboardCardDefinition): void {
  const rules = card.indicatorRules;
  if (rules === undefined) {
    return;
  }
  if (card.source.kind === "reportChart") {
    throw new FrameworkError(
      "DASHBOARD_INVALID",
      `Dashboard '${dashboardName}' card '${card.name}' chart cards cannot define indicator rules`,
      { status: 400 }
    );
  }
  if (rules.length === 0) {
    throw new FrameworkError(
      "DASHBOARD_INVALID",
      `Dashboard '${dashboardName}' card '${card.name}' indicator rules must not be empty`,
      { status: 400 }
    );
  }
  for (const [index, rule] of rules.entries()) {
    if (!DASHBOARD_INDICATOR_OPERATORS.includes(rule.operator)) {
      throw new FrameworkError(
        "DASHBOARD_INVALID",
        `Dashboard '${dashboardName}' card '${card.name}' indicator rule ${index + 1} has invalid operator '${String(rule.operator)}'`,
        { status: 400 }
      );
    }
    if (typeof rule.value !== "number" || !Number.isFinite(rule.value)) {
      throw new FrameworkError(
        "DASHBOARD_INVALID",
        `Dashboard '${dashboardName}' card '${card.name}' indicator rule ${index + 1} value must be a finite number`,
        { status: 400 }
      );
    }
    assertDashboardIdentifier(
      typeof rule.indicator === "string" ? rule.indicator : "",
      `dashboard '${dashboardName}' card '${card.name}' indicator rule ${index + 1} indicator`
    );
  }
}

function assertDashboardIdentifier(value: string, label: string): void {
  if (!value.trim()) {
    throw new FrameworkError("DASHBOARD_INVALID", `${label} is required`, { status: 400 });
  }
}

function assertUnique(values: readonly string[], label: string, dashboardName: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new FrameworkError(
        "DASHBOARD_INVALID",
        `Dashboard '${dashboardName}' has duplicate ${label} '${value}'`,
        { status: 400 }
      );
    }
    seen.add(value);
  }
}
