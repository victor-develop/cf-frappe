import type { DocumentSnapshot, JsonPrimitive, JsonValue, ListDocumentsFilter } from "../../core/types";

export function matchesListFilters(
  document: DocumentSnapshot,
  filters: readonly ListDocumentsFilter[] = []
): boolean {
  return filters.every((filter) => {
    const actual = document.data[filter.field];
    switch (filter.operator ?? "eq") {
      case "eq":
        return actual === filter.value;
      case "ne":
        return actual !== undefined && actual !== null && actual !== filter.value;
      case "contains":
        if (actual === undefined || actual === null) {
          return false;
        }
        return String(actual ?? "").toLowerCase().includes(String(filter.value).toLowerCase());
      case "gt":
        if (actual === undefined || actual === null) {
          return false;
        }
        return compareValues(actual, filter.value) > 0;
      case "gte":
        if (actual === undefined || actual === null) {
          return false;
        }
        return compareValues(actual, filter.value) >= 0;
      case "lt":
        if (actual === undefined || actual === null) {
          return false;
        }
        return compareValues(actual, filter.value) < 0;
      case "lte":
        if (actual === undefined || actual === null) {
          return false;
        }
        return compareValues(actual, filter.value) <= 0;
    }
  });
}

function compareValues(actual: JsonValue | undefined, expected: JsonPrimitive): number {
  if (typeof actual === "number" && typeof expected === "number") {
    return actual - expected;
  }
  return String(actual ?? "").localeCompare(String(expected));
}
