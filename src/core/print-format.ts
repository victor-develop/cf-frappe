import { FrameworkError } from "./errors.js";
import type { Actor, DocTypeDefinition, PermissionAction } from "./types.js";
import { SYSTEM_MANAGER_ROLE } from "./types.js";

export interface PrintFieldDefinition {
  readonly field: string;
  readonly label?: string;
}

export interface PrintSectionDefinition {
  readonly heading?: string;
  readonly fields: readonly PrintFieldDefinition[];
}

export interface PrintLetterheadDefinition {
  readonly name: string;
  readonly label?: string;
  readonly headerHtml?: string;
  readonly footerHtml?: string;
  readonly roles?: readonly string[];
}

export type PrintPageSizeName = "A3" | "A4" | "A5" | "Letter" | "Legal";
export type PrintPageOrientation = "portrait" | "landscape";

export interface PrintCustomPageSizeDefinition {
  readonly widthMm: number;
  readonly heightMm: number;
}

export interface PrintPageMarginsDefinition {
  readonly topMm?: number;
  readonly rightMm?: number;
  readonly bottomMm?: number;
  readonly leftMm?: number;
}

export interface PrintFontDefinition {
  readonly family?: string;
  readonly sizePt?: number;
}

export interface PrintLayoutDefinition {
  readonly pageSize?: PrintPageSizeName | PrintCustomPageSizeDefinition;
  readonly orientation?: PrintPageOrientation;
  readonly margins?: PrintPageMarginsDefinition;
  readonly font?: PrintFontDefinition;
}

export interface PrintFormatDefinition {
  readonly name: string;
  readonly label?: string;
  readonly module?: string;
  readonly description?: string;
  readonly doctype: string;
  readonly letterhead?: string;
  readonly sections?: readonly PrintSectionDefinition[];
  readonly template?: string;
  readonly layout?: PrintLayoutDefinition;
  readonly roles?: readonly string[];
  readonly permissionAction?: PermissionAction;
}

const PRINT_PAGE_SIZE_NAMES = ["A3", "A4", "A5", "Letter", "Legal"] as const;
const PRINT_TEMPLATE_PATTERN = /{{\s*([^{}]+?)\s*}}/g;
const DOCUMENT_METADATA_FIELDS = ["doctype", "name", "tenantId", "version", "docstatus", "createdAt", "updatedAt"] as const;
const PRINT_FORMAT_METADATA_FIELDS = ["doctype", "name", "label", "module", "description"] as const;

export type PrintTemplateReference =
  | { readonly scope: "doc"; readonly kind: "metadata"; readonly field: typeof DOCUMENT_METADATA_FIELDS[number] }
  | { readonly scope: "doc"; readonly kind: "field"; readonly field: string }
  | { readonly scope: "format"; readonly field: typeof PRINT_FORMAT_METADATA_FIELDS[number] };

interface PrintTemplateToken {
  readonly path: string;
  readonly start: number;
}

export function definePrintLetterhead(definition: PrintLetterheadDefinition): PrintLetterheadDefinition {
  assertIdentifier(definition.name, "print letterhead name");
  assertHasLetterheadBody(definition);
  return Object.freeze({ ...definition });
}

export function definePrintFormat(definition: PrintFormatDefinition): PrintFormatDefinition {
  assertIdentifier(definition.name, "print format name");
  const sections = definition.sections ?? [];
  const hasTemplate = definition.template !== undefined && definition.template.trim().length > 0;
  assertHasPrintableBody(definition.name, sections, hasTemplate);
  assertPrintLayoutValid(definition.name, definition.layout);
  for (const [index, section] of sections.entries()) {
    if (section.fields.length === 0) {
      throw new FrameworkError(
        "PRINT_FORMAT_INVALID",
        `Print format '${definition.name}' section ${index + 1} must define at least one field`,
        { status: 400 }
      );
    }
  }
  const layout = freezePrintLayout(definition.layout);
  return Object.freeze({
    ...definition,
    ...(layout === undefined ? {} : { layout }),
    sections: Object.freeze(
      sections.map((section) =>
        Object.freeze({
          ...section,
          fields: Object.freeze([...section.fields])
        })
      )
    )
  });
}

export function canReadPrintFormat(actor: Actor, format: PrintFormatDefinition): boolean {
  if (actor.roles.includes(SYSTEM_MANAGER_ROLE)) {
    return true;
  }
  return format.roles === undefined || format.roles.some((role) => actor.roles.includes(role));
}

export function canReadPrintLetterhead(actor: Actor, letterhead: PrintLetterheadDefinition): boolean {
  if (actor.roles.includes(SYSTEM_MANAGER_ROLE)) {
    return true;
  }
  return letterhead.roles === undefined || letterhead.roles.some((role) => actor.roles.includes(role));
}

