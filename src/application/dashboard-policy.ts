import type {
  DashboardCardDefinition,
  DashboardDocumentAggregate,
  DashboardIndicatorOperator
} from "../core/dashboard.js";
import type { JsonPrimitive } from "../core/types.js";

export interface DashboardDocumentAggregateState {
  readonly count: number;
  readonly sum: number;
  readonly min: number | null;
  readonly max: number | null;
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
