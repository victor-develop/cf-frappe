import type { DocTypeDefinition, DocumentSnapshot, FieldDefinition, LinkOption } from "../../core/types.js";

export interface DeskOption {
  readonly value: string;
  readonly label: string;
}

export function optionLabel(value: string, label?: string): DeskOption {
  return { value, label: label && label !== value ? `${label} (${value})` : value };
}

export function doctypeOptions(doctypes: readonly DocTypeDefinition[], selected = ""): readonly DeskOption[] {
  return preserveSelectedOption(
    doctypes.map((doctype) => ({
      value: doctype.name,
      label: doctype.label ?? doctype.name
    })),
    selected
  );
}

export function fieldOptions(
  doctype: DocTypeDefinition | undefined,
  selected = "",
  predicate: (field: FieldDefinition) => boolean = () => true
): readonly DeskOption[] {
  return preserveSelectedOption(
    (doctype?.fields ?? []).filter(predicate).map((field) => optionLabel(field.name, field.label)),
    selected
  );
}

export function stringOptions(values: readonly string[], selected = ""): readonly DeskOption[] {
  return preserveSelectedOption(
    uniqueSortedStrings(values).map((value) => ({ value, label: value })),
    selected
  );
}

export function fetchFromOptions(
  doctype: DocTypeDefinition | undefined,
  doctypes: readonly DocTypeDefinition[],
  selected = ""
): readonly DeskOption[] {
  if (doctype === undefined) {
    return preserveSelectedOption([], selected);
  }
  const byName = new Map(doctypes.map((item) => [item.name, item] as const));
  const options = doctype.fields
    .filter((field) => field.type === "link" && field.linkTo)
    .flatMap((linkField) => {
      const target = linkField.linkTo === undefined ? undefined : byName.get(linkField.linkTo);
      return (target?.fields ?? [])
        .filter((sourceField) => sourceField.type !== "table" && !sourceField.hidden)
        .map((sourceField) => ({
          value: `${linkField.name}.${sourceField.name}`,
          label: `${fieldDisplayLabel(linkField)} -> ${fieldDisplayLabel(sourceField)}`
        }));
    });
  return preserveSelectedOption(options, selected);
}

export function documentOptions(documents: readonly DocumentSnapshot[], selected = ""): readonly DeskOption[] {
  return preserveSelectedOption(
    documents.map((document) => ({
      value: document.name,
      label: document.name
    })),
    selected
  );
}

export function linkOptionsToDeskOptions(options: readonly LinkOption[], selected = ""): readonly DeskOption[] {
  return preserveSelectedOption(
    options.map((option) => ({
      value: option.value,
      label: option.label
    })),
    selected
  );
}

export function uniqueSortedStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

export function preserveSelectedOption(options: readonly DeskOption[], selected: string): readonly DeskOption[] {
  if (!selected || options.some((option) => option.value === selected)) {
    return options;
  }
  return [{ value: selected, label: selected }, ...options];
}

function fieldDisplayLabel(field: FieldDefinition): string {
  const label = field.label ?? field.name;
  return label === field.name ? field.name : `${label} (${field.name})`;
}
