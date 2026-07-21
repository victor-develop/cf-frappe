# Meta-Driven Desk Selector Acceptance Criteria

## Goal

Desk configuration screens should not require administrators to memorize internal DocType names, field names, user ids, role names, document names, or small metadata path fragments when cf-frappe already has enough metadata to offer a selector or autocomplete.

This change is accepted when the first production slice proves reusable, server-rendered selector primitives across rule configuration, permission configuration, user/role administration, and file/document references while keeping server-side validation authoritative.

## Scope

The current slice covers these shared primitives and surfaces:

- Shared Desk selector primitives for DocTypes, fields, users, roles, document references, and `fetchFrom` paths.
- Workflow definitions at `/desk/admin/workflows`.
- Notification rules at `/desk/admin/notification-rules`.
- Assignment rules at `/desk/admin/assignment-rules`.
- Custom fields at `/desk/admin/custom-fields`.
- Field property overrides at `/desk/admin/field-properties`.
- User permissions at `/desk/admin/user-permissions`.
- User account role forms at `/desk/admin/users`.
- File manager attachment references at `/desk/files`.

The current slice does not need to complete these richer builders:

- Visual condition builders for notification/assignment rule conditions and field `dependsOn` expressions.
- Workflow state token editors, workflow action autocomplete, and event-type autocomplete.
- Timeline share/assign user selectors on document forms.
- Kanban, calendar, dashboard, web-form, and workspace definition builders.
- Select option list editors.

## Shared Primitive Criteria

1. DocType selector:
   - Renders options from the actor-visible effective DocType registry.
   - Displays readable labels while submitting stable DocType names.
   - Preserves a selected stale value when it is no longer present in the current option list.

2. Field selector:
   - Renders options from a selected effective DocType's fields.
   - Supports predicate filtering for workflow-state fields, notification-recipient fields, assignment-assignee fields, and general editable/reference fields.
   - Preserves a selected stale value when server-side validation returns a stale or invalid draft.

3. User selector:
   - Uses `UserAccountService.list()` when available.
   - Suggests enabled users only.
   - Falls back gracefully to the actor id and saved stale users when the user catalog is unavailable or not authorized.

4. Role selector:
   - Uses the role catalog when available.
   - Suggests enabled roles plus the actor's current roles and saved stale roles.
   - Preserves the existing comma-separated form field contract for current POST handlers.

5. Document reference picker:
   - Uses a DocType selector for document reference DocTypes.
   - Offers document-name suggestions when a concrete target DocType can be resolved.
   - Keeps document-name text entry as a progressive fallback.

6. FetchFrom path selector:
   - Builds suggestions from the selected DocType's link fields and each link target's visible non-table fields.
   - Submits the existing `linkField.sourceField` value.

## Surface Criteria

1. Workflow admin:
   - `State Field` uses the shared field selector, limited to workflow-compatible field types.
   - `Initial State`, transition `from`, and transition `to` are selectable from workflow states when states exist.
   - Transition roles use the shared role selector.
   - Existing newline/pipe transition payload parsing remains compatible.

2. Notification rule admin:
   - Event kinds are rendered as metadata-driven choices.
   - Recipient field choices use the shared field selector and notification-rule field predicate.
   - Recipient user entries use the shared user selector.
   - Channels are rendered as explicit `inbox` and `email` choices.
   - Existing submitted form names remain compatible with `parseDeskNotificationRule`.

3. Assignment rule admin:
   - Event kinds are rendered as metadata-driven choices.
   - Assignee field choices use the shared field selector and assignment-rule field predicate.
   - Assignee user entries use the shared user selector.
   - Existing submitted form names remain compatible with `parseDeskAssignmentRule`.

4. Custom field admin:
   - `DocType`, `Link To`, and `Table Of` use shared DocType selector/autocomplete primitives.
   - `Fetch From` uses the shared fetchFrom path selector.
   - Existing submitted form names remain compatible with `parseDeskCustomField`.

5. Field property admin:
   - `DocType` and `Field` use shared DocType/field selectors.
   - `Fetch From` uses the shared fetchFrom path selector.
   - Existing submitted form names remain compatible with `parseDeskFieldPropertyOverride`.

6. User permissions:
   - User uses the shared user selector.
   - Target DocType and Applicable DocTypes use shared DocType selector/autocomplete primitives.
   - Target Name uses the shared document reference picker when a target DocType is available, with text fallback.
   - Existing submitted form names remain compatible with `parseDeskUserPermission`.

7. User account roles:
   - Create/change/provider-sync role fields use the shared role selector.
   - Existing comma-separated `roles` form values remain compatible with current parsers.

8. File attachment references:
   - File upload, metadata edit, filter, and bulk metadata controls use shared DocType selector/autocomplete primitives for attachment DocTypes.
   - Attachment names use document-name suggestions when available and keep text fallback.
   - Existing `attached_to_doctype`, `attached_to_name`, `bulk_attached_to_doctype`, and `bulk_attached_to_name` form/query names remain compatible.

## UI/UX Criteria

- Controls keep visible labels and do not rely on placeholder-only instructions.
- Native HTML controls are acceptable for this slice: `select`, checkbox groups, `input list`, and `datalist`.
- The UI remains server-rendered and progressive-enhancement friendly; JavaScript must not be required to submit a valid form.
- Invalid or stale values remain visible after validation failures so administrators can recover.

## Architecture Criteria

- Option shaping lives in pure Desk metadata helpers.
- HTML rendering lives in shared Desk control helpers.
- Page render functions should compose shared helpers instead of duplicating option filtering and datalist construction inline.
- Server-side validation remains authoritative. Selectors reduce mistakes but do not replace domain validation.
- Existing public route paths, command payload field names, and service APIs remain backward compatible.
- The implementation must not introduce a new frontend framework or client-side build step.

## Test Criteria

- Desk tests cover each shared primitive through at least one production surface.
- Desk tests assert that notification and assignment user suggestions come from enabled user accounts, exclude disabled accounts, and preserve saved stale users.
- Desk tests assert that user permissions render user, DocType, and document-reference selector controls while still accepting existing form names.
- Desk tests assert that user account role forms render role suggestions while still accepting comma-separated `roles`.
- Desk tests assert that file attachment reference controls render DocType and document-name suggestions while preserving existing file POST/query names.
- Existing malformed-input tests continue to prove server-side validation is authoritative.
- `npm run typecheck` and relevant Desk/application tests pass before software-architect review.

## Review Gate

The implementation is complete only after an independent software-architect sub-agent reviews the final code and returns PASS against this acceptance document.
