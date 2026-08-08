import type { Child, FC } from "hono/jsx";
import { html, raw } from "hono/html";
import { ASSIGNMENT_RULE_EVENT_KINDS, type AssignmentRuleState, isAssignmentRuleAssigneeField } from "../../../core/assignment-rules.js";
import { type AssignmentRuleAssigneeDefinition, type AssignmentRuleDefinition, type DocTypeDefinition, type NotificationRuleDefinition, type NotificationRuleRecipientDefinition, type PredicateExpression } from "../../../core/types.js";
import { NOTIFICATION_RULE_CHANNELS, NOTIFICATION_RULE_EVENT_KINDS, type NotificationRuleState, isNotificationRuleRecipientField } from "../../../core/notification-rules.js";
import { doctypeOptions, fieldOptions, stringOptions } from "../meta-options.js";
import { renderDocTypeSelectControl, renderFieldSelectControl, renderUserSelectorControl } from "../meta-controls.js";
import { uniqueSortedStrings } from "./shared.js";
import { ActionBar, Field, FormRow, Notice, SelectOptions, UnsafeRawHtml, renderFragment, type SelectOptionSpec } from "../ui/primitives.js";

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
  return renderFragment(<NotificationRuleAdmin state={state} />);
}

export function renderAssignmentRuleAdmin(state: AssignmentRuleAdminState): string {
  return renderFragment(<AssignmentRuleAdmin state={state} />);
}

/** `<td data-label>` cell matching the responsive Desk table layout. */
const Cell: FC<{ label: string; children?: Child }> = ({ label, children }) => (
  <td data-label={label}>{children}</td>
);

