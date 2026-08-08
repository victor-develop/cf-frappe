import { ASSIGNMENT_RULE_EVENT_KINDS, type AssignmentRuleState, isAssignmentRuleAssigneeField } from "../../../core/assignment-rules.js";
import { type AssignmentRuleAssigneeDefinition, type AssignmentRuleDefinition, type AssignmentRuleEventKind, type DocTypeDefinition, type NotificationRuleChannel, type NotificationRuleDefinition, type NotificationRuleEventKind, type NotificationRuleRecipientDefinition, type PredicateExpression } from "../../../core/types.js";
import { NOTIFICATION_RULE_CHANNELS, NOTIFICATION_RULE_EVENT_KINDS, type NotificationRuleState, isNotificationRuleRecipientField } from "../../../core/notification-rules.js";
import { doctypeOptions, fieldOptions, stringOptions } from "../meta-options.js";
import { renderDocTypeSelectControl, renderFieldSelectControl, renderUserSelectorControl } from "../meta-controls.js";
import { escapeHtml, renderTableCell, uniqueSortedStrings } from "./shared.js";

export interface NotificationRuleAdminState {
  readonly doctypes: readonly DocTypeDefinition[];
  readonly selectedDoctype: string;
  readonly selectedRuleName?: string;
  readonly doctype?: DocTypeDefinition;
  readonly userSuggestions?: readonly string[];
  readonly draftRule?: NotificationRuleDefinition;
  readonly state?: NotificationRuleState;
  readonly error?: string;
}

export interface AssignmentRuleAdminState {
  readonly doctypes: readonly DocTypeDefinition[];
  readonly selectedDoctype: string;
  readonly selectedRuleName?: string;
  readonly doctype?: DocTypeDefinition;
  readonly userSuggestions?: readonly string[];
  readonly draftRule?: AssignmentRuleDefinition;
  readonly state?: AssignmentRuleState;
  readonly error?: string;
}

