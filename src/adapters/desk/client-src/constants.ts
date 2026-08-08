/**
 * Browser copies of server constants injected into the legacy client string.
 *
 * These MUST stay in sync with:
 * - `src/core/types.ts` (CHILD_TABLE_ROW_INDEX_FIELD)
 * - `src/ports/file-storage.ts` (MIN_MULTIPART_FILE_PART_BYTES, MAX_MULTIPART_FILE_PARTS)
 *
 * A drift-guard unit test (`tests/desk-client-src/constants.test.ts`) asserts equality
 * against the server exports so the values cannot silently diverge.
 */

export const CHILD_TABLE_ROW_INDEX_FIELD = "__cf_frappe_row_index";

export const MIN_MULTIPART_FILE_PART_BYTES = 5 * 1024 * 1024;
export const MAX_MULTIPART_FILE_PARTS = 10_000;

export const LOCKED_VALUE_PROPERTY = "__cfFrappeLockedValue";
export const READ_ONLY_PROPERTY = "__cfFrappeReadOnly";
export const SOFT_DISABLED_PROPERTY = "__cfFrappeSoftDisabled";

export const REALTIME_COLLABORATION_MESSAGE_TYPE = "cf-frappe.realtime.collaboration";
export const FIELD_EDIT_MESSAGE_TYPE = "cf-frappe.collaboration.field_edit";
export const SHARED_DRAFT_MESSAGE_TYPE = "cf-frappe.collaboration.shared_draft";
