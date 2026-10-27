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
import { evaluatePredicateExpression } from "../core/predicates.js";
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
import { fieldIsReadOnlyForData } from "./document-field-policy.js";
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

export interface DocumentFormFieldAccessProjectionOptions {
  readonly actor: Actor;
  readonly doctype: DocTypeDefinition;
  readonly document: DocumentSnapshot;
  readonly canUpdateDocument: boolean;
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

/**
 * What one caller may do with one field of one document, as the backend decides
 * it.
 *
 * Exposed so a client renders what it is told instead of inferring it from a
 * missing key or a write that comes back 403. A field the caller may not even
 * know exists — one `canFieldAppearInMetadata` hides — has no entry at all, the
 * same as in the doctype metadata, so naming it here would not leak it either.
 *
 * - `read`: the value is in the document the caller is handed.
 * - `redacted`: set whenever `read` is false. The field is in the caller's schema
 *   but its value was withheld, so an absent key is not "empty".
 * - `write`: an update of this field, on the document as it stands, would pass
 *   the field checks. It folds in everything a write enforces per field: the
 *   document's update permission, docstatus (only `allowOnSubmit` fields once
 *   submitted, nothing once cancelled), `readOnly` and `readOnlyDependsOn`, the
 *   workflow state field, and field permission rules.
 * - `hidden`: a display hint — `hidden` or a true `hiddenDependsOn`. It is not a
 *   permission and says nothing about whether the value was sent.
 */
export interface DocumentFieldState {
  readonly read: boolean;
  readonly write: boolean;
  readonly redacted?: true;
  readonly hidden?: true;
}

export type DocumentFieldStates = Readonly<Record<string, DocumentFieldState>>;

/**
 * Field states for the top-level fields of `document`.
 *
 * `document` is the stored snapshot, not the redacted one — read and write
 * rules may depend on values the caller is not shown, and the answer has to be
 * the one enforcement would give. `hiddenDependsOn` is the exception: it is
 * evaluated against the redacted data, because it is a display rule the client
 * evaluates too, and evaluating it on a withheld value would leak that value
 * one bit at a time.
 */
export function documentFieldStates(options: DocumentFormFieldAccessProjectionOptions): DocumentFieldStates {
  return computeDocumentFieldStates(options, { conditionalReadOnly: true });
}

function computeDocumentFieldStates(
  options: DocumentFormFieldAccessProjectionOptions,
  rules: { readonly conditionalReadOnly: boolean }
): DocumentFieldStates {
  const tenantId = options.document.tenantId;
  // Workflow state moves only through a transition. (A naming series' target
  // field needs no entry: `defineDocType` requires it to be `readOnly`.)
  const workflowStateFields = new Set((options.doctype.workflows ?? []).map((workflow) => workflow.stateField));
  const fields = options.doctype.fields.filter((field) =>
    canFieldAppearInMetadata({ actor: options.actor, action: "read", field })
  );
  const readable = new Map(fields.map((field) => {
    const value = options.document.data[field.name];
    return [field.name, canReadField({
      actor: options.actor,
      doctype: options.doctype,
      field,
      document: options.document,
      tenantId,
      ...(value === undefined ? {} : { value })
    })] as const;
  }));
  // What the caller is shown, for evaluating display rules. Allow-listed, not
  // deny-listed: a field missing from `readable` is one the caller's metadata
  // hides, and its value must not reach `hiddenDependsOn` either.
  const declared = new Set(options.doctype.fields.map((field) => field.name));
  const shown: DocumentSnapshot = {
    ...options.document,
    data: Object.fromEntries(
      Object.entries(options.document.data).filter(([name]) =>
        declared.has(name) ? readable.get(name) === true : options.doctype.allowUnknownFields === true
      )
    ) as DocumentData
  };
  return Object.freeze(Object.fromEntries(fields.map((field) => {
    const read = readable.get(field.name) === true;
    const value = options.document.data[field.name];
    const write = options.canUpdateDocument &&
      documentStatusAllowsFieldUpdate(options.document, field) &&
      !workflowStateFields.has(field.name) &&
      !(field.readOnly === true ||
        (rules.conditionalReadOnly && fieldIsReadOnlyForData(options.doctype, field, options.document.data))) &&
      canWriteField({
        actor: options.actor,
        action: "update",
        doctype: options.doctype,
        field,
        document: options.document,
        tenantId,
        ...(value === undefined ? {} : { value })
      });
    const state: DocumentFieldState = {
      read,
      write,
      ...(read ? {} : { redacted: true as const }),
      ...(fieldIsHidden(field, shown) ? { hidden: true as const } : {})
    };
    return [field.name, Object.freeze(state)] as const;
  })));
}

export function projectDocTypeForDocumentFormAccess(
  options: DocumentFormFieldAccessProjectionOptions
): DocTypeDefinition {
  // Without `readOnlyDependsOn`: Desk does not re-evaluate it as the user edits,
  // and the save path drops read-only fields silently, so fixing it from the
  // stored state would discard an edit made in the same save that unlocks it.
  // The server still enforces it against the data being written.
  const states = computeDocumentFieldStates(options, { conditionalReadOnly: false });
  const fields = options.doctype.fields
    .filter((field) => states[field.name] !== undefined)
    .map((field) => {
      const state = states[field.name] as DocumentFieldState;
      // Not editable in a form unless it is also readable: the input would
      // render empty, and saving the form would overwrite the withheld value.
      const editable = state.write && state.read;
      return editable || field.readOnly === true
        ? field
        : Object.freeze({ ...field, readOnly: true });
    });
  return projectDocTypeFields(options.doctype, fields, options.actor);
}

function documentStatusAllowsFieldUpdate(document: DocumentSnapshot, field: FieldDefinition): boolean {
  if (document.docstatus === "draft") {
    return true;
  }
  return document.docstatus === "submitted" && field.allowOnSubmit === true;
}

function fieldIsHidden(field: FieldDefinition, document: DocumentSnapshot): boolean {
  if (field.hidden === true) {
    return true;
  }
  return field.hiddenDependsOn !== undefined && evaluatePredicateExpression(field.hiddenDependsOn, {
    before: null,
    after: document,
    input: {}
  });
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