export function assertPrintFormatMatchesDocType(format: PrintFormatDefinition, doctype: DocTypeDefinition): void {
  const fields = new Set(doctype.fields.map((field) => field.name));
  const sections = format.sections ?? [];
  const template = format.template ?? "";
  assertHasPrintableBody(format.name, sections, template.trim().length > 0);
  assertPrintLayoutValid(format.name, format.layout);
  for (const section of sections) {
    const sectionFields = new Set<string>();
    for (const printField of section.fields) {
      if (!fields.has(printField.field)) {
        throw new FrameworkError(
          "PRINT_FORMAT_INVALID",
          `Print format '${format.name}' references unknown field '${printField.field}'`,
          { status: 400 }
        );
      }
      if (sectionFields.has(printField.field)) {
        throw new FrameworkError(
          "PRINT_FORMAT_INVALID",
          `Print format '${format.name}' repeats field '${printField.field}' in one section`,
          { status: 400 }
        );
      }
      sectionFields.add(printField.field);
    }
  }
  for (const token of printTemplateTokens(template)) {
    assertTemplateTokenContext(format.name, template, token);
    const reference = parsePrintTemplatePath(token.path);
    if (!reference) {
      throw new FrameworkError(
        "PRINT_FORMAT_INVALID",
        `Print format '${format.name}' template variable '{{ ${token.path} }}' must reference doc.<field> or format.<property>`,
        { status: 400 }
      );
    }
    if (reference.scope === "doc" && reference.kind === "field" && !fields.has(reference.field)) {
      throw new FrameworkError(
        "PRINT_FORMAT_INVALID",
        `Print format '${format.name}' template references unknown field '${reference.field}'`,
        { status: 400 }
      );
    }
  }
}

export function assertPrintLetterheadValid(letterhead: PrintLetterheadDefinition): void {
  assertIdentifier(letterhead.name, "print letterhead name");
  assertHasLetterheadBody(letterhead);
}

export function printTemplatePaths(template: string): readonly string[] {
  return printTemplateTokens(template).map((token) => token.path);
}

function printTemplateTokens(template: string): readonly PrintTemplateToken[] {
  return [...template.matchAll(PRINT_TEMPLATE_PATTERN)]
    .map((match) => ({
      path: match[1]?.trim() ?? "",
      start: match.index ?? 0
    }))
    .filter((token) => token.path.length > 0);
}

export function substitutePrintTemplate(template: string, resolve: (path: string) => string): string {
  return template.replace(PRINT_TEMPLATE_PATTERN, (_token, path: string) => resolve(path.trim()));
}

export function parsePrintTemplatePath(path: string): PrintTemplateReference | null {
  const parts = path.split(".").map((part) => part.trim());
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    return null;
  }
  const [scope, field] = parts;
  if (scope === "doc" && field) {
    return isDocumentMetadataField(field)
      ? { scope: "doc", kind: "metadata", field }
      : { scope: "doc", kind: "field", field };
  }
  if (scope === "format" && field && isPrintFormatMetadataField(field)) {
    return { scope: "format", field };
  }
  return null;
}

function isDocumentMetadataField(field: string): field is typeof DOCUMENT_METADATA_FIELDS[number] {
  return DOCUMENT_METADATA_FIELDS.includes(field as typeof DOCUMENT_METADATA_FIELDS[number]);
}

function isPrintFormatMetadataField(field: string): field is typeof PRINT_FORMAT_METADATA_FIELDS[number] {
  return PRINT_FORMAT_METADATA_FIELDS.includes(field as typeof PRINT_FORMAT_METADATA_FIELDS[number]);
}

function assertHasPrintableBody(
  formatName: string,
  sections: readonly PrintSectionDefinition[],
  hasTemplate: boolean
): void {
  if (sections.length === 0 && !hasTemplate) {
    throw new FrameworkError(
      "PRINT_FORMAT_INVALID",
      `Print format '${formatName}' must define at least one section or template`,
      { status: 400 }
    );
  }
}

function assertHasLetterheadBody(letterhead: PrintLetterheadDefinition): void {
  if (!hasText(letterhead.headerHtml) && !hasText(letterhead.footerHtml)) {
    throw new FrameworkError(
      "PRINT_FORMAT_INVALID",
      `Print letterhead '${letterhead.name}' must define headerHtml or footerHtml`,
      { status: 400 }
    );
  }
}

