import { FrameworkError, type FrameworkErrorCode } from "./errors.js";
import type {
  DocTypeDefinition,
  FieldDefinition,
  JsonPrimitive,
  ListFilterValue,
  ListFilterBuilderField,
  ListDocumentsFilter,
  ListFilterControlDefinition,
  ListFilterInputType,
  ListFilterOperator,
  ListFilterOperatorOption,
  ListOrderDirection,
  ListOrderOption,
  ResolvedListView
} from "./types.js";

export const DEFAULT_LIST_PAGE_SIZE = 50;
export const MAX_LIST_PAGE_SIZE = 200;
export const DEFAULT_LIST_ORDER_BY = "updatedAt";
export const DEFAULT_LIST_ORDER: ListOrderDirection = "desc";
export const LIST_FILTER_OPERATORS = ["eq", "ne", "in", "not_in", "contains", "gt", "gte", "lt", "lte", "between"] as const;
export const LIST_ORDER_DIRECTIONS = ["asc", "desc"] as const;
const SYSTEM_LIST_ORDER_OPTIONS = [
  { name: "name", label: "Name" },
  { name: "createdAt", label: "Created" },
  { name: "updatedAt", label: "Updated" },
  { name: "version", label: "Version" }
] as const satisfies readonly ListOrderOption[];
const SYSTEM_LIST_FILTER_FIELDS = [
  { name: "system.name", label: "Name", type: "text", readOnly: true },
  { name: "system.docstatus", label: "Status", type: "select", options: ["draft", "submitted", "cancelled"], readOnly: true },
  { name: "system.createdAt", label: "Created", type: "datetime", readOnly: true },
  { name: "system.updatedAt", label: "Updated", type: "datetime", readOnly: true },
  { name: "system.version", label: "Version", type: "integer", readOnly: true }
] as const satisfies readonly FieldDefinition[];
const LIST_FILTER_OPERATOR_LABELS: Record<ListFilterOperator, string> = {
  eq: "equals",
  ne: "is not",
  in: "is in",
  not_in: "is not in",
  contains: "contains",
  gt: "greater than",
  gte: "greater than or equal",
  lt: "less than",
  lte: "less than or equal",
  between: "between"
};

export function isListFilterOperator(operator: unknown): operator is ListFilterOperator {
  return typeof operator === "string" && LIST_FILTER_OPERATORS.includes(operator as ListFilterOperator);
}

export function isListMembershipOperator(operator: ListFilterOperator): operator is "in" | "not_in" {
  return operator === "in" || operator === "not_in";
}

export function isListRangeOperator(operator: ListFilterOperator): operator is "between" {
  return operator === "between";
}

export function isListOrderDirection(order: unknown): order is ListOrderDirection {
  return typeof order === "string" && LIST_ORDER_DIRECTIONS.includes(order as ListOrderDirection);
}

export function listFilterOperatorsForField(field: FieldDefinition): readonly ListFilterOperatorOption[] {
  return supportedListFilterOperatorsForField(field).map((operator) => ({
    operator,
    label: LIST_FILTER_OPERATOR_LABELS[operator]
  }));
}

export function listFilterControlsForField(field: FieldDefinition): readonly ListFilterControlDefinition[] {
  if (!isFilterable(field)) {
    return [];
  }
  return defaultListFilterControlOperators(field).map((control) => listFilterControl(field, control));
}

interface NormalizeListFiltersOptions {
  readonly errorCode?: FrameworkErrorCode;
}

export function assertListViewDefinition(doctype: DocTypeDefinition): void {
  resolveListView(doctype);
}

export function resolveListView(doctype: DocTypeDefinition): ResolvedListView {
  const columns = resolveListColumns(doctype);
  const filterFields = resolveListFilterFields(doctype, columns);
  const order = normalizeListOrder(doctype, doctype.listView?.orderBy, doctype.listView?.order, {
    errorCode: "LIST_VIEW_INVALID"
  });
  return {
    columns,
    filterFields,
    filterBuilderFields: listFilterBuilderFields(filterFields),
    filterControls: filterFields.flatMap(listFilterControlsForField),
    filters: normalizeListFilters(doctype, doctype.listView?.filters ?? [], { errorCode: "LIST_VIEW_INVALID" }),
    orderBy: order.orderBy,
    order: order.order,
    orderOptions: listOrderOptionsForDocType(doctype),
    pageSize: normalizeListPageSize(doctype.listView?.pageSize, doctype.name)
  };
}

