import type {
  DashboardDefinition,
  DashboardCardDefinition,
  DashboardCardSourceDefinition,
  DashboardDocumentAggregate,
  DashboardIndicatorOperator
} from "../core/dashboard.js";
import { canReadDashboard } from "../core/dashboard.js";
import { notFound } from "../core/errors.js";
import type { Actor, JsonPrimitive } from "../core/types.js";
import type { ReportChartResult, ReportRunResult } from "./report-service.js";

export type DashboardCardValue = JsonPrimitive | ReportChartResult;

export type DashboardReadAccessDecision =
  | { readonly status: "allow" }
  | { readonly status: "deny"; readonly message: string };

export interface DashboardCardShape<TValue> {
  readonly name: string;
  readonly label: string;
  readonly value: TValue;
  readonly source: DashboardCardSourceDefinition;
  readonly description?: string;
  readonly indicator?: string;
}

export interface DashboardDocumentAggregateState {
  readonly count: number;
  readonly sum: number;
  readonly min: number | null;
  readonly max: number | null;
}

export function ensureDashboardServiceAvailable<T>(dashboards: T | undefined): asserts dashboards is T {
  if (dashboards === undefined) {
    throw notFound("Dashboards are not enabled", "DASHBOARD_NOT_FOUND");
  }
}

export function planDashboardReadAccess(options: {
  readonly actor: Actor;
  readonly dashboard: DashboardDefinition;
  readonly cardsReadable: boolean;
}): DashboardReadAccessDecision {
  if (!canReadDashboard(options.actor, options.dashboard) || !options.cardsReadable) {
    return {
      status: "deny",
      message: `Actor '${options.actor.id}' cannot read dashboard '${options.dashboard.name}'`
    };
  }
  return { status: "allow" };
}

export function dashboardCardResult<TValue>(
  card: DashboardCardDefinition,
  value: TValue
): DashboardCardShape<TValue> {
  const indicator = dashboardCardIndicator(card, value);
  return {
    name: card.name,
    label: card.label ?? card.name,
    value,
    source: card.source,
    ...(card.description === undefined ? {} : { description: card.description }),
    ...(indicator === undefined ? {} : { indicator })
  };
}

export function dashboardReportCardValue(
  source: Extract<DashboardCardSourceDefinition, { readonly kind: "reportChart" | "reportSummary" }>,
  result: Pick<ReportRunResult, "charts" | "summary">
): DashboardCardValue {
  if (source.kind === "reportChart") {
    return result.charts.find((chart) => chart.name === source.chart) ?? null;
  }
  return result.summary.find((summary) => summary.name === source.summary)?.value ?? null;
}

export function emptyDashboardDocumentAggregate(): DashboardDocumentAggregateState {
  return {
    count: 0,
    sum: 0,
    min: null,
    max: null
  };
}

export function updateDashboardDocumentAggregate(
  state: DashboardDocumentAggregateState,
  value: unknown
): DashboardDocumentAggregateState {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return state;
  }
  return {
    count: state.count + 1,
    sum: state.sum + value,
    min: state.min === null ? value : Math.min(state.min, value),
    max: state.max === null ? value : Math.max(state.max, value)
  };
}

export function finishDashboardDocumentAggregate(
  state: DashboardDocumentAggregateState,
  aggregate: DashboardDocumentAggregate
): JsonPrimitive {
  if (aggregate === "sum") {
    return state.sum;
  }
  if (aggregate === "avg") {
    return state.count === 0 ? null : state.sum / state.count;
  }
  if (aggregate === "min") {
    return state.min;
  }
  if (aggregate === "max") {
    return state.max;
  }
  return state.count;
}

export function dashboardCardIndicator(
  card: Pick<DashboardCardDefinition, "indicator" | "indicatorRules">,
  value: unknown
): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return card.indicator;
  }
  const rule = card.indicatorRules?.find((candidate) =>
    dashboardIndicatorMatches(value, candidate.operator, candidate.value)
  );
  return rule?.indicator ?? card.indicator;
}

export function dashboardIndicatorMatches(
  actual: number,
  operator: DashboardIndicatorOperator,
  expected: number
): boolean {
  if (operator === "eq") {
    return actual === expected;
  }
  if (operator === "ne") {
    return actual !== expected;
  }
  if (operator === "gt") {
    return actual > expected;
  }
  if (operator === "gte") {
    return actual >= expected;
  }
  if (operator === "lt") {
    return actual < expected;
  }
  return actual <= expected;
}
