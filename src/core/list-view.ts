import { FrameworkError, type FrameworkErrorCode } from "./errors";
import type {
  DocTypeDefinition,
  FieldDefinition,
  JsonPrimitive,
  ListDocumentsFilter,
  ListFilterOperator,
  ResolvedListView
} from "./types";

export const DEFAULT_LIST_PAGE_SIZE = 50;
export const MAX_LIST_PAGE_SIZE = 200;

interface NormalizeListFiltersOptions {
  readonly errorCode?: FrameworkErrorCode;
}

export function assertListViewDefinition(doctype: DocTypeDefinition): void {
  resolveListView(doctype);
}

export function resolveListView(doctype: DocTypeDefinition): ResolvedListView {
  const columns = resolveListColumns(doctype);
  return {
    columns,
    filterFields: resolveListFilterFields(doctype, columns),
    filters: normalizeListFilters(doctype, doctype.listView?.filters ?? [], { errorCode: "LIST_VIEW_INVALID" }),
    pageSize: normalizeListPageSize(doctype.listView?.pageSize, doctype.name)
  };
}

export function normalizeListFilters(
  doctype: DocTypeDefinition,
  filters: readonly ListDocumentsFilter[],
  options: NormalizeListFiltersOptions = {}
): readonly ListDocumentsFilter[] {
  if (filters.length === 0) {
    return [];
  }
  const errorCode = options.errorCode ?? "BAD_REQUEST";
  const fields = fieldMap(doctype);
  return filters.map((filter) => {
    const field = fields.get(filter.field);
    if (!field) {
      throw new FrameworkError(errorCode, `Filter field '${filter.field}' is not defined on ${doctype.name}`, {
        status: 400
      });
    }
    if (field.type === "json") {
      throw new FrameworkError(errorCode, `Filter field '${filter.field}' cannot be a json field`, {
        status: 400
      });
    }
    const operator = normalizeFilterOperator(filter.operator, errorCode);
    if (field.type === "boolean" && operator !== "eq") {
      throw new FrameworkError(errorCode, `Boolean filter '${filter.field}' only supports eq`, {
        status: 400
      });
    }
    return {
      field: filter.field,
      ...(operator === "eq" ? {} : { operator }),
      value: coerceFilterValue(field, filter.value, errorCode)
    };
  });
}

function resolveListColumns(doctype: DocTypeDefinition): readonly FieldDefinition[] {
  if (doctype.listView?.columns) {
    return resolveFields(doctype, doctype.listView.columns, "column");
  }
  const flagged = visibleFields(doctype).filter((field) => field.inListView);
  return flagged.length > 0 ? flagged : visibleFields(doctype).slice(0, 5);
}

function resolveListFilterFields(
  doctype: DocTypeDefinition,
  columns: readonly FieldDefinition[]
): readonly FieldDefinition[] {
  if (doctype.listView?.filterFields) {
    return ensureFilterable(resolveFields(doctype, doctype.listView.filterFields, "filter field"));
  }
  const flagged = doctype.fields.filter((field) => field.inListFilter);
  return flagged.length > 0 ? ensureFilterable(flagged) : columns.filter((field) => field.type !== "json");
}

function resolveFields(
  doctype: DocTypeDefinition,
  names: readonly string[],
  label: string
): readonly FieldDefinition[] {
  const fields = fieldMap(doctype);
  const seen = new Set<string>();
  return names.map((name) => {
    const field = fields.get(name);
    if (!field) {
      throw new FrameworkError(
        "LIST_VIEW_INVALID",
        `List view on ${doctype.name} references unknown ${label} '${name}'`,
        { status: 400 }
      );
    }
    if (seen.has(name)) {
      throw new FrameworkError("LIST_VIEW_INVALID", `List view on ${doctype.name} repeats ${label} '${name}'`, {
        status: 400
      });
    }
    seen.add(name);
    return field;
  });
}

function ensureFilterable(fields: readonly FieldDefinition[]): readonly FieldDefinition[] {
  for (const field of fields) {
    if (field.type === "json") {
      throw new FrameworkError("LIST_VIEW_INVALID", `List filter field '${field.name}' cannot be a json field`, {
        status: 400
      });
    }
  }
  return fields;
}

function normalizeListPageSize(pageSize: number | undefined, doctype: string): number {
  if (pageSize === undefined) {
    return DEFAULT_LIST_PAGE_SIZE;
  }
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new FrameworkError("LIST_VIEW_INVALID", `List view on ${doctype} must use a positive integer pageSize`, {
      status: 400
    });
  }
  return Math.min(pageSize, MAX_LIST_PAGE_SIZE);
}

function normalizeFilterOperator(operator: unknown, errorCode: FrameworkErrorCode): ListFilterOperator {
  if (operator === undefined) {
    return "eq";
  }
  if (operator === "eq" || operator === "contains" || operator === "gte" || operator === "lte") {
    return operator;
  }
  throw new FrameworkError(errorCode, `Unsupported list filter operator '${String(operator)}'`, { status: 400 });
}

function coerceFilterValue(
  field: FieldDefinition,
  value: JsonPrimitive,
  errorCode: FrameworkErrorCode
): JsonPrimitive {
  if (value === null) {
    throw new FrameworkError(errorCode, `Filter '${field.name}' cannot be null`, { status: 400 });
  }
  if (field.type === "integer") {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isInteger(parsed)) {
      throw new FrameworkError(errorCode, `Filter '${field.name}' must be an integer`, { status: 400 });
    }
    return parsed;
  }
  if (field.type === "number") {
    const parsed = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(parsed)) {
      throw new FrameworkError(errorCode, `Filter '${field.name}' must be a number`, { status: 400 });
    }
    return parsed;
  }
  if (field.type === "boolean") {
    if (typeof value === "boolean") {
      return value;
    }
    if (value === "true" || value === "1" || value === "on") {
      return true;
    }
    if (value === "false" || value === "0" || value === "off") {
      return false;
    }
    throw new FrameworkError(errorCode, `Filter '${field.name}' must be a boolean`, { status: 400 });
  }
  return typeof value === "string" ? value : String(value);
}

function visibleFields(doctype: DocTypeDefinition): readonly FieldDefinition[] {
  return doctype.fields.filter((field) => !field.hidden);
}

function fieldMap(doctype: DocTypeDefinition): Map<string, FieldDefinition> {
  return new Map(doctype.fields.map((field) => [field.name, field]));
}
