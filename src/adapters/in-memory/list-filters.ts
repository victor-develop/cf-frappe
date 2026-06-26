import type {
  DocumentSnapshot,
  JsonValue,
  ListDocumentsFilter,
  ListOrderDirection
} from "../../core/types.js";
import {
  listFilterExpressionFromFilters,
  matchesListFilterExpression as matchesCoreListFilterExpression
} from "../../core/list-view.js";

export { matchesCoreListFilterExpression as matchesListFilterExpression };

export function matchesListFilters(
  document: DocumentSnapshot,
  filters: readonly ListDocumentsFilter[] = []
): boolean {
  const expression = listFilterExpressionFromFilters(filters);
  return expression === undefined || matchesCoreListFilterExpression(document, expression);
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
