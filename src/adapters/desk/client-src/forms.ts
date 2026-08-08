/**
 * Form binding + `frm` API, ported verbatim from the legacy desk client string:
 *
 * - `registerFormHandlers` / `currentFormBinding` / `createFrm` (get/set_value,
 *   set_df_property, toggle_display/enable, save, merge_save, share_draft, trigger)
 * - save validation + dirty tracking (`data-dirty`)
 * - conditional visibility DSL (`data-cf-frappe-hidden-depends-on`)
 * - typed field coercion (`data-cf-frappe-field-type`), locked-value restore
 * - child table paths (`table[0].field`, CHILD_TABLE_ROW_INDEX_FIELD)
 * - document collaboration wiring (field-edit intents + shared drafts) on top of the
 *   realtime module's `cfFrappe.realtime.subscribe` (resolved at hydrate time)
 *
 * Registration: the module exports {@link registerFormsModule}; the flip agent wires
 * it from `hydrators.ts` (contract: `registerFormsModule()` at import time there).
 */

import { registerHydrator, registerNamespaceContribution } from "./boot.js";
import {
  CHILD_TABLE_ROW_INDEX_FIELD,
  LOCKED_VALUE_PROPERTY,
  READ_ONLY_PROPERTY,
  SHARED_DRAFT_MESSAGE_TYPE,
  SOFT_DISABLED_PROPERTY
} from "./constants.js";
import { pageContext, ready, type DeskPageContext } from "./context.js";
import { request, resourcePath, unwrapData } from "./http.js";
import { cloneMergeValue, documentMergePlan, type DocumentMergePlan } from "./merge.js";
import type {
  FormNamespaceExtension,
  HydratorRegistration,
  NamespaceContribution,
  RealtimeTopicOptions,
  UnknownRecord
} from "./seams.js";
import { documentTopicFromOptions } from "./topics.js";
import { isPlainObject } from "./url.js";

/** Any element carrying a `name` attribute inside the desk form (input/select/textarea). */
export type FormControl = HTMLElement & {
  name: string;
  value: string;
  type?: string;
  checked?: boolean;
  required?: boolean;
  readOnly?: boolean;
};

/** Subscription handed back by `cfFrappe.realtime.subscribe` (collaboration slice). */
export interface CollaborationSubscription {
  sendFieldEdit(field: string, input?: UnknownRecord): unknown;
  sendSharedDraft?(input?: unknown): unknown;
}

/** Legacy `frm` API surface (parity with the string client). */
export interface Frm {
  doc: UnknownRecord;
  docname: string | undefined;
  doctype: string | undefined;
  validated: boolean;
  last_merge_result?: unknown;
  remote_merge_plan?: unknown;
  dirty(): void;
  get_value(fieldname: string): unknown;
  clear_value(fieldname: string): Promise<unknown>;
  get_field(fieldname: string): FormControl | null;
  is_dirty(): boolean;
  is_new(): boolean;
  refresh(): boolean;
  refresh_field(fieldname: string): void;
  save(options?: UnknownRecord): Promise<unknown> | boolean;
  set_value(fieldname: string, value: unknown): Promise<unknown>;
  set_df_property(fieldname: string, property: string, value: unknown): Frm;
  toggle_display(fieldname: string, show: unknown): Frm;
  toggle_enable(fieldname: string, enable: unknown): Frm;
  trigger(eventName: string): boolean;
  mergePlan(remote?: unknown, draft?: unknown): DocumentMergePlan;
  merge_save(): Promise<unknown>;
  share_draft(input?: unknown): unknown;
}

export interface FormBinding {
  baseDoc: UnknownRecord;
  baseDocstatus: unknown;
  baseVersion: number | undefined;
  context: DeskPageContext;
  dirty: boolean;
  doc: UnknownRecord;
  form: HTMLFormElement;
  frm: Frm;
  submitting: boolean;
  validated: boolean;
  collaborationSubscription?: CollaborationSubscription | undefined;
  remoteSnapshot?: unknown;
  remoteMergePlan?: unknown;
}

interface ChildFieldPath {
  field: string;
  index: number;
  table: string;
}

const formHandlers: Record<string, UnknownRecord[]> = {};
let formBinding: FormBinding | null = null;

function expando(field: FormControl): Record<string, unknown> {
  return field as unknown as Record<string, unknown>;
}

