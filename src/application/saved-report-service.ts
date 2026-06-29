import { notFound, permissionDenied } from "../core/errors.js";
import type { ModelRegistry } from "../core/registry.js";
import { savedReportsStream } from "../core/streams.js";
import {
  DEFAULT_TENANT_ID,
  type Actor,
  type DocTypeDefinition,
  type TenantId
} from "../core/types.js";
import {
  foldSavedReports,
  normalizeSavedReportDefinition,
  normalizeSavedReportLabel,
  SAVED_REPORT_PAYLOAD_KINDS,
  savedReportCurrentVersion,
  savedReportDefinitionToPayload,
  savedReportEvent,
  savedReportsForOwner,
  savedReportToReportDefinition,
  sortedSavedReports,
  type SavedReport,
  type SavedReportDefinition,
  type SavedReportEventPayload
} from "./saved-report-events.js";
import {
  findSavedReport,
  planSavedReportLookup,
  planSavedReportReadAccess,
  planSavedReportDelete,
  planSavedReportSave,
  projectSavedReportSave
} from "./saved-report-policy.js";
import type { Clock } from "../ports/clock.js";
import { systemClock } from "../ports/clock.js";
import type { EventStore } from "../ports/event-store.js";
import type { IdGenerator } from "../ports/id-generator.js";
import { cryptoIdGenerator } from "../ports/id-generator.js";
import type {
  ReportCsvExport,
  ReportCsvExportOptions,
  ReportRunOptions,
  ReportRunResult
} from "./report-service.js";
import { ReportService } from "./report-service.js";

export type { SavedReportEventPayload } from "./saved-report-events.js";
export type { SavedReport, SavedReportDefinition } from "./saved-report-events.js";

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
    return sortedSavedReports(reports);
  }

  async get(actor: Actor, doctypeName: string, id: string, tenantId = resolveTenant(actor)): Promise<SavedReport> {
    const doctype = this.readableDoctype(actor, doctypeName);
    const decision = planSavedReportLookup(
      findSavedReport(await this.readAll(tenantId, doctype, actor.id), id),
      id
    );
    if (decision.status === "missing") {
      throw notFound(decision.message);
    }
    return decision.report;
  }

  async save(command: SaveReportCommand): Promise<SavedReport> {
    const doctype = this.readableDoctype(command.actor, command.doctype);
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const stream = savedReportsStream(tenantId, doctype.name, command.actor.id);
    const events = await this.events.readStream(stream, {
      payloadKinds: SAVED_REPORT_PAYLOAD_KINDS
    });
    const current = savedReportsForOwner(foldSavedReports(tenantId, doctype, events), command.actor.id);
    const existing = command.id === undefined ? undefined : findSavedReport(current, command.id);
    const decision = planSavedReportSave(existing, command.id);
    if (decision.status === "missing") {
      throw notFound(decision.message);
    }
    const label = normalizeSavedReportLabel(command.label);
    const definition = normalizeSavedReportDefinition(doctype, label, command.definition);
    const id = command.id ?? this.ids.next("report_");
    const now = this.clock.now();
    const event = savedReportEvent({
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
        definition: savedReportDefinitionToPayload(definition)
      },
      metadata: {}
    });
    await this.events.append(stream, savedReportCurrentVersion(events), [event]);
    return projectSavedReportSave({
      tenantId,
      doctype: doctype.name,
      id,
      label,
      ownerId: command.actor.id,
      definition,
      existing,
      now
    });
  }

  async delete(command: DeleteSavedReportCommand): Promise<void> {
    const doctype = this.readableDoctype(command.actor, command.doctype);
    const tenantId = resolveTenant(command.actor, command.tenantId);
    const stream = savedReportsStream(tenantId, doctype.name, command.actor.id);
    const events = await this.events.readStream(stream, {
      payloadKinds: SAVED_REPORT_PAYLOAD_KINDS
    });
    const existing = findSavedReport(
      savedReportsForOwner(foldSavedReports(tenantId, doctype, events), command.actor.id),
      command.id
    );
    const decision = planSavedReportDelete(existing, command.id);
    if (decision.status === "missing") {
      throw notFound(decision.message);
    }
    const now = this.clock.now();
    await this.events.append(stream, savedReportCurrentVersion(events), [
      savedReportEvent({
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
    return this.reports.runReportDefinition(command.actor, savedReportToReportDefinition(saved), command.options ?? {});
  }

  async exportCsv(command: ExportSavedReportCsvCommand): Promise<ReportCsvExport> {
    const saved = await this.get(command.actor, command.doctype, command.id, command.tenantId);
    return this.reports.exportReportDefinitionCsv(command.actor, savedReportToReportDefinition(saved), command.options ?? {});
  }

  private readableDoctype(actor: Actor, doctypeName: string): DocTypeDefinition {
    const doctype = this.registry.get(doctypeName);
    const decision = planSavedReportReadAccess({ actor, doctype });
    if (decision.status === "deny") {
      throw permissionDenied(decision.message);
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
      payloadKinds: SAVED_REPORT_PAYLOAD_KINDS
    });
    return savedReportsForOwner(foldSavedReports(tenantId, doctype, events), ownerId);
  }
}

function resolveTenant(actor: Actor, explicitTenantId?: TenantId): TenantId {
  return explicitTenantId ?? actor.tenantId ?? DEFAULT_TENANT_ID;
}
