import { badRequest, notFound, permissionDenied } from "../core/errors";
import { can } from "../core/permissions";
import {
  assertReportMatchesDocType,
  defineReport,
  type ReportChartDefinition,
  type ReportChartOrderBy,
  type ReportColumnDefinition,
  type ReportDefinition,
  type ReportFilterDefinition,
  type ReportGroupDefinition,
  type ReportOrder,
  type ReportSummaryDefinition
} from "../core/reports";
import type { ModelRegistry } from "../core/registry";
import { savedReportsStream } from "../core/streams";
import {
  DEFAULT_TENANT_ID,
  type Actor,
  type DocTypeDefinition,
  type DomainEvent,
  type JsonObject,
  type JsonValue,
  type FieldType,
  type NewDomainEvent,
  type TenantId
} from "../core/types";
import type { Clock } from "../ports/clock";
import { systemClock } from "../ports/clock";
import type { EventStore } from "../ports/event-store";
import type { IdGenerator } from "../ports/id-generator";
import { cryptoIdGenerator } from "../ports/id-generator";
import type {
  ReportCsvExport,
  ReportCsvExportOptions,
  ReportRunOptions,
  ReportRunResult
} from "./report-service";
import { ReportService } from "./report-service";

const MAX_REPORT_LABEL_LENGTH = 140;

export interface SavedReportDefinition {
  readonly columns: readonly ReportColumnDefinition[];
  readonly filters?: readonly ReportFilterDefinition[];
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

export interface SavedReportServiceOptions {
  readonly registry: ModelRegistry;
  readonly events: EventStore;
  readonly reports: ReportService;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}

export interface SaveReportCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly label: string;
  readonly definition: SavedReportDefinition;
  readonly id?: string;
  readonly tenantId?: TenantId;
}

export interface DeleteSavedReportCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly id: string;
  readonly tenantId?: TenantId;
}

export interface RunSavedReportCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly id: string;
  readonly tenantId?: TenantId;
  readonly options?: ReportRunOptions;
}

export interface ExportSavedReportCsvCommand {
  readonly actor: Actor;
  readonly doctype: string;
  readonly id: string;
  readonly tenantId?: TenantId;
  readonly options?: ReportCsvExportOptions;
}

export class SavedReportService {
  private readonly registry: ModelRegistry;
  private readonly events: EventStore;
  private readonly reports: ReportService;
  private readonly clock: Clock;
  private readonly ids: IdGenerator;

  constructor(options: SavedReportServiceOptions) {
    this.registry = options.registry;
    this.events = options.events;
    this.reports = options.reports;
    this.clock = options.clock ?? systemClock;
    this.ids = options.ids ?? cryptoIdGenerator;
  }

  async list(actor: Actor, doctypeName: string, tenantId = resolveTenant(actor)): Promise<readonly SavedReport[]> {
    const doctype = this.readableDoctype(actor, doctypeName);
    const reports = await this.readAll(tenantId, doctype, actor.id);
    return [...reports].sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
  }

  async get(actor: Actor, doctypeName: string, id: string, tenantId = resolveTenant(actor)): Promise<SavedReport> {
    const doctype = this.readableDoctype(actor, doctypeName);
    const report = (await this.readAll(tenantId, doctype, actor.id)).find((item) => item.id === id);
    if (!report) {
      throw notFound(`Saved report '${id}' was not found`);
    }
    return report;
  }