export function normalizeListOrder(
  doctype: DocTypeDefinition,
  orderBy = DEFAULT_LIST_ORDER_BY,
  order: ListOrderDirection = DEFAULT_LIST_ORDER,
  options: NormalizeListFiltersOptions = {}
): { readonly orderBy: string; readonly order: ListOrderDirection } {
  const errorCode = options.errorCode ?? "BAD_REQUEST";
  if (!isListOrderDirection(order)) {
    throw new FrameworkError(errorCode, "List order must be asc or desc", { status: 400 });
  }
  if (systemOrderOption(orderBy)) {
    return { orderBy, order };
  }
  const field = fieldMap(doctype).get(orderBy);
  if (!field) {
    throw new FrameworkError(errorCode, `List orderBy field '${orderBy}' is not defined on ${doctype.name}`, {
      status: 400
    });
  }
  if (field.hidden) {
    throw new FrameworkError(errorCode, `List orderBy field '${orderBy}' is hidden on ${doctype.name}`, {
      status: 400
    });
  }
  if (!isListSortable(field)) {
    throw new FrameworkError(errorCode, `List orderBy field '${orderBy}' cannot be a ${field.type} field`, {
      status: 400
    });
  }
  return { orderBy, order };
}

export function listOrderOptionsForDocType(doctype: DocTypeDefinition): readonly ListOrderOption[] {
  return [
    ...SYSTEM_LIST_ORDER_OPTIONS,
    ...doctype.fields
      .filter(isListSortable)
      .filter((field) => !systemOrderOption(field.name))
      .map((field) => ({ name: field.name, label: field.label ?? field.name }))
  ];
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
    const field = systemFilterField(filter.field) ?? fields.get(filter.field);
    if (!field) {
      throw new FrameworkError(errorCode, `Filter field '${filter.field}' is not defined on ${doctype.name}`, {
        status: 400
      });
    }
    if (!isFilterable(field)) {
      throw new FrameworkError(errorCode, `Filter field '${filter.field}' cannot be a ${field.type} field`, {
        status: 400
      });
    }
    const operator = normalizeFilterOperator(filter.operator, errorCode);
    if (!operatorAllowedForField(field, operator)) {
      throw new FrameworkError(errorCode, `Filter '${filter.field}' does not support ${operator}`, {
        status: 400
      });
    }
    return {
      field: filter.field,
      ...(operator === "eq" ? {} : { operator }),
      value: coerceFilterValue(field, filter.value, operator, errorCode)
    };
  });
}

export function mergeListFilters(
  defaults: readonly ListDocumentsFilter[],
  overrides: readonly ListDocumentsFilter[]
): readonly ListDocumentsFilter[] {
  if (defaults.length === 0) {
    return overrides;
  }
  if (overrides.length === 0) {
    return defaults;
  }
  return [
    ...defaults.filter((filter) => !overrides.some((override) => filterIsOverridden(filter, override))),
    ...overrides
  ];
}

function filterIsOverridden(defaultFilter: ListDocumentsFilter, overrideFilter: ListDocumentsFilter): boolean {
  if (defaultFilter.field !== overrideFilter.field) {
    return false;
  }
  const defaultOperator = defaultFilter.operator ?? "eq";
  const overrideOperator = overrideFilter.operator ?? "eq";
  return defaultOperator === overrideOperator || defaultOperator === "eq" || overrideOperator === "eq";
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
  return flagged.length > 0 ? ensureFilterable(flagged) : columns.filter(isFilterable);
}

function listFilterBuilderFields(filterFields: readonly FieldDefinition[]): readonly ListFilterBuilderField[] {
  const explicit = filterFields.map(listFilterBuilderField);
  const existing = new Set(explicit.map((field) => field.field));
  return [
    ...explicit,
    ...SYSTEM_LIST_FILTER_FIELDS
      .filter((field) => !existing.has(field.name))
      .map(listFilterBuilderField)
  ];
}

