import type {
  DocTypeDefinition,
  JsonValue,
  MutableDocumentData
} from "../core/types.js";

export interface FetchFromPath {
  readonly linkField: string;
  readonly sourceField: string;
}

export function parseFetchFrom(fetchFrom: string): FetchFromPath | undefined {
  const [linkField, sourceField, extra] = fetchFrom.split(".");
  if (!linkField || !sourceField || extra !== undefined) {
    return undefined;
  }
  return { linkField, sourceField };
}

export function isEmptyFetchedTarget(value: JsonValue | undefined): boolean {
  return value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0);
}

export function relatedDocTypeNames(doctype: DocTypeDefinition): readonly string[] {
  return [
    ...new Set(
      doctype.fields.flatMap((field) => [
        ...(field.type === "table" && field.tableOf ? [field.tableOf] : []),
        ...(field.type === "link" && field.linkTo ? [field.linkTo] : [])
      ])
    )
  ];
}

export function isMutableData(value: unknown): value is MutableDocumentData {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