export function registerFormHandlers(doctype: string, handlers?: UnknownRecord): void {
  const registered = formHandlers[doctype] || [];
  registered.push(handlers || {});
  formHandlers[doctype] = registered;
  ready(() => {
    const binding = currentFormBinding();
    if (binding && binding.context.doctype === doctype) {
      triggerFormHandler(binding, handlers || {}, "setup");
      triggerFormHandler(binding, handlers || {}, "onload");
      triggerFormHandler(binding, handlers || {}, "refresh");
    }
  });
}

export function currentFormBinding(): FormBinding | null {
  const context = pageContext();
  if (context.scope !== "form" || !context.doctype) {
    return null;
  }
  const form = document.querySelector<HTMLFormElement>("form.form");
  if (!form) {
    return null;
  }
  if (!formBinding || formBinding.form !== form) {
    formBinding = createFormBinding(context, form);
  }
  return formBinding;
}

function createFormBinding(context: DeskPageContext, form: HTMLFormElement): FormBinding {
  const baseDoc = readFormData(form);
  const binding: FormBinding = {
    baseDoc: cloneMergeValue(baseDoc) as UnknownRecord,
    baseDocstatus: context.documentStatus,
    baseVersion: context.documentVersion === undefined ? formExpectedVersion(form) : context.documentVersion,
    context,
    dirty: false,
    doc: baseDoc,
    form,
    frm: undefined as unknown as Frm,
    submitting: false,
    validated: true
  };
  binding.frm = createFrm(binding);
  attachFieldListeners(binding);
  applyConditionalFieldVisibility(binding);
  attachDocumentCollaboration(binding);
  form.addEventListener("submit", (event) => {
    if (binding.submitting) {
      return;
    }
    if (!isSaveSubmit(event)) {
      return;
    }
    if (!validateFormForSave(binding)) {
      event.preventDefault();
    }
  });
  return binding;
}

function createFrm(binding: FormBinding): Frm {
  const frm: Frm = {
    doc: binding.doc,
    docname: binding.context.documentName,
    doctype: binding.context.doctype,
    validated: true,
    dirty: () => {
      binding.dirty = true;
      binding.form.dataset.dirty = "1";
    },
    get_value: (fieldname: string) => {
      syncFormData(binding);
      return docValue(binding.doc, fieldname);
    },
    clear_value: (fieldname: string) => frm.set_value(fieldname, null),
    get_field: (fieldname: string) => {
      const fields = fieldsNamed(binding.form, fieldname);
      return fields.length > 0 ? (fields[0] as FormControl) : null;
    },
    is_dirty: () => binding.dirty,
    is_new: () => !binding.context.documentName,
    refresh: () => triggerFormEvent(binding, "refresh"),
    refresh_field: (fieldname: string) => {
      setFieldValue(binding.form, fieldname, docValue(binding.doc, fieldname));
    },
    save: (options?: UnknownRecord) => {
      if (options && options.merge) {
        return mergeSaveForm(binding);
      }
      return submitNativeForm(binding);
    },
    set_value: (fieldname: string, value: unknown) => {
      setFieldValue(binding.form, fieldname, value);
      syncFormData(binding);
      frm.dirty();
      triggerFormEvent(binding, fieldname);
      applyConditionalFieldVisibility(binding);
      return Promise.resolve(value);
    },
    set_df_property: (fieldname: string, property: string, value: unknown) => {
      setFieldProperty(binding.form, fieldname, property, value);
      return frm;
    },
    toggle_display: (fieldname: string, show: unknown) => {
      setFieldProperty(binding.form, fieldname, "hidden", !show);
      return frm;
    },
    toggle_enable: (fieldname: string, enable: unknown) => {
      setFieldProperty(binding.form, fieldname, "disabled", !enable);
      return frm;
    },
    trigger: (eventName: string) => triggerFormEvent(binding, eventName),
    mergePlan: (remote?: unknown, draft?: unknown) => currentFormMergePlan(binding, remote, draft),
    merge_save: () => mergeSaveForm(binding),
    share_draft: (input?: unknown) => sendFormSharedDraft(binding, input)
  };
  return frm;
}

