/**
 * Document presence panel hydration, ported from the legacy desk client string
 * (client.ts: hydratePresencePanels .. setPanelText).
 *
 * Behavior parity notes:
 * - Same DOM selectors (`[data-cf-frappe-presence="document"]`, panel text targets,
 *   merge-save / apply-shared-draft buttons), the same `data-*` state attributes and
 *   the same element-expando guards (`__cfFrappePresenceSubscription`, ...).
 * - The legacy code reached into the shared form binding directly. Across the module
 *   seam this port talks to the form module through its public runtime surface:
 *   `window.cfFrappe.form.current()` (the legacy `frm` API: `doctype`/`docname`/`doc`,
 *   `dirty()`, `mergePlan()`, `merge_save()`, `trigger()`) plus the same
 *   `form.form` element the form binding hydrates. Form-value read/write helpers the
 *   legacy shared with the form binding (`setControlValue`, `fieldValue`,
 *   child-table paths) are duplicated here verbatim, keyed off the shared constants.
 */

import { registerHydrator } from "./boot.js";
import {
  CHILD_TABLE_ROW_INDEX_FIELD,
  LOCKED_VALUE_PROPERTY,
  READ_ONLY_PROPERTY,
  SOFT_DISABLED_PROPERTY
} from "./constants.js";
import { pageContext } from "./context.js";
import {
  realtimePresenceDocument,
  realtimeSubscribe,
  type RealtimeConnectOptions,
  type RealtimeSubscription
} from "./realtime.js";
import type { UnknownRecord } from "./seams.js";
import { documentTopicFromOptions } from "./topics.js";
import { isPlainObject } from "./url.js";

/* ------------------------------- form seam -------------------------------- */

/**
 * Duck-typed slice of the legacy `frm` API (what `cfFrappe.form.current()` returns)
 * that the presence panel relies on.
 */
export interface PresenceFrm {
  doc: unknown;
  doctype?: string;
  docname?: string;
  dirty(): void;
  mergePlan(remote?: unknown, draft?: unknown): unknown;
  merge_save(): Promise<unknown>;
  trigger(eventName: string): unknown;
  remote_merge_plan?: unknown;
  [key: string]: unknown;
}

interface FormTarget {
  frm: PresenceFrm;
  form: HTMLFormElement;
}

function currentFormTarget(): FormTarget | null {
  const namespace = window.cfFrappe as { form?: { current?: () => unknown } } | undefined;
  const current = namespace?.form?.current;
  if (typeof current !== "function") {
    return null;
  }
  const frm = current();
  if (!frm || typeof frm !== "object") {
    return null;
  }
  const form = document.querySelector<HTMLFormElement>("form.form");
  if (!form) {
    return null;
  }
  return { frm: frm as PresenceFrm, form };
}

function matchingFormTarget(doctype: string, documentName: string): FormTarget | null {
  const target = currentFormTarget();
  if (!target || target.frm.doctype !== doctype || target.frm.docname !== documentName) {
    return null;
  }
  return target;
}

/* ------------------------------ panel state -------------------------------- */

interface PresenceFieldEdit {
  actor: unknown;
  connectionId: unknown;
  field: unknown;
}

interface StoredSharedDraft {
  actor: string;
  payload: {
    baseVersion: unknown;
    patch: UnknownRecord;
    unset: readonly unknown[];
  };
}

interface PresencePanelElement extends HTMLElement {
  __cfFrappePresenceSubscription?: RealtimeSubscription | undefined;
  __cfFrappeMergeSaveAttached?: boolean;
  __cfFrappeSharedDraftApplyAttached?: boolean;
  __cfFrappeSharedDraft?: StoredSharedDraft;
  __cfFrappeFieldEdits?: Record<string, PresenceFieldEdit>;
}

interface PresenceActionButton extends HTMLElement {
  disabled?: boolean;
}

/* --------------------------- doc value helpers ----------------------------- */
/* Duplicated verbatim from the legacy client string; shared constants keep the
   child-table path/internal-field semantics in lockstep with the form module. */

interface ChildFieldPath {
  field: string;
  index: number;
  table: string;
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

function cloneMergeValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(cloneMergeValue);
  }
  const clone: UnknownRecord = {};
  Object.keys(value as UnknownRecord).forEach((key) => {
    clone[key] = cloneMergeValue((value as UnknownRecord)[key]);
  });
  return clone;
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
  const row = (doc[child.table] as readonly unknown[])[child.index] as UnknownRecord | undefined;
  return row && row[child.field];
}

