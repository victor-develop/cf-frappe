import { matchesListFilterExpression } from "../core/list-view.js";
import { compactData } from "../core/schema.js";
import {
  CHILD_TABLE_ROW_INDEX_FIELD,
  type DocTypeDefinition,
  type DocumentData,
  type DocumentSnapshot,
  type FieldDefinition,
  type MutableDocumentData,
  type ValidationIssue
} from "../core/types.js";

export function readonlyIssues(
  doctype: DocTypeDefinition,
  patch: MutableDocumentData,
  relatedDocType: (doctype: string) => DocTypeDefinition | undefined,
  finalData: DocumentData = compactData(patch),
  unset: readonly string[] = []
): readonly ValidationIssue[] {
  const fields = new Map(doctype.fields.map((field) => [field.name, field]));
  const finalDocument = documentSnapshotForFieldCondition(doctype, finalData);
  const patchIssues = Object.keys(patch)
    .flatMap((fieldName) => {
      const field = fields.get(fieldName);
      if (!field || !fieldIsReadOnly(field, finalDocument)) {
        return [];
      }
      return [{
        field: fieldName,
        code: "readonly",
        message: `Field '${fieldName}' is read only`
      }];
    });
  const unsetIssues = unset
    .filter((fieldName) => !Object.prototype.hasOwnProperty.call(patch, fieldName))
    .flatMap((fieldName) => {
      const field = fields.get(fieldName);
      if (!field || field.readOnly === true || !conditionalReadOnlyApplies(field, finalDocument)) {
        return [];
      }
      return [{
        field: fieldName,
        code: "readonly",
        message: `Field '${fieldName}' is read only`
      }];
    });
  const childIssues = doctype.fields
    .filter((field) => field.type === "table" && Object.prototype.hasOwnProperty.call(patch, field.name))
    .flatMap((field) => {
      const value = patch[field.name];
      if (!Array.isArray(value) || !field.tableOf) {
        return [];
      }
      const child = relatedDocType(field.tableOf);
      if (!child) {
        return [];
      }
      const finalRowsValue = finalData[field.name];
      const finalRows = Array.isArray(finalRowsValue) ? finalRowsValue : [];
      return value.flatMap((row, index) =>
        isMutableData(row)
          ? readonlyIssues(
              child,
              row,
              relatedDocType,
              isMutableData(finalRows[index])
                ? compactData(finalRows[index] as MutableDocumentData)
                : compactData(row)
            ).map((issue) => ({
              ...issue,
              field: `${field.name}[${index}]${issue.field ? `.${issue.field}` : ""}`
            }))
          : []
      );
    });
  return [...patchIssues, ...unsetIssues, ...childIssues];
}

export function allowOnSubmitIssues(
  doctype: DocTypeDefinition,
  patch: MutableDocumentData,
  unset: readonly string[]
): readonly ValidationIssue[] {
  const fields = new Map(doctype.fields.map((field) => [field.name, field]));
  const changedFields = [...new Set([...Object.keys(patch), ...unset])];
  return changedFields.flatMap((fieldName) => {
    const field = fields.get(fieldName);
    if (!field || field.allowOnSubmit === true) {
      return [];
    }
    return [{
      field: fieldName,
      code: "allow_on_submit",
      message: `Field '${fieldName}' cannot be updated after submit`
    }];
  });
}

export function documentUnsetIssues(
  doctype: DocTypeDefinition,
  unset: readonly string[],
  existingData: DocumentData,
  patch: DocumentData
): readonly ValidationIssue[] {
  const fields = new Map(doctype.fields.map((field) => [field.name, field]));
  return unset.flatMap((field) => {
    const definition = fields.get(field);
    const issues: ValidationIssue[] = [];
    if (Object.prototype.hasOwnProperty.call(patch, field)) {
      issues.push({
        field,
        code: "unset_patch_conflict",
        message: `Field '${field}' cannot be patched and unset in the same update`
      });
    }
    if (definition?.required) {
      issues.push({
        field,
        code: "required",
        message: `Field '${field}' is required`
      });
    }
    if (definition?.readOnly) {
      issues.push({
        field,
        code: "readonly",
        message: `Field '${field}' is read only`
      });
    }
    if (definition === undefined && !Object.prototype.hasOwnProperty.call(existingData, field)) {
      issues.push({
        field,
        code: "unknown_field",
        message: `Field '${field}' is not defined on ${doctype.name}`
      });
    }
    return issues;
  });
}

export function childTableOriginIssues(
  doctype: DocTypeDefinition,
  patch: MutableDocumentData,
  existingData: MutableDocumentData | undefined,
  relatedDocType: (doctype: string) => DocTypeDefinition | undefined,
  pathPrefix = ""
): readonly ValidationIssue[] {
  return doctype.fields
    .filter((field) => field.type === "table" && Object.prototype.hasOwnProperty.call(patch, field.name))
    .flatMap((field) => {
      const value = patch[field.name];
      if (!Array.isArray(value) || !field.tableOf) {
        return [];
      }
      const child = relatedDocType(field.tableOf);
      if (!child) {
        return [];
      }
      const existingValue = existingData?.[field.name];
      const existingRows = Array.isArray(existingValue) ? existingValue : [];
      const seenOrigins = new Set<number>();
      return value.flatMap((row, rowIndex) => {
        if (!isMutableData(row) || !Object.prototype.hasOwnProperty.call(row, CHILD_TABLE_ROW_INDEX_FIELD)) {
          return [];
        }
        const fieldPath = `${pathPrefix}${field.name}[${rowIndex}].${CHILD_TABLE_ROW_INDEX_FIELD}`;
        const originIndex = childRowOriginIndex(row[CHILD_TABLE_ROW_INDEX_FIELD]);
        const issues: ValidationIssue[] = [];
        if (originIndex === undefined) {
          issues.push({
            field: fieldPath,
            code: "child_row_origin",
            message: `Field '${field.name}' has an invalid child row origin`
          });
          return issues;
        }
        if (originIndex >= existingRows.length) {
          issues.push({
            field: fieldPath,
            code: "child_row_origin",
            message: `Field '${field.name}' references a child row origin outside the current table`
          });
          return issues;
        }
        if (seenOrigins.has(originIndex)) {
          issues.push({
            field: fieldPath,
            code: "child_row_origin",
            message: `Field '${field.name}' cannot reuse the same child row origin more than once`
          });
          return issues;
        }
        seenOrigins.add(originIndex);
        return [
          ...issues,
          ...childTableOriginIssues(
            child,
            row,
            isMutableData(existingRows[originIndex]) ? existingRows[originIndex] : undefined,
            relatedDocType,
            `${pathPrefix}${field.name}[${rowIndex}].`
          )
        ];
      });
    });
}

