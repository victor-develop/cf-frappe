import type { FC } from "hono/jsx";
import { type DocTypeDefinition, type DocumentSnapshot } from "../../../core/types.js";
import { type RoleCatalogState } from "../../../core/roles.js";
import { USER_PROFILE_FIELDS, type UserProfileState } from "../../../core/user-profiles.js";
import { type UserAccount } from "../../../core/user-accounts.js";
import { type UserPermissionState } from "../../../core/user-permissions.js";
import { doctypeOptions, documentOptions, stringOptions } from "../meta-options.js";
import { renderDocTypeDatalistControl, renderDocumentReferencePickerControls, renderRoleMultiSelectorControl, renderUserSelectorControl } from "../meta-controls.js";
import { uniqueSortedStrings } from "./shared.js";
import { ActionBar, Field, FormRow, Notice, SelectOptions, UnsafeRawHtml, renderFragment, type SelectOptionSpec } from "../ui/primitives.js";

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
  return renderFragment(<UserPermissionAdmin state={state} options={options} />);
}

const UserPermissionAdmin: FC<{ state: UserPermissionState; options: UserPermissionAdminRenderOptions }> = ({
  state,
  options
}) => {
  const draft = options.draft;
  const selectedUserId = draft?.userId ?? state.userId;
  const targetDoctype = draft?.targetDoctype ?? "";
  const targetName = draft?.targetName ?? "";
  const applicableDoctypes = (draft?.applicableDoctypes ?? []).join(", ");
  const userOptions = stringOptions([...(options.userSuggestions ?? []), selectedUserId], selectedUserId);
  const targetDoctypeOptions = doctypeOptions(options.doctypes ?? [], targetDoctype);
  const targetDocumentOptions = documentOptions(options.documentSuggestions ?? [], targetName);
  return (
    <>
      <form class="panel form" method="get" action="/desk/admin/user-permissions">
        <FormRow columns={1}>
          <UnsafeRawHtml
            reason="pre-built user selector control from meta-controls; values escaped internally"
            html={renderUserSelectorControl({
              label: "User",
              name: "user",
              value: selectedUserId,
              options: userOptions,
              datalistId: "user-permission-user-suggestions"
            })}
          />
        </FormRow>
        <ActionBar>
          <button class="button primary" type="submit">Load</button>
        </ActionBar>
      </form>
      {options.error ? <Notice tone="error">{options.error}</Notice> : null}
      <form class="panel form" method="post" action="/desk/admin/user-permissions">
        <input type="hidden" name="user" value={selectedUserId} />
        <input type="hidden" name="expectedVersion" value={String(state.version)} />
        <FormRow>
          <UnsafeRawHtml
            reason="pre-built document reference picker controls from meta-controls; values escaped internally"
            html={renderDocumentReferencePickerControls({
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
          />
          <UnsafeRawHtml
            reason="pre-built doctype datalist control from meta-controls; values escaped internally"
            html={renderDocTypeDatalistControl({
              label: "Applicable DocTypes",
              name: "applicableDoctypes",
              value: applicableDoctypes,
              options: doctypeOptions(options.doctypes ?? [], applicableDoctypes),
              datalistId: "user-permission-applicable-doctype-options"
            })}
          />
        </FormRow>
        <ActionBar>
          <button class="button primary" type="submit">Allow</button>
        </ActionBar>
      </form>
      <section class="panel">
        <div class="table-wrap">
          <table class="responsive-table">
            <thead>
              <tr><th>Target DocType</th><th>Target Name</th><th>Applicable DocTypes</th><th>Action</th></tr>
            </thead>
            <tbody>
              {state.grants.length === 0 ? (
                <tr><td colspan={4} class="empty">No grants configured.</td></tr>
              ) : (
                state.grants.map((grant) => {
                  const applicable = (grant.applicableDoctypes ?? []).join(", ");
                  return (
                    <tr>
                      <td data-label="Target DocType">{grant.targetDoctype}</td>
                      <td data-label="Target Name">{grant.targetName}</td>
                      <td data-label="Applicable DocTypes">{applicable}</td>
                      <td data-label="Action">
                        <form class="inline-action" method="post" action="/desk/admin/user-permissions/revoke">
                          <input type="hidden" name="user" value={state.userId} />
                          <input type="hidden" name="targetDoctype" value={grant.targetDoctype} />
                          <input type="hidden" name="targetName" value={grant.targetName} />
                          <input type="hidden" name="applicableDoctypes" value={applicable} />
                          <input type="hidden" name="expectedVersion" value={String(state.version)} />
                          <button class="button danger" type="submit">Revoke</button>
                        </form>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
};

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
  return renderFragment(<UserAccountAdmin state={state} />);
}

const UserAccountAdmin: FC<{ state: UserAccountAdminState }> = ({ state }) => {
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
  return (
    <>
      <form class="panel form" method="get" action="/desk/admin/users">
        <FormRow columns={1}>
          <Field label="User">
            <input name="user" type="email" value={selectedUserId} />
          </Field>
        </FormRow>
        <ActionBar>
          <button class="button primary" type="submit">Load</button>
        </ActionBar>
      </form>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <form class="panel form" method="post" action="/desk/admin/users">
        <input type="hidden" name="expectedVersion" value="0" />
        <div class="form-head"><h2>Create User</h2></div>
        <FormRow>
          <Field label="User">
            <input name="user" type="email" value={createUserId} />
          </Field>
          <Field label="Email">
            <input name="email" type="email" value={createEmail} />
          </Field>
          <Field label="Password">
            <input name="password" type="password" autocomplete="new-password" />
          </Field>
          <UnsafeRawHtml
            reason="pre-built role multi-selector control from meta-controls; values escaped internally"
            html={renderRoleMultiSelectorControl({
              label: "Roles",
              name: "roles",
              value: createRoles,
              options: stringOptions(roleSuggestions, createRoles),
              datalistId: "user-account-create-role-suggestions"
            })}
          />
          <Field label="Status">
            <select name="enabled">
              <SelectOptions options={userAccountStatusOptions(state.createDraft?.enabled, "Enabled", "Disabled")} />
            </select>
          </Field>
        </FormRow>
        <ActionBar>
          <button class="button primary" type="submit">Create</button>
        </ActionBar>
      </form>
      <UserAuthProviderSyncForm
        account={account}
        selectedUserId={selectedUserId}
        roleSuggestions={roleSuggestions}
        draft={state.providerSyncDraft}
      />
      <section class="panel">
        <div class="table-wrap">
          <table class="responsive-table">
            <thead>
              <tr><th>User</th><th>Email</th><th>Full Name</th><th>Roles</th><th>Status</th><th>Version</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {account ? (
                <tr>
                  <td data-label="User">{account.userId}</td>
                  <td data-label="Email">{account.email ?? ""}</td>
                  <td data-label="Full Name">{state.profile?.profile.fullName ?? ""}</td>
                  <td data-label="Roles">{account.roles.join(", ")}</td>
                  <td data-label="Status">{account.enabled ? "enabled" : "disabled"}</td>
                  <td data-label="Version">{String(account.version)}</td>
                  <td data-label="Updated">{account.updatedAt ?? account.createdAt ?? ""}</td>
                </tr>
              ) : (
                <tr><td colspan={7} class="empty">No account loaded.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      {account ? (
        <>
          {state.profile ? <UserProfileForm account={account} profile={state.profile} /> : null}
          <form class="panel form" method="post" action="/desk/admin/users/password">
            <input type="hidden" name="user" value={account.userId} />
            <input type="hidden" name="expectedVersion" value={String(account.version)} />
            <div class="form-head"><h2>Password</h2></div>
            <FormRow columns={1}>
              <Field label="New Password">
                <input name="password" type="password" autocomplete="new-password" />
              </Field>
            </FormRow>
            <ActionBar>
              <button class="button primary" type="submit">Change Password</button>
            </ActionBar>
          </form>
          <form class="panel form" method="post" action="/desk/admin/users/roles">
            <input type="hidden" name="user" value={account.userId} />
            <input type="hidden" name="expectedVersion" value={String(account.version)} />
            <div class="form-head"><h2>Roles</h2></div>
            <FormRow columns={1}>
              <UnsafeRawHtml
                reason="pre-built role multi-selector control from meta-controls; values escaped internally"
                html={renderRoleMultiSelectorControl({
                  label: "Roles",
                  name: "roles",
                  value: (state.roleDraft?.roles ?? account.roles).join(", "),
                  options: stringOptions(roleSuggestions, (state.roleDraft?.roles ?? account.roles).join(", ")),
                  datalistId: "user-account-change-role-suggestions"
                })}
              />
            </FormRow>
            <ActionBar>
              <button class="button primary" type="submit">Save Roles</button>
            </ActionBar>
          </form>
          <form class="panel form" method="post" action={`/desk/admin/users/${account.enabled ? "disable" : "enable"}`}>
            <input type="hidden" name="user" value={account.userId} />
            <input type="hidden" name="expectedVersion" value={String(account.version)} />
            <div class="form-head"><h2>Status</h2><p>v{String(account.version)} · {account.enabled ? "enabled" : "disabled"}</p></div>
            <ActionBar>
              <button class={`button ${account.enabled ? "danger" : "primary"}`} type="submit">{account.enabled ? "Disable" : "Enable"}</button>
            </ActionBar>
          </form>
        </>
      ) : null}
    </>
  );
};

const UserAuthProviderSyncForm: FC<{
  account: UserAccount | undefined;
  selectedUserId: string;
  roleSuggestions: readonly string[];
  draft: UserAccountAdminState["providerSyncDraft"] | undefined;
}> = ({ account, selectedUserId, roleSuggestions, draft }) => {
  const userId = draft?.userId ?? account?.userId ?? selectedUserId;
  const expectedVersion = account?.version ?? 0;
  const roles = draft?.roles.join(", ") ?? account?.roles.join(", ") ?? "";
  const email = draft?.email ?? account?.email ?? "";
  return (
    <form class="panel form" method="post" action="/desk/admin/users/provider-sync">
      <input type="hidden" name="expectedVersion" value={String(expectedVersion)} />
      <div class="form-head"><h2>Sync Auth Provider</h2><p>v{String(expectedVersion)}</p></div>
      <FormRow>
        <Field label="User">
          <input name="user" value={userId} />
        </Field>
        <Field label="Provider">
          <input name="provider" value={draft?.provider ?? ""} />
        </Field>
        <Field label="Subject">
          <input name="subject" value={draft?.subject ?? ""} />
        </Field>
        <Field label="Email">
          <input name="email" type="email" value={email} />
        </Field>
        <UnsafeRawHtml
          reason="pre-built role multi-selector control from meta-controls; values escaped internally"
          html={renderRoleMultiSelectorControl({
            label: "Roles",
            name: "roles",
            value: roles,
            options: stringOptions(roleSuggestions, roles),
            datalistId: "user-account-provider-role-suggestions"
          })}
        />
        <Field label="Status">
          <select name="enabled">
            <SelectOptions options={userAccountStatusOptions(draft?.enabled, "Enabled", "Disabled", "Keep")} />
          </select>
        </Field>
        <Field label="Email Verified">
          <select name="emailVerified">
            <SelectOptions options={userAccountStatusOptions(draft?.emailVerified, "Verified", "Unverified", "Keep")} />
          </select>
        </Field>
      </FormRow>
      <ActionBar>
        <button class="button primary" type="submit">Sync Provider</button>
      </ActionBar>
    </form>
  );
};

function userAccountStatusOptions(
  value: boolean | undefined,
  trueLabel: string,
  falseLabel: string,
  emptyLabel?: string
): readonly SelectOptionSpec[] {
  const selected = value === undefined ? "" : value ? "true" : "false";
  return [
    ...(emptyLabel === undefined ? [] : [{ value: "", label: emptyLabel, selected: selected === "" }]),
    { value: "true", label: trueLabel, selected: selected === "true" },
    { value: "false", label: falseLabel, selected: selected === "false" }
  ];
}

const UserProfileForm: FC<{ account: UserAccount; profile: UserProfileState }> = ({ account, profile }) => (
  <form class="panel form" method="post" action="/desk/admin/users/profile">
    <input type="hidden" name="user" value={account.userId} />
    <input type="hidden" name="expectedVersion" value={String(profile.version)} />
    <div class="form-head"><h2>Profile</h2><p>v{String(profile.version)}</p></div>
    <FormRow>
      {USER_PROFILE_FIELDS.map((field) => (
        <Field label={userProfileFieldLabel(field)}>
          <input name={field} value={profile.profile[field] ?? ""} />
        </Field>
      ))}
    </FormRow>
    <ActionBar>
      <button class="button primary" type="submit">Save Profile</button>
    </ActionBar>
  </form>
);

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

interface RoleAdminRenderOptions {
  readonly error?: string;
  readonly knownRoles?: readonly string[];
}

export function renderRoleAdmin(
  state: RoleCatalogState,
  options: { readonly error?: string; readonly knownRoles?: readonly string[] } = {}
): string {
  return renderFragment(<RoleAdmin state={state} options={options} />);
}

const RoleAdmin: FC<{ state: RoleCatalogState; options: RoleAdminRenderOptions }> = ({ state, options }) => {
  const catalogRoleNames = new Set(state.roles.map((role) => role.name));
  const knownRoles = (options.knownRoles ?? []).filter((role) => !catalogRoleNames.has(role));
  return (
    <>
      {options.error ? <Notice tone="error">{options.error}</Notice> : null}
      <form class="panel form" method="post" action="/desk/admin/roles">
        <input type="hidden" name="expectedVersion" value={String(state.version)} />
        <div class="form-head"><h2>Create Role</h2><p>v{String(state.version)}</p></div>
        <FormRow>
          <Field label="Role">
            <input name="role" />
          </Field>
          <Field label="Description">
            <input name="description" />
          </Field>
          <Field label="Status">
            <select name="enabled">
              <SelectOptions
                options={[
                  { value: "true", label: "Enabled", selected: true },
                  { value: "false", label: "Disabled" }
                ]}
              />
            </select>
          </Field>
        </FormRow>
        <ActionBar>
          <button class="button primary" type="submit">Create</button>
        </ActionBar>
      </form>
      <section class="panel">
        <div class="table-wrap">
          <table class="responsive-table">
            <thead>
              <tr><th>Role</th><th>Description</th><th>Status</th><th>Role Version</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {state.roles.length === 0 && knownRoles.length === 0 ? (
                <tr><td colspan={5} class="empty">No roles configured.</td></tr>
              ) : (
                <>
                  {state.roles.map((role) => (
                    <tr>
                      <td data-label="Role">{role.name}</td>
                      <td data-label="Description">{role.description ?? ""}</td>
                      <td data-label="Status">{role.enabled ? "enabled" : "disabled"}</td>
                      <td data-label="Role Version">{String(role.version)}</td>
                      <td data-label="Actions">
                        <form class="inline-action" method="post" action={`/desk/admin/roles/${encodeURIComponent(role.name)}/description`}>
                          <input type="hidden" name="expectedVersion" value={String(state.version)} />
                          <input name="description" value={role.description ?? ""} />
                          <button class="button" type="submit">Save</button>
                        </form>
                        <form class="inline-action" method="post" action={`/desk/admin/roles/${encodeURIComponent(role.name)}/${role.enabled ? "disable" : "enable"}`}>
                          <input type="hidden" name="expectedVersion" value={String(state.version)} />
                          <button class={`button ${role.enabled ? "danger" : "primary"}`} type="submit">{role.enabled ? "Disable" : "Enable"}</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                  {knownRoles.map((role) => (
                    <tr>
                      <td data-label="Role">{role}</td>
                      <td data-label="Description">Referenced by app metadata or the current actor</td>
                      <td data-label="Status">known</td>
                      <td data-label="Role Version">not cataloged</td>
                      <td data-label="Actions"><span class="muted">Create this role to manage description or status.</span></td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
};
