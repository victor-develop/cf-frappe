import { permissionDenied } from "../core/errors.js";
import {
  canReadPrintLetterhead,
  mergePrintLayouts,
  type PrintFormatDefinition,
  type PrintLetterheadDefinition
} from "../core/print-format.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Actor } from "../core/types.js";
import type { PrintSettingsService } from "./print-settings-service.js";
import {
  canAccessPrintFormat,
  printDocumentSections,
  printHiddenFields,
  type PrintDocumentView,
  type PrintFieldView,
  type PrintSectionView
} from "./print-policy.js";
import { QueryService } from "./query-service.js";

export type { PrintDocumentView, PrintFieldView, PrintSectionView } from "./print-policy.js";

export interface PrintServiceOptions {
  readonly registry: ModelRegistry;
  readonly queries: QueryService;
  readonly printSettings?: PrintSettingsService;
}

export class PrintService {
  private readonly registry: ModelRegistry;
  private readonly queries: QueryService;
  private readonly printSettings: PrintSettingsService | undefined;

  constructor(options: PrintServiceOptions) {
    this.registry = options.registry;
    this.queries = options.queries;
    this.printSettings = options.printSettings;
  }

  listPrintFormats(actor: Actor, doctype?: string): readonly PrintFormatDefinition[] {
    return this.registry
      .listPrintFormats()
      .filter((format) => (doctype === undefined || format.doctype === doctype) && this.canAccess(actor, format));
  }

  getPrintFormat(actor: Actor, formatName: string): PrintFormatDefinition {
    const format = this.registry.getPrintFormat(formatName);
    if (!this.canAccess(actor, format)) {
      throw permissionDenied(`Actor '${actor.id}' cannot read print format '${format.name}'`);
    }
    return format;
  }

  listPrintLetterheads(actor: Actor): readonly PrintLetterheadDefinition[] {
    return this.registry
      .listPrintLetterheads()
      .filter((letterhead) => canReadPrintLetterhead(actor, letterhead));
  }

  getPrintLetterhead(actor: Actor, letterheadName: string): PrintLetterheadDefinition {
    const letterhead = this.registry.getPrintLetterhead(letterheadName);
    if (!canReadPrintLetterhead(actor, letterhead)) {
      throw permissionDenied(`Actor '${actor.id}' cannot read print letterhead '${letterhead.name}'`);
    }
    return letterhead;
  }

  async printDocument(actor: Actor, formatName: string, name: string): Promise<PrintDocumentView> {
    const format = this.getPrintFormat(actor, formatName);
    const doctype = this.registry.get(format.doctype);
    const document = await this.queries.getDocument(actor, format.doctype, name);
    const letterhead = format.letterhead ? this.getPrintLetterhead(actor, format.letterhead) : undefined;
    const defaultLayout = (await this.printSettings?.defaultsFor(actor))?.settings.defaultLayout;
    const layout = mergePrintLayouts(defaultLayout, format.layout);
    const hiddenPrintFields = printHiddenFields(doctype, document);
    return {
      format: layout === format.layout ? format : { ...format, ...(layout === undefined ? {} : { layout }) },
      ...(letterhead ? { letterhead } : {}),
      document,
      hiddenPrintFields: [...hiddenPrintFields],
      sections: printDocumentSections(format.sections, document, hiddenPrintFields)
    };
  }

  private canAccess(actor: Actor, format: PrintFormatDefinition): boolean {
    const doctype = this.registry.get(format.doctype);
    const letterhead = format.letterhead ? this.registry.getPrintLetterhead(format.letterhead) : undefined;
    return canAccessPrintFormat({ actor, format, doctype, letterhead });
  }

}
