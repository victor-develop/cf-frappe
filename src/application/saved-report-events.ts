import { badRequest } from "../core/errors.js";
import { domainEventPayloadKind } from "../core/domain-events.js";
import {
  assertReportMatchesDocType,
  defineReport,
  REPORT_FILTER_EXPRESSION_MAX_DEPTH,
  REPORT_FILTER_EXPRESSION_MAX_NODES,
  REPORT_FORMULA_MAX_DEPTH,
  type ReportChartDefinition,
  type ReportChartOrderBy,
  type ReportColumnDefinition,
  type ReportDefinition,
  type ReportFilterDefinition,
  type ReportFilterExpression,
  type ReportFilterValue,
  type ReportFormulaOperand,
  type ReportGroupDefinition,
  type ReportOrder,
  type ReportSummaryDefinition
} from "../core/reports.js";
import type {
  DocTypeDefinition,
  DomainEvent,
  FieldType,
  JsonObject,
  JsonValue,
  NewDomainEvent,
  TenantId
} from "../core/types.js";

const MAX_REPORT_LABEL_LENGTH = 140;

export type SavedReportEventPayload =
  | {
      readonly kind: "SavedReportSaved";
      readonly reportId: string;
      readonly label: string;
      readonly ownerId: string;
      readonly definition: JsonObject;
    }
  | {
      readonly kind: "SavedReportDeleted";
      readonly reportId: string;
      readonly ownerId: string;
    };

export type SavedReportPayloadKind = SavedReportEventPayload["kind"];

export const SAVED_REPORT_PAYLOAD_KINDS = Object.freeze([
  "SavedReportSaved",
  "SavedReportDeleted"
] as const satisfies readonly SavedReportPayloadKind[]);

const SAVED_REPORT_PAYLOAD_KIND_SET = new Set<string>(SAVED_REPORT_PAYLOAD_KINDS);

export interface SavedReportDefinition {
  readonly columns: readonly ReportColumnDefinition[];
  readonly filters?: readonly ReportFilterDefinition[];
  readonly filterExpression?: ReportFilterExpression;
  readonly summaries?: readonly ReportSummaryDefinition[];
  readonly groups?: readonly ReportGroupDefinition[];
  readonly charts?: readonly ReportChartDefinition[];
  readonly orderBy?: string;
  readonly order?: ReportOrder;
}

export interface SavedReport {
  readonly tenantId: TenantId;
  readonly doctype: string;
  readonly id: string;
  readonly label: string;
  readonly ownerId: string;
  readonly definition: SavedReportDefinition;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SavedReportState {
  readonly tenantId: TenantId;
  readonly doctype: string;
  readonly version: number;
  readonly reports: ReadonlyMap<string, SavedReport>;
}

export function foldSavedReports(
  tenantId: TenantId,
  doctype: DocTypeDefinition,
  events: readonly DomainEvent[]
): SavedReportState {
  const reports = new Map<string, SavedReport>();
  let version = 0;
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    version = Math.max(version, event.sequence);
    switch (event.payload.kind) {
      case "SavedReportSaved": {
        const existing = reports.get(event.payload.reportId);
        const label = normalizeSavedReportLabel(event.payload.label);
        const definition = normalizeSavedReportDefinition(
          doctype,
          label,
          savedReportDefinitionFromPayload(event.payload.definition)
        );
        reports.set(event.payload.reportId, {
          tenantId,
          doctype: doctype.name,
          id: event.payload.reportId,
          label,
          ownerId: event.payload.ownerId,
          definition,
          createdAt: existing?.createdAt ?? event.occurredAt,
          updatedAt: event.occurredAt
        });
        break;
      }
      case "SavedReportDeleted":
        reports.delete(event.payload.reportId);
        break;
    }
  }
  return {
    tenantId,
    doctype: doctype.name,
    version,
    reports
  };
}

export function savedReportsForOwner(state: SavedReportState, ownerId: string): readonly SavedReport[] {
  return [...state.reports.values()].filter((report) => report.ownerId === ownerId);
}

export function sortedSavedReports(reports: readonly SavedReport[]): readonly SavedReport[] {
  return [...reports].sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}

