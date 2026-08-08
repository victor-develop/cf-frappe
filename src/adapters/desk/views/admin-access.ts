import { type DocTypeDefinition, type DocumentSnapshot } from "../../../core/types.js";
import { type RoleCatalogState } from "../../../core/roles.js";
import { USER_PROFILE_FIELDS, type UserProfileState } from "../../../core/user-profiles.js";
import { type UserAccount } from "../../../core/user-accounts.js";
import { type UserPermissionState } from "../../../core/user-permissions.js";
import { doctypeOptions, documentOptions, stringOptions } from "../meta-options.js";
import { renderDocTypeDatalistControl, renderDocumentReferencePickerControls, renderRoleMultiSelectorControl, renderUserSelectorControl } from "../meta-controls.js";
import { escapeHtml, renderTableCell, uniqueSortedStrings } from "./shared.js";

interface UserPermissionDraft {
  readonly userId?: string;
  readonly targetDoctype?: string;
  readonly targetName?: string;
  readonly applicableDoctypes?: readonly string[];
}

interface UserPermissionAdminRenderOptions {
  readonly doctypes?: readonly DocTypeDefinition[];
  readonly userSuggestions?: readonly string[];
  readonly documentSuggestions?: readonly DocumentSnapshot[];
  readonly draft?: UserPermissionDraft;
  readonly error?: string;
}

