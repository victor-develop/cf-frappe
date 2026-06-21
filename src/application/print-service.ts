import { permissionDenied } from "../core/errors";
import { can } from "../core/permissions";
import {
  canReadPrintFormat,
  type PrintFormatDefinition,
  type PrintSectionDefinition
} from "../core/print-format";
import type { ModelRegistry } from "../core/registry";
import type { Actor, DocumentSnapshot, JsonValue } from "../core/types";
import { QueryService } from "./query-service";

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
  readonly document: DocumentSnapshot;
  readonly sections: readonly PrintSectionView[];
}

export interface PrintServiceOptions {
  readonly registry: ModelRegistry;
  readonly queries: QueryService;
}

export class PrintService {
  private readonly registry: ModelRegistry;
  private readonly queries: QueryService;

  constructor(options: PrintServiceOptions) {
    this.registry = options.registry;
    this.queries = options.queries;
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

  async printDocument(actor: Actor, formatName: string, name: string): Promise<PrintDocumentView> {
    const format = this.getPrintFormat(actor, formatName);
    const document = await this.queries.getDocument(actor, format.doctype, name);
    return {
      format,
      document,
      sections: format.sections.map((section) => printSectionView(section, document))
    };
  }

  private canAccess(actor: Actor, format: PrintFormatDefinition): boolean {
    const doctype = this.registry.get(format.doctype);
    return canReadPrintFormat(actor, format) && can(actor, doctype, format.permissionAction ?? "read");
  }
}

function printSectionView(section: PrintSectionDefinition, document: DocumentSnapshot): PrintSectionView {
  return {
    ...(section.heading ? { heading: section.heading } : {}),
    fields: section.fields.map((field) => ({
      field: field.field,
      label: field.label ?? field.field,
      value: document.data[field.field] ?? null
    }))
  };
}
