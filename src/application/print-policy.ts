import { can } from "../core/permissions.js";
import { badRequest, notFound } from "../core/errors.js";
import {
  canReadPrintFormat,
  canReadPrintLetterhead,
  type PrintFormatDefinition,
  type PrintLetterheadDefinition,
  type PrintSectionDefinition
} from "../core/print-format.js";
import type { Actor, DocTypeDefinition, DocumentSnapshot, JsonValue } from "../core/types.js";

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

export type PrintReadAccessDecision =
  | { readonly status: "allow" }
  | { readonly status: "deny"; readonly message: string };

export function ensurePrintPdfRendererAvailable<T>(renderer: T | undefined): asserts renderer is T {
  if (renderer === undefined) {
    throw badRequest("PDF print rendering is not configured");
  }
}

export function ensurePrintServiceAvailable<T>(prints: T | undefined): asserts prints is T {
  if (prints === undefined) {
    throw notFound("Print formats are not enabled", "PRINT_FORMAT_NOT_FOUND");
  }
}

export function canAccessPrintFormat(command: {
  readonly actor: Actor;
  readonly format: PrintFormatDefinition;
  readonly doctype: DocTypeDefinition;
  readonly letterhead?: PrintLetterheadDefinition | undefined;
}): boolean {
  return (
    canReadPrintFormat(command.actor, command.format) &&
    can(command.actor, command.doctype, command.format.permissionAction ?? "read") &&
    (command.format.letterhead === undefined ||
      (command.letterhead !== undefined && canReadPrintLetterhead(command.actor, command.letterhead)))
  );
}

export function planPrintFormatReadAccess(command: {
  readonly actor: Actor;
  readonly format: PrintFormatDefinition;
  readonly doctype: DocTypeDefinition;
  readonly letterhead?: PrintLetterheadDefinition | undefined;
}): PrintReadAccessDecision {
  if (!canAccessPrintFormat(command)) {
    return {
      status: "deny",
      message: `Actor '${command.actor.id}' cannot read print format '${command.format.name}'`
    };
  }
  return { status: "allow" };
}

export function planPrintLetterheadReadAccess(command: {
  readonly actor: Actor;
  readonly letterhead: PrintLetterheadDefinition;
}): PrintReadAccessDecision {
  if (!canReadPrintLetterhead(command.actor, command.letterhead)) {
    return {
      status: "deny",
      message: `Actor '${command.actor.id}' cannot read print letterhead '${command.letterhead.name}'`
    };
  }
  return { status: "allow" };
}

export function printDocumentSections(
  sections: readonly PrintSectionDefinition[] | undefined,
  document: DocumentSnapshot,
  hiddenPrintFields: ReadonlySet<string>
): readonly PrintSectionView[] {
  return (sections ?? [])
    .map((section) => printSectionView(section, document, hiddenPrintFields))
    .filter((section) => section.fields.length > 0);
}

export function printSectionView(
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

export function printHiddenFields(doctype: DocTypeDefinition, document: DocumentSnapshot): ReadonlySet<string> {
  return new Set(
    doctype.fields
      .filter((field) => field.printHide || (field.printHideIfNoValue && isPrintEmptyValue(document.data[field.name] ?? null)))
      .map((field) => field.name)
  );
}

export function isPrintEmptyValue(value: JsonValue): boolean {
  return value === null || value === "" || (Array.isArray(value) && value.length === 0);
}