export function normalizeSavedReportLabel(label: string): string {
  const normalized = label.trim();
  if (normalized.length === 0) {
    throw badRequest("Saved report label is required");
  }
  if (normalized.length > MAX_REPORT_LABEL_LENGTH) {
    throw badRequest(`Saved report label exceeds ${MAX_REPORT_LABEL_LENGTH} characters`);
  }
  return normalized;
}

export function normalizeSavedReportDefinition(
  doctype: DocTypeDefinition,
  label: string,
  definition: SavedReportDefinition
): SavedReportDefinition {
  const report = defineReport({
    name: "Saved Report Draft",
    label,
    doctype: doctype.name,
    columns: definition.columns,
    ...(definition.filters ? { filters: definition.filters } : {}),
    ...(definition.filterExpression === undefined ? {} : { filterExpression: definition.filterExpression }),
    ...(definition.summaries ? { summaries: definition.summaries } : {}),
    ...(definition.groups ? { groups: definition.groups } : {}),
    ...(definition.charts ? { charts: definition.charts } : {}),
    ...(definition.orderBy === undefined ? {} : { orderBy: definition.orderBy }),
    ...(definition.order === undefined ? {} : { order: definition.order })
  });
  assertReportMatchesDocType(report, doctype);
  return reportDefinitionToSavedDefinition(report);
}

export function reportDefinitionToSavedDefinition(report: ReportDefinition): SavedReportDefinition {
  return {
    columns: report.columns,
    ...(report.filters ? { filters: report.filters } : {}),
    ...(report.filterExpression === undefined ? {} : { filterExpression: report.filterExpression }),
    ...(report.summaries ? { summaries: report.summaries } : {}),
    ...(report.groups ? { groups: report.groups } : {}),
    ...(report.charts ? { charts: report.charts } : {}),
    ...(report.orderBy === undefined ? {} : { orderBy: report.orderBy }),
    ...(report.order === undefined ? {} : { order: report.order })
  };
}

export function savedReportToReportDefinition(saved: SavedReport): ReportDefinition {
  return defineReport({
    name: savedReportRuntimeName(saved.id),
    label: saved.label,
    doctype: saved.doctype,
    columns: saved.definition.columns,
    ...(saved.definition.filters ? { filters: saved.definition.filters } : {}),
    ...(saved.definition.filterExpression === undefined ? {} : { filterExpression: saved.definition.filterExpression }),
    ...(saved.definition.summaries ? { summaries: saved.definition.summaries } : {}),
    ...(saved.definition.groups ? { groups: saved.definition.groups } : {}),
    ...(saved.definition.charts ? { charts: saved.definition.charts } : {}),
    ...(saved.definition.orderBy === undefined ? {} : { orderBy: saved.definition.orderBy }),
    ...(saved.definition.order === undefined ? {} : { order: saved.definition.order })
  });
}

export function savedReportDefinitionToPayload(definition: SavedReportDefinition): JsonObject {
  return compactObject({
    columns: definition.columns.map(columnToPayload),
    filters: definition.filters?.map(filterToPayload),
    filterExpression: definition.filterExpression === undefined
      ? undefined
      : filterExpressionToPayload(definition.filterExpression),
    summaries: definition.summaries?.map(summaryToPayload),
    groups: definition.groups?.map(groupToPayload),
    charts: definition.charts?.map(chartToPayload),
    orderBy: definition.orderBy,
    order: definition.order
  });
}

export function savedReportDefinitionFromPayload(payload: JsonObject): SavedReportDefinition {
  return {
    columns: objectArray(payload.columns, "columns").map(columnFromPayload),
    ...(payload.filters === undefined ? {} : { filters: objectArray(payload.filters, "filters").map(filterFromPayload) }),
    ...(payload.filterExpression === undefined
      ? {}
      : { filterExpression: filterExpressionFromPayload(payload.filterExpression, "filterExpression") }),
    ...(payload.summaries === undefined ? {} : { summaries: objectArray(payload.summaries, "summaries").map(summaryFromPayload) }),
    ...(payload.groups === undefined ? {} : { groups: objectArray(payload.groups, "groups").map(groupFromPayload) }),
    ...(payload.charts === undefined ? {} : { charts: objectArray(payload.charts, "charts").map(chartFromPayload) }),
    ...(typeof payload.orderBy === "string" ? { orderBy: payload.orderBy } : {}),
    ...(payload.order === "asc" || payload.order === "desc" ? { order: payload.order } : {})
  };
}

