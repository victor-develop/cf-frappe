import type {
  DocumentData,
  DocumentSnapshot,
  DocTypeDefinition,
  FieldDefinition,
  JsonValue,
  MutableDocumentData,
  ValidationIssue
} from "../core/types.js";
import { compactData } from "../core/schema.js";

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

export type RelatedDocTypeResolver = (doctype: string) => DocTypeDefinition | undefined;

export interface DocumentLinkAccessContext {
  readonly sourceDoctype: DocTypeDefinition;
  readonly field: FieldDefinition;
  readonly targetDoctype: DocTypeDefinition;
  readonly targetName: string;
}

export interface ValidateDocumentLinksOptions {
  readonly doctype: DocTypeDefinition;
  readonly data: MutableDocumentData;
  readonly relatedDocType: RelatedDocTypeResolver;
  readonly canReadLinkedTarget: (context: DocumentLinkAccessContext) => Promise<boolean>;
  readonly pathPrefix?: string;
}

export interface ApplyFetchedFieldsOptions {
  readonly doctype: DocTypeDefinition;
  readonly data: MutableDocumentData;
  readonly relatedDocType: RelatedDocTypeResolver;
  readonly readFetchedTarget: (context: DocumentLinkAccessContext) => Promise<DocumentSnapshot | null>;
  readonly existing?: DocumentSnapshot;
}

export async function applyFetchedFields(options: ApplyFetchedFieldsOptions): Promise<DocumentData> {
  const enriched: MutableDocumentData = { ...options.data };
  const explicitFields = new Set(Object.keys(options.data));
  const hasExisting = options.existing !== undefined;
  for (const field of options.doctype.fields) {
    if (field.fetchFrom === undefined || explicitFields.has(field.name)) {
      continue;
    }
    const fetchPath = parseFetchFrom(field.fetchFrom);
    if (!fetchPath) {
      continue;
    }
    const linkField = options.doctype.fields.find((candidate) => candidate.name === fetchPath.linkField);
    if (!linkField || linkField.type !== "link") {
      continue;
    }
    if (hasExisting && !Object.prototype.hasOwnProperty.call(options.data, linkField.name)) {
      continue;
    }
    const existingValue = options.existing?.data[field.name];
    if (field.fetchIfEmpty === true && !isEmptyFetchedTarget(enriched[field.name] ?? existingValue)) {
      continue;
    }
    const linkValue = enriched[linkField.name] ?? options.existing?.data[linkField.name];
    if (typeof linkValue !== "string" || linkValue.length === 0) {
      continue;
    }
    const targetDoctype = options.relatedDocType(linkField.linkTo ?? "");
    if (!targetDoctype) {
      continue;
    }
    const target = await options.readFetchedTarget({
      sourceDoctype: options.doctype,
      field: linkField,
      targetDoctype,
      targetName: linkValue
    });
    const fetchedValue = target?.data[fetchPath.sourceField];
    if (fetchedValue !== undefined) {
      enriched[field.name] = fetchedValue;
    }
  }
  return compactData(enriched);
}

export async function validateDocumentLinks(
  options: ValidateDocumentLinksOptions
): Promise<readonly ValidationIssue[]> {
  const pathPrefix = options.pathPrefix ?? "";
  const linkableFields = options.doctype.fields.filter(
    (field) =>
      (field.type === "link" || field.type === "table") &&
      Object.prototype.hasOwnProperty.call(options.data, field.name)
  );
  if (linkableFields.length === 0) {
    return [];
  }
  const issues = await Promise.all(
    linkableFields.map(async (field): Promise<readonly ValidationIssue[]> => {
      const value = options.data[field.name];
      const fieldPath = `${pathPrefix}${field.name}`;
      if (field.type === "table") {
        if (!Array.isArray(value) || !field.tableOf) {
          return [];
        }
        const child = options.relatedDocType(field.tableOf);
        if (!child) {
          return [];
        }
        const rowIssues = await Promise.all(
          value.map((row, index) =>
            isMutableData(row)
              ? validateDocumentLinks({
                  ...options,
                  doctype: child,
                  data: row,
                  pathPrefix: `${fieldPath}[${index}].`
                })
              : Promise.resolve([])
          )
        );
        return rowIssues.flat();
      }
      if (typeof value !== "string" || value.length === 0) {
        return [];
      }
      const targetDoctype = options.relatedDocType(field.linkTo ?? "");
      if (!targetDoctype) {
        return [];
      }
      if (
        await options.canReadLinkedTarget({
          sourceDoctype: options.doctype,
          field,
          targetDoctype,
          targetName: value
        })
      ) {
        return [];
      }
      return [
        {
          field: fieldPath,
          code: "link_not_found",
          message: `Field '${field.name}' references missing ${targetDoctype.name}/${value}`
        }
      ];
    })
  );
  return issues.flat();
}
