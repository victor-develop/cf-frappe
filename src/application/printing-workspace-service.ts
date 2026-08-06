import {
  mergePrintLayouts,
  type PrintFormatDefinition,
  type PrintLayoutDefinition,
  type PrintLetterheadDefinition
} from "../core/print-format.js";
import { notFound } from "../core/errors.js";
import type { PrintSettingsState } from "../core/print-settings.js";
import type { Actor } from "../core/types.js";
import type { PrintService } from "./print-service.js";
import type { PrintSettingsService } from "./print-settings-service.js";
import type { QueryService } from "./query-service.js";

export interface PrintFormatSummary {
  readonly name: string;
  readonly label: string;
  readonly doctype: string;
  readonly module?: string;
  readonly description?: string;
}

export interface PrintLetterheadSummary {
  readonly name: string;
  readonly label: string;
}

export interface PrintingWorkspaceOverview {
  readonly formats: readonly PrintFormatSummary[];
  readonly letterheads: readonly PrintLetterheadSummary[];
  readonly settings: PrintSettingsState;
  readonly canManageDefaultLayout: boolean;
}

export interface PrintPreviewDocument {
  readonly name: string;
}

export interface PrintFormatInspection {
  readonly format: PrintFormatDefinition;
  readonly inheritedLayout?: PrintLayoutDefinition;
  readonly effectiveLayout?: PrintLayoutDefinition;
  readonly previewDocuments: readonly PrintPreviewDocument[];
}

export interface PrintingWorkspaceServiceOptions {
  readonly prints: Pick<PrintService, "listPrintFormats" | "getPrintFormat" | "listPrintLetterheads" | "getPrintLetterhead">;
  readonly printSettings: Pick<PrintSettingsService, "defaultsFor" | "canAdminister">;
  readonly queries: Pick<QueryService, "listDocumentsForAction">;
}

export function ensurePrintingWorkspaceServiceAvailable<T>(
  service: T | undefined
): asserts service is T {
  if (service === undefined) {
    throw notFound("Printing workspace is not enabled");
  }
}

export class PrintingWorkspaceService {
  private readonly prints: PrintingWorkspaceServiceOptions["prints"];
  private readonly printSettings: PrintingWorkspaceServiceOptions["printSettings"];
  private readonly queries: PrintingWorkspaceServiceOptions["queries"];

  constructor(options: PrintingWorkspaceServiceOptions) {
    this.prints = options.prints;
    this.printSettings = options.printSettings;
    this.queries = options.queries;
  }

  async overview(actor: Actor): Promise<PrintingWorkspaceOverview> {
    const formats = this.prints.listPrintFormats(actor)
      .map((format): PrintFormatSummary => ({
        name: format.name,
        label: format.label ?? format.name,
        doctype: format.doctype,
        ...(format.module === undefined ? {} : { module: format.module }),
        ...(format.description === undefined ? {} : { description: format.description })
      }))
      .sort(comparePrintFormats);
    const letterheads = this.prints.listPrintLetterheads(actor)
      .map((letterhead): PrintLetterheadSummary => ({
        name: letterhead.name,
        label: letterhead.label ?? letterhead.name
      }))
      .sort((left, right) => left.label.localeCompare(right.label) || left.name.localeCompare(right.name));
    return {
      formats,
      letterheads,
      settings: await this.printSettings.defaultsFor(actor),
      canManageDefaultLayout: this.printSettings.canAdminister(actor)
    };
  }

  async inspectFormat(actor: Actor, formatName: string, previewLimit = 20): Promise<PrintFormatInspection> {
    const format = this.prints.getPrintFormat(actor, formatName);
    const settings = await this.printSettings.defaultsFor(actor);
    const effectiveLayout = mergePrintLayouts(settings.settings.defaultLayout, format.layout);
    const normalizedPreviewLimit = Number.isFinite(previewLimit) ? Math.trunc(previewLimit) : 20;
    const documents = await this.queries.listDocumentsForAction(
      actor,
      format.doctype,
      format.permissionAction ?? "read",
      {
        limit: Math.max(1, Math.min(50, normalizedPreviewLimit)),
        maxLimit: 50
      }
    );
    return {
      format,
      ...(settings.settings.defaultLayout === undefined ? {} : { inheritedLayout: settings.settings.defaultLayout }),
      ...(effectiveLayout === undefined ? {} : { effectiveLayout }),
      previewDocuments: documents.data.map((document) => ({ name: document.name }))
    };
  }

  inspectLetterhead(actor: Actor, letterheadName: string): PrintLetterheadDefinition {
    return this.prints.getPrintLetterhead(actor, letterheadName);
  }
}

function comparePrintFormats(left: PrintFormatSummary, right: PrintFormatSummary): number {
  return (left.module ?? "").localeCompare(right.module ?? "") ||
    left.doctype.localeCompare(right.doctype) ||
    left.label.localeCompare(right.label) ||
    left.name.localeCompare(right.name);
}
