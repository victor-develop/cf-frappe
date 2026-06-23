import type { ValidationIssue } from "./types.js";

export type FrameworkErrorCode =
  | "APP_DEPENDENCY_CYCLE"
  | "APP_DEPENDENCY_MISSING"
  | "APP_DUPLICATE"
  | "APP_INVALID"
  | "CLIENT_SCRIPT_DUPLICATE"
  | "CLIENT_SCRIPT_INVALID"
  | "DATA_PATCH_CHECKSUM_MISMATCH"
  | "DATA_PATCH_DUPLICATE"
  | "DATA_PATCH_FAILED"
  | "DATA_PATCH_INVALID"
  | "DATA_PATCH_NOT_FOUND"
  | "DATA_PATCH_ORDER_VIOLATION"
  | "DATA_PATCH_PENDING"
  | "DATA_PATCH_RETRY_UNAVAILABLE"
  | "DOCTYPE_NOT_FOUND"
  | "DOCTYPE_DUPLICATE"
  | "DOCTYPE_LINK_INVALID"
  | "DOCTYPE_NAMING_INVALID"
  | "DOCTYPE_TABLE_INVALID"
  | "FORM_VIEW_INVALID"
  | "JOB_NOT_FOUND"
  | "JOB_DUPLICATE"
  | "JOB_EXECUTION_NOT_FOUND"
  | "JOB_POOL_DUPLICATE"
  | "JOB_POOL_INVALID"
  | "JOB_POOL_NOT_FOUND"
  | "JOB_RETRY_INVALID"
  | "JOB_RESOURCE_INVALID"
  | "JOB_SCHEDULE_NOT_FOUND"
  | "LIST_VIEW_INVALID"
  | "MIGRATION_CHECKSUM_MISMATCH"
  | "MIGRATION_DUPLICATE"
  | "MIGRATION_EMPTY"
  | "MIGRATION_ID_INVALID"
  | "MIGRATION_INDEX_CONFLICT"
  | "MIGRATION_INDEX_DUPLICATE"
  | "MIGRATION_INDEX_INVALID"
  | "DOCUMENT_NOT_FOUND"
  | "DOCUMENT_CONFLICT"
  | "DOCUMENT_DELETED"
  | "DOCUMENT_STATUS_CONFLICT"
  | "FILE_SCAN_FAILED"
  | "FILE_UPLOAD_PENDING"
  | "PERMISSION_DENIED"
  | "PRINT_FORMAT_DUPLICATE"
  | "PRINT_FORMAT_INVALID"
  | "PRINT_FORMAT_NOT_FOUND"
  | "REPORT_DUPLICATE"
  | "REPORT_INVALID"
  | "REPORT_NOT_FOUND"
  | "VALIDATION_FAILED"
  | "WORKSPACE_DUPLICATE"
  | "WORKSPACE_INVALID"
  | "WORKSPACE_NOT_FOUND"
  | "WORKFLOW_TRANSITION_DENIED"
  | "BAD_REQUEST";

export class FrameworkError extends Error {
  readonly code: FrameworkErrorCode;
  readonly status: number;
  readonly issues: readonly ValidationIssue[];

  constructor(
    code: FrameworkErrorCode,
    message: string,
    options: { readonly status?: number; readonly issues?: readonly ValidationIssue[] } = {}
  ) {
    super(message);
    this.name = "FrameworkError";
    this.code = code;
    this.status = options.status ?? 500;
    this.issues = options.issues ?? [];
  }
}

export function notFound(message: string, code: FrameworkErrorCode = "DOCUMENT_NOT_FOUND"): FrameworkError {
  return new FrameworkError(code, message, { status: 404 });
}

export function badRequest(message: string): FrameworkError {
  return new FrameworkError("BAD_REQUEST", message, { status: 400 });
}

export function validationFailed(issues: readonly ValidationIssue[]): FrameworkError {
  return new FrameworkError("VALIDATION_FAILED", "Validation failed", { status: 422, issues });
}

export function permissionDenied(message = "Permission denied"): FrameworkError {
  return new FrameworkError("PERMISSION_DENIED", message, { status: 403 });
}

export function conflict(message: string): FrameworkError {
  return new FrameworkError("DOCUMENT_CONFLICT", message, { status: 409 });
}
