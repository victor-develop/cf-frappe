import {
  canAccessField,
  canFieldAppearInMetadata,
  canFieldBeQueried,
  canReadField,
  canWriteField
} from "../core/field-permissions.js";
import type {
  DocumentFieldMergeConflict,
  DocumentFieldMergePlan
} from "../core/document-merge.js";
import { isListFilterGroup } from "../core/list-view.js";
import { compactData } from "../core/schema.js";
import type {
  Actor,
  DocTypeDefinition,
  DocumentData,
  DocumentSnapshot,
  FieldDefinition,
  FieldPermissionAction,
  FormViewDefinition,
  JsonValue,
  ListDocumentsFilter,
  ListFilterExpression,
  ListViewDefinition,
  MutableDocumentData,
  TenantId,
  ValidationIssue
} from "../core/types.js";
import type { RelatedDocTypeResolver } from "./document-reference-policy.js";

const SYSTEM_ORDER_FIELDS = new Set(["name", "createdAt", "updatedAt", "version"]);
const SYSTEM_MERGE_FIELDS = new Set(["docstatus"]);

export interface FieldAccessDocTypeProjectionOptions {
  readonly actor: Actor;
  readonly doctype: DocTypeDefinition;
  readonly action: FieldPermissionAction;
  readonly tenantId?: TenantId;
}

export interface DocumentFieldReadOptions {
  readonly actor: Actor;
  readonly doctype: DocTypeDefinition;
  readonly document: DocumentSnapshot;
  readonly relatedDocType: RelatedDocTypeResolver;
}

export interface DocumentFieldWriteOptions {
  readonly actor: Actor;
  readonly action: "create" | "update";
  readonly doctype: DocTypeDefinition;
  readonly data: MutableDocumentData;
  readonly relatedDocType: RelatedDocTypeResolver;
  readonly document?: DocumentSnapshot;
  readonly unset?: readonly string[];
}

export function projectDocTypeForFieldAccess(
  options: FieldAccessDocTypeProjectionOptions
): DocTypeDefinition {
  const fields = options.doctype.fields.filter((field) =>
    canFieldAppearInMetadata({
      actor: options.actor,
      action: options.action,
      field
    })
  );
  return projectDocTypeFields(options.doctype, fields, options.actor);
}

export function projectDocTypeForFieldQueries(input: {
  readonly actor: Actor;
  readonly doctype: DocTypeDefinition;
}): DocTypeDefinition {
  return projectDocTypeFields(
    input.doctype,
    input.doctype.fields.filter((field) => canFieldBeQueried({ actor: input.actor, field })),
    input.actor
  );
}

export function canAccessFieldValue(input: {
  readonly actor: Actor;
  readonly action: FieldPermissionAction;
  readonly doctype: DocTypeDefinition;
  readonly field: FieldDefinition;
  readonly document?: DocumentSnapshot;
  readonly value?: JsonValue;
  readonly tenantId?: TenantId;
}): boolean {
  return canAccessField(input);
}

export function redactDocumentSnapshot(options: DocumentFieldReadOptions): DocumentSnapshot {
  return {
    ...options.document,
    data: redactDocumentData({
      actor: options.actor,
      doctype: options.doctype,
      data: options.document.data,
      document: options.document,
      relatedDocType: options.relatedDocType,
      tenantId: options.document.tenantId
    })
  };
}

export function readableDocumentFieldNames(options: {
  readonly actor: Actor;
  readonly doctype: DocTypeDefinition;
  readonly document: DocumentSnapshot;
}): ReadonlySet<string> {
  return new Set(
    options.doctype.fields
      .filter((field) =>
        canReadField({
          actor: options.actor,
          doctype: options.doctype,
          field,
          document: options.document,
          tenantId: options.document.tenantId,
          ...(options.document.data[field.name] === undefined ? {} : { value: options.document.data[field.name] })
        })
      )
      .map((field) => field.name)
  );
}

export function fieldPermissionIssues(options: DocumentFieldWriteOptions): readonly ValidationIssue[] {
  return documentFieldPermissionIssues({
    ...options,
    pathPrefix: ""
  });
}

