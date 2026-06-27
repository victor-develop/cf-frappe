import { permissionDenied } from "../core/errors.js";
import { can } from "../core/permissions.js";
import {
  canReadPrintLetterhead,
  canReadPrintFormat,
  mergePrintLayouts,
  type PrintFormatDefinition,
  type PrintLetterheadDefinition,
  type PrintSectionDefinition
} from "../core/print-format.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Actor, DocTypeDefinition, DocumentSnapshot, JsonValue } from "../core/types.js";
import type { PrintSettingsService } from "./print-settings-service.js";
import { QueryService } from "./query-service.js";

export interface PrintFieldView {
  readonly field: string;
  readonly label: string;
  readonly value: JsonValue;
}

export interface PrintSectionView {
  readonly heading?: string;
  readonly fields: readonly PrintFieldView[];
}

export interface PrintDocumentView {
  readonly format: PrintFormatDefinition;
  readonly letterhead?: PrintLetterheadDefinition;
  readonly document: DocumentSnapshot;
  readonly hiddenPrintFields: readonly string[];
  readonly sections: readonly PrintSectionView[];
}

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
      sections: (format.sections ?? [])
        .map((section) => printSectionView(section, document, hiddenPrintFields))
        .filter((section) => section.fields.length > 0)
    };
  }

  private canAccess(actor: Actor, format: PrintFormatDefinition): boolean {
    const doctype = this.registry.get(format.doctype);
    return (
      canReadPrintFormat(actor, format) &&
      can(actor, doctype, format.permissionAction ?? "read") &&
      this.canAccessReferencedLetterhead(actor, format.letterhead)
    );
  }

  private canAccessReferencedLetterhead(actor: Actor, letterheadName: string | undefined): boolean {
    if (!letterheadName) {
      return true;
    }
    return canReadPrintLetterhead(actor, this.registry.getPrintLetterhead(letterheadName));
  }

}

function printSectionView(
  section: PrintSectionDefinition,
  document: DocumentSnapshot,
  hiddenPrintFields: ReadonlySet<string>
): PrintSectionView {
  return {
    ...(section.heading ? { heading: section.heading } : {}),
    fields: section.fields
      .filter((field) => !hiddenPrintFields.has(field.field))
      .map((field) => ({
        field: field.field,
        label: field.label ?? field.field,
        value: document.data[field.field] ?? null
      }))
  };
}

function printHiddenFields(doctype: DocTypeDefinition, document: DocumentSnapshot): ReadonlySet<string> {
  return new Set(
    doctype.fields
      .filter((field) => field.printHide || (field.printHideIfNoValue && isPrintEmptyValue(document.data[field.name] ?? null)))
      .map((field) => field.name)
  );
}

function isPrintEmptyValue(value: JsonValue): boolean {
  return value === null || value === "" || (Array.isArray(value) && value.length === 0);
}