export function renderUserPermissionAdmin(
  state: UserPermissionState,
  options: UserPermissionAdminRenderOptions = {}
): string {
  const draft = options.draft;
  const selectedUserId = draft?.userId ?? state.userId;
  const targetDoctype = draft?.targetDoctype ?? "";
  const targetName = draft?.targetName ?? "";
  const applicableDoctypes = (draft?.applicableDoctypes ?? []).join(", ");
  const userOptions = stringOptions([...(options.userSuggestions ?? []), selectedUserId], selectedUserId);
  const targetDoctypeOptions = doctypeOptions(options.doctypes ?? [], targetDoctype);
  const targetDocumentOptions = documentOptions(options.documentSuggestions ?? [], targetName);
  const rows = state.grants
    .map((grant) => {
      const applicable = (grant.applicableDoctypes ?? []).join(", ");
      return `<tr>
        ${renderTableCell("Target DocType", escapeHtml(grant.targetDoctype))}
        ${renderTableCell("Target Name", escapeHtml(grant.targetName))}
        ${renderTableCell("Applicable DocTypes", escapeHtml(applicable))}
        ${renderTableCell("Action", `
          <form class="inline-action" method="post" action="/desk/admin/user-permissions/revoke">
            <input type="hidden" name="user" value="${escapeHtml(state.userId)}">
            <input type="hidden" name="targetDoctype" value="${escapeHtml(grant.targetDoctype)}">
            <input type="hidden" name="targetName" value="${escapeHtml(grant.targetName)}">
            <input type="hidden" name="applicableDoctypes" value="${escapeHtml(applicable)}">
            <input type="hidden" name="expectedVersion" value="${String(state.version)}">
            <button class="button danger" type="submit">Revoke</button>
          </form>
        `)}
      </tr>`;
    })
    .join("");
  return `<form class="panel form" method="get" action="/desk/admin/user-permissions">
    <div class="fields cols-1">
      ${renderUserSelectorControl({
        label: "User",
        name: "user",
        value: selectedUserId,
        options: userOptions,
        datalistId: "user-permission-user-suggestions"
      })}
    </div>
    <div class="actions"><button class="button primary" type="submit">Load</button></div>
  </form>
  ${options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : ""}
  <form class="panel form" method="post" action="/desk/admin/user-permissions">
    <input type="hidden" name="user" value="${escapeHtml(selectedUserId)}">
    <input type="hidden" name="expectedVersion" value="${String(state.version)}">
    <div class="fields">
      ${renderDocumentReferencePickerControls({
        doctypeName: "targetDoctype",
        documentName: "targetName",
        doctypeLabel: "Target DocType",
        documentLabel: "Target Name",
        selectedDoctype: targetDoctype,
        selectedDocumentName: targetName,
        doctypes: targetDoctypeOptions,
        documents: targetDocumentOptions,
        doctypeDatalistId: "user-permission-target-doctype-options",
        documentDatalistId: "user-permission-target-name-options"
      })}
      ${renderDocTypeDatalistControl({
        label: "Applicable DocTypes",
        name: "applicableDoctypes",
        value: applicableDoctypes,
        options: doctypeOptions(options.doctypes ?? [], applicableDoctypes),
        datalistId: "user-permission-applicable-doctype-options"
      })}
    </div>
    <div class="actions"><button class="button primary" type="submit">Allow</button></div>
  </form>
  <section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>Target DocType</th><th>Target Name</th><th>Applicable DocTypes</th><th>Action</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="empty">No grants configured.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

export interface UserAccountAdminState {
  readonly selectedUserId: string;
  readonly account?: UserAccount;
  readonly profile?: UserProfileState;
  readonly roleSuggestions?: readonly string[];
  readonly createDraft?: {
    readonly userId: string;
    readonly email?: string;
    readonly roles: readonly string[];
    readonly enabled?: boolean;
  };
  readonly roleDraft?: {
    readonly roles: readonly string[];
  };
  readonly providerSyncDraft?: {
    readonly userId: string;
    readonly provider: string;
    readonly subject: string;
    readonly email?: string;
    readonly roles: readonly string[];
    readonly enabled?: boolean;
    readonly emailVerified?: boolean;
  };
  readonly error?: string;
}

export function renderUserAccountAdmin(state: UserAccountAdminState): string {
  const account = state.account;
  const selectedUserId = account?.userId ?? state.selectedUserId;
  const roleSuggestions = uniqueSortedStrings([
    ...(state.roleSuggestions ?? []),
    ...(account?.roles ?? []),
    ...(state.createDraft?.roles ?? []),
    ...(state.roleDraft?.roles ?? []),
    ...(state.providerSyncDraft?.roles ?? [])
  ]);
  const createUserId = state.createDraft?.userId ?? (account ? "" : selectedUserId);
  const createRoles = state.createDraft?.roles.join(", ") ?? "";
  const createEmail = state.createDraft?.email ?? "";
  const providerSyncForm = renderUserAuthProviderSyncForm(account, selectedUserId, roleSuggestions, state.providerSyncDraft);
  const rows = account
    ? `<tr>
        ${renderTableCell("User", escapeHtml(account.userId))}
        ${renderTableCell("Email", escapeHtml(account.email ?? ""))}
        ${renderTableCell("Full Name", escapeHtml(state.profile?.profile.fullName ?? ""))}
        ${renderTableCell("Roles", escapeHtml(account.roles.join(", ")))}
        ${renderTableCell("Status", account.enabled ? "enabled" : "disabled")}
        ${renderTableCell("Version", String(account.version))}
        ${renderTableCell("Updated", escapeHtml(account.updatedAt ?? account.createdAt ?? ""))}
      </tr>`
    : "";
  const accountTools = account
    ? `${state.profile ? renderUserProfileForm(account, state.profile) : ""}
    <form class="panel form" method="post" action="/desk/admin/users/password">
      <input type="hidden" name="user" value="${escapeHtml(account.userId)}">
      <input type="hidden" name="expectedVersion" value="${String(account.version)}">
      <div class="form-head"><h2>Password</h2></div>
      <div class="fields cols-1">
        <label class="field"><span>New Password</span><input name="password" type="password" autocomplete="new-password"></label>
      </div>
      <div class="actions"><button class="button primary" type="submit">Change Password</button></div>
    </form>
    <form class="panel form" method="post" action="/desk/admin/users/roles">
      <input type="hidden" name="user" value="${escapeHtml(account.userId)}">
      <input type="hidden" name="expectedVersion" value="${String(account.version)}">
      <div class="form-head"><h2>Roles</h2></div>
      <div class="fields cols-1">
        ${renderRoleMultiSelectorControl({
          label: "Roles",
          name: "roles",
          value: (state.roleDraft?.roles ?? account.roles).join(", "),
          options: stringOptions(roleSuggestions, (state.roleDraft?.roles ?? account.roles).join(", ")),
          datalistId: "user-account-change-role-suggestions"
        })}
      </div>
      <div class="actions"><button class="button primary" type="submit">Save Roles</button></div>
    </form>
    <form class="panel form" method="post" action="/desk/admin/users/${account.enabled ? "disable" : "enable"}">
      <input type="hidden" name="user" value="${escapeHtml(account.userId)}">
      <input type="hidden" name="expectedVersion" value="${String(account.version)}">
      <div class="form-head"><h2>Status</h2><p>v${String(account.version)} · ${account.enabled ? "enabled" : "disabled"}</p></div>
      <div class="actions"><button class="button ${account.enabled ? "danger" : "primary"}" type="submit">${account.enabled ? "Disable" : "Enable"}</button></div>
    </form>`
    : "";
  return `<form class="panel form" method="get" action="/desk/admin/users">
    <div class="fields cols-1">
      <label class="field"><span>User</span><input name="user" type="email" value="${escapeHtml(selectedUserId)}"></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Load</button></div>
  </form>
  ${state.error ? `<p class="error" role="alert">${escapeHtml(state.error)}</p>` : ""}
  <form class="panel form" method="post" action="/desk/admin/users">
    <input type="hidden" name="expectedVersion" value="0">
    <div class="form-head"><h2>Create User</h2></div>
    <div class="fields">
      <label class="field"><span>User</span><input name="user" type="email" value="${escapeHtml(createUserId)}"></label>
      <label class="field"><span>Email</span><input name="email" type="email" value="${escapeHtml(createEmail)}"></label>
      <label class="field"><span>Password</span><input name="password" type="password" autocomplete="new-password"></label>
      ${renderRoleMultiSelectorControl({
        label: "Roles",
        name: "roles",
        value: createRoles,
        options: stringOptions(roleSuggestions, createRoles),
        datalistId: "user-account-create-role-suggestions"
      })}
      <label class="field"><span>Status</span><select name="enabled">${renderUserAccountStatusOptions(state.createDraft?.enabled, "Enabled", "Disabled")}</select></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Create</button></div>
  </form>
  ${providerSyncForm}
  <section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>User</th><th>Email</th><th>Full Name</th><th>Roles</th><th>Status</th><th>Version</th><th>Updated</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="7" class="empty">No account loaded.</td></tr>`}</tbody>
      </table>
    </div>
  </section>
  ${accountTools}`;
}

