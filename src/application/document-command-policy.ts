import type { DocumentMergeSnapshot } from "../core/document-merge.js";
import { badRequest, conflict, FrameworkError } from "../core/errors.js";
import type {
  DocStatus,
  DocumentData,
  DocumentSnapshot
} from "../core/types.js";

export function ensureExpectedVersion(existing: DocumentSnapshot, expectedVersion?: number): void {
  if (expectedVersion !== undefined && existing.version !== expectedVersion) {
    throw conflict(`Expected version ${expectedVersion}, found ${existing.version}`);
  }
}

export function ensureMergeBaseVersion(baseVersion: number): void {
  if (!Number.isSafeInteger(baseVersion) || baseVersion < 0) {
    throw badRequest("baseVersion must be a non-negative integer");
  }
}

export function mergeSnapshotFromDocument(document: DocumentSnapshot): DocumentMergeSnapshot {
  return {
    version: document.version,
    docstatus: document.docstatus,
    data: document.data
  };
}

export function ensureDocumentStatus(
  document: DocumentSnapshot,
  allowed: readonly DocStatus[],
  action: string
): void {
  if (!allowed.includes(document.docstatus)) {
    throw new FrameworkError(
      "DOCUMENT_STATUS_CONFLICT",
      `Cannot ${action} ${document.doctype}/${document.name} while it is ${document.docstatus}`,
      { status: 409 }
    );
  }
}

export function normalizeUnsetFields(fields: readonly string[] | undefined): readonly string[] {
  if (fields === undefined) {
    return [];
  }
  const normalized = fields.map((field) => field.trim()).filter((field) => field.length > 0);
  return [...new Set(normalized)];
}

export function pickCommandFields(fields: readonly string[] | undefined, input: DocumentData): DocumentData {
  if (!fields) {
    return input;
  }
  return Object.fromEntries(fields.map((field) => [field, input[field]]).filter(([, value]) => value !== undefined)) as DocumentData;
}
