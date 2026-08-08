import { type AssignedDocumentsResult } from "../../../application/document-history-service.js";
import { type DocTypeDefinition, type DocumentSnapshot } from "../../../core/types.js";
import { type UserNotificationInbox } from "../../../application/user-notification-service.js";
import { escapeHtml, labelFor, renderTableCell } from "./shared.js";

export function renderUserNotificationInbox(inbox: UserNotificationInbox): string {
  const rows = inbox.notifications
    .map((notification) => `<tr>
        ${renderTableCell("Status", notification.read ? "read" : "unread")}
        ${renderTableCell("Subject", escapeHtml(notification.subject))}
        ${renderTableCell("DocType", escapeHtml(notification.doctype))}
        ${renderTableCell("Name", escapeHtml(notification.documentName))}
        ${renderTableCell("Actor", escapeHtml(notification.actorId))}
        ${renderTableCell("Created", `<time datetime="${escapeHtml(notification.createdAt)}">${escapeHtml(notification.createdAt)}</time>`)}
        ${renderTableCell("Dismissed", notification.dismissed ? "yes" : "no")}
        ${renderTableCell("Action", renderNotificationActions(notification))}
      </tr>`)
    .join("");
  return `<form class="panel form list-filters" method="get" action="/desk/notifications">
    <div class="fields">
      <label class="field checkbox"><input name="unread" value="1" type="checkbox"${inbox.filters.unreadOnly ? " checked" : ""}><span>Unread</span></label>
      <label class="field checkbox"><input name="include_dismissed" value="1" type="checkbox"${inbox.filters.includeDismissed ? " checked" : ""}><span>Dismissed</span></label>
      <label class="field"><span>Limit</span><input name="limit" type="number" min="1" max="200" value="${String(inbox.limit)}"></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Filter</button></div>
  </form>
  <section class="toolbar">
    <span class="muted">${String(inbox.unreadCount)} unread</span>
  </section>
  <section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>Status</th><th>Subject</th><th>DocType</th><th>Name</th><th>Actor</th><th>Created</th><th>Dismissed</th><th>Action</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8" class="empty">No notifications.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

function renderNotificationActions(notification: UserNotificationInbox["notifications"][number]): string {
  const read = notification.read
    ? ""
    : `<button class="button" type="submit" formaction="/desk/notifications/${encodeURIComponent(notification.id)}/read">Read</button>`;
  const dismiss = notification.dismissed
    ? ""
    : `<button class="button" type="submit" formaction="/desk/notifications/${encodeURIComponent(notification.id)}/dismiss">Dismiss</button>`;
  if (!read && !dismiss) {
    return "";
  }
  return `<form class="inline-action" method="post">${read}${dismiss}</form>`;
}

export function renderAssignedToMePage(
  result: AssignedDocumentsResult,
  doctypes: readonly DocTypeDefinition[]
): string {
  const rows = result.data
    .map((item) => `<tr>
      ${renderTableCell("Document", `<a href="${escapeHtml(item.route)}">${escapeHtml(item.label)}</a>`)}
      ${renderTableCell("DocType", escapeHtml(item.doctype))}
      ${renderTableCell("Status", `<span class="status-pill">${escapeHtml(item.docstatus)}</span>`)}
      ${renderTableCell("Assignees", escapeHtml(item.assignees.join(", ")))}
      ${renderTableCell("Version", `<span class="version-pill">v${String(item.version)}</span>`)}
      ${renderTableCell("Updated", `<time datetime="${escapeHtml(item.updatedAt)}">${escapeHtml(item.updatedAt)}</time>`)}
    </tr>`)
    .join("");
  const recordCount = `${String(result.data.length)} of ${String(result.total)} assigned`;
  return `<form class="panel form list-filters" method="get" action="/desk/assigned-to-me">
    <div class="fields">
      <label class="field"><span>DocType</span><select name="doctype">${renderAssignedDoctypeOptions(doctypes, result.filters.doctype)}</select></label>
      <label class="field"><span>Limit</span><input name="limit" type="number" min="1" max="200" value="${String(result.limit)}"></label>
    </div>
    <div class="actions"><a class="button" href="/desk/assigned-to-me">Clear</a><button class="button primary" type="submit">Filter</button></div>
  </form>
  <section class="toolbar list-toolbar">
    <div class="toolbar-main"><span class="record-count">Assigned to ${escapeHtml(result.assignee)}</span></div>
    <div class="toolbar-aside"><span class="record-count">${recordCount}</span></div>
  </section>
  <section class="panel list-table-panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>Document</th><th>DocType</th><th>Status</th><th>Assignees</th><th>Version</th><th>Updated</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="empty">Nothing assigned to you.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

function renderAssignedDoctypeOptions(doctypes: readonly DocTypeDefinition[], selectedDoctype: string | undefined): string {
  return [
    `<option value=""${selectedDoctype === undefined ? " selected" : ""}>Any DocType</option>`,
    ...doctypes.map((doctype) =>
      `<option value="${escapeHtml(doctype.name)}"${doctype.name === selectedDoctype ? " selected" : ""}>${escapeHtml(labelFor(doctype))}</option>`
    )
  ].join("");
}

export function renderDocumentPresencePanel(
  document: DocumentSnapshot,
  options: { readonly realtimeRoute?: string } = {}
): string {
  const realtimeAttribute = options.realtimeRoute === undefined
    ? ""
    : ` data-realtime-route="${escapeHtml(options.realtimeRoute)}"`;
  return `<section class="panel presence" aria-labelledby="document-presence" data-cf-frappe-presence="document" data-doctype="${escapeHtml(document.doctype)}" data-document-name="${escapeHtml(document.name)}" data-document-version="${String(document.version)}" data-tenant-id="${escapeHtml(document.tenantId)}"${realtimeAttribute}>
    <div class="presence-head">
      <h2 id="document-presence">Presence</h2>
      <p data-cf-frappe-presence-count>Checking active collaborators.</p>
    </div>
    <p class="presence-list" data-cf-frappe-presence-list>Checking active collaborators.</p>
    <p class="presence-list" data-cf-frappe-field-edits>No live field edits.</p>
    <p class="presence-list" data-cf-frappe-shared-draft>No shared draft proposals.</p>
    <p class="presence-list" data-cf-frappe-document-update>Viewing latest saved version.</p>
    <button type="button" data-cf-frappe-merge-save hidden>Merge saved changes</button>
    <button type="button" data-cf-frappe-apply-shared-draft hidden>Apply shared draft</button>
  </section>`;
}
