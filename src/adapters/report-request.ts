import type { ReportFilters, ReportRunOptions } from "../application/report-service.js";
import { badRequest } from "../core/errors.js";
import type { ReportOrder } from "../core/reports.js";
import type { JsonPrimitive } from "../core/types.js";

export function reportFiltersFromUrl(url: URL): ReportFilters {
  const filters: Record<string, JsonPrimitive> = {};
  url.searchParams.forEach((value, key) => {
    if (key.startsWith("filter_")) {
      filters[key.slice("filter_".length)] = value;
    }
  });
  return filters;
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