function renderUserAuthProviderSyncForm(
  account: UserAccount | undefined,
  selectedUserId: string,
  roleSuggestions: readonly string[],
  draft: UserAccountAdminState["providerSyncDraft"] | undefined
): string {
  const userId = draft?.userId ?? account?.userId ?? selectedUserId;
  const expectedVersion = account?.version ?? 0;
  const roles = draft?.roles.join(", ") ?? account?.roles.join(", ") ?? "";
  const email = draft?.email ?? account?.email ?? "";
  return `<form class="panel form" method="post" action="/desk/admin/users/provider-sync">
    <input type="hidden" name="expectedVersion" value="${String(expectedVersion)}">
    <div class="form-head"><h2>Sync Auth Provider</h2><p>v${String(expectedVersion)}</p></div>
    <div class="fields">
      <label class="field"><span>User</span><input name="user" value="${escapeHtml(userId)}"></label>
      <label class="field"><span>Provider</span><input name="provider" value="${escapeHtml(draft?.provider ?? "")}"></label>
      <label class="field"><span>Subject</span><input name="subject" value="${escapeHtml(draft?.subject ?? "")}"></label>
      <label class="field"><span>Email</span><input name="email" type="email" value="${escapeHtml(email)}"></label>
      ${renderRoleMultiSelectorControl({
        label: "Roles",
        name: "roles",
        value: roles,
        options: stringOptions(roleSuggestions, roles),
        datalistId: "user-account-provider-role-suggestions"
      })}
      <label class="field"><span>Status</span><select name="enabled">${renderUserAccountStatusOptions(draft?.enabled, "Enabled", "Disabled", "Keep")}</select></label>
      <label class="field"><span>Email Verified</span><select name="emailVerified">${renderUserAccountStatusOptions(draft?.emailVerified, "Verified", "Unverified", "Keep")}</select></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Sync Provider</button></div>
  </form>`;
}

function renderUserAccountStatusOptions(
  value: boolean | undefined,
  trueLabel: string,
  falseLabel: string,
  emptyLabel?: string
): string {
  const selected = value === undefined ? "" : value ? "true" : "false";
  return [
    ...(emptyLabel === undefined ? [] : [`<option value=""${selected === "" ? " selected" : ""}>${escapeHtml(emptyLabel)}</option>`]),
    `<option value="true"${selected === "true" ? " selected" : ""}>${escapeHtml(trueLabel)}</option>`,
    `<option value="false"${selected === "false" ? " selected" : ""}>${escapeHtml(falseLabel)}</option>`
  ].join("");
}

