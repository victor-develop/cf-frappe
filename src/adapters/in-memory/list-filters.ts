import type {
  DocumentSnapshot,
  JsonPrimitive,
  JsonValue,
  ListDocumentsFilter,
  ListOrderDirection
} from "../../core/types.js";

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

export function compareListDocuments(
  left: DocumentSnapshot,
  right: DocumentSnapshot,
  orderBy: string,
  order: ListOrderDirection
): number {
  const direction = order === "desc" ? -1 : 1;
  const primary = compareListValues(listOrderValue(left, orderBy), listOrderValue(right, orderBy), direction);
  if (primary !== 0) {
    return primary;
  }
  if (orderBy === "updatedAt") {
    return 0;
  }
  const updated = compareListValues(left.updatedAt, right.updatedAt, -1);
  return updated !== 0 ? updated : compareBinaryStrings(left.name, right.name);
}

function listOrderValue(document: DocumentSnapshot, orderBy: string): JsonValue | number | string | undefined {
  switch (orderBy) {
    case "name":
      return document.name;
    case "createdAt":
      return document.createdAt;
    case "updatedAt":
      return document.updatedAt;
    case "version":
      return document.version;
    default:
      return document.data[orderBy];
  }
}

function compareListValues(
  left: JsonValue | number | string | undefined,
  right: JsonValue | number | string | undefined,
  direction: 1 | -1
): number {
  const leftMissing = left === undefined || left === null;
  const rightMissing = right === undefined || right === null;
  if (leftMissing || rightMissing) {
    return leftMissing === rightMissing ? 0 : leftMissing ? 1 : -1;
  }
  if (typeof left === "number" && typeof right === "number") {
    return (left - right) * direction;
  }
  if (typeof left === "boolean" && typeof right === "boolean") {
    return (Number(left) - Number(right)) * direction;
  }
  return compareBinaryStrings(String(left), String(right)) * direction;
}

function compareBinaryStrings(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}

function compareValues(actual: JsonValue | undefined, expected: JsonPrimitive): number {
  if (typeof actual === "number" && typeof expected === "number") {
    return actual - expected;
  }
  return String(actual ?? "").localeCompare(String(expected));
}