export function projectDocumentMergePlanForFieldAccess(options: {
  readonly actor: Actor;
  readonly doctype: DocTypeDefinition;
  readonly document: DocumentSnapshot;
  readonly plan: DocumentFieldMergePlan;
  readonly relatedDocType: RelatedDocTypeResolver;
}): DocumentFieldMergePlan {
  const readableFields = readableDocumentFieldNames({
    actor: options.actor,
    doctype: options.doctype,
    document: options.document
  });
  const schemaFields = new Map(options.doctype.fields.map((field) => [field.name, field]));
  const fieldVisible = (field: string) =>
    SYSTEM_MERGE_FIELDS.has(field) ||
    readableFields.has(field) ||
    (options.doctype.allowUnknownFields === true && !schemaFields.has(field));
  const patchData = compactData(options.plan.patch);
  const patchDocument = {
    ...options.document,
    data: compactData({
      ...options.document.data,
      ...patchData
    })
  };
  const conflicts = options.plan.conflicts
    .filter((conflict) => fieldVisible(conflict.field))
    .map((conflict) => projectMergeConflictForFieldAccess({
      actor: options.actor,
      doctype: options.doctype,
      document: patchDocument,
      conflict,
      fields: schemaFields,
      relatedDocType: options.relatedDocType
    }));
  return {
    ...options.plan,
    localChangedFields: options.plan.localChangedFields.filter(fieldVisible),
    remoteChangedFields: options.plan.remoteChangedFields.filter(fieldVisible),
    mergedFields: options.plan.mergedFields.filter(fieldVisible),
    patch: redactDocumentData({
      actor: options.actor,
      doctype: options.doctype,
      data: patchData,
      document: patchDocument,
      relatedDocType: options.relatedDocType,
      tenantId: options.document.tenantId
    }) as MutableDocumentData,
    unset: options.plan.unset.filter(fieldVisible),
    conflicts
  };
}

function projectDocTypeFields(
  doctype: DocTypeDefinition,
  fields: readonly FieldDefinition[],
  actor: Actor
): DocTypeDefinition {
  const visibleNames = new Set(fields.map((field) => field.name));
  const queryableNames = new Set(
    fields
      .filter((field) => canFieldBeQueried({ actor, field }))
      .map((field) => field.name)
  );
  return Object.freeze({
    ...doctype,
    fields: Object.freeze(fields),
    ...projectFormView(doctype.formView, visibleNames),
    ...projectListView(doctype.listView, visibleNames, queryableNames, fields)
  });
}

function projectMergeConflictForFieldAccess(input: {
  readonly actor: Actor;
  readonly doctype: DocTypeDefinition;
  readonly document: DocumentSnapshot;
  readonly conflict: DocumentFieldMergeConflict;
  readonly fields: ReadonlyMap<string, FieldDefinition>;
  readonly relatedDocType: RelatedDocTypeResolver;
}): DocumentFieldMergeConflict {
  const field = input.fields.get(input.conflict.field);
  if (field === undefined) {
    return input.conflict;
  }
  return {
    field: input.conflict.field,
    reason: input.conflict.reason,
    basePresent: input.conflict.basePresent,
    localPresent: input.conflict.localPresent,
    remotePresent: input.conflict.remotePresent,
    ...projectMergeConflictValue("baseValue", input.conflict.baseValue, { ...input, field }),
    ...projectMergeConflictValue("localValue", input.conflict.localValue, { ...input, field }),
    ...projectMergeConflictValue("remoteValue", input.conflict.remoteValue, { ...input, field })
  };
}

function projectMergeConflictValue(
  key: "baseValue" | "localValue" | "remoteValue",
  value: JsonValue | undefined,
  input: {
    readonly actor: Actor;
    readonly document: DocumentSnapshot;
    readonly field: FieldDefinition;
    readonly relatedDocType: RelatedDocTypeResolver;
  }
): Partial<Record<"baseValue" | "localValue" | "remoteValue", JsonValue>> {
  return value === undefined
    ? {}
    : {
        [key]: redactFieldValue({
          actor: input.actor,
          field: input.field,
          value,
          parent: input.document,
          relatedDocType: input.relatedDocType,
          tenantId: input.document.tenantId
        })
      };
}