export function savedReportCurrentVersion(events: readonly DomainEvent[]): number {
  return events.at(-1)?.sequence ?? 0;
}

export function savedReportEvent<TPayload extends SavedReportEventPayload>(
  event: NewDomainEvent<TPayload>
): NewDomainEvent<TPayload> {
  return event;
}

export function isSavedReportPayloadKind(kind: string): kind is SavedReportPayloadKind {
  return SAVED_REPORT_PAYLOAD_KIND_SET.has(kind);
}

export function isSavedReportEvent(event: DomainEvent): event is DomainEvent<SavedReportEventPayload> {
  return isSavedReportPayloadKind(domainEventPayloadKind(event));
}

function columnToPayload(column: ReportColumnDefinition): JsonObject {
  return compactObject({
    name: column.name,
    label: column.label,
    field: column.field,
    type: column.type,
    formula: column.formula === undefined ? undefined : formulaToPayload(column.formula)
  });
}

function filterToPayload(filter: ReportFilterDefinition): JsonObject {
  return compactObject({
    name: filter.name,
    label: filter.label,
    field: filter.field,
    type: filter.type,
    operator: filter.operator,
    required: filter.required,
    defaultValue: filter.defaultValue
  });
}

function summaryToPayload(summary: ReportSummaryDefinition): JsonObject {
  return compactObject({
    name: summary.name,
    label: summary.label,
    aggregate: summary.aggregate,
    field: summary.field,
    type: summary.type,
    indicator: summary.indicator
  });
}

function groupToPayload(group: ReportGroupDefinition): JsonObject {
  return compactObject({
    name: group.name,
    label: group.label,
    field: group.field,
    maxRows: group.maxRows,
    summaries: group.summaries.map(summaryToPayload)
  });
}

function chartToPayload(chart: ReportChartDefinition): JsonObject {
  return compactObject({
    name: chart.name,
    label: chart.label,
    type: chart.type,
    group: chart.group,
    summary: chart.summary,
    maxPoints: chart.maxPoints,
    orderBy: chart.orderBy,
    order: chart.order,
    colors: chart.colors ? [...chart.colors] : undefined,
    showValues: chart.showValues,
    xAxisLabel: chart.xAxisLabel,
    yAxisLabel: chart.yAxisLabel
  });
}

function formulaToPayload(formula: NonNullable<ReportColumnDefinition["formula"]>): JsonObject {
  return {
    operator: formula.operator,
    left: formulaOperandToPayload(formula.left),
    right: formulaOperandToPayload(formula.right)
  };
}

function formulaOperandToPayload(operand: ReportFormulaOperand): JsonValue {
  return typeof operand === "object" ? formulaToPayload(operand) : operand;
}

function filterExpressionToPayload(expression: ReportFilterExpression): JsonObject {
  if (isReportFilterExpressionGroup(expression)) {
    return {
      kind: "group",
      match: expression.match,
      filters: expression.filters.map(filterExpressionToPayload)
    };
  }
  return {
    filter: expression.filter,
    value: Array.isArray(expression.value) ? [...expression.value] : expression.value
  };
}

function columnFromPayload(payload: JsonObject): ReportColumnDefinition {
  const type = typeof payload.type === "string" ? payload.type as FieldType : undefined;
  const formula = payload.formula !== undefined && isJsonObject(payload.formula)
    ? formulaFromPayload(payload.formula)
    : undefined;
  return {
    name: requiredString(payload.name, "column.name"),
    ...(typeof payload.label === "string" ? { label: payload.label } : {}),
    ...(typeof payload.field === "string" ? { field: payload.field } : {}),
    ...(type === undefined ? {} : { type }),
    ...(formula === undefined ? {} : { formula })
  };
}