  async save(command: SaveReportCommand): Promise<SavedReport> {
    const doctype = this.readableDoctype(command.actor, command.doctype);
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const stream = savedReportsStream(tenantId, doctype.name, command.actor.id);
    const events = await this.events.readStream(stream, {
      payloadKinds: ["SavedReportSaved", "SavedReportDeleted"]
    });
    const current = foldSavedReports(tenantId, doctype, events).filter(
      (report) => report.ownerId === command.actor.id
    );
    const existing = command.id ? current.find((report) => report.id === command.id) : undefined;
    if (command.id && !existing) {
      throw notFound(`Saved report '${command.id}' was not found`);
    }
    const label = normalizeLabel(command.label);
    const definition = normalizeDefinition(doctype, label, command.definition);
    const id = command.id ?? this.ids.next("report_");
    const now = this.clock.now();
    const event = newEvent({
      id: this.ids.next("evt_"),
      tenantId,
      stream,
      type: `${doctype.name}SavedReportSaved`,
      doctype: doctype.name,
      documentName: id,
      actorId: command.actor.id,
      occurredAt: now,
      payload: {
        kind: "SavedReportSaved",
        reportId: id,
        label,
        ownerId: command.actor.id,
        definition: definitionToPayload(definition)
      },
      metadata: {}
    });
    await this.events.append(stream, currentVersion(events), [event]);
    return {
      tenantId,
      doctype: doctype.name,
      id,
      label,
      ownerId: command.actor.id,
      definition,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
  }

  async delete(command: DeleteSavedReportCommand): Promise<void> {
    const doctype = this.readableDoctype(command.actor, command.doctype);
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const stream = savedReportsStream(tenantId, doctype.name, command.actor.id);
    const events = await this.events.readStream(stream, {
      payloadKinds: ["SavedReportSaved", "SavedReportDeleted"]
    });
    const existing = foldSavedReports(tenantId, doctype, events)
      .filter((report) => report.ownerId === command.actor.id)
      .find((report) => report.id === command.id);
    if (!existing) {
      throw notFound(`Saved report '${command.id}' was not found`);
    }
    const now = this.clock.now();
    await this.events.append(stream, currentVersion(events), [
      newEvent({
        id: this.ids.next("evt_"),
        tenantId,
        stream,
        type: `${doctype.name}SavedReportDeleted`,
        doctype: doctype.name,
        documentName: command.id,
        actorId: command.actor.id,
        occurredAt: now,
        payload: {
          kind: "SavedReportDeleted",
          reportId: command.id,
          ownerId: command.actor.id
        },
        metadata: {}
      })
    ]);
  }

  async run(command: RunSavedReportCommand): Promise<ReportRunResult> {
    const saved = await this.get(command.actor, command.doctype, command.id, command.tenantId);
    return this.reports.runReportDefinition(command.actor, toReportDefinition(saved), command.options ?? {});
  }

  async exportCsv(command: ExportSavedReportCsvCommand): Promise<ReportCsvExport> {
    const saved = await this.get(command.actor, command.doctype, command.id, command.tenantId);
    return this.reports.exportReportDefinitionCsv(command.actor, toReportDefinition(saved), command.options ?? {});
  }

  private readableDoctype(actor: Actor, doctypeName: string): DocTypeDefinition {
    const doctype = this.registry.get(doctypeName);
    if (!can(actor, doctype, "read")) {
      throw permissionDenied(`Actor '${actor.id}' cannot read ${doctype.name}`);
    }
    return doctype;
  }

  private async readAll(
    tenantId: TenantId,
    doctype: DocTypeDefinition,
    ownerId: string
  ): Promise<readonly SavedReport[]> {
    const stream = savedReportsStream(tenantId, doctype.name, ownerId);
    const events = await this.events.readStream(stream, {
      payloadKinds: ["SavedReportSaved", "SavedReportDeleted"]
    });
    return foldSavedReports(tenantId, doctype, events).filter((report) => report.ownerId === ownerId);
  }
}

function foldSavedReports(
  tenantId: TenantId,
  doctype: DocTypeDefinition,
  events: readonly DomainEvent[]
): readonly SavedReport[] {
  const reports = new Map<string, SavedReport>();
  for (const event of [...events].sort((left, right) => left.sequence - right.sequence)) {
    switch (event.payload.kind) {
      case "SavedReportSaved": {
        const existing = reports.get(event.payload.reportId);
        reports.set(event.payload.reportId, {
          tenantId,
          doctype: doctype.name,
          id: event.payload.reportId,
          label: event.payload.label,
          ownerId: event.payload.ownerId,
          definition: definitionFromPayload(event.payload.definition),
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
  return [...reports.values()];
}

function normalizeLabel(label: string): string {
  const normalized = label.trim();
  if (normalized.length === 0) {
    throw badRequest("Saved report label is required");
  }
  if (normalized.length > MAX_REPORT_LABEL_LENGTH) {
    throw badRequest(`Saved report label exceeds ${MAX_REPORT_LABEL_LENGTH} characters`);
  }
  return normalized;
}

function normalizeDefinition(
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
    ...(definition.summaries ? { summaries: definition.summaries } : {}),
    ...(definition.groups ? { groups: definition.groups } : {}),
    ...(definition.charts ? { charts: definition.charts } : {}),
    ...(definition.orderBy === undefined ? {} : { orderBy: definition.orderBy }),
    ...(definition.order === undefined ? {} : { order: definition.order })
  });
  assertReportMatchesDocType(report, doctype);
  return reportDefinitionToSavedDefinition(report);
}

function reportDefinitionToSavedDefinition(report: ReportDefinition): SavedReportDefinition {
  return {
    columns: report.columns,
    ...(report.filters ? { filters: report.filters } : {}),
    ...(report.summaries ? { summaries: report.summaries } : {}),
    ...(report.groups ? { groups: report.groups } : {}),
    ...(report.charts ? { charts: report.charts } : {}),
    ...(report.orderBy === undefined ? {} : { orderBy: report.orderBy }),
    ...(report.order === undefined ? {} : { order: report.order })
  };
}

function toReportDefinition(saved: SavedReport): ReportDefinition {
  return defineReport({
    name: runtimeReportName(saved.id),
    label: saved.label,
    doctype: saved.doctype,
    columns: saved.definition.columns,
    ...(saved.definition.filters ? { filters: saved.definition.filters } : {}),
    ...(saved.definition.summaries ? { summaries: saved.definition.summaries } : {}),
    ...(saved.definition.groups ? { groups: saved.definition.groups } : {}),
    ...(saved.definition.charts ? { charts: saved.definition.charts } : {}),
    ...(saved.definition.orderBy === undefined ? {} : { orderBy: saved.definition.orderBy }),
    ...(saved.definition.order === undefined ? {} : { order: saved.definition.order })
  });
}

function definitionToPayload(definition: SavedReportDefinition): JsonObject {
  return compactObject({
    columns: definition.columns.map(columnToPayload),
    filters: definition.filters?.map(filterToPayload),
    summaries: definition.summaries?.map(summaryToPayload),
    groups: definition.groups?.map(groupToPayload),
    charts: definition.charts?.map(chartToPayload),
    orderBy: definition.orderBy,
    order: definition.order
  });
}

function definitionFromPayload(payload: JsonObject): SavedReportDefinition {
  return {
    columns: objectArray(payload.columns, "columns").map(columnFromPayload),
    ...(payload.filters === undefined ? {} : { filters: objectArray(payload.filters, "filters").map(filterFromPayload) }),
    ...(payload.summaries === undefined ? {} : { summaries: objectArray(payload.summaries, "summaries").map(summaryFromPayload) }),
    ...(payload.groups === undefined ? {} : { groups: objectArray(payload.groups, "groups").map(groupFromPayload) }),
    ...(payload.charts === undefined ? {} : { charts: objectArray(payload.charts, "charts").map(chartFromPayload) }),
    ...(typeof payload.orderBy === "string" ? { orderBy: payload.orderBy } : {}),
    ...(payload.order === "asc" || payload.order === "desc" ? { order: payload.order } : {})
  };
}

function columnToPayload(column: ReportColumnDefinition): JsonObject {
  return compactObject({ name: column.name, label: column.label, field: column.field, type: column.type });
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
    showValues: chart.showValues
  });
}

function columnFromPayload(payload: JsonObject): ReportColumnDefinition {
  const type = typeof payload.type === "string" ? payload.type as FieldType : undefined;
  return {
    name: requiredString(payload.name, "column.name"),
    ...(typeof payload.label === "string" ? { label: payload.label } : {}),
    ...(typeof payload.field === "string" ? { field: payload.field } : {}),
    ...(type === undefined ? {} : { type })
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
    ...(isJsonPrimitive(payload.defaultValue) ? { defaultValue: payload.defaultValue } : {})
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
    ...(typeof payload.label === "string" ? { label: payload.label } : {})
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
    ...(typeof payload.showValues === "boolean" ? { showValues: payload.showValues } : {})
  };
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

function stringArray(value: JsonValue | undefined): readonly string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

function requiredString(value: JsonValue | undefined, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw badRequest(`Saved report definition '${field}' is invalid`);
  }
  return value;
}

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonPrimitive(value: JsonValue | undefined): value is string | number | boolean | null {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function runtimeReportName(id: string): string {
  const safeId = id.replaceAll(/[^A-Za-z0-9_ ]+/g, " ").trim() || "Report";
  return `Saved Report ${safeId}`;
}

function resolveTenant(actor: Actor, explicitTenantId?: TenantId): TenantId {
  return explicitTenantId ?? actor.tenantId ?? DEFAULT_TENANT_ID;
}

function currentVersion(events: readonly DomainEvent[]): number {
  return events.at(-1)?.sequence ?? 0;
}

function newEvent<TPayload extends NewDomainEvent["payload"]>(event: NewDomainEvent<TPayload>): NewDomainEvent<TPayload> {
  return event;
}