export function renderNotificationRuleAdmin(state: NotificationRuleAdminState): string {
  const version = state.state?.version ?? 0;
  const selectedRule = state.state?.rules.find((entry) => entry.rule.name === state.selectedRuleName);
  const rule = state.draftRule ?? selectedRule?.rule;
  const doctype = state.doctype ?? state.doctypes.find((item) => item.name === state.selectedDoctype);
  const userSuggestions = uniqueSortedStrings([
    ...(state.userSuggestions ?? []),
    ...(state.draftRule?.recipients.flatMap((recipient) => recipient.kind === "user" ? [recipient.userId] : []) ?? []),
    ...((state.state?.rules ?? []).flatMap((entry) =>
      entry.rule.recipients.flatMap((recipient) => recipient.kind === "user" ? [recipient.userId] : [])
    ))
  ]);
  const rows = state.state?.rules
    .map((entry) => `<tr>
      ${renderTableCell("Name", escapeHtml(entry.rule.name))}
      ${renderTableCell("Status", entry.enabled ? "enabled" : "disabled")}
      ${renderTableCell("Events", escapeHtml(entry.rule.events.join(", ")))}
      ${renderTableCell("Recipients", escapeHtml(entry.rule.recipients.map(notificationRuleRecipientLabel).join(", ")))}
      ${renderTableCell("Channels", escapeHtml((entry.rule.channels ?? ["inbox"]).join(", ")))}
      ${renderTableCell("Condition", escapeHtml(notificationRuleConditionLabel(entry.rule.condition)))}
      ${renderTableCell("Subject", escapeHtml(entry.rule.subject ?? ""))}
      ${renderTableCell("Actions", `
        <a class="button" href="${escapeHtml(notificationRuleAdminHref(state.selectedDoctype, entry.rule.name))}">Edit</a>
        <form class="inline-action" method="post" action="/desk/admin/notification-rules/${encodeURIComponent(state.selectedDoctype)}/${encodeURIComponent(entry.rule.name)}/${entry.enabled ? "disable" : "enable"}">
          <input type="hidden" name="expectedVersion" value="${String(version)}">
          <button class="button" type="submit">${entry.enabled ? "Disable" : "Enable"}</button>
        </form>
        <form class="inline-action" method="post" action="/desk/admin/notification-rules/${encodeURIComponent(state.selectedDoctype)}/${encodeURIComponent(entry.rule.name)}/clear">
          <input type="hidden" name="expectedVersion" value="${String(version)}">
          <button class="button danger" type="submit">Clear</button>
        </form>
      `)}
    </tr>`)
    .join("");
  return `<form class="panel form" method="get" action="/desk/admin/notification-rules">
    <div class="fields cols-1">
      ${renderDocTypeSelectControl({
        label: "DocType",
        name: "doctype",
        value: state.selectedDoctype,
        options: doctypeOptions(state.doctypes, state.selectedDoctype)
      })}
    </div>
    <div class="actions"><button class="button primary" type="submit">Load</button></div>
  </form>
  ${state.error ? `<p class="error" role="alert">${escapeHtml(state.error)}</p>` : ""}
  <form class="panel form" method="post" action="/desk/admin/notification-rules">
    <input type="hidden" name="doctype" value="${escapeHtml(state.selectedDoctype)}">
    <input type="hidden" name="expectedVersion" value="${String(version)}">
    <div class="form-head"><h2>${rule === undefined ? "Notification Rule" : "Edit Notification Rule"}</h2><p>v${String(version)}</p></div>
    <div class="fields">
      <label class="field"><span>Name</span><input name="name" value="${escapeHtml(rule?.name ?? "")}"></label>
      <label class="field"><span>Enabled</span><select name="enabled">${renderNotificationRuleBooleanOptions(rule?.enabled, "Enabled", "Disabled")}</select></label>
      <label class="field wide"><span>Condition JSON</span><textarea name="condition" rows="5">${escapeHtml(notificationRuleConditionValue(rule?.condition))}</textarea></label>
      <label class="field"><span>Subject</span><input name="subject" value="${escapeHtml(rule?.subject ?? "")}" placeholder="{{ actor }} updated {{ doctype }} {{ name }}"></label>
      <label class="field"><span>Exclude Actor</span><select name="excludeActor">${renderNotificationRuleBooleanOptions(rule?.excludeActor, "Yes", "No")}</select></label>
    </div>
    ${renderNotificationRuleEventChoices(rule?.events ?? ["DocumentUpdated"])}
    ${renderNotificationRuleChannelChoices(rule?.channels)}
    ${renderNotificationRecipientControls(rule?.recipients ?? [{ kind: "field", field: "created_by" }], doctype, userSuggestions)}
    <div class="actions"><button class="button primary" type="submit">Save Rule</button></div>
  </form>
  <section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>Name</th><th>Status</th><th>Events</th><th>Recipients</th><th>Channels</th><th>Condition</th><th>Subject</th><th>Actions</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8" class="empty">No notification rules configured.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

export function renderAssignmentRuleAdmin(state: AssignmentRuleAdminState): string {
  const version = state.state?.version ?? 0;
  const selectedRule = state.state?.rules.find((entry) => entry.rule.name === state.selectedRuleName);
  const rule = state.draftRule ?? selectedRule?.rule;
  const doctype = state.doctype ?? state.doctypes.find((item) => item.name === state.selectedDoctype);
  const userSuggestions = uniqueSortedStrings([
    ...(state.userSuggestions ?? []),
    ...(state.draftRule?.assignees.flatMap((assignee) => assignee.kind === "user" ? [assignee.userId] : []) ?? []),
    ...((state.state?.rules ?? []).flatMap((entry) =>
      entry.rule.assignees.flatMap((assignee) => assignee.kind === "user" ? [assignee.userId] : [])
    ))
  ]);
  const rows = state.state?.rules
    .map((entry) => `<tr>
      ${renderTableCell("Name", escapeHtml(entry.rule.name))}
      ${renderTableCell("Status", entry.enabled ? "enabled" : "disabled")}
      ${renderTableCell("Events", escapeHtml(entry.rule.events.join(", ")))}
      ${renderTableCell("Assignees", escapeHtml(entry.rule.assignees.map(assignmentRuleAssigneeLabel).join(", ")))}
      ${renderTableCell("Condition", escapeHtml(notificationRuleConditionLabel(entry.rule.condition)))}
      ${renderTableCell("Actions", `
        <a class="button" href="${escapeHtml(assignmentRuleAdminHref(state.selectedDoctype, entry.rule.name))}">Edit</a>
        <form class="inline-action" method="post" action="/desk/admin/assignment-rules/${encodeURIComponent(state.selectedDoctype)}/${encodeURIComponent(entry.rule.name)}/${entry.enabled ? "disable" : "enable"}">
          <input type="hidden" name="expectedVersion" value="${String(version)}">
          <button class="button" type="submit">${entry.enabled ? "Disable" : "Enable"}</button>
        </form>
        <form class="inline-action" method="post" action="/desk/admin/assignment-rules/${encodeURIComponent(state.selectedDoctype)}/${encodeURIComponent(entry.rule.name)}/clear">
          <input type="hidden" name="expectedVersion" value="${String(version)}">
          <button class="button danger" type="submit">Clear</button>
        </form>
      `)}
    </tr>`)
    .join("");
  return `<form class="panel form" method="get" action="/desk/admin/assignment-rules">
    <div class="fields cols-1">
      ${renderDocTypeSelectControl({
        label: "DocType",
        name: "doctype",
        value: state.selectedDoctype,
        options: doctypeOptions(state.doctypes, state.selectedDoctype)
      })}
    </div>
    <div class="actions"><button class="button primary" type="submit">Load</button></div>
  </form>
  ${state.error ? `<p class="error" role="alert">${escapeHtml(state.error)}</p>` : ""}
  <form class="panel form" method="post" action="/desk/admin/assignment-rules">
    <input type="hidden" name="doctype" value="${escapeHtml(state.selectedDoctype)}">
    <input type="hidden" name="expectedVersion" value="${String(version)}">
    <div class="form-head"><h2>${rule === undefined ? "Assignment Rule" : "Edit Assignment Rule"}</h2><p>v${String(version)}</p></div>
    <div class="fields">
      <label class="field"><span>Name</span><input name="name" value="${escapeHtml(rule?.name ?? "")}"></label>
      <label class="field"><span>Enabled</span><select name="enabled">${renderNotificationRuleBooleanOptions(rule?.enabled, "Enabled", "Disabled")}</select></label>
      <label class="field wide"><span>Condition JSON</span><textarea name="condition" rows="5">${escapeHtml(notificationRuleConditionValue(rule?.condition))}</textarea></label>
      <label class="field"><span>Exclude Actor</span><select name="excludeActor">${renderNotificationRuleBooleanOptions(rule?.excludeActor, "Yes", "No")}</select></label>
    </div>
    ${renderAssignmentRuleEventChoices(rule?.events ?? ["DocumentCreated"])}
    ${renderAssignmentAssigneeControls(rule?.assignees ?? [{ kind: "field", field: "created_by" }], doctype, userSuggestions)}
    <div class="actions"><button class="button primary" type="submit">Save Rule</button></div>
  </form>
  <section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>Name</th><th>Status</th><th>Events</th><th>Assignees</th><th>Condition</th><th>Actions</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="empty">No assignment rules configured.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

function renderNotificationRuleBooleanOptions(value: boolean | undefined, trueLabel: string, falseLabel: string): string {
  return [
    `<option value=""${value === undefined ? " selected" : ""}>Default</option>`,
    `<option value="true"${value ? " selected" : ""}>${escapeHtml(trueLabel)}</option>`,
    `<option value="false"${value === false ? " selected" : ""}>${escapeHtml(falseLabel)}</option>`
  ].join("");
}

function notificationRuleAdminHref(doctype: string, ruleName: string): string {
  return `/desk/admin/notification-rules?doctype=${encodeURIComponent(doctype)}&rule=${encodeURIComponent(ruleName)}`;
}

function assignmentRuleAdminHref(doctype: string, ruleName: string): string {
  return `/desk/admin/assignment-rules?doctype=${encodeURIComponent(doctype)}&rule=${encodeURIComponent(ruleName)}`;
}

function notificationRuleRecipientLabel(
  recipient: NotificationRuleState["rules"][number]["rule"]["recipients"][number]
): string {
  if (recipient.kind === "documentOwner") {
    return "documentOwner";
  }
  if (recipient.kind === "field") {
    return `field:${recipient.field}`;
  }
  return `user:${recipient.userId}`;
}

function assignmentRuleAssigneeLabel(
  assignee: AssignmentRuleState["rules"][number]["rule"]["assignees"][number]
): string {
  if (assignee.kind === "field") {
    return `field:${assignee.field}`;
  }
  return `user:${assignee.userId}`;
}

function notificationRuleConditionValue(condition: PredicateExpression | undefined): string {
  return condition === undefined ? "" : JSON.stringify(condition, null, 2);
}

function notificationRuleConditionLabel(condition: PredicateExpression | undefined): string {
  return condition === undefined ? "" : JSON.stringify(condition);
}

function renderNotificationRuleEventChoices(selected: readonly NotificationRuleEventKind[]): string {
  return renderChoiceFieldset(
    "Events",
    "events",
    NOTIFICATION_RULE_EVENT_KINDS,
    selected,
    notificationRuleEventLabel
  );
}

function renderAssignmentRuleEventChoices(selected: readonly AssignmentRuleEventKind[]): string {
  return renderChoiceFieldset(
    "Events",
    "events",
    ASSIGNMENT_RULE_EVENT_KINDS,
    selected,
    notificationRuleEventLabel
  );
}

function renderNotificationRuleChannelChoices(selected: readonly NotificationRuleChannel[] | undefined): string {
  return renderChoiceFieldset(
    "Channels",
    "channels",
    NOTIFICATION_RULE_CHANNELS,
    selected ?? [],
    (channel) => channel === "inbox" ? "Inbox" : "Email"
  );
}

function renderChoiceFieldset<T extends string>(
  legend: string,
  name: string,
  values: readonly T[],
  selected: readonly string[],
  label: (value: T) => string
): string {
  const selectedSet = new Set(selected);
  const choices = values
    .map((value) => `<label class="choice">
      <input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(value)}"${selectedSet.has(value) ? " checked" : ""}>
      <span>${escapeHtml(label(value))}</span>
    </label>`)
    .join("");
  return `<fieldset class="choice-grid">
    <legend>${escapeHtml(legend)}</legend>
    ${choices}
  </fieldset>`;
}

function notificationRuleEventLabel(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function renderNotificationRecipientControls(
  recipients: readonly NotificationRuleRecipientDefinition[],
  doctype: DocTypeDefinition | undefined,
  userSuggestions: readonly string[]
): string {
  const rows = (recipients.length === 0 ? [{ kind: "field", field: "created_by" } as const] : [...recipients, undefined])
    .map((recipient, index) => renderNotificationRecipientRow(recipient, index, doctype, userSuggestions))
    .join("");
  return `<fieldset class="admin-row-builder">
    <legend>Recipients</legend>
    <div class="admin-row-list">${rows}</div>
  </fieldset>`;
}

function renderNotificationRecipientRow(
  recipient: NotificationRuleRecipientDefinition | undefined,
  index: number,
  doctype: DocTypeDefinition | undefined,
  userSuggestions: readonly string[]
): string {
  const kind = recipient?.kind ?? "";
  const field = recipient?.kind === "field" ? recipient.field : "";
  const user = recipient?.kind === "user" ? recipient.userId : "";
  return `<div class="admin-row">
    <label class="field compact"><span>Kind ${String(index + 1)}</span><select name="recipientKind">${renderNotificationRecipientKindOptions(kind)}</select></label>
    ${renderFieldSelectControl({
      label: "Field",
      name: "recipientField",
      value: field,
      options: fieldOptions(doctype, field, isNotificationRuleRecipientField),
      includeBlank: true,
      className: "field compact"
    })}
    ${renderUserSelectorControl({
      label: "User",
      name: "recipientUser",
      value: user,
      options: stringOptions(userSuggestions, user),
      datalistId: index === 0 ? "notification-rule-user-suggestions" : `notification-rule-user-suggestions-${String(index)}`,
      className: "field compact"
    })}
  </div>`;
}

function renderNotificationRecipientKindOptions(selected: string): string {
  const options: readonly { readonly value: string; readonly label: string }[] = [
    { value: "", label: "" },
    { value: "field", label: "Field" },
    { value: "user", label: "User" },
    { value: "documentOwner", label: "Document Owner" }
  ];
  return options
    .map(({ value, label }) =>
      `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`
    )
    .join("");
}

function renderAssignmentAssigneeControls(
  assignees: readonly AssignmentRuleAssigneeDefinition[],
  doctype: DocTypeDefinition | undefined,
  userSuggestions: readonly string[]
): string {
  const rows = (assignees.length === 0 ? [{ kind: "field", field: "created_by" } as const] : [...assignees, undefined])
    .map((assignee, index) => renderAssignmentAssigneeRow(assignee, index, doctype, userSuggestions))
    .join("");
  return `<fieldset class="admin-row-builder">
    <legend>Assignees</legend>
    <div class="admin-row-list">${rows}</div>
  </fieldset>`;
}

function renderAssignmentAssigneeRow(
  assignee: AssignmentRuleAssigneeDefinition | undefined,
  index: number,
  doctype: DocTypeDefinition | undefined,
  userSuggestions: readonly string[]
): string {
  const kind = assignee?.kind ?? "";
  const field = assignee?.kind === "field" ? assignee.field : "";
  const user = assignee?.kind === "user" ? assignee.userId : "";
  return `<div class="admin-row">
    <label class="field compact"><span>Kind ${String(index + 1)}</span><select name="assigneeKind">${renderAssignmentAssigneeKindOptions(kind)}</select></label>
    ${renderFieldSelectControl({
      label: "Field",
      name: "assigneeField",
      value: field,
      options: fieldOptions(doctype, field, isAssignmentRuleAssigneeField),
      includeBlank: true,
      className: "field compact"
    })}
    ${renderUserSelectorControl({
      label: "User",
      name: "assigneeUser",
      value: user,
      options: stringOptions(userSuggestions, user),
      datalistId: index === 0 ? "assignment-rule-user-suggestions" : `assignment-rule-user-suggestions-${String(index)}`,
      className: "field compact"
    })}
  </div>`;
}

function renderAssignmentAssigneeKindOptions(selected: string): string {
  const options: readonly { readonly value: string; readonly label: string }[] = [
    { value: "", label: "" },
    { value: "field", label: "Field" },
    { value: "user", label: "User" }
  ];
  return options
    .map(({ value, label }) =>
      `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`
    )
    .join("");
}
