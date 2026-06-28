import type { ValidationIssue } from "./types.js";

export type FrameworkErrorCode =
  | "APP_DEPENDENCY_CYCLE"
  | "APP_DEPENDENCY_MISSING"
  | "APP_DUPLICATE"
  | "APP_INVALID"
  | "ASSIGNMENT_RULE_INVALID"
  | "ASSIGNMENT_RULE_NOT_FOUND"
  | "CALENDAR_DUPLICATE"
  | "CALENDAR_INVALID"
  | "CALENDAR_NOT_FOUND"
  | "CLIENT_SCRIPT_DUPLICATE"
  | "CLIENT_SCRIPT_INVALID"
  | "CUSTOM_FIELD_INVALID"
  | "DATA_PATCH_CHECKSUM_MISMATCH"
  | "DATA_PATCH_APPLY_UNAVAILABLE"
  | "DATA_PATCH_DUPLICATE"
  | "DATA_PATCH_FAILED"
  | "DATA_PATCH_INVALID"
  | "DATA_PATCH_NOT_FOUND"
  | "DATA_PATCH_ORDER_VIOLATION"
  | "DATA_PATCH_PENDING"
  | "DATA_PATCH_RETRY_UNAVAILABLE"
  | "DATA_PATCH_ROLLBACK_FAILED"
  | "DATA_PATCH_ROLLBACK_PENDING"
  | "DATA_PATCH_ROLLBACK_RETRY_UNAVAILABLE"
  | "DATA_PATCH_ROLLBACK_UNAVAILABLE"
  | "DASHBOARD_DUPLICATE"
  | "DASHBOARD_INVALID"
  | "DASHBOARD_NOT_FOUND"
  | "D1_DOCUMENT_INVALID"
  | "D1_EVENT_INVALID"
  | "EVENT_INVALID"
  | "DOCTYPE_NOT_FOUND"
  | "DOCTYPE_DUPLICATE"
  | "DOCTYPE_FIELD_INVALID"
  | "DOCTYPE_LINK_INVALID"
  | "DOCTYPE_NAMING_INVALID"
  | "DOCTYPE_TABLE_INVALID"
  | "FORM_VIEW_INVALID"
  | "JOB_NOT_FOUND"
  | "JOB_DUPLICATE"
  | "JOB_EXECUTION_INVALID"
  | "JOB_EXECUTION_NOT_FOUND"
  | "JOB_POOL_DUPLICATE"
  | "JOB_POOL_INVALID"
  | "JOB_POOL_NOT_FOUND"
  | "JOB_RETRY_INVALID"
  | "JOB_RESOURCE_INVALID"
  | "JOB_SCHEDULE_NOT_FOUND"
  | "KANBAN_DUPLICATE"
  | "KANBAN_INVALID"
  | "KANBAN_NOT_FOUND"
  | "LIST_VIEW_INVALID"
  | "MIGRATION_CHECKSUM_MISMATCH"
  | "MIGRATION_DUPLICATE"
  | "MIGRATION_EMPTY"
  | "MIGRATION_ID_INVALID"
  | "MIGRATION_INDEX_CONFLICT"
  | "MIGRATION_INDEX_DUPLICATE"
  | "MIGRATION_INDEX_INVALID"
  | "NOTIFICATION_RULE_INVALID"
  | "NOTIFICATION_RULE_NOT_FOUND"
  | "DOCUMENT_NOT_FOUND"
  | "DOCUMENT_CONFLICT"
  | "DOCUMENT_DELETED"
  | "DOCUMENT_STATUS_CONFLICT"
  | "FILE_SCAN_FAILED"
  | "FILE_STORAGE_ERROR"
  | "FILE_UPLOAD_PENDING"
  | "FIELD_PROPERTY_INVALID"
  | "PERMISSION_DENIED"
  | "PRINT_FORMAT_DUPLICATE"
  | "PRINT_FORMAT_INVALID"
  | "PRINT_FORMAT_NOT_FOUND"
  | "PRINT_PDF_RENDER_FAILED"
  | "REPORT_DUPLICATE"
  | "REPORT_INVALID"
  | "REPORT_NOT_FOUND"
  | "VALIDATION_FAILED"
  | "WEB_FORM_DUPLICATE"
  | "WEB_FORM_INVALID"
  | "WEB_FORM_NOT_FOUND"
  | "WEB_PAGE_DUPLICATE"
  | "WEB_PAGE_INVALID"
  | "WEB_PAGE_NOT_FOUND"
  | "WEBSITE_SETTINGS_DUPLICATE"
  | "WEBSITE_SETTINGS_INVALID"
  | "WEBSITE_SETTINGS_NOT_FOUND"
  | "WEBSITE_THEME_DUPLICATE"
  | "WEBSITE_THEME_INVALID"
  | "WEBSITE_THEME_NOT_FOUND"
  | "WEB_VIEW_DUPLICATE"
  | "WEB_VIEW_INVALID"
  | "WEB_VIEW_NOT_FOUND"
  | "WORKSPACE_DUPLICATE"
  | "WORKSPACE_INVALID"
  | "WORKSPACE_NOT_FOUND"
  | "WORKFLOW_INVALID"
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
