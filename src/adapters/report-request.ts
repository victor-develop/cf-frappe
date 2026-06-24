import type { ReportFilters, ReportRunOptions } from "../application/report-service.js";
import { badRequest } from "../core/errors.js";
import {
  REPORT_FILTER_EXPRESSION_MAX_DEPTH,
  REPORT_FILTER_EXPRESSION_MAX_NODES,
  isReportFilterGroup,
  type ReportFilterExpression,
  type ReportFilterValue,
  type ReportOrder
} from "../core/reports.js";
import type { JsonPrimitive } from "../core/types.js";

const FILTER_EXPRESSION_QUERY_KEY = "filter_expression";

export function reportFiltersFromUrl(url: URL): ReportFilters {
  const filters: Record<string, ReportFilterValue> = {};
  url.searchParams.forEach((value, key) => {
    if (key === FILTER_EXPRESSION_QUERY_KEY) {
      return;
    }
    if (key.startsWith("filter_")) {
      const filterName = key.slice("filter_".length);
      const existing = filters[filterName];
      filters[filterName] = existing === undefined ? value : appendReportFilterValue(existing, value);
    }
  });
  return filters;
}

export function reportFilterExpressionFromUrl(url: URL): ReportFilterExpression | undefined {
  const raw = nonEmptyQueryValue(url.searchParams.get(FILTER_EXPRESSION_QUERY_KEY));
  if (raw === undefined) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw) as unknown;
  } catch {
    throw badRequest("Report filter expression must be valid JSON");
  }
  return reportFilterExpressionFromValue(value, "Report filter expression");
}

export function reportFilterExpressionFromValue(
  value: unknown,
  label = "Report filter expression"
): ReportFilterExpression {
  return reportFilterExpressionNodeFromValue(value, label, 1, { remaining: REPORT_FILTER_EXPRESSION_MAX_NODES });
}

function appendReportFilterValue(existing: ReportFilterValue, value: JsonPrimitive): readonly JsonPrimitive[] {
  return isReportFilterArray(existing) ? [...existing, value] : [existing, value];
}

function isReportFilterArray(value: ReportFilterValue): value is readonly JsonPrimitive[] {
  return Array.isArray(value);
}

function reportFilterExpressionNodeFromValue(
  value: unknown,
  label: string,
  depth: number,
  budget: ReportFilterExpressionParseBudget
): ReportFilterExpression {
  budget.remaining -= 1;
  if (budget.remaining < 0) {
    throw badRequest(
      `Report filter expression cannot exceed ${REPORT_FILTER_EXPRESSION_MAX_DEPTH} levels or ${REPORT_FILTER_EXPRESSION_MAX_NODES} nodes`
    );
  }
  if (!isRecord(value)) {
    throw badRequest(`${label} must be an object`);
  }
  if ("filter" in value) {
    return reportFilterPredicateFromValue(value, label);
  }
  if (depth > REPORT_FILTER_EXPRESSION_MAX_DEPTH) {
    throw badRequest(`Report filter expression cannot exceed ${REPORT_FILTER_EXPRESSION_MAX_DEPTH} levels`);
  }
  if (value.kind !== undefined && value.kind !== "group") {
    throw badRequest(`${label} kind must be group`);
  }
  if (value.match !== "all" && value.match !== "any") {
    throw badRequest(`${label} match must be all or any`);
  }
  if (!Array.isArray(value.filters)) {
    throw badRequest(`${label} filters must be an array`);
  }
  const expression: ReportFilterExpression = {
    kind: "group",
    match: value.match,
    filters: value.filters.map((item) =>
      reportFilterExpressionNodeFromValue(item, `${label} filter`, depth + 1, budget)
    )
  };
  if (!isReportFilterGroup(expression) || expression.filters.length === 0) {
    throw badRequest(`${label} group must include at least one filter`);
  }
  return expression;
}

function reportFilterPredicateFromValue(value: Record<string, unknown>, label: string): ReportFilterExpression {
  if (typeof value.filter !== "string" || value.filter.length === 0) {
    throw badRequest(`${label} filter must be a string`);
  }
  return {
    filter: value.filter,
    value: reportFilterValueFromUnknown(value.value, `${label} value must be scalar or a scalar array`)
  };
}

function reportFilterValueFromUnknown(value: unknown, message: string): ReportFilterValue {
  if (isJsonPrimitive(value)) {
    return value;
  }
  if (Array.isArray(value) && value.every(isJsonPrimitive)) {
    return value;
  }
  throw badRequest(message);
}

export function reportOrderingFromUrl(url: URL): Pick<ReportRunOptions, "orderBy" | "order"> {
  const orderBy = nonEmptyQueryValue(url.searchParams.get("order_by"));
  const order = nonEmptyQueryValue(url.searchParams.get("order"));
  return {
    ...(orderBy === undefined ? {} : { orderBy }),
    ...(order === undefined ? {} : { order: parseReportOrder(order) })
  };
}

function parseReportOrder(value: string): ReportOrder {
  if (value === "asc" || value === "desc") {
    return value;
  }
  throw badRequest("Report order must be asc or desc");
}

function nonEmptyQueryValue(value: string | null): string | undefined {
  return value === null || value === "" ? undefined : value;
}

function isJsonPrimitive(value: unknown): value is JsonPrimitive {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ReportFilterExpressionParseBudget {
  remaining: number;
}
