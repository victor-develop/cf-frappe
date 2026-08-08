import type { FC } from "hono/jsx";
import { type AssignedDocumentsResult } from "../../../application/document-history-service.js";
import { type DocTypeDefinition, type DocumentSnapshot } from "../../../core/types.js";
import { type UserNotificationInbox } from "../../../application/user-notification-service.js";
import {
  ActionBar,
  FormRow,
  Panel,
  SelectOptions,
  Toolbar,
  UnsafeRawHtml,
  renderFragment,
  type SelectOptionSpec
} from "../ui/primitives.js";
import { labelFor } from "./shared.js";

type UserNotification = UserNotificationInbox["notifications"][number];

export function renderUserNotificationInbox(inbox: UserNotificationInbox): string {
  return renderFragment(<UserNotificationInboxView inbox={inbox} />);
}

const UserNotificationInboxView: FC<{ inbox: UserNotificationInbox }> = ({ inbox }) => (
  <>
    <form class="panel form list-filters" method="get" action="/desk/notifications">
      <FormRow>
        <label class="field checkbox"><input name="unread" value="1" type="checkbox" checked={inbox.filters.unreadOnly} /><span>Unread</span></label>
        <label class="field checkbox"><input name="include_dismissed" value="1" type="checkbox" checked={inbox.filters.includeDismissed} /><span>Dismissed</span></label>
        <label class="field"><span>Limit</span><input name="limit" type="number" min="1" max="200" value={String(inbox.limit)} /></label>
      </FormRow>
      <ActionBar>
        <button class="button primary" type="submit">Filter</button>
      </ActionBar>
    </form>
    <Toolbar>
      <span class="muted">{String(inbox.unreadCount)} unread</span>
    </Toolbar>
    <Panel>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Status</th><th>Subject</th><th>DocType</th><th>Name</th><th>Actor</th><th>Created</th><th>Dismissed</th><th>Action</th></tr></thead>
          <tbody>
            {inbox.notifications.length === 0 ? (
              <tr><td colspan={8} class="empty">No notifications.</td></tr>
            ) : (
              inbox.notifications.map((notification) => (
                <tr>
                  <td data-label="Status">{notification.read ? "read" : "unread"}</td>
                  <td data-label="Subject">{notification.subject}</td>
                  <td data-label="DocType">{notification.doctype}</td>
                  <td data-label="Name">{notification.documentName}</td>
                  <td data-label="Actor">{notification.actorId}</td>
                  <td data-label="Created"><time datetime={notification.createdAt}>{notification.createdAt}</time></td>
                  <td data-label="Dismissed">{notification.dismissed ? "yes" : "no"}</td>
                  <td data-label="Action"><NotificationActions notification={notification} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  </>
);

const NotificationActions: FC<{ notification: UserNotification }> = ({ notification }) => {
  if (notification.read && notification.dismissed) {
    return null;
  }
  return (
    <form class="inline-action" method="post">
      {notification.read ? null : (
        <button class="button" type="submit" formaction={`/desk/notifications/${encodeURIComponent(notification.id)}/read`}>Read</button>
      )}
      {notification.dismissed ? null : (
        <button class="button" type="submit" formaction={`/desk/notifications/${encodeURIComponent(notification.id)}/dismiss`}>Dismiss</button>
      )}
    </form>
  );
};

export function renderAssignedToMePage(
  result: AssignedDocumentsResult,
  doctypes: readonly DocTypeDefinition[]
): string {
  return renderFragment(<AssignedToMePage result={result} doctypes={doctypes} />);
}

const AssignedToMePage: FC<{
  result: AssignedDocumentsResult;
  doctypes: readonly DocTypeDefinition[];
}> = ({ result, doctypes }) => {
  const recordCount = `${String(result.data.length)} of ${String(result.total)} assigned`;
  return (
    <>
      <form class="panel form list-filters" method="get" action="/desk/assigned-to-me">
        <FormRow>
          <label class="field"><span>DocType</span><select name="doctype"><SelectOptions options={assignedDoctypeOptions(doctypes, result.filters.doctype)} /></select></label>
          <label class="field"><span>Limit</span><input name="limit" type="number" min="1" max="200" value={String(result.limit)} /></label>
        </FormRow>
        <ActionBar>
          <a class="button" href="/desk/assigned-to-me">Clear</a>
          <button class="button primary" type="submit">Filter</button>
        </ActionBar>
      </form>
      <section class="toolbar list-toolbar">
        <div class="toolbar-main"><span class="record-count">Assigned to {result.assignee}</span></div>
        <div class="toolbar-aside"><span class="record-count">{recordCount}</span></div>
      </section>
      <Panel variant="list-table-panel">
        <div class="table-wrap">
          <table class="responsive-table">
            <thead><tr><th>Document</th><th>DocType</th><th>Status</th><th>Assignees</th><th>Version</th><th>Updated</th></tr></thead>
            <tbody>
              {result.data.length === 0 ? (
                <tr><td colspan={6} class="empty">Nothing assigned to you.</td></tr>
              ) : (
                result.data.map((item) => (
                  <tr>
                    <td data-label="Document"><a href={item.route}>{item.label}</a></td>
                    <td data-label="DocType">{item.doctype}</td>
                    <td data-label="Status"><span class="status-pill">{item.docstatus}</span></td>
                    <td data-label="Assignees">{item.assignees.join(", ")}</td>
                    <td data-label="Version"><span class="version-pill">v{String(item.version)}</span></td>
                    <td data-label="Updated"><time datetime={item.updatedAt}>{item.updatedAt}</time></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
};

function assignedDoctypeOptions(
  doctypes: readonly DocTypeDefinition[],
  selectedDoctype: string | undefined
): readonly SelectOptionSpec[] {
  return [
    { value: "", label: "Any DocType", selected: selectedDoctype === undefined },
    ...doctypes.map((doctype) => ({
      value: doctype.name,
      label: labelFor(doctype),
      selected: doctype.name === selectedDoctype
    }))
  ];
}

/**
 * Static presence-panel skeleton. Injected verbatim via UnsafeRawHtml because
 * the desk client script and tests depend on bare valueless attributes
 * (`data-cf-frappe-presence-count`, `data-cf-frappe-merge-save hidden`, ...)
 * that hono/jsx cannot serialize: boolean/data props render as `="true"` or
 * `=""`, breaking byte-level assertions like 'data-cf-frappe-merge-save hidden'
 * in tests/desk/desk-app.test.ts. The markup below is a constant with no
 * interpolation, so no escaping is bypassed.
 */
const PRESENCE_PANEL_BODY = `
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
  `;

export function renderDocumentPresencePanel(
  document: DocumentSnapshot,
  options: { readonly realtimeRoute?: string } = {}
): string {
  return renderFragment(<DocumentPresencePanel document={document} realtimeRoute={options.realtimeRoute} />);
}

const DocumentPresencePanel: FC<{
  document: DocumentSnapshot;
  realtimeRoute?: string | undefined;
}> = ({ document, realtimeRoute }) => (
  <section
    class="panel presence"
    aria-labelledby="document-presence"
    data-cf-frappe-presence="document"
    data-doctype={document.doctype}
    data-document-name={document.name}
    data-document-version={String(document.version)}
    data-tenant-id={document.tenantId}
    data-realtime-route={realtimeRoute}
  >
    <UnsafeRawHtml
      reason="Constant markup with zero interpolation; preserves bare valueless data-cf-frappe-* and hidden attributes that hono/jsx boolean props cannot emit and that client.js plus desk tests assert byte-for-byte."
      html={PRESENCE_PANEL_BODY}
    />
  </section>
);