function validateFormForSave(binding: FormBinding): boolean {
  syncFormData(binding);
  binding.validated = true;
  binding.frm.validated = true;
  const valid =
    triggerFormEvent(binding, "validate") !== false &&
    (binding.frm.validated as boolean) !== false &&
    (binding.validated as boolean) !== false;
  const beforeSave = valid ? triggerFormEvent(binding, "before_save") !== false : false;
  return (
    valid &&
    beforeSave &&
    (binding.frm.validated as boolean) !== false &&
    (binding.validated as boolean) !== false
  );
}

function submitNativeForm(binding: FormBinding): boolean {
  if (!validateFormForSave(binding)) {
    return false;
  }
  binding.submitting = true;
  if (typeof binding.form.requestSubmit === "function") {
    binding.form.requestSubmit();
  } else if (typeof binding.form.submit === "function") {
    binding.form.submit();
  }
  binding.submitting = false;
  return true;
}

function mergeSaveForm(binding: FormBinding): Promise<unknown> {
  if (binding.submitting) {
    return Promise.resolve(false);
  }
  if (!binding.context.doctype || !binding.context.documentName || binding.baseVersion === undefined) {
    return Promise.reject(new Error("Merge save requires an existing document"));
  }
  if (!validateFormForSave(binding)) {
    return Promise.resolve(false);
  }
  const plan = currentFormLocalChangePlan(binding);
  const input: UnknownRecord = {
    baseVersion: binding.baseVersion,
    patch: plan.patch
  };
  if (plan.unset.length > 0) {
    input.unset = plan.unset;
  }
  binding.submitting = true;
  return request(`${resourcePath(binding.context.doctype, binding.context.documentName)}/merge`, {
    method: "POST",
    body: input
  })
    .then(unwrapData)
    .then((result) => {
      applyMergeSaveResult(binding, result);
      return result;
    })
    .finally(() => {
      binding.submitting = false;
    });
}

function attachFieldListeners(binding: FormBinding): void {
  binding.form.querySelectorAll<HTMLElement>("[name]").forEach((element) => {
    const field = element as FormControl;
    const fieldname = field.name;
    field.addEventListener("focus", () => {
      sendFormFieldEdit(binding, field, true);
    });
    field.addEventListener("change", () => {
      if (restoreLockedFieldValue(field)) {
        return;
      }
      syncFormData(binding);
      binding.frm.dirty();
      triggerFormEvent(binding, fieldname);
      applyConditionalFieldVisibility(binding);
      sendFormFieldEdit(binding, field, true);
    });
    field.addEventListener("input", () => {
      if (restoreLockedFieldValue(field)) {
        return;
      }
      syncFormData(binding);
      binding.frm.dirty();
      applyConditionalFieldVisibility(binding);
      sendFormFieldEdit(binding, field, true);
    });
    field.addEventListener("blur", () => {
      sendFormFieldEdit(binding, field, false);
    });
  });
}

function attachDocumentCollaboration(binding: FormBinding): void {
  const context = binding.context;
  if (!context.documentName || !context.tenantId || !context.realtimeRoute) {
    return;
  }
  try {
    const namespace = window.cfFrappe as UnknownRecord | undefined;
    const realtime = namespace && (namespace.realtime as UnknownRecord | undefined);
    const subscribe = realtime && realtime.subscribe;
    const options: RealtimeTopicOptions & { realtimeRoute?: string } = {
      tenantId: context.tenantId,
      realtimeRoute: context.realtimeRoute
    };
    binding.collaborationSubscription = (
      subscribe as (topic: string, handlers: UnknownRecord, options: UnknownRecord) => unknown
    )(
      documentTopicFromOptions(context.doctype as string, context.documentName, options),
      {},
      options
    ) as CollaborationSubscription;
  } catch (_error) {
    binding.collaborationSubscription = undefined;
  }
}

function sendFormFieldEdit(binding: FormBinding, field: FormControl, editing: boolean): void {
  if (!binding.collaborationSubscription || isInternalFormField(field.name)) {
    return;
  }
  binding.collaborationSubscription.sendFieldEdit(field.name, { editing });
}