function hasText(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function freezePrintLayout(layout: PrintLayoutDefinition | undefined): PrintLayoutDefinition | undefined {
  if (layout === undefined) {
    return undefined;
  }
  return Object.freeze({
    ...(layout.pageSize === undefined
      ? {}
      : { pageSize: isCustomPrintPageSize(layout.pageSize) ? Object.freeze({ ...layout.pageSize }) : layout.pageSize }),
    ...(layout.orientation === undefined ? {} : { orientation: layout.orientation }),
    ...(layout.margins === undefined ? {} : { margins: Object.freeze({ ...layout.margins }) }),
    ...(layout.font === undefined ? {} : { font: Object.freeze({ ...layout.font }) })
  });
}

function assertPrintLayoutValid(formatName: string, layout: unknown): void {
  if (layout === undefined) {
    return;
  }
  if (!isRecord(layout)) {
    throw invalidPrintLayout(formatName, "layout must be an object");
  }
  assertPrintPageSizeValid(formatName, layout.pageSize);
  if (isRecord(layout.pageSize) && layout.orientation !== undefined) {
    throw invalidPrintLayout(formatName, "layout orientation cannot be combined with custom page size");
  }
  if (layout.orientation !== undefined && layout.orientation !== "portrait" && layout.orientation !== "landscape") {
    throw invalidPrintLayout(formatName, "layout orientation must be portrait or landscape");
  }
  assertPrintMarginsValid(formatName, layout.margins);
  assertPrintFontValid(formatName, layout.font);
}

function assertPrintPageSizeValid(formatName: string, pageSize: unknown): void {
  if (pageSize === undefined) {
    return;
  }
  if (typeof pageSize === "string") {
    if (!PRINT_PAGE_SIZE_NAMES.includes(pageSize as PrintPageSizeName)) {
      throw invalidPrintLayout(formatName, `layout page size '${pageSize}' is not supported`);
    }
    return;
  }
  if (!isRecord(pageSize)) {
    throw invalidPrintLayout(formatName, "layout page size must be a supported name or custom size");
  }
  assertNumberInRange(formatName, "layout custom page widthMm", pageSize.widthMm, 1, 2000, "millimeters");
  assertNumberInRange(formatName, "layout custom page heightMm", pageSize.heightMm, 1, 2000, "millimeters");
}

function assertPrintMarginsValid(formatName: string, margins: unknown): void {
  if (margins === undefined) {
    return;
  }
  if (!isRecord(margins)) {
    throw invalidPrintLayout(formatName, "layout margins must be an object");
  }
  for (const side of ["topMm", "rightMm", "bottomMm", "leftMm"] as const) {
    const value = margins[side];
    if (value !== undefined) {
      assertNumberInRange(formatName, `layout margin ${side}`, value, 0, 100, "millimeters");
    }
  }
}

function assertPrintFontValid(formatName: string, font: unknown): void {
  if (font === undefined) {
    return;
  }
  if (!isRecord(font)) {
    throw invalidPrintLayout(formatName, "layout font must be an object");
  }
  const family = font.family;
  if (family !== undefined && (typeof family !== "string" || !/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/.test(family))) {
    throw invalidPrintLayout(formatName, "layout font family contains unsupported characters");
  }
  if (font.sizePt !== undefined) {
    assertNumberInRange(formatName, "layout font sizePt", font.sizePt, 6, 72, "points");
  }
}

function assertNumberInRange(
  formatName: string,
  label: string,
  value: unknown,
  min: number,
  max: number,
  unit: string
): void {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    throw invalidPrintLayout(formatName, `${label} must be between ${String(min)} and ${String(max)} ${unit}`);
  }
}

function invalidPrintLayout(formatName: string, message: string): FrameworkError {
  return new FrameworkError("PRINT_FORMAT_INVALID", `Print format '${formatName}' ${message}`, { status: 400 });
}

function isCustomPrintPageSize(pageSize: PrintLayoutDefinition["pageSize"]): pageSize is PrintCustomPageSizeDefinition {
  return isRecord(pageSize);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertTemplateTokenContext(formatName: string, template: string, token: PrintTemplateToken): void {
  if (isInsideHtmlTag(template, token.start)) {
    throw new FrameworkError(
      "PRINT_FORMAT_INVALID",
      `Print format '${formatName}' template variable '{{ ${token.path} }}' cannot be used inside an HTML tag`,
      { status: 400 }
    );
  }
  if (isInsideRawTextElement(template, token.start, "script") || isInsideRawTextElement(template, token.start, "style")) {
    throw new FrameworkError(
      "PRINT_FORMAT_INVALID",
      `Print format '${formatName}' template variable '{{ ${token.path} }}' cannot be used inside script or style blocks`,
      { status: 400 }
    );
  }
}

function isInsideHtmlTag(template: string, offset: number): boolean {
  let inTag = false;
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < offset; index += 1) {
    const character = template[index];
    if (!inTag) {
      if (character === "<" && startsHtmlTag(template, index)) {
        inTag = true;
      }
      continue;
    }
    if (quote) {
      if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") {
      inTag = false;
    }
  }
  return inTag;
}

function startsHtmlTag(template: string, offset: number): boolean {
  const next = template[offset + 1];
  return next !== undefined && /[A-Za-z/!]/.test(next);
}

function isInsideRawTextElement(template: string, offset: number, tagName: "script" | "style"): boolean {
  const beforeToken = template.slice(0, offset).toLowerCase();
  const open = beforeToken.lastIndexOf(`<${tagName}`);
  const close = beforeToken.lastIndexOf(`</${tagName}>`);
  return open > close;
}

function assertIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_ ]*$/.test(value)) {
    throw new FrameworkError("PRINT_FORMAT_INVALID", `Invalid ${label}: '${value}'`, {
      status: 400
    });
  }
}