function projectFormView(
  formView: FormViewDefinition | undefined,
  visibleNames: ReadonlySet<string>
): { readonly formView?: FormViewDefinition } {
  if (formView?.sections === undefined) {
    return {};
  }
  const sections = formView.sections
    .map((section) => ({
      ...section,
      fields: Object.freeze(section.fields.filter((field) => visibleNames.has(field)))
    }))
    .filter((section) => section.fields.length > 0);
  return sections.length === 0
    ? {}
    : {
        formView: Object.freeze({
          ...formView,
          sections: Object.freeze(sections.map((section) => Object.freeze(section)))
        })
      };
}

function projectListView(
  listView: ListViewDefinition | undefined,
  visibleNames: ReadonlySet<string>,
  queryableNames: ReadonlySet<string>,
  visibleFields: readonly FieldDefinition[]
): { readonly listView?: ListViewDefinition } {
  const shouldPinFilterFields = listView === undefined && visibleFields.some((field) => !queryableNames.has(field.name));
  if (listView === undefined) {
    return shouldPinFilterFields
      ? { listView: Object.freeze({ filterFields: Object.freeze([...queryableNames]) }) }
      : {};
  }
  const columns = listView.columns?.filter((field) => visibleNames.has(field));
  const filterFields = listView.filterFields?.filter((field) => systemFilterField(field) || queryableNames.has(field));
  const filters = listView.filters?.filter((filter) => listFilterReferencesQueryableField(filter, queryableNames));
  const orderBy = listView.orderBy === undefined || orderFieldIsQueryable(listView.orderBy, queryableNames)
    ? listView.orderBy
    : undefined;
  const {
    columns: _columns,
    filterFields: _filterFields,
    filters: _filters,
    orderBy: _orderBy,
    ...base
  } = listView;
  return {
    listView: Object.freeze({
      ...base,
      ...(columns === undefined || columns.length === 0 ? {} : { columns: Object.freeze(columns) }),
      ...(filterFields === undefined ? {} : { filterFields: Object.freeze(filterFields) }),
      ...(filters === undefined || filters.length === 0 ? {} : { filters: Object.freeze(filters) }),
      ...(orderBy === undefined ? {} : { orderBy })
    })
  };
}

function listFilterReferencesQueryableField(
  filter: ListDocumentsFilter,
  queryableNames: ReadonlySet<string>
): boolean {
  return systemFilterField(filter.field) || queryableNames.has(filter.field);
}

function orderFieldIsQueryable(field: string, queryableNames: ReadonlySet<string>): boolean {
  return SYSTEM_ORDER_FIELDS.has(field) || queryableNames.has(field);
}

function systemFilterField(field: string): boolean {
  return field.startsWith("system.");
}

function redactDocumentData(input: {
  readonly actor: Actor;
  readonly doctype: DocTypeDefinition;
  readonly data: DocumentData;
  readonly document: DocumentSnapshot;
  readonly relatedDocType: RelatedDocTypeResolver;
  readonly tenantId: TenantId;
}): DocumentData {
  const redacted: MutableDocumentData = input.doctype.allowUnknownFields ? { ...input.data } : {};
  for (const field of input.doctype.fields) {
    if (!Object.prototype.hasOwnProperty.call(input.data, field.name)) {
      continue;
    }
    const value = input.data[field.name];
    if (value === undefined) {
      continue;
    }
    if (!canReadField({
      actor: input.actor,
      doctype: input.doctype,
      field,
      document: input.document,
      value,
      tenantId: input.tenantId
    })) {
      delete redacted[field.name];
      continue;
    }
    redacted[field.name] = redactFieldValue({
      actor: input.actor,
      field,
      value,
      parent: input.document,
      relatedDocType: input.relatedDocType,
      tenantId: input.tenantId
    });
  }
  return Object.fromEntries(
    Object.entries(redacted).filter(([, value]) => value !== undefined)
  ) as DocumentData;
}