function sendFormSharedDraft(binding: FormBinding, input?: unknown): unknown {
  let messageInput: UnknownRecord = isPlainObject(input) ? input : {};
  if (!Object.prototype.hasOwnProperty.call(messageInput, "patch")) {
    const plan = currentFormLocalChangePlan(binding);
    messageInput = Object.assign(
      {
        baseVersion: binding.baseVersion,
        patch: plan.patch
      },
      plan.unset.length > 0 ? { unset: plan.unset } : {},
      messageInput
    );
  }
  messageInput = withoutUnsetPatchFields(messageInput);
  if (!hasSharedDraftChanges(messageInput)) {
    return sharedDraftMessage(messageInput);
  }
  if (!binding.collaborationSubscription || typeof binding.collaborationSubscription.sendSharedDraft !== "function") {
    return sharedDraftMessage(messageInput);
  }
  return binding.collaborationSubscription.sendSharedDraft(messageInput);
}

function hasSharedDraftChanges(input: UnknownRecord): boolean {
  return (
    (isPlainObject(input.patch) && Object.keys(input.patch).length > 0) ||
    (Array.isArray(input.unset) && input.unset.length > 0)
  );
}

function withoutUnsetPatchFields(input: UnknownRecord): UnknownRecord {
  if (!isPlainObject(input.patch) || !Array.isArray(input.unset)) {
    return input;
  }
  const unset = input.unset.map((field) => String(field || "").trim());
  const patch = Object.assign({}, input.patch);
  unset.forEach((field) => {
    delete patch[field];
  });
  return Object.assign({}, input, { patch });
}

/** Local fallback mirroring the realtime module's shared-draft message builder. */
function sharedDraftMessage(input: unknown): UnknownRecord {
  const options: UnknownRecord = isPlainObject(input) ? input : {};
  const message: UnknownRecord = {
    type: SHARED_DRAFT_MESSAGE_TYPE
  };
  if (Number.isInteger(options.baseVersion) && (options.baseVersion as number) >= 0) {
    message.baseVersion = options.baseVersion;
  }
  if (isPlainObject(options.patch)) {
    message.patch = options.patch;
  }
  if (Array.isArray(options.unset)) {
    message.unset = options.unset;
  }
  return message;
}

function readFormData(form: HTMLFormElement): UnknownRecord {
  const doc: UnknownRecord = {};
  form.querySelectorAll<HTMLElement>("[name]").forEach((element) => {
    const field = element as FormControl;
    if (!isInternalFormField(field.name)) {
      setDocValue(doc, field.name, fieldValue(field));
    }
  });
  return doc;
}

function syncFormData(binding: FormBinding): void {
  binding.doc = readFormData(binding.form);
  binding.frm.doc = binding.doc;
}