function unsetDocValue(doc: UnknownRecord, fieldname: string): void {
  const child = childFieldPath(fieldname);
  if (child) {
    const rows: unknown[] = Array.isArray(doc[child.table]) ? (doc[child.table] as unknown[]) : [];
    const row = rows[child.index] as UnknownRecord | undefined;
    if (row) {
      delete row[child.field];
    }
    doc[child.table] = rows;
    return;
  }
  delete doc[fieldname];
}

/* --------------------------- form control helpers -------------------------- */

interface FormFieldElement extends HTMLElement {
  name: string;
  value: string;
  type?: string;
  checked?: boolean;
  required?: boolean;
}

function formFields(form: HTMLFormElement): readonly FormFieldElement[] {
  return Array.prototype.slice.call(form.querySelectorAll("[name]")) as FormFieldElement[];
}

function fieldValue(field: FormFieldElement): unknown {
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

function setControlValue(field: FormFieldElement, value: unknown): void {
  if (field.type === "checkbox") {
    field.checked = Boolean(value);
  } else if (field.dataset && field.dataset.cfFrappeFieldType === "json" && value !== null && typeof value === "object") {
    field.value = JSON.stringify(value);
  } else {
    field.value = value == null ? "" : String(value);
  }
}

function fieldInteractionLocked(field: FormFieldElement): boolean {
  const expando = field as unknown as Record<string, unknown>;
  return Boolean(expando[READ_ONLY_PROPERTY] || expando[SOFT_DISABLED_PROPERTY]);
}

function rememberLockedFieldValue(field: FormFieldElement): void {
  if (fieldInteractionLocked(field)) {
    (field as unknown as Record<string, unknown>)[LOCKED_VALUE_PROPERTY] = fieldValue(field);
  }
}

function readFormData(form: HTMLFormElement): UnknownRecord {
  const doc: UnknownRecord = {};
  formFields(form).forEach((field) => {
    if (!isInternalFormField(field.name)) {
      setDocValue(doc, field.name, fieldValue(field));
    }
  });
  return doc;
}

function formExpectedVersion(form: HTMLFormElement): number {
  const fields = formFields(form).filter((field) => field.name === "expectedVersion");
  const first = fields[0];
  if (!first) {
    return 0;
  }
  const value = Number(first.value);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

/**
 * Resolves the form binding's base version across the module seam: the form module
 * stamps `data-document-version` on the form after a merge-save applies a snapshot;
 * before that the page context / rendered `expectedVersion` control carry it
 * (mirrors `createFormBinding`'s `baseVersion` resolution).
 */
function formBaseVersion(form: HTMLFormElement): number | undefined {
  const stamped = form.dataset.documentVersion;
  if (stamped !== undefined) {
    const stampedVersion = Number(stamped);
    if (Number.isInteger(stampedVersion) && stampedVersion >= 0) {
      return stampedVersion;
    }
  }
  const contextVersion = pageContext().documentVersion;
  return contextVersion === undefined ? formExpectedVersion(form) : contextVersion;
}

function writeDocumentToForm(form: HTMLFormElement, data: UnknownRecord): void {
  const baseVersion = formBaseVersion(form);
  formFields(form).forEach((field) => {
    if (field.name === "expectedVersion") {
      setControlValue(field, baseVersion);
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

/* ------------------------------- hydration --------------------------------- */

export function hydratePresencePanels(): void {
  const panels = document.querySelectorAll('[data-cf-frappe-presence="document"]');
  if (!panels || panels.length === 0) {
    return;
  }
  Array.prototype.forEach.call(panels, (panel: PresencePanelElement) => {
    hydratePresencePanel(panel);
  });
}

function hydratePresencePanel(panel: PresencePanelElement): void {
  const context = pageContext();
  const dataset = panel.dataset || {};
  const doctype = dataset.doctype || context.doctype;
  const documentName = dataset.documentName || context.documentName;
  const realtimeRoute = dataset.realtimeRoute || context.realtimeRoute;
  const tenantId = dataset.tenantId || context.tenantId;
  if (!doctype || !documentName || !tenantId) {
    return;
  }
  const realtimeOptions: RealtimeConnectOptions = Object.assign(
    { tenantId },
    realtimeRoute ? { realtimeRoute } : {}
  );
  setPresencePanelState(panel, "loading", "Checking active collaborators.", "Checking active collaborators.");
  setPanelText(panel, "[data-cf-frappe-document-update]", "Viewing latest saved version.");
  setPanelText(panel, "[data-cf-frappe-shared-draft]", "No shared draft proposals.");
  attachPresencePanelMergeSave(panel, doctype, documentName);
  attachPresencePanelSharedDraftApply(panel, doctype, documentName);
  setPresencePanelMergeAction(panel, false, false);
  setPresencePanelSharedDraftAction(panel, false, false);
  realtimePresenceDocument(doctype, documentName, realtimeOptions)
    .then((snapshot) => {
      setPresencePanelConnections(panel, "ready", (snapshot as UnknownRecord | null | undefined)?.connections);
      subscribePresencePanel(panel, doctype, documentName, realtimeOptions);
    })
    .catch((error: unknown) => {
      const message = (error as { message?: unknown } | null | undefined)?.message;
      setPresencePanelState(
        panel,
        "error",
        "Presence unavailable",
        message ? String(message) : "Unable to load document presence."
      );
    });
}

function subscribePresencePanel(
  panel: PresencePanelElement,
  doctype: string,
  documentName: string,
  options: RealtimeConnectOptions
): void {
  if (panel.__cfFrappePresenceSubscription) {
    return;
  }
  try {
    panel.__cfFrappePresenceSubscription = realtimeSubscribe(
      documentTopicFromOptions(doctype, documentName, options),
      {
        event: (event: unknown) => {
          markPresencePanelDocumentEvent(panel, event, doctype, documentName);
        },
        presence: (presence: unknown) => {
          setPresencePanelConnections(panel, "live", (presence as UnknownRecord | null | undefined)?.connections);
        },
        fieldEdit: (payload: unknown) => {
          setPresencePanelFieldEdit(panel, payload);
        },
        sharedDraft: (payload: unknown) => {
          setPresencePanelSharedDraft(panel, payload, doctype, documentName);
        }
      },
      options
    );
  } catch (_error) {
    panel.__cfFrappePresenceSubscription = undefined;
  }
}

/* ---------------------------- remote document ------------------------------- */

function markPresencePanelDocumentEvent(
  panel: PresencePanelElement,
  event: unknown,
  doctype: string,
  documentName: string
): void {
  const payload = (event as UnknownRecord | null | undefined)?.payload as UnknownRecord | undefined;
  const snapshot = payload?.snapshot as UnknownRecord | undefined;
  const remoteVersion = snapshot?.version;
  const localVersion = panel.dataset && panel.dataset.documentVersion ? Number(panel.dataset.documentVersion) : NaN;
  if (typeof remoteVersion !== "number" || Number.isNaN(localVersion) || remoteVersion <= localVersion) {
    return;
  }
  if (panel.dataset) {
    panel.dataset.documentState = "stale";
    panel.dataset.remoteVersion = String(remoteVersion);
  }
  setPanelText(
    panel,
    "[data-cf-frappe-document-update]",
    `Document updated to v${String(remoteVersion)}. Refresh to review latest changes.`
  );
  const target = markCurrentFormRemoteUpdate(doctype, documentName, snapshot);
  setPresencePanelMergeAction(panel, Boolean(target), false, "Merge saved changes");
}

function markCurrentFormRemoteUpdate(
  doctype: string,
  documentName: string,
  snapshot: UnknownRecord | undefined
): FormTarget | null {
  const target = matchingFormTarget(doctype, documentName);
  if (!target) {
    return null;
  }
  target.form.dataset.remoteUpdate = "1";
  if (snapshot && isPlainObject(snapshot.data) && typeof target.frm.mergePlan === "function") {
    const plan = target.frm.mergePlan(snapshot) as UnknownRecord | null | undefined;
    target.frm.remote_merge_plan = plan;
    if (plan && plan.status !== undefined) {
      target.form.dataset.remoteMergeState = String(plan.status);
    }
  }
  return target;
}

/* ------------------------------- merge save -------------------------------- */

function attachPresencePanelMergeSave(panel: PresencePanelElement, doctype: string, documentName: string): void {
  if (panel.__cfFrappeMergeSaveAttached) {
    return;
  }
  const button = panel.querySelector("[data-cf-frappe-merge-save]");
  if (!button || typeof button.addEventListener !== "function") {
    return;
  }
  panel.__cfFrappeMergeSaveAttached = true;
  button.addEventListener("click", () => {
    const target = matchingFormTarget(doctype, documentName);
    if (!target) {
      return;
    }
    setPresencePanelMergeAction(panel, true, true, "Merging...");
    setPanelText(panel, "[data-cf-frappe-document-update]", "Merging saved changes.");
    target.frm
      .merge_save()
      .then((result: unknown) => {
        if (result === false) {
          if (panel.dataset) {
            panel.dataset.documentState = "validation-blocked";
          }
          setPanelText(panel, "[data-cf-frappe-document-update]", "Fix validation errors before merging saved changes.");
          setPresencePanelMergeAction(panel, true, false, "Try merge again");
          return;
        }
        updatePresencePanelMergeResult(panel, result);
      })
      .catch((error: unknown) => {
        if (panel.dataset) {
          panel.dataset.documentState = "merge-error";
        }
        const message = (error as { message?: unknown } | null | undefined)?.message;
        setPanelText(
          panel,
          "[data-cf-frappe-document-update]",
          message ? String(message) : "Unable to merge saved changes."
        );
        setPresencePanelMergeAction(panel, true, false, "Try merge again");
      });
  });
}

function updatePresencePanelMergeResult(panel: PresencePanelElement, result: unknown): void {
  const mergeResult = result as UnknownRecord | null | undefined;
  const mergedDocument = mergeResult?.document as UnknownRecord | undefined;
  const version = mergedDocument?.version;
  if (mergeResult && (mergeResult.status === "applied" || mergeResult.status === "noop")) {
    if (panel.dataset) {
      panel.dataset.documentState = "merged";
      if (typeof version === "number") {
        panel.dataset.documentVersion = String(version);
        panel.dataset.remoteVersion = String(version);
      }
    }
    setPanelText(
      panel,
      "[data-cf-frappe-document-update]",
      mergeResult.status === "applied"
        ? `Merged saved changes${typeof version === "number" ? ` at v${String(version)}` : ""}.`
        : `Already up to date${typeof version === "number" ? ` at v${String(version)}` : ""}.`
    );
    setPresencePanelMergeAction(panel, false, false);
    return;
  }
  if (panel.dataset) {
    panel.dataset.documentState = "conflict";
  }
  setPanelText(panel, "[data-cf-frappe-document-update]", "Merge conflict. Review local changes before saving.");
  setPresencePanelMergeAction(panel, true, false, "Try merge again");
}

function setPresencePanelMergeAction(
  panel: PresencePanelElement,
  visible: boolean,
  disabled: boolean,
  label?: string
): void {
  const button = panel.querySelector<HTMLElement>("[data-cf-frappe-merge-save]") as PresenceActionButton | null;
  if (!button) {
    return;
  }
  button.hidden = !visible;
  button.disabled = Boolean(disabled);
  if (label !== undefined) {
    button.textContent = label;
  }
}

/* ------------------------------ shared drafts ------------------------------- */

function attachPresencePanelSharedDraftApply(
  panel: PresencePanelElement,
  doctype: string,
  documentName: string
): void {
  if (panel.__cfFrappeSharedDraftApplyAttached) {
    return;
  }
  const button = panel.querySelector("[data-cf-frappe-apply-shared-draft]");
  if (!button || typeof button.addEventListener !== "function") {
    return;
  }
  panel.__cfFrappeSharedDraftApplyAttached = true;
  button.addEventListener("click", () => {
    const target = matchingFormTarget(doctype, documentName);
    const draft = panel.__cfFrappeSharedDraft;
    if (!target || !draft) {
      return;
    }
    if (typeof draft.payload.baseVersion === "number" && formBaseVersion(target.form) !== draft.payload.baseVersion) {
      if (panel.dataset) {
        panel.dataset.sharedDraftState = "stale";
      }
      setPresencePanelSharedDraftAction(panel, false, false);
      return;
    }
    setPresencePanelSharedDraftAction(panel, true, true, "Applying...");
    const fields = applySharedDraftToForm(target, draft.payload);
    if (fields.length === 0) {
      if (panel.dataset) {
        panel.dataset.sharedDraftState = "noop";
      }
      setPanelText(panel, "[data-cf-frappe-shared-draft]", "No applicable shared draft changes.");
      setPresencePanelSharedDraftAction(panel, false, false);
      return;
    }
    if (panel.dataset) {
      panel.dataset.sharedDraftState = "applied";
    }
    setPanelText(
      panel,
      "[data-cf-frappe-shared-draft]",
      `Applied shared draft from ${draft.actor}: ${presencePanelFieldSummary(fields)}.`
    );
    setPresencePanelSharedDraftAction(panel, false, false);
  });
}

function setPresencePanelSharedDraft(
  panel: PresencePanelElement,
  payload: unknown,
  doctype: string,
  documentName: string
): void {
  const draftPayload = payload as UnknownRecord | null | undefined;
  if (!draftPayload || draftPayload.doctype !== doctype || draftPayload.name !== documentName) {
    return;
  }
  const fields = sharedDraftFields(draftPayload);
  if (fields.length === 0) {
    return;
  }
  const actor = String(draftPayload.actorId || draftPayload.connectionId || "A collaborator");
  panel.__cfFrappeSharedDraft = {
    actor,
    payload: {
      baseVersion: draftPayload.baseVersion,
      patch: isPlainObject(draftPayload.patch) ? (cloneMergeValue(draftPayload.patch) as UnknownRecord) : {},
      unset: Array.isArray(draftPayload.unset) ? (draftPayload.unset as readonly unknown[]).slice() : []
    }
  };
  if (panel.dataset) {
    panel.dataset.sharedDraftState = "available";
    if (typeof draftPayload.baseVersion === "number") {
      panel.dataset.sharedDraftBaseVersion = String(draftPayload.baseVersion);
    }
  }
  setPanelText(
    panel,
    "[data-cf-frappe-shared-draft]",
    `${actor} shared draft changes: ${presencePanelFieldSummary(fields)}.`
  );
  const target = matchingFormTarget(doctype, documentName);
  if (target && typeof draftPayload.baseVersion === "number" && formBaseVersion(target.form) !== draftPayload.baseVersion) {
    if (panel.dataset) {
      panel.dataset.sharedDraftState = "stale";
    }
    setPanelText(
      panel,
      "[data-cf-frappe-shared-draft]",
      `${actor} shared draft changes for v${String(draftPayload.baseVersion)}` +
        `; current form is v${String(formBaseVersion(target.form))}.`
    );
    setPresencePanelSharedDraftAction(panel, false, false);
    return;
  }
  setPresencePanelSharedDraftAction(panel, Boolean(target), false, "Apply shared draft");
}

function applySharedDraftToForm(target: FormTarget, payload: StoredSharedDraft["payload"]): readonly string[] {
  const draft = cloneMergeValue(readFormData(target.form)) as UnknownRecord;
  const changed: string[] = [];
  const patch = isPlainObject(payload.patch) ? payload.patch : {};
  Object.keys(patch).forEach((field) => {
    const fieldname = String(field || "").trim();
    if (!fieldname || isInternalFormField(fieldname)) {
      return;
    }
    setDocValue(draft, fieldname, cloneMergeValue(patch[field]));
    changed.push(fieldname);
  });
  (Array.isArray(payload.unset) ? payload.unset : []).forEach((field) => {
    const fieldname = String(field || "").trim();
    if (!fieldname || isInternalFormField(fieldname) || changed.indexOf(fieldname) >= 0) {
      return;
    }
    unsetDocValue(draft, fieldname);
    changed.push(fieldname);
  });
  if (changed.length === 0) {
    return changed;
  }
  target.frm.doc = draft;
  writeDocumentToForm(target.form, draft);
  target.frm.dirty();
  changed.forEach((field) => {
    target.frm.trigger(field);
  });
  return changed;
}

function sharedDraftFields(payload: UnknownRecord): readonly string[] {
  const seen: Record<string, boolean> = {};
  const fields: string[] = [];
  const patch = isPlainObject(payload.patch) ? payload.patch : {};
  Object.keys(patch).forEach((field) => {
    addSharedDraftField(fields, seen, field);
  });
  (Array.isArray(payload.unset) ? (payload.unset as readonly unknown[]) : []).forEach((field) => {
    addSharedDraftField(fields, seen, field);
  });
  return fields;
}

function addSharedDraftField(fields: string[], seen: Record<string, boolean>, field: unknown): void {
  const fieldname = String(field || "").trim();
  if (!fieldname || seen[fieldname]) {
    return;
  }
  seen[fieldname] = true;
  fields.push(fieldname);
}

function presencePanelFieldSummary(fields: readonly string[]): string {
  const visible = fields.slice(0, 5);
  const suffix = fields.length > visible.length ? ` +${String(fields.length - visible.length)} more` : "";
  return visible.join(", ") + suffix;
}

function setPresencePanelSharedDraftAction(
  panel: PresencePanelElement,
  visible: boolean,
  disabled: boolean,
  label?: string
): void {
  const button = panel.querySelector<HTMLElement>("[data-cf-frappe-apply-shared-draft]") as PresenceActionButton | null;
  if (!button) {
    return;
  }
  button.hidden = !visible;
  button.disabled = Boolean(disabled);
  if (label !== undefined) {
    button.textContent = label;
  }
}

/* ---------------------------- presence rendering ---------------------------- */

function setPresencePanelConnections(panel: PresencePanelElement, state: string, connections: unknown): void {
  prunePresencePanelFieldEdits(panel, connections);
  const labels = presenceConnectionLabels(connections);
  const count = labels.length;
  setPresencePanelState(
    panel,
    state,
    count === 1 ? "1 active collaborator" : `${String(count)} active collaborators`,
    count === 0 ? "No active collaborators are viewing this document." : labels.join(", ")
  );
}

function presenceConnectionLabels(connections: unknown): readonly string[] {
  const seen: Record<string, boolean> = {};
  const labels: string[] = [];
  (Array.isArray(connections) ? (connections as readonly unknown[]) : []).forEach((connection) => {
    const record = connection as UnknownRecord | null | undefined;
    const label = record && (record.userId || record.connectionId);
    if (!label || seen[String(label)]) {
      return;
    }
    seen[String(label)] = true;
    labels.push(String(label));
  });
  return labels;
}

function setPresencePanelFieldEdit(panel: PresencePanelElement, payload: unknown): void {
  const editPayload = payload as UnknownRecord | null | undefined;
  if (!editPayload || !editPayload.field) {
    return;
  }
  const edits = panel.__cfFrappeFieldEdits || {};
  const key = `${String(editPayload.connectionId || "")}:${String(editPayload.field)}`;
  if (editPayload.editing === false) {
    delete edits[key];
  } else {
    edits[key] = {
      actor: editPayload.actorId || editPayload.connectionId || "A collaborator",
      connectionId: editPayload.connectionId,
      field: editPayload.field
    };
  }
  panel.__cfFrappeFieldEdits = edits;
  renderPresencePanelFieldEdits(panel);
}

function prunePresencePanelFieldEdits(panel: PresencePanelElement, connections: unknown): void {
  const edits = panel.__cfFrappeFieldEdits;
  if (!edits || !Array.isArray(connections)) {
    return;
  }
  const active: Record<string, boolean> = {};
  (connections as readonly unknown[]).forEach((connection) => {
    const record = connection as UnknownRecord | null | undefined;
    if (record && record.connectionId) {
      active[String(record.connectionId)] = true;
    }
  });
  let changed = false;
  Object.keys(edits).forEach((editKey) => {
    const edit = edits[editKey];
    const connectionId = edit && edit.connectionId;
    if (!connectionId || !active[String(connectionId)]) {
      delete edits[editKey];
      changed = true;
    }
  });
  if (changed) {
    renderPresencePanelFieldEdits(panel);
  }
}

function renderPresencePanelFieldEdits(panel: PresencePanelElement): void {
  const edits = panel.__cfFrappeFieldEdits || {};
  const labels = Object.keys(edits)
    .sort()
    .map((editKey) => {
      const edit = edits[editKey] as PresenceFieldEdit;
      return `${String(edit.actor)} editing ${String(edit.field)}`;
    });
  setPanelText(panel, "[data-cf-frappe-field-edits]", labels.length === 0 ? "No live field edits." : labels.join(", "));
}

function setPresencePanelState(panel: PresencePanelElement, state: string, countText: string, listText: string): void {
  if (panel.dataset) {
    panel.dataset.presenceState = state;
  }
  setPanelText(panel, "[data-cf-frappe-presence-count]", countText);
  setPanelText(panel, "[data-cf-frappe-presence-list]", listText);
}

function setPanelText(panel: PresencePanelElement, selector: string, value: string): void {
  const panelTarget = typeof panel.querySelector === "function" ? panel.querySelector(selector) : null;
  if (panelTarget) {
    panelTarget.textContent = value;
  }
}

/** Registers the presence-panel hydrator (idempotent to re-run after resetRegistries). */
export function registerPresencePanels(): void {
  registerHydrator({ name: "presence-panels", hydrate: hydratePresencePanels });
}

registerPresencePanels();