function resolveFields(
  doctype: DocTypeDefinition,
  names: readonly string[],
  label: string
): readonly FieldDefinition[] {
  const fields = fieldMap(doctype);
  const seen = new Set<string>();
  return names.map((name) => {
    const field = label === "filter field" ? systemFilterField(name) ?? fields.get(name) : fields.get(name);
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
    if (!isFilterable(field)) {
      throw new FrameworkError("LIST_VIEW_INVALID", `List filter field '${field.name}' cannot be a ${field.type} field`, {
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
  if (isListFilterOperator(operator)) {
    return operator;
  }
  throw new FrameworkError(errorCode, `Unsupported list filter operator '${String(operator)}'`, { status: 400 });
}

function operatorAllowedForField(field: FieldDefinition, operator: ListFilterOperator): boolean {
  return supportedListFilterOperatorsForField(field).includes(operator);
}

function systemOrderOption(name: string): boolean {
  return SYSTEM_LIST_ORDER_OPTIONS.some((option) => option.name === name);
}

function systemFilterField(name: string): FieldDefinition | undefined {
  return SYSTEM_LIST_FILTER_FIELDS.find((field) => field.name === name);
}

function isListSortable(field: FieldDefinition): boolean {
  return !field.hidden && field.type !== "json" && field.type !== "table";
}

function supportedListFilterOperatorsForField(field: FieldDefinition): readonly ListFilterOperator[] {
  if (!isFilterable(field)) {
    return [];
  }
  const operators: ListFilterOperator[] = ["eq", "ne", "in", "not_in"];
  if (field.type === "text" || field.type === "longText" || field.type === "link") {
    operators.push("contains");
  }
  if (field.type === "integer" || field.type === "number" || field.type === "date" || field.type === "datetime") {
    operators.push("gt", "gte", "lt", "lte", "between");
  }
  return operators;
}

function defaultListFilterControlOperators(
  field: FieldDefinition
): readonly { readonly operator: ListFilterOperator; readonly labelSuffix?: string }[] {
  switch (field.type) {
    case "text":
    case "longText":
    case "link":
      return [
        { operator: "contains" },
        { operator: "ne", labelSuffix: "is not" }
      ];
    case "integer":
    case "number":
    case "date":
    case "datetime":
      return [
        { operator: "gte", labelSuffix: "from" },
        { operator: "lte", labelSuffix: "to" }
      ];
    default:
      return [
        { operator: "eq" },
        { operator: "ne", labelSuffix: "is not" }
      ];
  }
}

function listFilterControl(
  field: FieldDefinition,
  control: { readonly operator: ListFilterOperator; readonly labelSuffix?: string }
): ListFilterControlDefinition {
  return {
    field: field.name,
    operator: control.operator,
    operatorLabel: LIST_FILTER_OPERATOR_LABELS[control.operator],
    inputType: listFilterInputType(field),
    queryKey: listFilterQueryKey(field.name, control.operator),
    ...(control.labelSuffix ? { labelSuffix: control.labelSuffix } : {})
  };
}

function listFilterBuilderField(field: FieldDefinition): ListFilterBuilderField {
  return {
    field: field.name,
    inputType: listFilterInputType(field),
    operators: listFilterOperatorsForField(field)
  };
}

function listFilterQueryKey(field: string, operator: ListFilterOperator): string {
  return `filter_${field}${operator === "eq" ? "" : `__${operator}`}`;
}

function listFilterInputType(field: FieldDefinition): ListFilterInputType {
  switch (field.type) {
    case "integer":
    case "number":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime-local";
    case "select":
      return "select";
    case "boolean":
      return "boolean";
    default:
      return "text";
  }
}

function coerceFilterValue(
  field: FieldDefinition,
  value: ListFilterValue,
  operator: ListFilterOperator,
  errorCode: FrameworkErrorCode
): ListFilterValue {
  if (isListMembershipOperator(operator)) {
    if (!isFilterValueArray(value)) {
      throw new FrameworkError(errorCode, `Filter '${field.name}' must use an array value for ${operator}`, {
        status: 400
      });
    }
    if (value.length === 0) {
      throw new FrameworkError(errorCode, `Filter '${field.name}' must include at least one value`, { status: 400 });
    }
    return value.map((item) => coerceScalarFilterValue(field, item, errorCode));
  }
  if (isListRangeOperator(operator)) {
    if (!isFilterValueArray(value)) {
      throw new FrameworkError(errorCode, `Filter '${field.name}' must use an array value for ${operator}`, {
        status: 400
      });
    }
    if (value.length !== 2) {
      throw new FrameworkError(errorCode, `Filter '${field.name}' must include exactly two values for ${operator}`, {
        status: 400
      });
    }
    return value.map((item) => coerceRangeFilterValue(field, item, errorCode));
  }
  if (isFilterValueArray(value)) {
    throw new FrameworkError(errorCode, `Filter '${field.name}' must use a scalar value for ${operator}`, {
      status: 400
    });
  }
  return coerceScalarFilterValue(field, value, errorCode);
}

function isFilterValueArray(value: ListFilterValue): value is readonly JsonPrimitive[] {
  return Array.isArray(value);
}

function coerceScalarFilterValue(
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

function coerceRangeFilterValue(
  field: FieldDefinition,
  value: JsonPrimitive,
  errorCode: FrameworkErrorCode
): JsonPrimitive {
  if (value === null) {
    throw new FrameworkError(errorCode, `Filter '${field.name}' range values cannot be null`, { status: 400 });
  }
  if (typeof value === "string" && value.trim() === "") {
    throw new FrameworkError(errorCode, `Filter '${field.name}' range values cannot be empty`, { status: 400 });
  }
  if (field.type === "date" || field.type === "datetime") {
    if (typeof value !== "string") {
      throw new FrameworkError(errorCode, `Filter '${field.name}' range values must be strings`, { status: 400 });
    }
    return value;
  }
  if (typeof value === "boolean") {
    throw new FrameworkError(errorCode, `Filter '${field.name}' range values cannot be boolean`, { status: 400 });
  }
  return coerceScalarFilterValue(field, value, errorCode);
}

function visibleFields(doctype: DocTypeDefinition): readonly FieldDefinition[] {
  return doctype.fields.filter((field) => !field.hidden);
}

function isFilterable(field: FieldDefinition): boolean {
  return field.type !== "json" && field.type !== "table";
}

function fieldMap(doctype: DocTypeDefinition): Map<string, FieldDefinition> {
  return new Map(doctype.fields.map((field) => [field.name, field]));
}