function formExpectedVersion(form: HTMLFormElement): number {
  const fields = fieldsNamed(form, "expectedVersion");
  if (fields.length === 0) {
    return 0;
  }
  const value = Number((fields[0] as FormControl).value);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function fieldValue(field: FormControl): unknown {
  const fieldType = field.dataset && field.dataset.cfFrappeFieldType;
  if (field.type === "checkbox") {
    return Boolean(field.checked);
  }
  if (fieldType && field.value === "" && !field.required) {
    return undefined;
  }
  if (fieldType === "integer") {
    const integerValue = Number(field.value);
    return Number.isInteger(integerValue) ? integerValue : field.value;
  }
  if (fieldType === "number") {
    const numberValue = Number(field.value);
    return Number.isFinite(numberValue) ? numberValue : field.value;
  }
  if (fieldType === "boolean") {
    return field.value === "on" || field.value === "true";
  }
  if (fieldType === "json") {
    try {
      return JSON.parse(field.value);
    } catch (_error) {
      return field.value;
    }
  }
  return field.value;
}

function setFieldValue(form: HTMLFormElement, fieldname: string, value: unknown): void {
  fieldsNamed(form, fieldname).forEach((field) => {
    setControlValue(field, value);
    rememberLockedFieldValue(field);
  });
}

function fieldsNamed(form: HTMLFormElement, fieldname: string): FormControl[] {
  const fields: FormControl[] = [];
  form.querySelectorAll<HTMLElement>("[name]").forEach((element) => {
    const field = element as FormControl;
    if (field.name === fieldname) {
      fields.push(field);
    }
  });
  return fields;
}

function setFieldProperty(form: HTMLFormElement, fieldname: string, property: string, value: unknown): void {
  fieldsNamed(form, fieldname).forEach((field) => {
    if (property === "hidden") {
      setFieldHidden(field, Boolean(value));
      return;
    }
    if (property === "display") {
      setFieldHidden(field, !value);
      return;
    }
    if (property === "read_only" || property === "readOnly") {
      setFieldReadOnly(field, Boolean(value));
      return;
    }
    if (property === "disabled") {
      setFieldSoftDisabled(field, Boolean(value));
      return;
    }
    if (property === "reqd" || property === "required") {
      field.required = Boolean(value);
      return;
    }
    expando(field)[property] = value;
  });
}

function setControlValue(field: FormControl, value: unknown): void {
  if (field.type === "checkbox") {
    field.checked = Boolean(value);
  } else if (field.dataset && field.dataset.cfFrappeFieldType === "json" && value !== null && typeof value === "object") {
    field.value = JSON.stringify(value);
  } else {
    field.value = value == null ? "" : String(value);
  }
}

function fieldWrapper(field: FormControl): HTMLElement {
  if (typeof field.closest === "function") {
    return (field.closest(".field") as HTMLElement | null) || field;
  }
  return field;
}

function setFieldHidden(field: FormControl, hidden: boolean): void {
  field.hidden = hidden;
  fieldWrapper(field).hidden = hidden;
}

function setFieldReadOnly(field: FormControl, readOnly: boolean): void {
  expando(field)[READ_ONLY_PROPERTY] = readOnly;
  field.readOnly = readOnly;
  setBooleanAttribute(field, "aria-readonly", readOnly);
  if (readOnly) {
    rememberLockedFieldValue(field, true);
  } else {
    delete expando(field)[READ_ONLY_PROPERTY];
    clearLockedFieldValueIfUnlocked(field);
  }
}

function setFieldSoftDisabled(field: FormControl, disabled: boolean): void {
  expando(field)[SOFT_DISABLED_PROPERTY] = disabled;
  setBooleanAttribute(field, "aria-disabled", disabled);
  if (disabled) {
    rememberLockedFieldValue(field, true);
  } else {
    delete expando(field)[SOFT_DISABLED_PROPERTY];
    clearLockedFieldValueIfUnlocked(field);
  }
}

function setBooleanAttribute(field: FormControl, name: string, value: boolean): void {
  if (typeof field.setAttribute === "function" && typeof field.removeAttribute === "function") {
    if (value) {
      field.setAttribute(name, "true");
    } else {
      field.removeAttribute(name);
    }
  }
}

function fieldInteractionLocked(field: FormControl): boolean {
  return Boolean(expando(field)[READ_ONLY_PROPERTY] || expando(field)[SOFT_DISABLED_PROPERTY]);
}

function rememberLockedFieldValue(field: FormControl, force?: boolean): void {
  if (force || fieldInteractionLocked(field)) {
    expando(field)[LOCKED_VALUE_PROPERTY] = fieldValue(field);
  }
}

function restoreLockedFieldValue(field: FormControl): boolean {
  if (!fieldInteractionLocked(field)) {
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(field, LOCKED_VALUE_PROPERTY)) {
    setControlValue(field, expando(field)[LOCKED_VALUE_PROPERTY]);
  }
  return true;
}

function clearLockedFieldValueIfUnlocked(field: FormControl): void {
  if (!fieldInteractionLocked(field)) {
    delete expando(field)[LOCKED_VALUE_PROPERTY];
  }
}

function setDocValue(doc: UnknownRecord, fieldname: string, value: unknown): void {
  const child = childFieldPath(fieldname);
  if (child) {
    const rows: unknown[] = Array.isArray(doc[child.table]) ? (doc[child.table] as unknown[]) : [];
    rows[child.index] = Object.assign({}, (rows[child.index] as UnknownRecord | undefined) || {}, {
      [child.field]: value
    });
    doc[child.table] = rows;
    return;
  }
  doc[fieldname] = value;
}

function docValue(doc: UnknownRecord, fieldname: string): unknown {
  if (Object.prototype.hasOwnProperty.call(doc, fieldname)) {
    return doc[fieldname];
  }
  const child = childFieldPath(fieldname);
  if (!child || !Array.isArray(doc[child.table])) {
    return undefined;
  }
  const row = (doc[child.table] as unknown[])[child.index];
  return row && (row as UnknownRecord)[child.field];
}

function childFieldPath(fieldname: string): ChildFieldPath | null {
  const match = /^([^.[\]]+)\[(\d+)\]\.(.+)$/.exec(fieldname);
  if (!match) {
    return null;
  }
  return {
    field: match[3] as string,
    index: Number(match[2]),
    table: match[1] as string
  };
}

function isInternalFormField(fieldname: string): boolean {
  const child = childFieldPath(fieldname);
  return (
    fieldname === "expectedVersion" ||
    fieldname === CHILD_TABLE_ROW_INDEX_FIELD ||
    (child !== null && child.field === CHILD_TABLE_ROW_INDEX_FIELD)
  );
}

function formFieldNames(form: HTMLFormElement): string[] {
  const names: string[] = [];
  const seen: Record<string, boolean> = {};
  form.querySelectorAll<HTMLElement>("[name]").forEach((element) => {
    const field = element as FormControl;
    const fieldname = String(field.name || "").trim();
    const child = childFieldPath(fieldname);
    const mergeField = child ? child.table : fieldname;
    if (!mergeField || isInternalFormField(fieldname) || seen[mergeField]) {
      return;
    }
    seen[mergeField] = true;
    names.push(mergeField);
  });
  return names;
}

function currentFormMergePlan(binding: FormBinding, remote?: unknown, draft?: unknown): DocumentMergePlan {
  syncFormData(binding);
  const remoteSnapshot = remote || binding.remoteSnapshot || {
    version: binding.baseVersion,
    data: binding.baseDoc
  };
  const baseSnapshot = formBaseSnapshot(binding);
  return documentMergePlan(baseSnapshot, remoteSnapshot, draft || binding.doc, {
    fields: formFieldNames(binding.form)
  });
}

function currentFormLocalChangePlan(binding: FormBinding): DocumentMergePlan {
  syncFormData(binding);
  const baseSnapshot = formBaseSnapshot(binding);
  return documentMergePlan(baseSnapshot, baseSnapshot, binding.doc, {
    fields: formFieldNames(binding.form)
  });
}

function formBaseSnapshot(binding: FormBinding): UnknownRecord {
  return Object.assign(
    {
      version: binding.baseVersion,
      data: binding.baseDoc
    },
    binding.baseDocstatus === undefined ? {} : { docstatus: binding.baseDocstatus }
  );
}

function applyMergeSaveResult(binding: FormBinding, result: unknown): void {
  binding.frm.last_merge_result = result;
  const record = result as UnknownRecord | null | undefined;
  if (record && record.plan) {
    binding.remoteMergePlan = record.plan;
    binding.frm.remote_merge_plan = record.plan;
    binding.form.dataset.remoteMergeState = String((record.plan as UnknownRecord).status);
  }
  if (record && record.document) {
    binding.remoteSnapshot = record.document;
  }
  if (record && (record.status === "applied" || record.status === "noop") && record.document) {
    applyDocumentSnapshotToForm(binding, record.document);
  }
}

function applyDocumentSnapshotToForm(binding: FormBinding, snapshot: unknown): void {
  const record = snapshot as UnknownRecord | null | undefined;
  if (!record || !isPlainObject(record.data)) {
    return;
  }
  binding.baseDoc = cloneMergeValue(record.data) as UnknownRecord;
  binding.baseDocstatus = record.docstatus;
  if (typeof record.version === "number") {
    binding.baseVersion = record.version;
    binding.context.documentVersion = record.version;
    binding.form.dataset.documentVersion = String(record.version);
  }
  binding.doc = cloneMergeValue(record.data) as UnknownRecord;
  binding.frm.doc = binding.doc;
  writeDocumentToForm(binding, binding.doc);
  applyConditionalFieldVisibility(binding);
  binding.dirty = false;
  delete binding.form.dataset.dirty;
  delete binding.form.dataset.remoteUpdate;
  delete binding.remoteSnapshot;
  delete binding.remoteMergePlan;
  delete binding.frm.remote_merge_plan;
  binding.form.dataset.remoteMergeState = "clean";
}

function writeDocumentToForm(binding: FormBinding, data: UnknownRecord): void {
  binding.form.querySelectorAll<HTMLElement>("[name]").forEach((element) => {
    const field = element as FormControl;
    if (field.name === "expectedVersion") {
      setControlValue(field, binding.baseVersion);
      rememberLockedFieldValue(field);
      return;
    }
    if (isInternalFormField(field.name)) {
      return;
    }
    setControlValue(field, docValue(data, field.name));
    rememberLockedFieldValue(field);
  });
}

function applyConditionalFieldVisibility(binding: FormBinding): void {
  syncFormData(binding);
  binding.form.querySelectorAll<HTMLElement>("[name]").forEach((element) => {
    const field = element as FormControl;
    const expressionSource = field.dataset && field.dataset.cfFrappeHiddenDependsOn;
    if (!expressionSource) {
      return;
    }
    const expression = parseJson(expressionSource);
    if (!expression) {
      return;
    }
    setFieldHidden(field, matchesFormPredicateExpression(binding, expression));
  });
}

function parseJson(source: string): unknown {
  try {
    return JSON.parse(source);
  } catch (_error) {
    return null;
  }
}

function matchesFormPredicateExpression(binding: FormBinding, expression: unknown): boolean {
  if (!expression || typeof expression !== "object") {
    return false;
  }
  const record = expression as UnknownRecord;
  if (record.kind === "group") {
    const predicates: readonly unknown[] = Array.isArray(record.predicates) ? record.predicates : [];
    return record.match === "any"
      ? predicates.some((predicate) => matchesFormPredicateExpression(binding, predicate))
      : predicates.every((predicate) => matchesFormPredicateExpression(binding, predicate));
  }
  if (record.kind === "not") {
    return !matchesFormPredicateExpression(binding, record.predicate);
  }
  if (record.kind !== "compare") {
    return false;
  }
  return matchesFormPredicateComparison(binding, record);
}

function matchesFormPredicateComparison(binding: FormBinding, expression: UnknownRecord): boolean {
  const actual = formPredicateOperandValue(binding, expression.left);
  const expected = formPredicateOperandValue(binding, expression.right);
  const operator = expression.operator;
  if (operator === "eq") {
    return jsonConditionValuesEqual(actual, expected);
  }
  if (operator === "ne") {
    return actual !== undefined && actual !== null && !jsonConditionValuesEqual(actual, expected);
  }
  if (operator === "in") {
    return (
      actual !== undefined &&
      actual !== null &&
      Array.isArray(expected) &&
      expected.some((value) => jsonConditionValuesEqual(actual, value))
    );
  }
  if (operator === "not_in") {
    return (
      actual !== undefined &&
      actual !== null &&
      Array.isArray(expected) &&
      !expected.some((value) => jsonConditionValuesEqual(actual, value))
    );
  }
  if (operator === "is") {
    return expected === "set"
      ? actual !== undefined && actual !== null
      : expected === "not set" && (actual === undefined || actual === null);
  }
  if (operator === "contains") {
    return (
      actual !== undefined &&
      actual !== null &&
      expected !== undefined &&
      expected !== null &&
      String(actual).toLowerCase().indexOf(String(expected).toLowerCase()) >= 0
    );
  }
  if (operator === "like" || operator === "not_like") {
    if (actual === undefined || actual === null || typeof expected !== "string") {
      return false;
    }
    const matched = likePatternMatches(actual, expected);
    return operator === "like" ? matched : !matched;
  }
  if (operator === "gt" || operator === "gte" || operator === "lt" || operator === "lte") {
    if (!comparableConditionValues(actual, expected)) {
      return false;
    }
    const compared = compareConditionValues(actual, expected);
    return operator === "gt"
      ? compared > 0
      : operator === "gte"
        ? compared >= 0
        : operator === "lt"
          ? compared < 0
          : compared <= 0;
  }
  if (operator === "between" || operator === "not_between") {
    if (
      actual === undefined ||
      actual === null ||
      !Array.isArray(expected) ||
      expected.length !== 2 ||
      !comparableConditionValues(actual, expected[0]) ||
      !comparableConditionValues(actual, expected[1])
    ) {
      return false;
    }
    const between =
      compareConditionValues(actual, expected[0]) >= 0 && compareConditionValues(actual, expected[1]) <= 0;
    return operator === "between" ? between : !between;
  }
  return false;
}

function formPredicateOperandValue(binding: FormBinding, operand: unknown): unknown {
  if (!operand || typeof operand !== "object") {
    return undefined;
  }
  const record = operand as UnknownRecord;
  if (record.kind === "literal") {
    return record.value;
  }
  if (record.kind === "field" && record.scope === "after" && typeof record.field === "string") {
    return formConditionValue(binding, record.field);
  }
  return undefined;
}

function formConditionValue(binding: FormBinding, fieldname: string): unknown {
  if (fieldname === "system.name") {
    return binding.context.documentName;
  }
  if (fieldname === "system.docstatus") {
    return binding.context.documentStatus;
  }
  if (fieldname === "system.version") {
    return binding.context.documentVersion;
  }
  return docValue(binding.doc, fieldname);
}

function compareConditionValues(left: unknown, right: unknown): number {
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  return String(left).localeCompare(String(right));
}

function comparableConditionValues(left: unknown, right: unknown): boolean {
  return (
    left !== undefined &&
    left !== null &&
    right !== undefined &&
    right !== null &&
    typeof left !== "object" &&
    typeof right !== "object"
  );
}

function jsonConditionValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (left === undefined || right === undefined || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonConditionValuesEqual(value, right[index]))
    );
  }
  if (typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  const leftRecord = left as UnknownRecord;
  const rightRecord = right as UnknownRecord;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && jsonConditionValuesEqual(leftRecord[key], rightRecord[key]))
  );
}

