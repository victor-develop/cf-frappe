import type {
  DocTypeDefinition,
  DocumentSnapshot,
  FieldDefinition,
  GlobalSearchResultItem,
  JsonPrimitive,
  JsonValue,
  LinkOption
} from "../core/types.js";

export interface DocumentCsvColumn {
  readonly label: string;
  value(document: DocumentSnapshot): JsonPrimitive | undefined;
}

export interface GlobalSearchMatch {
  readonly field: string;
  readonly text: string;
}

export function documentCsvColumns(fields: readonly FieldDefinition[]): readonly DocumentCsvColumn[] {
  return [
    { label: "Name", value: (document) => document.name },
    ...fields.map((field) => ({
      label: field.label ?? field.name,
      value: (document: DocumentSnapshot) => primitiveCsvValue(document.data[field.name])
    })),
    { label: "Version", value: (document) => document.version },
    { label: "Updated", value: (document) => document.updatedAt }
  ];
}

export function primitiveCsvValue(value: JsonValue | undefined): JsonPrimitive | undefined {
  if (
    value === undefined ||
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return JSON.stringify(value);
}

export function globalSearchMatch(
  doctype: DocTypeDefinition,
  document: DocumentSnapshot,
  query: string
): GlobalSearchMatch | undefined {
  return globalSearchCandidates(doctype, document).find((candidate) =>
    candidate.text.toLowerCase().includes(query)
  );
}

export function globalSearchCandidates(
  doctype: DocTypeDefinition,
  document: DocumentSnapshot
): readonly GlobalSearchMatch[] {
  const candidates: GlobalSearchMatch[] = [];
  const seen = new Set<string>();
  const add = (field: string, value: JsonValue | undefined) => {
    const text = searchableText(value);
    if (text === undefined) {
      return;
    }
    const key = `${field}:${text}`;
    if (!seen.has(key)) {
      candidates.push({ field, text });
      seen.add(key);
    }
  };
  add("name", document.name);
  add("title", document.data.title);
  if (doctype.naming?.kind === "field") {
    add(doctype.naming.field, document.data[doctype.naming.field]);
  }
  for (const field of doctype.fields) {
    if (field.inGlobalSearch) {
      add(field.name, document.data[field.name]);
    }
  }
  return candidates;
}

export function searchableText(value: JsonValue | undefined): string | undefined {
  if (typeof value === "string") {
    const text = value.trim();
    return text ? text : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

export function toGlobalSearchResult(
  doctype: DocTypeDefinition,
  document: DocumentSnapshot,
  match: GlobalSearchMatch
): GlobalSearchResultItem {
  return {
    doctype: doctype.name,
    name: document.name,
    label: labelForLinkedDocument(document, doctype),
    matchedField: match.field,
    matchedText: match.text,
    route: `/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(document.name)}`,
    updatedAt: document.updatedAt
  };
}

export function compareSearchResults(left: GlobalSearchResultItem, right: GlobalSearchResultItem): number {
  return (
    right.updatedAt.localeCompare(left.updatedAt) ||
    left.label.localeCompare(right.label) ||
    left.doctype.localeCompare(right.doctype) ||
    left.name.localeCompare(right.name)
  );
}

export function toLinkOption(document: DocumentSnapshot, doctype: DocTypeDefinition): LinkOption {
  return {
    value: document.name,
    label: labelForLinkedDocument(document, doctype)
  };
}

export function labelForLinkedDocument(document: DocumentSnapshot, doctype: DocTypeDefinition): string {
  const title = document.data.title;
  if (typeof title === "string" && title.length > 0) {
    return title;
  }
  if (doctype.naming?.kind === "field") {
    const namedValue = document.data[doctype.naming.field];
    if (typeof namedValue === "string" && namedValue.length > 0) {
      return namedValue;
    }
  }
  return document.name;
}

export function matchesLinkSearch(option: LinkOption, search: string): boolean {
  return option.value.toLowerCase().includes(search) || option.label.toLowerCase().includes(search);
}