function filterFromPayload(payload: JsonObject): ReportFilterDefinition {
  const type = typeof payload.type === "string" ? payload.type as FieldType : undefined;
  const operator = typeof payload.operator === "string" ? payload.operator as ReportFilterDefinition["operator"] : undefined;
  return {
    name: requiredString(payload.name, "filter.name"),
    field: requiredString(payload.field, "filter.field"),
    ...(typeof payload.label === "string" ? { label: payload.label } : {}),
    ...(type === undefined ? {} : { type }),
    ...(operator === undefined ? {} : { operator }),
    ...(typeof payload.required === "boolean" ? { required: payload.required } : {}),
    ...(isReportFilterValue(payload.defaultValue) ? { defaultValue: payload.defaultValue } : {})
  };
}

function summaryFromPayload(payload: JsonObject): ReportSummaryDefinition {
  const type = typeof payload.type === "string" ? payload.type as FieldType : undefined;
  return {
    name: requiredString(payload.name, "summary.name"),
    aggregate: requiredString(payload.aggregate, "summary.aggregate") as ReportSummaryDefinition["aggregate"],
    ...(typeof payload.label === "string" ? { label: payload.label } : {}),
    ...(typeof payload.field === "string" ? { field: payload.field } : {}),
    ...(type === undefined ? {} : { type }),
    ...(typeof payload.indicator === "string" ? { indicator: payload.indicator } : {})
  };
}

function groupFromPayload(payload: JsonObject): ReportGroupDefinition {
  return {
    name: requiredString(payload.name, "group.name"),
    field: requiredString(payload.field, "group.field"),
    summaries: objectArray(payload.summaries, "group.summaries").map(summaryFromPayload),
    ...(typeof payload.label === "string" ? { label: payload.label } : {}),
    ...(typeof payload.maxRows === "number" ? { maxRows: payload.maxRows } : {})
  };
}

function chartFromPayload(payload: JsonObject): ReportChartDefinition {
  const orderBy = typeof payload.orderBy === "string" ? payload.orderBy as ReportChartOrderBy : undefined;
  const colors = stringArray(payload.colors);
  return {
    name: requiredString(payload.name, "chart.name"),
    type: requiredString(payload.type, "chart.type") as ReportChartDefinition["type"],
    group: requiredString(payload.group, "chart.group"),
    summary: requiredString(payload.summary, "chart.summary"),
    ...(typeof payload.label === "string" ? { label: payload.label } : {}),
    ...(typeof payload.maxPoints === "number" ? { maxPoints: payload.maxPoints } : {}),
    ...(orderBy === undefined ? {} : { orderBy }),
    ...(payload.order === "asc" || payload.order === "desc" ? { order: payload.order } : {}),
    ...(colors ? { colors } : {}),
    ...(typeof payload.showValues === "boolean" ? { showValues: payload.showValues } : {}),
    ...(typeof payload.xAxisLabel === "string" ? { xAxisLabel: payload.xAxisLabel } : {}),
    ...(typeof payload.yAxisLabel === "string" ? { yAxisLabel: payload.yAxisLabel } : {})
  };
}

function formulaFromPayload(
  payload: JsonObject,
  field = "formula",
  depth = 1
): NonNullable<ReportColumnDefinition["formula"]> {
  if (depth > REPORT_FORMULA_MAX_DEPTH) {
    throw badRequest(`Saved report definition '${field}' exceeds maximum formula depth of ${REPORT_FORMULA_MAX_DEPTH}`);
  }
  return {
    operator: requiredString(payload.operator, `${field}.operator`) as NonNullable<ReportColumnDefinition["formula"]>["operator"],
    left: formulaOperandFromPayload(payload.left, `${field}.left`, depth + 1),
    right: formulaOperandFromPayload(payload.right, `${field}.right`, depth + 1)
  };
}

function filterExpressionFromPayload(value: JsonValue | undefined, field: string): ReportFilterExpression {
  return filterExpressionNodeFromPayload(value, field, 1, { remaining: REPORT_FILTER_EXPRESSION_MAX_NODES });
}