function redactFieldValue(input: {
  readonly actor: Actor;
  readonly field: FieldDefinition;
  readonly value: JsonValue;
  readonly parent: DocumentSnapshot;
  readonly relatedDocType: RelatedDocTypeResolver;
  readonly tenantId: TenantId;
}): JsonValue {
  if (input.field.type !== "table" || input.field.tableOf === undefined || !Array.isArray(input.value)) {
    return input.value;
  }
  const child = input.relatedDocType(input.field.tableOf);
  if (child === undefined) {
    return input.value;
  }
  return input.value.map((row, index) => {
    if (!isMutableData(row)) {
      return row;
    }
    const rowData = row as DocumentData;
    const rowSnapshot = childRowSnapshot({
      parent: input.parent,
      child,
      field: input.field,
      index,
      data: rowData
    });
    return redactDocumentData({
      actor: input.actor,
      doctype: child,
      data: rowData,
      document: rowSnapshot,
      relatedDocType: input.relatedDocType,
      tenantId: input.tenantId
    });
  });
}

function documentFieldPermissionIssues(options: DocumentFieldWriteOptions & {
  readonly pathPrefix: string;
}): readonly ValidationIssue[] {
  const fields = new Map(options.doctype.fields.map((field) => [field.name, field]));
  const changedFields = [...new Set([...Object.keys(options.data), ...(options.unset ?? [])])];
  return changedFields.flatMap((fieldName) => {
    const field = fields.get(fieldName);
    if (field === undefined) {
      return [];
    }
    const fieldPath = `${options.pathPrefix}${field.name}`;
    const value = options.data[field.name];
    if (!canWriteField({
      actor: options.actor,
      action: options.action,
      doctype: options.doctype,
      field,
      ...(options.document === undefined ? {} : { document: options.document }),
      ...(value === undefined ? {} : { value }),
      ...(options.document?.tenantId === undefined ? {} : { tenantId: options.document.tenantId })
    })) {
      return [fieldPermissionIssue(options.actor, options.action, fieldPath)];
    }
    return childFieldPermissionIssues({ ...options, field, value, fieldPath });
  });
}

function childFieldPermissionIssues(input: DocumentFieldWriteOptions & {
  readonly field: FieldDefinition;
  readonly fieldPath: string;
  readonly pathPrefix: string;
  readonly value: JsonValue | undefined;
}): readonly ValidationIssue[] {
  if (input.field.type !== "table" || input.field.tableOf === undefined || !Array.isArray(input.value)) {
    return [];
  }
  const child = input.relatedDocType(input.field.tableOf);
  if (child === undefined) {
    return [];
  }
  return input.value.flatMap((row, index) => {
    if (!isMutableData(row)) {
      return [];
    }
    const rowData = row as MutableDocumentData;
    const rowDocument = childRowSnapshot({
      parent: input.document,
      child,
      field: input.field,
      index,
      data: Object.fromEntries(
        Object.entries(rowData).filter(([, value]) => value !== undefined)
      ) as DocumentData
    });
    return documentFieldPermissionIssues({
      actor: input.actor,
      action: input.action,
      doctype: child,
      data: rowData,
      relatedDocType: input.relatedDocType,
      document: rowDocument,
      pathPrefix: `${input.fieldPath}[${index}].`
    });
  });
}

function fieldPermissionIssue(
  actor: Actor,
  action: "create" | "update",
  field: string
): ValidationIssue {
  return {
    field,
    code: "field_permission",
    message: `Actor '${actor.id}' cannot ${action} field '${field}'`
  };
}

function childRowSnapshot(input: {
  readonly parent: DocumentSnapshot | undefined;
  readonly child: DocTypeDefinition;
  readonly field: FieldDefinition;
  readonly index: number;
  readonly data: DocumentData;
}): DocumentSnapshot {
  return {
    tenantId: input.parent?.tenantId ?? "",
    doctype: input.child.name,
    name: input.parent === undefined ? `${input.field.name}[${input.index}]` : `${input.parent.name}.${input.field.name}[${input.index}]`,
    version: input.parent?.version ?? 0,
    docstatus: input.parent?.docstatus ?? "draft",
    data: input.data,
    createdAt: input.parent?.createdAt ?? "",
    updatedAt: input.parent?.updatedAt ?? ""
  };
}

function isMutableData(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function listFilterExpressionReferencesOnlyQueryableFields(
  expression: ListFilterExpression,
  queryableFields: ReadonlySet<string>
): boolean {
  if (isListFilterGroup(expression)) {
    return expression.filters.every((filter) =>
      listFilterExpressionReferencesOnlyQueryableFields(filter, queryableFields)
    );
  }
  return systemFilterField(expression.field) || queryableFields.has(expression.field);
}
