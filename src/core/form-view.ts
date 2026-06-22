import { FrameworkError } from "./errors.js";
import type {
  DocTypeDefinition,
  FieldDefinition,
  FormSectionDefinition,
  ResolvedFormSection,
  ResolvedFormView
} from "./types.js";

export function assertFormViewDefinition(doctype: DocTypeDefinition): void {
  resolveFormView(doctype);
}

export function resolveFormView(doctype: DocTypeDefinition): ResolvedFormView {
  const sections =
    doctype.formView?.sections !== undefined
      ? resolveConfiguredSections(doctype, doctype.formView.sections)
      : defaultSections(doctype);
  return {
    sections,
    fields: sections.flatMap((section) => section.fields)
  };
}

function resolveConfiguredSections(
  doctype: DocTypeDefinition,
  sections: readonly FormSectionDefinition[]
): readonly ResolvedFormSection[] {
  if (sections.length === 0) {
    throw new FrameworkError("FORM_VIEW_INVALID", `Form view on ${doctype.name} must define at least one section`, {
      status: 400
    });
  }
  return resolveSections(doctype, sections);
}

function resolveSections(
  doctype: DocTypeDefinition,
  sections: readonly FormSectionDefinition[]
): readonly ResolvedFormSection[] {
  const fields = fieldMap(doctype);
  const seen = new Set<string>();
  return sections.map((section, index) => {
    if (section.fields.length === 0) {
      throw new FrameworkError(
        "FORM_VIEW_INVALID",
        `Form view on ${doctype.name} section ${index + 1} must define at least one field`,
        { status: 400 }
      );
    }
    return {
      ...(section.heading !== undefined ? { heading: section.heading } : {}),
      columns: normalizeColumns(section.columns, doctype.name, index),
      fields: section.fields.map((name) => {
        const field = fields.get(name);
        if (!field) {
          throw new FrameworkError(
            "FORM_VIEW_INVALID",
            `Form view on ${doctype.name} references unknown field '${name}'`,
            { status: 400 }
          );
        }
        if (field.hidden) {
          throw new FrameworkError(
            "FORM_VIEW_INVALID",
            `Form view on ${doctype.name} references hidden field '${name}'`,
            { status: 400 }
          );
        }
        if (seen.has(name)) {
          throw new FrameworkError(
            "FORM_VIEW_INVALID",
            `Form view on ${doctype.name} repeats field '${name}'`,
            { status: 400 }
          );
        }
        seen.add(name);
        return field;
      })
    };
  });
}

function defaultSections(doctype: DocTypeDefinition): readonly ResolvedFormSection[] {
  const visible = doctype.fields.filter((field) => !field.hidden);
  const flagged = visible.filter((field) => field.inFormView);
  const fields = flagged.length > 0 ? flagged : visible;
  return fields.length > 0
    ? [
        {
          columns: 2,
          fields
        }
      ]
    : [];
}

function normalizeColumns(columns: number | undefined, doctype: string, index: number): 1 | 2 {
  if (columns === undefined) {
    return 2;
  }
  if (columns !== 1 && columns !== 2) {
    throw new FrameworkError(
      "FORM_VIEW_INVALID",
      `Form view on ${doctype} section ${index + 1} columns must be 1 or 2`,
      { status: 400 }
    );
  }
  return columns;
}

function fieldMap(doctype: DocTypeDefinition): Map<string, FieldDefinition> {
  return new Map(doctype.fields.map((field) => [field.name, field]));
}