function filterExpressionNodeFromPayload(
  value: JsonValue | undefined,
  field: string,
  depth: number,
  budget: ReportFilterExpressionPayloadBudget
): ReportFilterExpression {
  budget.remaining -= 1;
  if (budget.remaining < 0) {
    throw badRequest(
      `Saved report definition '${field}' exceeds maximum filter expression depth of ${REPORT_FILTER_EXPRESSION_MAX_DEPTH} levels or ${REPORT_FILTER_EXPRESSION_MAX_NODES} nodes`
    );
  }
  const payload = jsonObjectValue(value, field);
  if ("filter" in payload) {
    return {
      filter: requiredString(payload.filter, `${field}.filter`),
      value: reportFilterValueFromPayload(payload.value, `${field}.value`)
    };
  }
  if (depth > REPORT_FILTER_EXPRESSION_MAX_DEPTH) {
    throw badRequest(`Saved report definition '${field}' exceeds maximum filter expression depth of ${REPORT_FILTER_EXPRESSION_MAX_DEPTH}`);
  }
  if (payload.kind !== undefined && payload.kind !== "group") {
    throw badRequest(`Saved report definition '${field}.kind' is invalid`);
  }
  const filters = objectArray(payload.filters, `${field}.filters`);
  if (filters.length === 0) {
    throw badRequest(`Saved report definition '${field}.filters' is invalid`);
  }
  if (payload.match !== "all" && payload.match !== "any") {
    throw badRequest(`Saved report definition '${field}.match' is invalid`);
  }
  return {
    kind: "group",
    match: payload.match,
    filters: filters.map((item, index) =>
      filterExpressionNodeFromPayload(item, `${field}.filters.${index}`, depth + 1, budget)
    )
  };
}

interface ReportFilterExpressionPayloadBudget {
  remaining: number;
}

function reportFilterValueFromPayload(value: JsonValue | undefined, field: string): ReportFilterValue {
  if (isJsonPrimitive(value)) {
    return value;
  }
  if (Array.isArray(value) && value.every(isJsonPrimitive)) {
    return value;
  }
  throw badRequest(`Saved report definition '${field}' is invalid`);
}

function formulaOperandFromPayload(value: JsonValue | undefined, field: string, depth: number): ReportFormulaOperand {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value !== undefined && isJsonObject(value)) {
    return formulaFromPayload(value, field, depth);
  }
  throw badRequest(`Saved report definition '${field}' is invalid`);
}

function compactObject(values: Readonly<Record<string, JsonValue | undefined>>): JsonObject {
  const result: Record<string, JsonValue> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function objectArray(value: JsonValue | undefined, field: string): readonly JsonObject[] {
  if (!Array.isArray(value) || !value.every(isJsonObject)) {
    throw badRequest(`Saved report definition '${field}' is invalid`);
  }
  return value;
}

function jsonObjectValue(value: JsonValue | undefined, field: string): JsonObject {
  if (!isJsonObject(value)) {
    throw badRequest(`Saved report definition '${field}' is invalid`);
  }
  return value;
}

function stringArray(value: JsonValue | undefined): readonly string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

function requiredString(value: JsonValue | undefined, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw badRequest(`Saved report definition '${field}' is invalid`);
  }
  return value;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReportFilterExpressionGroup(
  expression: ReportFilterExpression
): expression is Extract<ReportFilterExpression, { readonly kind: "group" }> {
  return "kind" in expression && expression.kind === "group";
}

function isJsonPrimitive(value: JsonValue | undefined): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function isReportFilterValue(value: JsonValue | undefined): value is NonNullable<ReportFilterDefinition["defaultValue"]> {
  return isJsonPrimitive(value) || (Array.isArray(value) && value.every(isJsonPrimitive));
}

function savedReportRuntimeName(id: string): string {
  const safeId = id.replaceAll(/[^A-Za-z0-9_ ]+/g, " ").trim() || "Report";
  return `Saved Report ${safeId}`;
}

declare module "../core/types.js" {
  interface DomainEventPayloadMap {
    readonly SavedReportSaved: Extract<
      SavedReportEventPayload,
      { readonly kind: "SavedReportSaved" }
    >;
    readonly SavedReportDeleted: Extract<
      SavedReportEventPayload,
      { readonly kind: "SavedReportDeleted" }
    >;
  }
}
