import type { DocStatus, DocumentData, JsonValue, MutableDocumentData } from "./types.js";

export interface DocumentMergeSnapshot {
  readonly version: number;
  readonly docstatus?: DocStatus;
  readonly data: DocumentData;
}

export interface PlanDocumentFieldMergeInput {
  readonly base: DocumentMergeSnapshot;
  readonly remote: DocumentMergeSnapshot;
  readonly draft: MutableDocumentData;
  readonly fields?: readonly string[];
}

export type DocumentFieldMergeStatus = "clean" | "conflict";

export type DocumentFieldMergeConflictReason = "remote_changed" | "remote_status_changed";

export interface DocumentFieldMergeConflict {
  readonly field: string;
  readonly reason: DocumentFieldMergeConflictReason;
  readonly basePresent: boolean;
  readonly localPresent: boolean;
  readonly remotePresent: boolean;
  readonly baseValue?: JsonValue;
  readonly localValue?: JsonValue;
  readonly remoteValue?: JsonValue;
}

export interface DocumentFieldMergePlan {
  readonly status: DocumentFieldMergeStatus;
  readonly baseVersion: number;
  readonly remoteVersion: number;
  readonly localChangedFields: readonly string[];
  readonly remoteChangedFields: readonly string[];
  readonly mergedFields: readonly string[];
  readonly patch: MutableDocumentData;
  readonly unset: readonly string[];
  readonly conflicts: readonly DocumentFieldMergeConflict[];
}

export function planDocumentFieldMerge(input: PlanDocumentFieldMergeInput): DocumentFieldMergePlan {
  const fields = mergeFields(input);
  const localChangedFields: string[] = [];
  const remoteChangedFields: string[] = [];
  const mergedFields: string[] = [];
  const conflicts: DocumentFieldMergeConflict[] = [];
  const patch: MutableDocumentData = {};
  const unset: string[] = [];

  if (
    input.base.docstatus !== undefined &&
    input.remote.docstatus !== undefined &&
    input.base.docstatus !== input.remote.docstatus
  ) {
    conflicts.push(conflictFor("docstatus", "remote_status_changed", {
      basePresent: true,
      localPresent: true,
      remotePresent: true,
      baseValue: input.base.docstatus,
      localValue: input.base.docstatus,
      remoteValue: input.remote.docstatus
    }));
  }

  for (const field of fields) {
    const basePresent = hasOwn(input.base.data, field);
    const localPresent = hasOwn(input.draft, field);
    const remotePresent = hasOwn(input.remote.data, field);
    const baseValue = input.base.data[field];
    const localValue = input.draft[field];
    const remoteValue = input.remote.data[field];
    const localChanged = localPresent && !jsonEqual(localValue, baseValue);
    const remoteChanged = !jsonEqual(remoteValue, baseValue);

    if (localChanged) {
      localChangedFields.push(field);
    }
    if (remoteChanged) {
      remoteChangedFields.push(field);
    }
    if (!localChanged) {
      continue;
    }
    if (remoteChanged && !jsonEqual(localValue, remoteValue)) {
      conflicts.push(conflictFor(field, "remote_changed", {
        basePresent,
        localPresent,
        remotePresent,
        baseValue,
        localValue,
        remoteValue
      }));
      continue;
    }
    if (jsonEqual(localValue, remoteValue)) {
      mergedFields.push(field);
      continue;
    }
    mergedFields.push(field);
    if (localValue === undefined) {
      unset.push(field);
    } else {
      patch[field] = cloneJsonValue(localValue);
    }
  }

  return {
    status: conflicts.length === 0 ? "clean" : "conflict",
    baseVersion: input.base.version,
    remoteVersion: input.remote.version,
    localChangedFields,
    remoteChangedFields,
    mergedFields,
    patch,
    unset,
    conflicts
  };
}

function mergeFields(input: PlanDocumentFieldMergeInput): readonly string[] {
  const fields = input.fields ?? [
    ...Object.keys(input.base.data),
    ...Object.keys(input.remote.data),
    ...Object.keys(input.draft)
  ];
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const field of fields) {
    const name = String(field).trim();
    if (!name || seen.has(name)) {
      continue;
    }
    seen.add(name);
    normalized.push(name);
  }
  return normalized;
}

function conflictFor(
  field: string,
  reason: DocumentFieldMergeConflictReason,
  values: {
    readonly basePresent: boolean;
    readonly localPresent: boolean;
    readonly remotePresent: boolean;
    readonly baseValue: JsonValue | undefined;
    readonly localValue: JsonValue | undefined;
    readonly remoteValue: JsonValue | undefined;
  }
): DocumentFieldMergeConflict {
  return {
    field,
    reason,
    basePresent: values.basePresent,
    localPresent: values.localPresent,
    remotePresent: values.remotePresent,
    ...(values.baseValue === undefined ? {} : { baseValue: cloneJsonValue(values.baseValue) }),
    ...(values.localValue === undefined ? {} : { localValue: cloneJsonValue(values.localValue) }),
    ...(values.remoteValue === undefined ? {} : { remoteValue: cloneJsonValue(values.remoteValue) })
  };
}

function jsonEqual(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
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
    return left.every((item, index) => jsonEqual(item, right[index]));
  }
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  const leftObject = left as Record<string, JsonValue>;
  const rightObject = right as Record<string, JsonValue>;
  return leftKeys.every((key, index) => key === rightKeys[index] && jsonEqual(leftObject[key], rightObject[key]));
}

function cloneJsonValue(value: JsonValue): JsonValue {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(cloneJsonValue);
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item)]));
}

function hasOwn(value: object, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, field);
}
