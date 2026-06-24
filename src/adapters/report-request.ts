import type { ReportFilters, ReportRunOptions } from "../application/report-service.js";
import { badRequest } from "../core/errors.js";
import type { ReportFilterValue, ReportOrder } from "../core/reports.js";
import type { JsonPrimitive } from "../core/types.js";

export function reportFiltersFromUrl(url: URL): ReportFilters {
  const filters: Record<string, ReportFilterValue> = {};
  url.searchParams.forEach((value, key) => {
    if (key.startsWith("filter_")) {
      const filterName = key.slice("filter_".length);
      const existing = filters[filterName];
      filters[filterName] = existing === undefined ? value : appendReportFilterValue(existing, value);
    }
  });
  return filters;
}

function appendReportFilterValue(existing: ReportFilterValue, value: JsonPrimitive): readonly JsonPrimitive[] {
  return isReportFilterArray(existing) ? [...existing, value] : [existing, value];
}

function isReportFilterArray(value: ReportFilterValue): value is readonly JsonPrimitive[] {
  return Array.isArray(value);
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