function likePatternMatches(actual: unknown, pattern: string): boolean {
  return new RegExp(`^${likePatternRegex(pattern)}$`, "i").test(String(actual));
}

function likePatternRegex(pattern: string): string {
  let regex = "";
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index];
    if (character === "\\") {
      const next = pattern[index + 1];
      if (next === undefined) {
        regex += "(?!)";
        continue;
      }
      regex += escapeRegex(next);
      index += 1;
    } else if (character === "%") {
      regex += "[\\s\\S]*";
    } else if (character === "_") {
      regex += "[\\s\\S]";
    } else {
      regex += escapeRegex(character || "");
    }
  }
  return regex;
}

function escapeRegex(value: unknown): string {
  return String(value).replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function isSaveSubmit(event: Event): boolean {
  const submitter = (event as { submitter?: Element | null }).submitter;
  return !(
    submitter &&
    typeof submitter.getAttribute === "function" &&
    submitter.getAttribute("formaction") !== null
  );
}

export function triggerFormEvent(binding: FormBinding, eventName: string): boolean {
  let ok = true;
  (formHandlers[binding.context.doctype as string] || []).forEach((handlers) => {
    if (triggerFormHandler(binding, handlers, eventName) === false) {
      ok = false;
    }
  });
  return ok;
}

function triggerFormHandler(binding: FormBinding, handlers: UnknownRecord | undefined, eventName: string): unknown {
  const handler = handlers && handlers[eventName];
  if (typeof handler !== "function") {
    return undefined;
  }
  binding.validated = binding.frm.validated;
  const result = (handler as (frm: Frm) => unknown)(binding.frm);
  binding.validated = binding.frm.validated;
  return result;
}

/** `cfFrappe.form` surface (parity: current / on / trigger). */
export const formNamespaceExtension: FormNamespaceExtension = {
  current(): Frm | null {
    const binding = currentFormBinding();
    return binding ? binding.frm : null;
  },
  on(doctype: string | UnknownRecord, handlers?: UnknownRecord): unknown {
    return registerFormHandlers(doctype as string, handlers);
  },
  trigger(eventName: string): unknown {
    const binding = currentFormBinding();
    return binding ? triggerFormEvent(binding, eventName) : undefined;
  }
};

export const formsNamespaceContribution: NamespaceContribution = () => ({
  form: formNamespaceExtension
});

/** Boot hydrator (legacy `ready(currentFormBinding)`). */
export const formsHydration: HydratorRegistration = {
  name: "form-binding",
  hydrate: () => {
    currentFormBinding();
  }
};

/** Registers the forms hydrator + `cfFrappe.form` contribution (wired by the flip agent). */
export function registerFormsModule(): void {
  registerHydrator(formsHydration);
  registerNamespaceContribution(formsNamespaceContribution);
}

/** Test seam (mirrors `boot.resetRegistries`): clears handler registry and cached binding. */
export function resetFormsState(): void {
  Object.keys(formHandlers).forEach((key) => {
    delete formHandlers[key];
  });
  formBinding = null;
}
