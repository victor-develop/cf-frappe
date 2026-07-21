import { permissionDenied } from "../core/errors.js";
import {
  mergePrintLayouts,
  parsePrintTemplatePath,
  type PrintFormatDefinition,
  type PrintLetterheadDefinition
} from "../core/print-format.js";
import type { ModelRegistry } from "../core/registry.js";
import type { Actor, DocTypeDefinition } from "../core/types.js";
import type { PrintSettingsService } from "./print-settings-service.js";
import {
  planPrintFormatReadAccess,
  planPrintLetterheadReadAccess,
  printDocumentSections,
  printHiddenFields,
  type PrintDocumentView,
  type PrintFieldView,
  type PrintReadAccessDecision,
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
      .filter((format) =>
        (doctype === undefined || format.doctype === doctype) &&
        this.printFormatReadAccess(actor, format).status === "allow"
      )
      .map((format) => projectPrintFormatForVisibleFields(format, this.queries.getMeta(actor, format.doctype)));
  }

  getPrintFormat(actor: Actor, formatName: string): PrintFormatDefinition {
    const format = this.registry.getPrintFormat(formatName);
    const decision = this.printFormatReadAccess(actor, format);
    if (decision.status === "deny") {
      throw permissionDenied(decision.message);
    }
    return projectPrintFormatForVisibleFields(format, this.queries.getMeta(actor, format.doctype));
  }

  listPrintLetterheads(actor: Actor): readonly PrintLetterheadDefinition[] {
    return this.registry
      .listPrintLetterheads()
      .filter((letterhead) => planPrintLetterheadReadAccess({ actor, letterhead }).status === "allow");
  }

  getPrintLetterhead(actor: Actor, letterheadName: string): PrintLetterheadDefinition {
    const letterhead = this.registry.getPrintLetterhead(letterheadName);
    const decision = planPrintLetterheadReadAccess({ actor, letterhead });
    if (decision.status === "deny") {
      throw permissionDenied(decision.message);
    }
    return letterhead;
  }

  async printDocument(actor: Actor, formatName: string, name: string): Promise<PrintDocumentView> {
    const format = this.getPrintFormat(actor, formatName);
    const doctype = await this.queries.getEffectiveMeta(actor, format.doctype);
    const document = await this.queries.getDocument(actor, format.doctype, name);
    const letterhead = format.letterhead ? this.getPrintLetterhead(actor, format.letterhead) : undefined;
    const defaultLayout = (await this.printSettings?.defaultsFor(actor))?.settings.defaultLayout;
    const layout = mergePrintLayouts(defaultLayout, format.layout);
    const formatted = layout === format.layout ? format : { ...format, ...(layout === undefined ? {} : { layout }) };
    const projectedFormat = projectPrintFormatForVisibleFields(formatted, doctype);
    const hiddenPrintFields = printHiddenFields(doctype, document);
    return {
      format: projectedFormat,
      ...(letterhead ? { letterhead } : {}),
      document,
      hiddenPrintFields: [...hiddenPrintFields],
      sections: printDocumentSections(projectedFormat.sections, document, hiddenPrintFields)
    };
  }

  private printFormatReadAccess(actor: Actor, format: PrintFormatDefinition): PrintReadAccessDecision {
    const doctype = this.registry.get(format.doctype);
    const letterhead = format.letterhead ? this.registry.getPrintLetterhead(format.letterhead) : undefined;
    return planPrintFormatReadAccess({ actor, format, doctype, letterhead });
  }

}

function projectPrintFormatForVisibleFields(
  format: PrintFormatDefinition,
  doctype: DocTypeDefinition
): PrintFormatDefinition {
  const visibleFields = new Set(doctype.fields.map((field) => field.name));
  const sections = (format.sections ?? [])
    .map((section) => ({
      ...section,
      fields: section.fields.filter((field) => visibleFields.has(field.field))
    }))
    .filter((section) => section.fields.length > 0);
  const template = printTemplateIsVisible(format.template, visibleFields) ? format.template : undefined;
  const { sections: _sections, template: _template, ...base } = format;
  return {
    ...base,
    sections,
    ...(template === undefined ? {} : { template })
  };
}

function printTemplateIsVisible(template: string | undefined, visibleFields: ReadonlySet<string>): boolean {
  if (template === undefined) {
    return true;
  }
  for (const token of template.matchAll(/{{\s*([^{}]+?)\s*}}/g)) {
    const reference = parsePrintTemplatePath(token[1]?.trim() ?? "");
    if (reference?.scope === "doc" && reference.kind === "field" && !visibleFields.has(reference.field)) {
      return false;
    }
  }
  return true;
}