const NotificationRuleAdmin: FC<{ state: NotificationRuleAdminState }> = ({ state }) => {
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
  const entries = state.state?.rules ?? [];
  return (
    <>
      <form class="panel form" method="get" action="/desk/admin/notification-rules">
        <FormRow columns={1}>
          <UnsafeRawHtml
            reason="output of renderDocTypeSelectControl (shared meta-controls string renderer), escaped internally via escapeHtml"
            html={renderDocTypeSelectControl({
              label: "DocType",
              name: "doctype",
              value: state.selectedDoctype,
              options: doctypeOptions(state.doctypes, state.selectedDoctype)
            })}
          />
        </FormRow>
        <ActionBar>
          <button class="button primary" type="submit">Load</button>
        </ActionBar>
      </form>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <form class="panel form" method="post" action="/desk/admin/notification-rules">
        <input type="hidden" name="doctype" value={state.selectedDoctype} />
        <input type="hidden" name="expectedVersion" value={String(version)} />
        <div class="form-head"><h2>{rule === undefined ? "Notification Rule" : "Edit Notification Rule"}</h2><p>v{String(version)}</p></div>
        <FormRow>
          <Field label="Name">
            <input name="name" value={rule?.name ?? ""} />
          </Field>
          <Field label="Enabled">
            <select name="enabled">
              <SelectOptions options={booleanOptionSpecs(rule?.enabled, "Enabled", "Disabled")} />
            </select>
          </Field>
          <Field label="Condition JSON" variant="wide">
            <textarea name="condition" rows={5}>{notificationRuleConditionValue(rule?.condition)}</textarea>
          </Field>
          <Field label="Subject">
            <input name="subject" value={rule?.subject ?? ""} placeholder="{{ actor }} updated {{ doctype }} {{ name }}" />
          </Field>
          <Field label="Exclude Actor">
            <select name="excludeActor">
              <SelectOptions options={booleanOptionSpecs(rule?.excludeActor, "Yes", "No")} />
            </select>
          </Field>
        </FormRow>
        <ChoiceFieldset
          legend="Events"
          name="events"
          values={NOTIFICATION_RULE_EVENT_KINDS}
          selected={rule?.events ?? ["DocumentUpdated"]}
          label={notificationRuleEventLabel}
        />
        <ChoiceFieldset
          legend="Channels"
          name="channels"
          values={NOTIFICATION_RULE_CHANNELS}
          selected={rule?.channels ?? []}
          label={(channel) => channel === "inbox" ? "Inbox" : "Email"}
        />
        <NotificationRecipientControls
          recipients={rule?.recipients ?? [{ kind: "field", field: "created_by" }]}
          doctype={doctype}
          userSuggestions={userSuggestions}
        />
        <ActionBar>
          <button class="button primary" type="submit">Save Rule</button>
        </ActionBar>
      </form>
      <section class="panel">
        <div class="table-wrap">
          <table class="responsive-table">
            <thead><tr><th>Name</th><th>Status</th><th>Events</th><th>Recipients</th><th>Channels</th><th>Condition</th><th>Subject</th><th>Actions</th></tr></thead>
            <tbody>
              {entries.length === 0 ? (
                <tr><td colspan={8} class="empty">No notification rules configured.</td></tr>
              ) : (
                entries.map((entry) => (
                  <tr>
                    <Cell label="Name">{entry.rule.name}</Cell>
                    <Cell label="Status">{entry.enabled ? "enabled" : "disabled"}</Cell>
                    <Cell label="Events">{entry.rule.events.join(", ")}</Cell>
                    <Cell label="Recipients">{entry.rule.recipients.map(notificationRuleRecipientLabel).join(", ")}</Cell>
                    <Cell label="Channels">{(entry.rule.channels ?? ["inbox"]).join(", ")}</Cell>
                    <Cell label="Condition">{notificationRuleConditionLabel(entry.rule.condition)}</Cell>
                    <Cell label="Subject">{entry.rule.subject ?? ""}</Cell>
                    <Cell label="Actions">
                      <a class="button" href={notificationRuleAdminHref(state.selectedDoctype, entry.rule.name)}>Edit</a>
                      <form class="inline-action" method="post" action={`/desk/admin/notification-rules/${encodeURIComponent(state.selectedDoctype)}/${encodeURIComponent(entry.rule.name)}/${entry.enabled ? "disable" : "enable"}`}>
                        <input type="hidden" name="expectedVersion" value={String(version)} />
                        <button class="button" type="submit">{entry.enabled ? "Disable" : "Enable"}</button>
                      </form>
                      <form class="inline-action" method="post" action={`/desk/admin/notification-rules/${encodeURIComponent(state.selectedDoctype)}/${encodeURIComponent(entry.rule.name)}/clear`}>
                        <input type="hidden" name="expectedVersion" value={String(version)} />
                        <button class="button danger" type="submit">Clear</button>
                      </form>
                    </Cell>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
};

const AssignmentRuleAdmin: FC<{ state: AssignmentRuleAdminState }> = ({ state }) => {
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
  const entries = state.state?.rules ?? [];
  return (
    <>
      <form class="panel form" method="get" action="/desk/admin/assignment-rules">
        <FormRow columns={1}>
          <UnsafeRawHtml
            reason="output of renderDocTypeSelectControl (shared meta-controls string renderer), escaped internally via escapeHtml"
            html={renderDocTypeSelectControl({
              label: "DocType",
              name: "doctype",
              value: state.selectedDoctype,
              options: doctypeOptions(state.doctypes, state.selectedDoctype)
            })}
          />
        </FormRow>
        <ActionBar>
          <button class="button primary" type="submit">Load</button>
        </ActionBar>
      </form>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <form class="panel form" method="post" action="/desk/admin/assignment-rules">
        <input type="hidden" name="doctype" value={state.selectedDoctype} />
        <input type="hidden" name="expectedVersion" value={String(version)} />
        <div class="form-head"><h2>{rule === undefined ? "Assignment Rule" : "Edit Assignment Rule"}</h2><p>v{String(version)}</p></div>
        <FormRow>
          <Field label="Name">
            <input name="name" value={rule?.name ?? ""} />
          </Field>
          <Field label="Enabled">
            <select name="enabled">
              <SelectOptions options={booleanOptionSpecs(rule?.enabled, "Enabled", "Disabled")} />
            </select>
          </Field>
          <Field label="Condition JSON" variant="wide">
            <textarea name="condition" rows={5}>{notificationRuleConditionValue(rule?.condition)}</textarea>
          </Field>
          <Field label="Exclude Actor">
            <select name="excludeActor">
              <SelectOptions options={booleanOptionSpecs(rule?.excludeActor, "Yes", "No")} />
            </select>
          </Field>
        </FormRow>
        <ChoiceFieldset
          legend="Events"
          name="events"
          values={ASSIGNMENT_RULE_EVENT_KINDS}
          selected={rule?.events ?? ["DocumentCreated"]}
          label={notificationRuleEventLabel}
        />
        <AssignmentAssigneeControls
          assignees={rule?.assignees ?? [{ kind: "field", field: "created_by" }]}
          doctype={doctype}
          userSuggestions={userSuggestions}
        />
        <ActionBar>
          <button class="button primary" type="submit">Save Rule</button>
        </ActionBar>
      </form>
      <section class="panel">
        <div class="table-wrap">
          <table class="responsive-table">
            <thead><tr><th>Name</th><th>Status</th><th>Events</th><th>Assignees</th><th>Condition</th><th>Actions</th></tr></thead>
            <tbody>
              {entries.length === 0 ? (
                <tr><td colspan={6} class="empty">No assignment rules configured.</td></tr>
              ) : (
                entries.map((entry) => (
                  <tr>
                    <Cell label="Name">{entry.rule.name}</Cell>
                    <Cell label="Status">{entry.enabled ? "enabled" : "disabled"}</Cell>
                    <Cell label="Events">{entry.rule.events.join(", ")}</Cell>
                    <Cell label="Assignees">{entry.rule.assignees.map(assignmentRuleAssigneeLabel).join(", ")}</Cell>
                    <Cell label="Condition">{notificationRuleConditionLabel(entry.rule.condition)}</Cell>
                    <Cell label="Actions">
                      <a class="button" href={assignmentRuleAdminHref(state.selectedDoctype, entry.rule.name)}>Edit</a>
                      <form class="inline-action" method="post" action={`/desk/admin/assignment-rules/${encodeURIComponent(state.selectedDoctype)}/${encodeURIComponent(entry.rule.name)}/${entry.enabled ? "disable" : "enable"}`}>
                        <input type="hidden" name="expectedVersion" value={String(version)} />
                        <button class="button" type="submit">{entry.enabled ? "Disable" : "Enable"}</button>
                      </form>
                      <form class="inline-action" method="post" action={`/desk/admin/assignment-rules/${encodeURIComponent(state.selectedDoctype)}/${encodeURIComponent(entry.rule.name)}/clear`}>
                        <input type="hidden" name="expectedVersion" value={String(version)} />
                        <button class="button danger" type="submit">Clear</button>
                      </form>
                    </Cell>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
};

function booleanOptionSpecs(value: boolean | undefined, trueLabel: string, falseLabel: string): readonly SelectOptionSpec[] {
  return [
    { value: "", label: "Default", selected: value === undefined },
    { value: "true", label: trueLabel, selected: value === true },
    { value: "false", label: falseLabel, selected: value === false }
  ];
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

/**
 * Checkbox choice grid. The `<input>` goes through hono's `html` tagged
 * template (which escapes interpolations) because the desk tests assert the
 * bare `checked` attribute byte-for-byte, and hono/jsx boolean props render
 * as `checked=""`.
 */
const ChoiceFieldset: FC<{
  legend: string;
  name: string;
  values: readonly string[];
  selected: readonly string[];
  label: (value: string) => string;
}> = ({ legend, name, values, selected, label }) => {
  const selectedSet = new Set(selected);
  return (
    <fieldset class="choice-grid">
      <legend>{legend}</legend>
      {values.map((value) => (
        <label class="choice">
          {html`<input type="checkbox" name="${name}" value="${value}"${selectedSet.has(value) ? raw(" checked") : raw("")}>`}
          <span>{label(value)}</span>
        </label>
      ))}
    </fieldset>
  );
};

function notificationRuleEventLabel(value: string): string {
  return value.replace(/([a-z])([A-Z])/g, "$1 $2");
}

const NotificationRecipientControls: FC<{
  recipients: readonly NotificationRuleRecipientDefinition[];
  doctype: DocTypeDefinition | undefined;
  userSuggestions: readonly string[];
}> = ({ recipients, doctype, userSuggestions }) => {
  const rows = recipients.length === 0 ? [{ kind: "field", field: "created_by" } as const] : [...recipients, undefined];
  return (
    <fieldset class="admin-row-builder">
      <legend>Recipients</legend>
      <div class="admin-row-list">
        {rows.map((recipient, index) => (
          <NotificationRecipientRow
            recipient={recipient}
            index={index}
            doctype={doctype}
            userSuggestions={userSuggestions}
          />
        ))}
      </div>
    </fieldset>
  );
};

const NotificationRecipientRow: FC<{
  recipient: NotificationRuleRecipientDefinition | undefined;
  index: number;
  doctype: DocTypeDefinition | undefined;
  userSuggestions: readonly string[];
}> = ({ recipient, index, doctype, userSuggestions }) => {
  const kind = recipient?.kind ?? "";
  const field = recipient?.kind === "field" ? recipient.field : "";
  const user = recipient?.kind === "user" ? recipient.userId : "";
  return (
    <div class="admin-row">
      <Field label={`Kind ${String(index + 1)}`} variant="compact">
        <select name="recipientKind">
          <SelectOptions options={notificationRecipientKindOptionSpecs(kind)} />
        </select>
      </Field>
      <UnsafeRawHtml
        reason="output of renderFieldSelectControl (shared meta-controls string renderer), escaped internally via escapeHtml"
        html={renderFieldSelectControl({
          label: "Field",
          name: "recipientField",
          value: field,
          options: fieldOptions(doctype, field, isNotificationRuleRecipientField),
          includeBlank: true,
          className: "field compact"
        })}
      />
      <UnsafeRawHtml
        reason="output of renderUserSelectorControl (shared meta-controls string renderer), escaped internally via escapeHtml"
        html={renderUserSelectorControl({
          label: "User",
          name: "recipientUser",
          value: user,
          options: stringOptions(userSuggestions, user),
          datalistId: index === 0 ? "notification-rule-user-suggestions" : `notification-rule-user-suggestions-${String(index)}`,
          className: "field compact"
        })}
      />
    </div>
  );
};

function notificationRecipientKindOptionSpecs(selected: string): readonly SelectOptionSpec[] {
  const options: readonly { readonly value: string; readonly label: string }[] = [
    { value: "", label: "" },
    { value: "field", label: "Field" },
    { value: "user", label: "User" },
    { value: "documentOwner", label: "Document Owner" }
  ];
  return options.map(({ value, label }) => ({ value, label, selected: value === selected }));
}

const AssignmentAssigneeControls: FC<{
  assignees: readonly AssignmentRuleAssigneeDefinition[];
  doctype: DocTypeDefinition | undefined;
  userSuggestions: readonly string[];
}> = ({ assignees, doctype, userSuggestions }) => {
  const rows = assignees.length === 0 ? [{ kind: "field", field: "created_by" } as const] : [...assignees, undefined];
  return (
    <fieldset class="admin-row-builder">
      <legend>Assignees</legend>
      <div class="admin-row-list">
        {rows.map((assignee, index) => (
          <AssignmentAssigneeRow
            assignee={assignee}
            index={index}
            doctype={doctype}
            userSuggestions={userSuggestions}
          />
        ))}
      </div>
    </fieldset>
  );
};

const AssignmentAssigneeRow: FC<{
  assignee: AssignmentRuleAssigneeDefinition | undefined;
  index: number;
  doctype: DocTypeDefinition | undefined;
  userSuggestions: readonly string[];
}> = ({ assignee, index, doctype, userSuggestions }) => {
  const kind = assignee?.kind ?? "";
  const field = assignee?.kind === "field" ? assignee.field : "";
  const user = assignee?.kind === "user" ? assignee.userId : "";
  return (
    <div class="admin-row">
      <Field label={`Kind ${String(index + 1)}`} variant="compact">
        <select name="assigneeKind">
          <SelectOptions options={assignmentAssigneeKindOptionSpecs(kind)} />
        </select>
      </Field>
      <UnsafeRawHtml
        reason="output of renderFieldSelectControl (shared meta-controls string renderer), escaped internally via escapeHtml"
        html={renderFieldSelectControl({
          label: "Field",
          name: "assigneeField",
          value: field,
          options: fieldOptions(doctype, field, isAssignmentRuleAssigneeField),
          includeBlank: true,
          className: "field compact"
        })}
      />
      <UnsafeRawHtml
        reason="output of renderUserSelectorControl (shared meta-controls string renderer), escaped internally via escapeHtml"
        html={renderUserSelectorControl({
          label: "User",
          name: "assigneeUser",
          value: user,
          options: stringOptions(userSuggestions, user),
          datalistId: index === 0 ? "assignment-rule-user-suggestions" : `assignment-rule-user-suggestions-${String(index)}`,
          className: "field compact"
        })}
      />
    </div>
  );
};

function assignmentAssigneeKindOptionSpecs(selected: string): readonly SelectOptionSpec[] {
  const options: readonly { readonly value: string; readonly label: string }[] = [
    { value: "", label: "" },
    { value: "field", label: "Field" },
    { value: "user", label: "User" }
  ];
  return options.map(({ value, label }) => ({ value, label, selected: value === selected }));
}
