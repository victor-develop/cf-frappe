import { badRequest, FrameworkError } from "../core/errors.js";
import { mergeListFilters } from "../core/list-view.js";
import type {
  DocTypeDefinition,
  DocumentSnapshot,
  FieldDefinition,
  GlobalSearchResultItem,
  JsonPrimitive,
  JsonValue,
  ListDocumentsFilter,
  LinkOption
} from "../core/types.js";

export const DEFAULT_DOCUMENT_CSV_EXPORT_LIMIT = 10_000;

export interface DocumentCsvColumn {
  readonly label: string;
  value(document: DocumentSnapshot): JsonPrimitive | undefined;
}

export interface GlobalSearchMatch {
  readonly field: string;
  readonly text: string;
}

export type DocumentReadProjectionDecision =
  | { readonly status: "not-found"; readonly message: string }
  | { readonly status: "check-access"; readonly document: DocumentSnapshot };

export type ProjectionPageScanDecision =
  | { readonly status: "complete" }
  | { readonly status: "continue"; readonly nextOffset: number };

export type LinkOptionCandidateDecision =
  | { readonly status: "skip" }
  | { readonly status: "add" }
  | { readonly status: "add-and-complete" };

export type GlobalSearchCandidateDecision =
  | { readonly status: "skip" }
  | { readonly status: "add"; readonly result: GlobalSearchResultItem };

export type LinkFieldDefinition = FieldDefinition & {
  readonly type: "link";
  readonly linkTo: string;
};

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

export function planGlobalSearchCandidate(input: {
  readonly doctype: DocTypeDefinition;
  readonly document: DocumentSnapshot;
  readonly query: string;
}): GlobalSearchCandidateDecision {
  const match = globalSearchMatch(input.doctype, input.document, input.query);
  if (!match) {
    return { status: "skip" };
  }
  return {
    status: "add",
    result: toGlobalSearchResult(input.doctype, input.document, match)
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

export function planDocumentReadProjection(input: {
  readonly doctype: DocTypeDefinition;
  readonly name: string;
  readonly document: DocumentSnapshot | null;
}): DocumentReadProjectionDecision {
  if (!input.document || input.document.docstatus === "deleted") {
    return {
      status: "not-found",
      message: `${input.doctype.name}/${input.name} was not found`
    };
  }
  return { status: "check-access", document: input.document };
}

export function planProjectionPageScan(input: {
  readonly offset: number;
  readonly pageSize: number;
  readonly total: number;
}): ProjectionPageScanDecision {
  return input.offset + input.pageSize >= input.total
    ? { status: "complete" }
    : { status: "continue", nextOffset: input.offset + input.pageSize };
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

export function planLinkOptionCandidate(input: {
  readonly option: LinkOption;
  readonly search: string | undefined;
  readonly currentCount: number;
  readonly limit: number;
}): LinkOptionCandidateDecision {
  if (input.search && !matchesLinkSearch(input.option, input.search)) {
    return { status: "skip" };
  }
  return input.currentCount + 1 >= input.limit
    ? { status: "add-and-complete" }
    : { status: "add" };
}

export function mergeDefaultFilters(
  defaults: readonly ListDocumentsFilter[],
  overrides: readonly ListDocumentsFilter[]
): readonly ListDocumentsFilter[] {
  return mergeListFilters(defaults, overrides);
}

export function clampLimit(limit?: number, max = 200): number {
  if (limit === undefined) {
    return 50;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new FrameworkError("BAD_REQUEST", "limit must be a positive integer", { status: 400 });
  }
  return Math.min(limit, max);
}

export function clampCsvExportLimit(limit?: number): number {
  if (limit === undefined) {
    return DEFAULT_DOCUMENT_CSV_EXPORT_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest("CSV export limit must be a positive integer");
  }
  return Math.min(limit, DEFAULT_DOCUMENT_CSV_EXPORT_LIMIT);
}

export function clampSearchLimit(limit?: number): number {
  if (limit === undefined) {
    return 20;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new FrameworkError("BAD_REQUEST", "Search limit must be a positive integer", { status: 400 });
  }
  return Math.min(limit, 100);
}

export function getField(doctype: DocTypeDefinition, fieldName: string): FieldDefinition {
  const field = doctype.fields.find((item) => item.name === fieldName);
  if (!field) {
    throw new FrameworkError("BAD_REQUEST", `Field '${fieldName}' is not defined on ${doctype.name}`, {
      status: 400
    });
  }
  return field;
}

export function getLinkField(doctype: DocTypeDefinition, fieldName: string): LinkFieldDefinition {
  const field = getField(doctype, fieldName);
  if (field.type !== "link" || !field.linkTo) {
    throw new FrameworkError("BAD_REQUEST", `Field '${fieldName}' on ${doctype.name} is not a link field`, {
      status: 400
    });
  }
  return field as LinkFieldDefinition;
}

export function normalizeSearch(q: string | undefined): string | undefined {
  const search = q?.trim().toLowerCase();
  return search ? search : undefined;
}

export function normalizeRequiredSearch(q: string | undefined): string {
  const search = normalizeSearch(q);
  if (!search) {
    throw new FrameworkError("BAD_REQUEST", "Search query is required", { status: 400 });
  }
  return search;
}
