import { FrameworkError } from "./errors";
import type { Actor, DocTypeDefinition, PermissionAction } from "./types";
import { SYSTEM_MANAGER_ROLE } from "./types";

export interface PrintFieldDefinition {
  readonly field: string;
  readonly label?: string;
}

export interface PrintSectionDefinition {
  readonly heading?: string;
  readonly fields: readonly PrintFieldDefinition[];
}

export interface PrintFormatDefinition {
  readonly name: string;
  readonly label?: string;
  readonly module?: string;
  readonly description?: string;
  readonly doctype: string;
  readonly sections: readonly PrintSectionDefinition[];
  readonly roles?: readonly string[];
  readonly permissionAction?: PermissionAction;
}

export function definePrintFormat(definition: PrintFormatDefinition): PrintFormatDefinition {
  assertIdentifier(definition.name, "print format name");
  if (definition.sections.length === 0) {
    throw new FrameworkError("PRINT_FORMAT_INVALID", `Print format '${definition.name}' must define at least one section`, {
      status: 400
    });
  }
  for (const [index, section] of definition.sections.entries()) {
    if (section.fields.length === 0) {
      throw new FrameworkError(
        "PRINT_FORMAT_INVALID",
        `Print format '${definition.name}' section ${index + 1} must define at least one field`,
        { status: 400 }
      );
    }
  }
  return Object.freeze({
    ...definition,
    sections: Object.freeze(
      definition.sections.map((section) =>
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

export function assertPrintFormatMatchesDocType(format: PrintFormatDefinition, doctype: DocTypeDefinition): void {
  const fields = new Set(doctype.fields.map((field) => field.name));
  for (const section of format.sections) {
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
}

function assertIdentifier(value: string, label: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_ ]*$/.test(value)) {
    throw new FrameworkError("PRINT_FORMAT_INVALID", `Invalid ${label}: '${value}'`, {
      status: 400
    });
  }
}
