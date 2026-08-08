/**
 * Field-level merge planning, ported verbatim from the legacy desk client string
 * (`documentMergePlan` + conflict/snapshot helpers).
 *
 * Pure data functions — no DOM access. The form module builds merge/save plans on
 * top of these; `cfFrappe.collaboration.mergePlan` is expected to be wired to
 * {@link documentMergePlan} when the collaboration namespace is assembled.
 */

import type { UnknownRecord } from "./bodies.js";
import { isPlainObject } from "./url.js";

export type MergeConflictReason = "remote_changed" | "remote_status_changed";

export interface MergeConflict {
  field: string;
  reason: MergeConflictReason;
  basePresent: boolean;
  localPresent: boolean;
  remotePresent: boolean;
  baseValue?: unknown;
  localValue?: unknown;
  remoteValue?: unknown;
}

export interface DocumentMergePlan {
  status: "clean" | "conflict";
  baseVersion: number;
  remoteVersion: number;
  localChangedFields: string[];
  remoteChangedFields: string[];
  mergedFields: string[];
  patch: UnknownRecord;
  unset: string[];
  conflicts: MergeConflict[];
}

export interface DocumentMergePlanOptions {
  fields?: readonly unknown[];
}

interface MergeSnapshot {
  version: number;
  data: UnknownRecord;
  docstatus?: unknown;
}

interface MergeConflictValues {
  basePresent: boolean;
  localPresent: boolean;
  remotePresent: boolean;
  baseValue: unknown;
  localValue: unknown;
  remoteValue: unknown;
}

export function documentMergePlan(
  base: unknown,
  remote: unknown,
  draft: unknown,
  options?: DocumentMergePlanOptions
): DocumentMergePlan {
  const baseSnapshot = mergeSnapshot(base, 0);
  const remoteSnapshot = mergeSnapshot(remote, baseSnapshot.version);
  const draftData: UnknownRecord = isPlainObject(draft) ? draft : {};
  const fields = mergeFields(baseSnapshot.data, remoteSnapshot.data, draftData, options && options.fields);
  const localChangedFields: string[] = [];
  const remoteChangedFields: string[] = [];
  const mergedFields: string[] = [];
  const conflicts: MergeConflict[] = [];
  const patch: UnknownRecord = {};
  const unset: string[] = [];
  if (
    baseSnapshot.docstatus !== undefined &&
    remoteSnapshot.docstatus !== undefined &&
    baseSnapshot.docstatus !== remoteSnapshot.docstatus
  ) {
    conflicts.push(
      mergeConflict("docstatus", "remote_status_changed", {
        basePresent: true,
        localPresent: true,
        remotePresent: true,
        baseValue: baseSnapshot.docstatus,
        localValue: baseSnapshot.docstatus,
        remoteValue: remoteSnapshot.docstatus
      })
    );
  }
  fields.forEach((field) => {
    const basePresent = Object.prototype.hasOwnProperty.call(baseSnapshot.data, field);
    const localPresent = Object.prototype.hasOwnProperty.call(draftData, field);
    const remotePresent = Object.prototype.hasOwnProperty.call(remoteSnapshot.data, field);
    const baseValue = baseSnapshot.data[field];
    const localValue = draftData[field];
    const remoteValue = remoteSnapshot.data[field];
    const localChanged = localPresent ? !mergeJsonEqual(localValue, baseValue) : basePresent;
    const remoteChanged = !mergeJsonEqual(remoteValue, baseValue);
    if (localChanged) {
      localChangedFields.push(field);
    }
    if (remoteChanged) {
      remoteChangedFields.push(field);
    }
    if (!localChanged) {
      return;
    }
    if (remoteChanged && !mergeJsonEqual(localValue, remoteValue)) {
      conflicts.push(
        mergeConflict(field, "remote_changed", {
          basePresent,
          localPresent,
          remotePresent,
          baseValue,
          localValue,
          remoteValue
        })
      );
      return;
    }
    if (mergeJsonEqual(localValue, remoteValue)) {
      mergedFields.push(field);
      return;
    }
    mergedFields.push(field);
    if (localValue === undefined) {
      unset.push(field);
    } else {
      patch[field] = cloneMergeValue(localValue);
    }
  });
  return {
    status: conflicts.length === 0 ? "clean" : "conflict",
    baseVersion: baseSnapshot.version,
    remoteVersion: remoteSnapshot.version,
    localChangedFields,
    remoteChangedFields,
    mergedFields,
    patch,
    unset,
    conflicts
  };
}

function mergeSnapshot(value: unknown, fallbackVersion: number): MergeSnapshot {
  const source: UnknownRecord = isPlainObject(value) ? value : {};
  const hasData = isPlainObject(source.data);
  const version =
    typeof source.version === "number" && Number.isFinite(source.version) ? source.version : fallbackVersion;
  const snapshot: MergeSnapshot = {
    version,
    data: cloneMergeValue(hasData ? source.data : source) as UnknownRecord
  };
  if (source.docstatus !== undefined) {
    snapshot.docstatus = source.docstatus;
  }
  return snapshot;
}

function mergeFields(base: UnknownRecord, remote: UnknownRecord, draft: UnknownRecord, fields: unknown): string[] {
  const input: readonly unknown[] = Array.isArray(fields)
    ? fields
    : Object.keys(base).concat(Object.keys(remote), Object.keys(draft));
  const seen: Record<string, boolean> = {};
  const result: string[] = [];
  input.forEach((field) => {
    const name = String(field || "").trim();
    if (!name || seen[name]) {
      return;
    }
    seen[name] = true;
    result.push(name);
  });
  return result;
}

function mergeConflict(field: string, reason: MergeConflictReason, values: MergeConflictValues): MergeConflict {
  const conflict: MergeConflict = {
    field,
    reason,
    basePresent: values.basePresent,
    localPresent: values.localPresent,
    remotePresent: values.remotePresent
  };
  if (values.baseValue !== undefined) {
    conflict.baseValue = cloneMergeValue(values.baseValue);
  }
  if (values.localValue !== undefined) {
    conflict.localValue = cloneMergeValue(values.localValue);
  }
  if (values.remoteValue !== undefined) {
    conflict.remoteValue = cloneMergeValue(values.remoteValue);
  }
  return conflict;
}

export function mergeJsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (left === undefined || right === undefined) {
    return false;
  }
  if (left === null || right === null || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => mergeJsonEqual(item, right[index]));
  }
  const leftRecord = left as UnknownRecord;
  const rightRecord = right as UnknownRecord;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key, index) => key === rightKeys[index] && mergeJsonEqual(leftRecord[key], rightRecord[key]));
}

export function cloneMergeValue(value: unknown): unknown {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(cloneMergeValue);
  }
  const source = value as UnknownRecord;
  const clone: UnknownRecord = {};
  Object.keys(source).forEach((key) => {
    clone[key] = cloneMergeValue(source[key]);
  });
  return clone;
}
