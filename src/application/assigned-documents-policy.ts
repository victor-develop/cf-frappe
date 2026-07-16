import { badRequest, notFound } from "../core/errors.js";
import type {
  DocStatus,
  DocTypeName,
  DocumentName,
  TenantId
} from "../core/types.js";

export const DEFAULT_ASSIGNED_DOCUMENTS_LIMIT = 50;
export const MAX_ASSIGNED_DOCUMENTS_LIMIT = 200;

export interface AssignedDocumentSummary {
  readonly tenantId: TenantId;
  readonly doctype: DocTypeName;
  readonly name: DocumentName;
  readonly label: string;
  readonly route: string;
  readonly version: number;
  readonly docstatus: DocStatus;
  readonly updatedAt: string;
  readonly assignees: readonly string[];
}

export interface AssignedDocumentsResult {
  readonly tenantId: TenantId;
  readonly assignee: string;
  readonly limit: number;
  readonly total: number;
  readonly data: readonly AssignedDocumentSummary[];
  readonly filters: {
    readonly doctype?: string;
  };
}

export function ensureDocumentHistoryServiceAvailable<T>(history: T | undefined): asserts history is T {
  if (history === undefined) {
    throw notFound("Assignments are not enabled");
  }
}

export function normalizeAssignedDocumentsLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_ASSIGNED_DOCUMENTS_LIMIT;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw badRequest("Assigned documents limit must be a positive integer");
  }
  return Math.min(limit, MAX_ASSIGNED_DOCUMENTS_LIMIT);
}

export function normalizeAssignedDocumentsAssignee(assignee: string | undefined, actorId: string): string {
  const normalized = (assignee ?? actorId).trim();
  if (normalized.length === 0) {
    throw badRequest("Assigned documents assignee is required");
  }
  return normalized;
}

export function normalizeAssignedDocumentsDoctype(doctype: string | undefined): string | undefined {
  const normalized = doctype?.trim();
  return normalized === undefined || normalized === "" ? undefined : normalized;
}

export function assignedDocumentMatchesAssignee(
  assignees: readonly string[],
  assignee: string
): boolean {
  return assignees.includes(assignee);
}

export function compareAssignedDocumentSummaries(
  left: AssignedDocumentSummary,
  right: AssignedDocumentSummary
): number {
  return right.updatedAt.localeCompare(left.updatedAt) ||
    left.doctype.localeCompare(right.doctype) ||
    left.label.localeCompare(right.label) ||
    left.name.localeCompare(right.name);
}