function renderUserProfileForm(account: UserAccount, profile: UserProfileState): string {
  const fields = USER_PROFILE_FIELDS.map((field) => {
    const label = userProfileFieldLabel(field);
    return `<label class="field"><span>${escapeHtml(label)}</span><input name="${field}" value="${escapeHtml(profile.profile[field] ?? "")}"></label>`;
  }).join("");
  return `<form class="panel form" method="post" action="/desk/admin/users/profile">
    <input type="hidden" name="user" value="${escapeHtml(account.userId)}">
    <input type="hidden" name="expectedVersion" value="${String(profile.version)}">
    <div class="form-head"><h2>Profile</h2><p>v${String(profile.version)}</p></div>
    <div class="fields">${fields}</div>
    <div class="actions"><button class="button primary" type="submit">Save Profile</button></div>
  </form>`;
}

function userProfileFieldLabel(field: (typeof USER_PROFILE_FIELDS)[number]): string {
  switch (field) {
    case "firstName":
      return "First Name";
    case "middleName":
      return "Middle Name";
    case "lastName":
      return "Last Name";
    case "fullName":
      return "Full Name";
    case "userImage":
      return "User Image";
    case "mobileNo":
      return "Mobile No";
    case "timeZone":
      return "Time Zone";
    case "deskTheme":
      return "Desk Theme";
    case "dateFormat":
      return "Date Format";
    case "timeFormat":
      return "Time Format";
    case "numberFormat":
      return "Number Format";
    case "weekStart":
      return "Week Start";
    case "defaultWorkspace":
      return "Default Workspace";
    default:
      return `${field.slice(0, 1).toUpperCase()}${field.slice(1)}`;
  }
}

export function renderRoleAdmin(
  state: RoleCatalogState,
  options: { readonly error?: string; readonly knownRoles?: readonly string[] } = {}
): string {
  const catalogRoleNames = new Set(state.roles.map((role) => role.name));
  const rows = state.roles
    .map((role) => {
      const action = role.enabled ? "disable" : "enable";
      return `<tr>
        ${renderTableCell("Role", escapeHtml(role.name))}
        ${renderTableCell("Description", escapeHtml(role.description ?? ""))}
        ${renderTableCell("Status", role.enabled ? "enabled" : "disabled")}
        ${renderTableCell("Role Version", String(role.version))}
        ${renderTableCell("Actions", `
          <form class="inline-action" method="post" action="/desk/admin/roles/${encodeURIComponent(role.name)}/description">
            <input type="hidden" name="expectedVersion" value="${String(state.version)}">
            <input name="description" value="${escapeHtml(role.description ?? "")}">
            <button class="button" type="submit">Save</button>
          </form>
          <form class="inline-action" method="post" action="/desk/admin/roles/${encodeURIComponent(role.name)}/${action}">
            <input type="hidden" name="expectedVersion" value="${String(state.version)}">
            <button class="button ${role.enabled ? "danger" : "primary"}" type="submit">${role.enabled ? "Disable" : "Enable"}</button>
          </form>
        `)}
      </tr>`;
    })
    .join("");
  const knownRows = (options.knownRoles ?? [])
    .filter((role) => !catalogRoleNames.has(role))
    .map((role) => `<tr>
      ${renderTableCell("Role", escapeHtml(role))}
      ${renderTableCell("Description", "Referenced by app metadata or the current actor")}
      ${renderTableCell("Status", "known")}
      ${renderTableCell("Role Version", "not cataloged")}
      ${renderTableCell("Actions", `<span class="muted">Create this role to manage description or status.</span>`)}
    </tr>`)
    .join("");
  const allRows = `${rows}${knownRows}`;
  return `${options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : ""}
  <form class="panel form" method="post" action="/desk/admin/roles">
    <input type="hidden" name="expectedVersion" value="${String(state.version)}">
    <div class="form-head"><h2>Create Role</h2><p>v${String(state.version)}</p></div>
    <div class="fields">
      <label class="field"><span>Role</span><input name="role"></label>
      <label class="field"><span>Description</span><input name="description"></label>
      <label class="field"><span>Status</span><select name="enabled"><option value="true" selected>Enabled</option><option value="false">Disabled</option></select></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Create</button></div>
  </form>
  <section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>Role</th><th>Description</th><th>Status</th><th>Role Version</th><th>Actions</th></tr></thead>
        <tbody>${allRows || `<tr><td colspan="5" class="empty">No roles configured.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}