export function preserveReadOnlyTableValues(
  doctype: DocTypeDefinition,
  patch: DocumentData,
  existing: DocumentSnapshot,
  relatedDocType: (doctype: string) => DocTypeDefinition | undefined
): DocumentData {
  return normalizeTableFields(doctype, patch, existing.data, relatedDocType);
}

export function stripInternalTableFields(
  doctype: DocTypeDefinition,
  data: DocumentData,
  relatedDocType: (doctype: string) => DocTypeDefinition | undefined
): DocumentData {
  return normalizeTableFields(doctype, data, undefined, relatedDocType);
}

export function copyDocumentData(
  doctype: DocTypeDefinition,
  data: DocumentData,
  relatedDocType: (doctype: string) => DocTypeDefinition | undefined,
  options: { readonly skipNoCopy?: boolean } = {}
): DocumentData {
  const entries = Object.entries(data)
    .filter(([fieldName]) =>
      !doctype.fields.some((field) =>
        field.name === fieldName && (field.readOnly || (options.skipNoCopy === true && field.noCopy === true))
      )
    )
    .map(([fieldName, value]) => {
      const field = doctype.fields.find((item) => item.name === fieldName);
      if (field?.type !== "table" || !field.tableOf || !Array.isArray(value)) {
        return [fieldName, value] as const;
      }
      const child = relatedDocType(field.tableOf);
      if (!child) {
        return [fieldName, value.map((row) => stripChildRowInternalFields(row))] as const;
      }
      return [
        fieldName,
        value.map((row) =>
          isMutableData(row)
            ? copyDocumentData(child, compactData(stripChildRowInternalFields(row)), relatedDocType, options)
            : row
        )
      ] as const;
    });
  return Object.fromEntries(entries) as DocumentData;
}

function fieldIsReadOnly(field: FieldDefinition, document: DocumentSnapshot): boolean {
  return field.readOnly === true || conditionalReadOnlyApplies(field, document);
}

function conditionalReadOnlyApplies(field: FieldDefinition, document: DocumentSnapshot): boolean {
  return field.readOnlyDependsOn !== undefined && matchesListFilterExpression(document, field.readOnlyDependsOn);
}

function documentSnapshotForFieldCondition(doctype: DocTypeDefinition, data: DocumentData): DocumentSnapshot {
  return {
    tenantId: "",
    doctype: doctype.name,
    name: "",
    version: 0,
    docstatus: "draft",
    data,
    createdAt: "",
    updatedAt: ""
  };
}

function normalizeTableFields(
  doctype: DocTypeDefinition,
  data: DocumentData,
  existingData: MutableDocumentData | undefined,
  relatedDocType: (doctype: string) => DocTypeDefinition | undefined
): DocumentData {
  const entries = Object.entries(data).map(([fieldName, value]) => {
    const field = doctype.fields.find((item) => item.name === fieldName);
    if (field?.type !== "table" || !field.tableOf || !Array.isArray(value)) {
      return [fieldName, value] as const;
    }
    const child = relatedDocType(field.tableOf);
    if (!child) {
      return [fieldName, value.map((row) => stripChildRowInternalFields(row))] as const;
    }
    const existingValue = existingData?.[fieldName];
    const existingRows = Array.isArray(existingValue) ? existingValue : undefined;
    const readOnlyChildFields = child.fields.filter((childField) => childField.readOnly);
    const rows = value.map((row) => {
      if (!isMutableData(row)) {
        return row;
      }
      const originIndex = childRowOriginIndex(row[CHILD_TABLE_ROW_INDEX_FIELD]);
      const existingRow =
        originIndex === undefined || existingRows === undefined ? undefined : existingRows[originIndex];
      const normalized = normalizeTableFields(
        child,
        stripChildRowInternalFields(row),
        isMutableData(existingRow) ? existingRow : undefined,
        relatedDocType
      ) as MutableDocumentData;
      if (!isMutableData(existingRow) || readOnlyChildFields.length === 0) {
        return normalized;
      }
      const preserved = { ...normalized };
      for (const childField of readOnlyChildFields) {
        if (
          !Object.prototype.hasOwnProperty.call(preserved, childField.name) &&
          Object.prototype.hasOwnProperty.call(existingRow, childField.name)
        ) {
          preserved[childField.name] = existingRow[childField.name];
        }
      }
      return preserved;
    });
    return [fieldName, rows] as const;
  });
  return Object.fromEntries(entries) as DocumentData;
}

function stripChildRowInternalFields(row: unknown): DocumentData {
  if (!isMutableData(row)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(row).filter(([fieldName]) => fieldName !== CHILD_TABLE_ROW_INDEX_FIELD)
  ) as DocumentData;
}

function childRowOriginIndex(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function isMutableData(value: unknown): value is MutableDocumentData {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
