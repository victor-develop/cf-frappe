import { CHILD_TABLE_ROW_INDEX_FIELD, type DocTypeDefinition, type DocumentSnapshot, type FieldDefinition, type JsonValue, type LinkOption, type ResolvedFormSection, type ResolvedFormView } from "../../../core/types.js";
import { type ClientScriptDefinition } from "../../../core/client-script.js";
import { type DocumentAssignments, type DocumentFollowers, type DocumentTags, type DocumentTimeline } from "../../../application/document-history-service.js";
import { type DocumentSharePermission, type DocumentShareState } from "../../../core/document-shares.js";
import { type PrintFormatDefinition } from "../../../core/print-format.js";
import { type RelatedDocTypeResource, type RelatedResourcesView } from "../../../application/related-resource-service.js";
import { escapeHtml, formatFormValue, formatValue, inputType, labelFor, renderClientScripts, renderTableCell, slug } from "./shared.js";

export type FormLinkOptions = Readonly<Record<string, readonly LinkOption[]>>;

export type FormTableDefinitions = Readonly<Record<string, DocTypeDefinition>>;

export type FormLifecycleAction = "submit" | "cancel";

export interface FormWorkflowAction {
  readonly workflow: string;
  readonly workflowLabel: string;
  readonly action: string;
  readonly label: string;
  readonly to: string;
}

export interface FormDomainCommandAction {
  readonly name: string;
}

export interface DocumentSharePanelState extends DocumentShareState {
  readonly delegablePermissions: readonly DocumentSharePermission[];
}

export function renderRelatedResources(
  resources: RelatedResourcesView,
  options: { readonly printPdfEnabled?: boolean } = {}
): string {
  if (resources.doctypes.length === 0 && resources.printFormats.length === 0) {
    return "";
  }
  const doctypeItems = resources.doctypes.map((resource) => {
    const direction = resource.direction === "incoming" ? "Incoming" : "Outgoing";
    return `<li><a class="related-resource-link" href="${escapeHtml(relatedDocTypeHref(resource, resources.documentName))}">
      <span><strong>${escapeHtml(resource.doctypeLabel)}</strong><small>${escapeHtml(direction)} via ${escapeHtml(resource.fieldLabel)}</small></span>
      <span class="related-resource-kind">DocType</span>
    </a></li>`;
  }).join("");
  const printFormatItems = resources.printFormats.map((format) => {
    const href = resources.documentName === undefined
      ? `/desk/printing/formats/${encodeURIComponent(format.name)}`
      : `/desk/print/${encodeURIComponent(format.name)}/${encodeURIComponent(resources.documentName)}`;
    const pdfLink = resources.documentName !== undefined && options.printPdfEnabled
      ? `<a class="button" href="${href}/pdf">PDF</a>`
      : "";
    return `<li><div class="related-resource-link related-resource-print">
      <a href="${href}"><strong>${escapeHtml(format.label)}</strong>${format.description === undefined ? "" : `<small>${escapeHtml(format.description)}</small>`}</a>
      <span class="related-resource-actions"><span class="related-resource-kind">Print Format</span>${pdfLink}</span>
    </div></li>`;
  }).join("");
  const groups = [
    doctypeItems === "" ? "" : `<section class="related-resource-group"><h3>Linked DocTypes</h3><ul class="related-resource-list">${doctypeItems}</ul></section>`,
    printFormatItems === "" ? "" : `<section class="related-resource-group"><h3>Print Formats</h3><ul class="related-resource-list">${printFormatItems}</ul></section>`
  ].join("");
  const count = resources.doctypes.length + resources.printFormats.length;
  return `<section class="panel related-resources" aria-label="Related resources">
    <div class="form-head"><h2>Related</h2><p>${String(count)} ${count === 1 ? "resource" : "resources"}</p></div>
    <div class="related-resource-groups">${groups}</div>
  </section>`;
}

function relatedDocTypeHref(resource: RelatedDocTypeResource, documentName: string | undefined): string {
  const base = `/desk/${encodeURIComponent(resource.doctype)}`;
  if (documentName === undefined) {
    return base;
  }
  if (resource.direction === "outgoing" && resource.linkedDocumentName !== undefined) {
    return `${base}/${encodeURIComponent(resource.linkedDocumentName)}`;
  }
  if (resource.direction === "incoming") {
    return `${base}?${encodeURIComponent(`filter_${resource.field}`)}=${encodeURIComponent(documentName)}&default_filters=0`;
  }
  return base;
}

export function renderFormView(
  doctype: DocTypeDefinition,
  formView: ResolvedFormView,
  options: {
    readonly mode: "create" | "update";
    readonly document?: DocumentSnapshot;
    readonly error?: string;
    readonly linkOptions?: FormLinkOptions;
    readonly tableDefinitions?: FormTableDefinitions;
    readonly lifecycleActions?: readonly FormLifecycleAction[];
    readonly workflowActions?: readonly FormWorkflowAction[];
    readonly domainCommands?: readonly FormDomainCommandAction[];
    readonly printFormats?: readonly PrintFormatDefinition[];
    readonly printPdfEnabled?: boolean;
    readonly clientScripts?: readonly ClientScriptDefinition[];
    readonly realtimeRoute?: string;
    readonly canUpdate?: boolean;
    readonly canDuplicate?: boolean;
    readonly canAmend?: boolean;
  }
): string {
  const updateDocument = options.mode === "update" ? options.document : undefined;
  const workflowInitialStates = new Map(
    (doctype.workflows ?? []).map((workflow) => [workflow.stateField, workflow.initialState] as const)
  );
  const action =
    options.mode === "create"
      ? `/desk/${encodeURIComponent(doctype.name)}`
      : `/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(updateDocument?.name ?? "")}`;
  const title = options.mode === "create" ? `New ${labelFor(doctype)}` : updateDocument?.name ?? doctype.name;
  const canSave = options.mode === "create" || (Boolean(options.canUpdate) && updateDocument?.docstatus === "draft");
  const domainCommands = options.domainCommands ?? [];
  const sections = formView.sections
    .map((section) =>
      renderFormSection(
        section,
        options.document,
        options.linkOptions ?? {},
        options.tableDefinitions ?? {},
        workflowInitialStates
      )
    )
    .join("");
  const commands =
    updateDocument?.docstatus === "draft" && domainCommands.length
      ? `<section class="command-row" aria-label="Commands">${domainCommands
          .map(
            (command) =>
              `<button class="button" formmethod="post" formaction="/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(updateDocument.name)}/command/${encodeURIComponent(command.name)}">${escapeHtml(command.name)}</button>`
          )
          .join("")}</section>`
      : "";
  const lifecycleActions =
    updateDocument !== undefined && options.lifecycleActions?.length
      ? `<section class="command-row" aria-label="Lifecycle actions">${options.lifecycleActions
          .map((action) => {
            const label = action === "submit" ? "Submit" : "Cancel Document";
            return `<button class="button" formmethod="post" formaction="/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(updateDocument.name)}/${action}">${escapeHtml(label)}</button>`;
          })
          .join("")}</section>`
      : "";
  const workflowActions =
    updateDocument !== undefined && options.workflowActions?.length
      ? groupWorkflowActions(options.workflowActions)
          .map(([workflowName, actions]) => `<section class="command-row" aria-label="${escapeHtml(actions[0]?.workflowLabel ?? workflowName)} workflow actions">
            <strong>${escapeHtml(actions[0]?.workflowLabel ?? workflowName)}</strong>
            ${actions.map((workflow) =>
              `<button class="button" formmethod="post" formaction="/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(updateDocument.name)}/workflows/${encodeURIComponent(workflow.workflow)}/transition/${encodeURIComponent(workflow.action)}">${escapeHtml(workflow.label)}</button>`
            ).join("")}
          </section>`).join("")
      : "";
  const printLinks =
    updateDocument !== undefined && options.printFormats?.length
      ? `<section class="command-row" aria-label="Print formats">${options.printFormats
          .map((format) => renderPrintFormatLinks(format, updateDocument, Boolean(options.printPdfEnabled)))
          .join("")}</section>`
      : "";
  const duplicateAction =
    updateDocument !== undefined && options.canDuplicate
      ? `<button class="button" type="submit" formmethod="post" formaction="/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(updateDocument.name)}/duplicate">Duplicate</button>`
      : "";
  const amendAction =
    updateDocument?.docstatus === "cancelled" && options.canAmend
      ? `<button class="button" type="submit" formmethod="post" formaction="/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(updateDocument.name)}/amend">Amend</button>`
      : "";
  const cancelAction = `<a class="button" href="/desk/${encodeURIComponent(doctype.name)}">Cancel</a>`;
  const saveAction = canSave
    ? `<button class="button primary" type="submit">${options.mode === "create" ? "Create" : "Save"}</button>`
    : "";
  const formActions = `${cancelAction}${saveAction}${duplicateAction}${amendAction}`;
  const versionField = options.document
    ? `<input type="hidden" name="expectedVersion" value="${String(options.document.version)}">`
    : "";
  return `<form class="panel form document-form" method="post" action="${action}">
    <div class="form-action-bar">
      <div>
        <strong>${escapeHtml(title)}</strong>
        <span>${options.document ? `${escapeHtml(options.document.docstatus)} · v${String(options.document.version)}` : escapeHtml(doctype.name)}</span>
      </div>
      <div class="form-action-buttons">${formActions}</div>
    </div>
    <div class="form-head">
      <h2>${escapeHtml(title)}</h2>
      ${options.document ? `<p><span class="status-pill">${escapeHtml(options.document.docstatus)}</span> <span>v${String(options.document.version)}</span></p>` : `<p>${escapeHtml(doctype.name)}</p>`}
    </div>
    ${versionField}
    ${options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : ""}
    ${sections}
    <div class="actions">
      ${formActions}
    </div>
    ${commands}
    ${workflowActions}
    ${lifecycleActions}
    ${printLinks}
  </form>
  ${renderClientScripts(
    doctype.name,
    "form",
    options.clientScripts ?? [],
    options.document?.name,
    options.document?.tenantId,
    options.realtimeRoute,
    options.document
  )}`;
}

function renderPrintFormatLinks(format: PrintFormatDefinition, document: DocumentSnapshot, pdfEnabled: boolean): string {
  const baseHref = `/desk/print/${encodeURIComponent(format.name)}/${encodeURIComponent(document.name)}`;
  const label = format.label ?? format.name;
  const pdfLink = pdfEnabled ? `<a class="button" href="${baseHref}/pdf">${escapeHtml(label)} PDF</a>` : "";
  return `<a class="button" href="${baseHref}">${escapeHtml(label)}</a>${pdfLink}`;
}

export function renderDocumentTimeline(
  timeline: DocumentTimeline,
  options: {
    readonly allowComment?: boolean;
    readonly allowAssign?: boolean;
    readonly allowTag?: boolean;
    readonly allowFollow?: boolean;
    readonly allowShare?: boolean;
    readonly actorId?: string;
    readonly assignments?: DocumentAssignments;
    readonly tags?: DocumentTags;
    readonly followers?: DocumentFollowers;
    readonly shares?: DocumentSharePanelState;
  } = {}
): string {
  const rows = timeline.entries
    .map(
      (entry) => `<tr>
        ${renderTableCell("#", String(entry.sequence))}
        ${renderTableCell("Event", `<strong>${escapeHtml(entry.summary)}</strong><small>${escapeHtml(entry.type)}</small>${renderTimelineChanges(entry.changes)}`)}
        ${renderTableCell("Actor", escapeHtml(entry.actorId))}
        ${renderTableCell("Occurred", escapeHtml(entry.occurredAt))}
      </tr>`
    )
    .join("");
  const commentForm = options.allowComment ? renderCommentForm(timeline) : "";
  const assignmentPanel = options.assignments
    ? renderAssignmentPanel(timeline, options.assignments, { allowAssign: options.allowAssign ?? false })
    : "";
  const tagPanel = options.tags ? renderTagPanel(timeline, options.tags, { allowTag: options.allowTag ?? false }) : "";
  const followerPanel = options.followers
    ? renderFollowerPanel(timeline, options.followers, {
        allowFollow: options.allowFollow ?? false,
        ...(options.actorId !== undefined ? { actorId: options.actorId } : {})
      })
    : "";
  const sharePanel = options.shares
    ? renderSharePanel(timeline, options.shares, { allowShare: options.allowShare ?? false })
    : "";
  return `<section class="panel timeline" aria-labelledby="document-timeline">
    <div class="timeline-head">
      <h2 id="document-timeline">Timeline</h2>
      <p>v${String(timeline.version)} · ${escapeHtml(timeline.docstatus)}</p>
    </div>
    ${tagPanel}
    ${followerPanel}
    ${sharePanel}
    ${assignmentPanel}
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>#</th><th>Event</th><th>Actor</th><th>Occurred</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="empty">No events yet.</td></tr>`}</tbody>
      </table>
    </div>
    ${commentForm}
  </section>`;
}

function renderTimelineChanges(changes: DocumentTimeline["entries"][number]["changes"]): string {
  if (changes.length === 0) {
    return "";
  }
  return `<ul class="timeline-changes">${changes.map(renderTimelineChange).join("")}</ul>`;
}

function renderTimelineChange(change: DocumentTimeline["entries"][number]["changes"][number]): string {
  return `<li>
    <span>${escapeHtml(change.field)}</span>
    <span>${escapeHtml(formatValue(change.oldValue))}</span>
    <span aria-hidden="true">&rarr;</span>
    <span>${escapeHtml(formatValue(change.newValue))}</span>
  </li>`;
}

function renderSharePanel(
  timeline: DocumentTimeline,
  shares: DocumentSharePanelState,
  options: { readonly allowShare?: boolean }
): string {
  const shareRows = shares.grants
    .map(
      (grant) => `<li>
        <span>${escapeHtml(grant.userId)}</span>
        <small>${grant.permissions.map((permission) => escapeHtml(permission)).join(", ")}</small>
        ${options.allowShare ? renderUnshareForm(timeline, grant.userId) : ""}
      </li>`
    )
    .join("");
  const shareForm = options.allowShare ? renderShareForm(timeline, shares.delegablePermissions) : "";
  return `<div class="timeline-shares">
    <h3 id="document-shares">Shares</h3>
    <ul class="share-list">${shareRows || `<li class="empty">No shares.</li>`}</ul>
    ${shareForm}
  </div>`;
}

function renderShareForm(
  timeline: DocumentTimeline,
  delegablePermissions: readonly DocumentSharePermission[]
): string {
  const action = `/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/shares`;
  const choices = delegablePermissions.map(renderSharePermissionChoice).join("");
  return `<form class="timeline-share-form" method="post">
    <input type="hidden" name="expectedVersion" value="${String(timeline.version)}">
    <label class="field" for="timeline-share-user"><span>User</span><input id="timeline-share-user" name="user" type="text"></label>
    <fieldset class="choice-grid">
      <legend>Permissions</legend>
      ${choices}
    </fieldset>
    <button class="button primary" type="submit" formaction="${action}">Share</button>
  </form>`;
}

function renderSharePermissionChoice(permission: DocumentSharePermission): string {
  const checked = permission === "read" ? " checked" : "";
  return `<label class="choice"><input type="checkbox" name="permission" value="${permission}"${checked}> <span>${sharePermissionLabel(permission)}</span></label>`;
}

function sharePermissionLabel(permission: DocumentSharePermission): string {
  switch (permission) {
    case "read":
      return "Read";
    case "update":
      return "Update";
    case "share":
      return "Share";
  }
}

function renderUnshareForm(timeline: DocumentTimeline, userId: string): string {
  const action = `/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/shares/${encodeURIComponent(userId)}/remove`;
  return `<form class="inline-action" method="post">
    <input type="hidden" name="expectedVersion" value="${String(timeline.version)}">
    <button class="button" type="submit" formaction="${action}">Revoke</button>
  </form>`;
}

function renderAssignmentPanel(
  timeline: DocumentTimeline,
  assignments: DocumentAssignments,
  options: { readonly allowAssign?: boolean }
): string {
  const assigneeRows = assignments.assignees
    .map(
      (assignee) => `<li>
        <span>${escapeHtml(assignee)}</span>
        ${options.allowAssign ? renderUnassignForm(timeline, assignee) : ""}
      </li>`
    )
    .join("");
  const assignmentForm = options.allowAssign ? renderAssignmentForm(timeline) : "";
  return `<div class="timeline-assignments">
    <h3 id="document-assignments">Assignments</h3>
    <ul class="assignment-list">${assigneeRows || `<li class="empty">No assignees.</li>`}</ul>
    ${assignmentForm}
  </div>`;
}

function renderTagPanel(
  timeline: DocumentTimeline,
  tags: DocumentTags,
  options: { readonly allowTag?: boolean }
): string {
  const tagRows = tags.tags
    .map(
      (tag) => `<li>
        <span>${escapeHtml(tag)}</span>
        ${options.allowTag ? renderUntagForm(timeline, tag) : ""}
      </li>`
    )
    .join("");
  const tagForm = options.allowTag ? renderTagForm(timeline) : "";
  return `<div class="timeline-tags">
    <h3 id="document-tags">Tags</h3>
    <ul class="tag-list">${tagRows || `<li class="empty">No tags.</li>`}</ul>
    ${tagForm}
  </div>`;
}

function renderTagForm(timeline: DocumentTimeline): string {
  const action = `/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/tags`;
  return `<form class="timeline-tag-form" method="post">
    <input type="hidden" name="expectedVersion" value="${String(timeline.version)}">
    <label class="field" for="timeline-tag"><span>Tag</span><input id="timeline-tag" name="tag" type="text"></label>
    <button class="button primary" type="submit" formaction="${action}">Add tag</button>
  </form>`;
}

function renderFollowerPanel(
  timeline: DocumentTimeline,
  followers: DocumentFollowers,
  options: { readonly actorId?: string; readonly allowFollow?: boolean }
): string {
  const followerRows = followers.followers
    .map(
      (followerId) => `<li>
        <span>${escapeHtml(followerId)}</span>
        ${options.allowFollow && followerId === options.actorId ? renderUnfollowForm(timeline, followerId) : ""}
      </li>`
    )
    .join("");
  const isFollowing = options.actorId !== undefined && followers.followers.includes(options.actorId);
  const followForm = options.allowFollow && options.actorId && !isFollowing ? renderFollowForm(timeline) : "";
  return `<div class="timeline-followers">
    <h3 id="document-followers">Followers</h3>
    <ul class="follower-list">${followerRows || `<li class="empty">No followers.</li>`}</ul>
    ${followForm}
  </div>`;
}

function renderFollowForm(timeline: DocumentTimeline): string {
  const action = `/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/followers`;
  return `<form class="timeline-follower-form" method="post">
    <input type="hidden" name="expectedVersion" value="${String(timeline.version)}">
    <button class="button primary" type="submit" formaction="${action}">Follow</button>
  </form>`;
}

function renderUnfollowForm(timeline: DocumentTimeline, followerId: string): string {
  const action = `/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/followers/${encodeURIComponent(followerId)}/remove`;
  return `<form class="inline-action" method="post">
    <input type="hidden" name="expectedVersion" value="${String(timeline.version)}">
    <button class="button" type="submit" formaction="${action}">Unfollow</button>
  </form>`;
}

function renderUntagForm(timeline: DocumentTimeline, tag: string): string {
  const action = `/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/tags/${encodeURIComponent(tag)}/remove`;
  return `<form class="inline-action" method="post">
    <input type="hidden" name="expectedVersion" value="${String(timeline.version)}">
    <button class="button" type="submit" formaction="${action}">Remove</button>
  </form>`;
}

function renderAssignmentForm(timeline: DocumentTimeline): string {
  const action = `/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/assignments`;
  return `<form class="timeline-assignment-form" method="post">
    <input type="hidden" name="expectedVersion" value="${String(timeline.version)}">
    <label class="field" for="timeline-assignee"><span>Assign</span><input id="timeline-assignee" name="assignee" type="text"></label>
    <button class="button primary" type="submit" formaction="${action}">Assign</button>
  </form>`;
}

function renderUnassignForm(timeline: DocumentTimeline, assignee: string): string {
  const action = `/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/assignments/${encodeURIComponent(assignee)}/remove`;
  return `<form class="inline-action" method="post">
    <input type="hidden" name="expectedVersion" value="${String(timeline.version)}">
    <button class="button" type="submit" formaction="${action}">Unassign</button>
  </form>`;
}

function renderCommentForm(timeline: DocumentTimeline): string {
  const action = `/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/comments`;
  return `<form class="timeline-comment" method="post">
    <input type="hidden" name="expectedVersion" value="${String(timeline.version)}">
    <label class="field" for="timeline-comment"><span>Comment</span><textarea id="timeline-comment" name="comment_text"></textarea></label>
    <div class="actions">
      <button class="button primary" type="submit" formaction="${action}">Add comment</button>
    </div>
  </form>`;
}

function renderFormSection(
  section: ResolvedFormSection,
  document: DocumentSnapshot | undefined,
  linkOptions: FormLinkOptions,
  tableDefinitions: FormTableDefinitions,
  workflowInitialStates: ReadonlyMap<string, string>
): string {
  const fields = section.fields
    .map((field) =>
      renderField(
        field,
        document?.data[field.name] ?? workflowInitialStates.get(field.name),
        linkOptions[field.name] ?? [],
        tableDefinitions[field.name],
        linkOptions,
        tableDefinitions,
        workflowInitialStates.has(field.name)
      )
    )
    .join("");
  return `<section class="form-section">
    ${section.heading ? `<h3>${escapeHtml(section.heading)}</h3>` : ""}
    <div class="fields cols-${section.columns}">${fields}</div>
  </section>`;
}

function renderField(
  field: FieldDefinition,
  value: JsonValue | undefined,
  linkOptions: readonly LinkOption[],
  tableDefinition: DocTypeDefinition | undefined,
  allLinkOptions: FormLinkOptions,
  tableDefinitions: FormTableDefinitions,
  protectedWorkflowState = false
): string {
  const id = `field-${slug(field.name)}`;
  const label = escapeHtml(field.label ?? field.name);
  const required = field.required ? " required" : "";
  const nonEditable = field.readOnly === true || protectedWorkflowState;
  const readonly = nonEditable && field.type !== "link" && field.type !== "select" && field.type !== "boolean"
    ? " readonly"
    : "";
  const disabled = nonEditable && (field.type === "link" || field.type === "select" || field.type === "boolean")
    ? " disabled"
    : "";
  const hiddenDependsOn = field.hiddenDependsOn === undefined
    ? ""
    : ` data-cf-frappe-hidden-depends-on="${escapeHtml(JSON.stringify(field.hiddenDependsOn))}"`;
  const placeholder = renderFieldPlaceholder(field);
  const nameAttribute = nonEditable ? "" : ` name="${escapeHtml(field.name)}"`;
  const protectedAttribute = protectedWorkflowState ? ' data-cf-frappe-workflow-state="protected"' : "";
  const common = `id="${id}"${nameAttribute} data-cf-frappe-field-type="${field.type}"${protectedAttribute}${hiddenDependsOn}${required}${readonly}${disabled}`;
  const formatted = formatFormValue(value);
  const help = renderFieldHelp(field);
  if (field.type === "table") {
    return renderTableField(field, value, tableDefinition, allLinkOptions, tableDefinitions, field.name, field.name, nonEditable);
  }
  if (protectedWorkflowState) {
    return `<label class="field" for="${id}"><span>${label}${field.required ? " *" : ""}</span><input type="text" ${common} value="${escapeHtml(formatted)}"${placeholder}>${help}</label>`;
  }
  if (field.type === "link") {
    const options = renderLinkOptions(linkOptions, formatted);
    return `<label class="field" for="${id}"><span>${label}${field.required ? " *" : ""}</span><select ${common}>${options}</select>${help}</label>`;
  }
  if (field.type === "select") {
    const options = (field.options ?? [])
      .map((option) => `<option value="${escapeHtml(option)}"${option === formatted ? " selected" : ""}>${escapeHtml(option)}</option>`)
      .join("");
    return `<label class="field" for="${id}"><span>${label}${field.required ? " *" : ""}</span><select ${common}>${options}</select>${help}</label>`;
  }
  if (field.type === "longText" || field.type === "json") {
    return `<label class="field" for="${id}"><span>${label}${field.required ? " *" : ""}</span><textarea ${common}${placeholder}>${escapeHtml(formatted)}</textarea>${help}</label>`;
  }
  const type = inputType(field);
  const checked = field.type === "boolean" && value === true ? " checked" : "";
  if (field.type === "boolean") {
    return `<label class="field checkbox-field" for="${id}"><input type="${type}" ${common} value="true"${checked}${placeholder}><span>${label}${field.required ? " *" : ""}</span>${help}</label>`;
  }
  return `<label class="field" for="${id}"><span>${label}${field.required ? " *" : ""}</span><input type="${type}" ${common} value="${escapeHtml(formatted)}"${checked}${placeholder}>${help}</label>`;
}

function renderTableField(
  field: FieldDefinition,
  value: JsonValue | undefined,
  child: DocTypeDefinition | undefined,
  linkOptions: FormLinkOptions,
  tableDefinitions: FormTableDefinitions,
  definitionPath: string,
  inputPath: string,
  nonEditable = false
): string {
  const label = escapeHtml(field.label ?? field.name);
  const help = renderFieldHelp(field);
  if (!child) {
    const nameAttribute = nonEditable ? "" : ` name="${escapeHtml(field.name)}"`;
    const readonly = nonEditable ? " readonly" : "";
    return `<label class="field" for="field-${slug(field.name)}"><span>${label}${field.required ? " *" : ""}</span><textarea id="field-${slug(field.name)}"${nameAttribute} data-cf-frappe-field-type="${field.type}"${readonly}>${escapeHtml(formatFormValue(value))}</textarea>${help}</label>`;
  }
  const rows = Array.isArray(value) ? value.filter(isJsonObject) : [];
  const renderRows = rows.length > 0 ? rows : [{}];
  const childFields = child.fields.filter((childField) => !childField.hidden && !childField.readOnly);
  const headers = childFields
    .map((childField) => `<th>${escapeHtml(childField.label ?? childField.name)}</th>`)
    .join("");
  const body = renderRows
    .map((row, rowIndex) =>
      renderTableRow({
        definitionPath,
        inputPath,
        rowIndex,
        ...(rows.length > 0 ? { originIndex: rowIndex } : {}),
        row,
        childFields,
        linkOptions,
        tableDefinitions
      })
    )
    .join("");
  const nextRow = rows.length > 0
    ? renderBlankTableRow(definitionPath, inputPath, rows.length, childFields, linkOptions, tableDefinitions)
    : "";
  return `<fieldset class="field table-field"${nonEditable ? " disabled" : ""}>
    <legend>${label}${field.required ? " *" : ""}</legend>
    <div class="table-wrap">
      <table>
        <thead><tr>${headers}</tr></thead>
        <tbody>${body}${nextRow}</tbody>
      </table>
    </div>
    ${help}
  </fieldset>`;
}

function renderFieldHelp(field: FieldDefinition): string {
  return [
    field.readOnly ? "Read only" : "",
    field.description ?? ""
  ].filter((item) => item.length > 0).map((item) => `<small>${escapeHtml(item)}</small>`).join("");
}

function groupWorkflowActions(
  actions: readonly FormWorkflowAction[]
): readonly (readonly [string, readonly FormWorkflowAction[]])[] {
  const grouped = new Map<string, FormWorkflowAction[]>();
  for (const action of actions) {
    const group = grouped.get(action.workflow) ?? [];
    group.push(action);
    grouped.set(action.workflow, group);
  }
  return [...grouped.entries()];
}

function renderTableRow(options: {
  readonly definitionPath: string;
  readonly inputPath: string;
  readonly rowIndex: number;
  readonly originIndex?: number;
  readonly row: Record<string, JsonValue>;
  readonly childFields: readonly FieldDefinition[];
  readonly linkOptions: FormLinkOptions;
  readonly tableDefinitions: FormTableDefinitions;
}): string {
  const marker =
    options.originIndex === undefined ? "" : renderTableRowOrigin(options.inputPath, options.rowIndex, options.originIndex);
  if (options.childFields.length === 0) {
    return `<tr><td>${marker}</td></tr>`;
  }
  return `<tr>${options.childFields
    .map((childField, cellIndex) => {
      const input = renderTableCellInput(
        options.definitionPath,
        options.inputPath,
        options.rowIndex,
        childField,
        options.row[childField.name],
        options.linkOptions[`${options.definitionPath}.${childField.name}`] ?? [],
        options.linkOptions,
        options.tableDefinitions
      );
      return `<td>${cellIndex === 0 ? marker : ""}${input}</td>`;
    })
    .join("")}</tr>`;
}

function renderTableRowOrigin(tableField: string, rowIndex: number, originIndex: number): string {
  const name = `${tableField}[${rowIndex}].${CHILD_TABLE_ROW_INDEX_FIELD}`;
  return `<input type="hidden" name="${escapeHtml(name)}" value="${String(originIndex)}">`;
}

function renderBlankTableRow(
  definitionPath: string,
  inputPath: string,
  rowIndex: number,
  childFields: readonly FieldDefinition[],
  linkOptions: FormLinkOptions,
  tableDefinitions: FormTableDefinitions
): string {
  return `<tr>${childFields
    .map((childField) =>
      `<td>${renderTableCellInput(definitionPath, inputPath, rowIndex, childField, undefined, linkOptions[`${definitionPath}.${childField.name}`] ?? [], linkOptions, tableDefinitions)}</td>`
    )
    .join("")}</tr>`;
}

function renderTableCellInput(
  definitionPath: string,
  inputPath: string,
  rowIndex: number,
  field: FieldDefinition,
  value: JsonValue | undefined,
  linkOptions: readonly LinkOption[],
  allLinkOptions: FormLinkOptions,
  tableDefinitions: FormTableDefinitions
): string {
  const fieldDefinitionPath = `${definitionPath}.${field.name}`;
  const name = `${inputPath}[${rowIndex}].${field.name}`;
  if (field.type === "table") {
    const child = tableDefinitions[fieldDefinitionPath];
    return renderTableField(field, value, child, allLinkOptions, tableDefinitions, fieldDefinitionPath, name);
  }
  const id = `field-${slug(name)}`;
  const placeholder = renderFieldPlaceholder(field);
  const common = `id="${id}" name="${escapeHtml(name)}" data-cf-frappe-field-type="${field.type}"`;
  const formatted = formatFormValue(value);
  if (field.type === "link") {
    return `<select ${common}>${renderLinkOptions(linkOptions, formatted)}</select>`;
  }
  if (field.type === "select") {
    const options = (field.options ?? [])
      .map((option) => `<option value="${escapeHtml(option)}"${option === formatted ? " selected" : ""}>${escapeHtml(option)}</option>`)
      .join("");
    return `<select ${common}>${options}</select>`;
  }
  if (field.type === "longText" || field.type === "json") {
    return `<textarea ${common}${placeholder}>${escapeHtml(formatted)}</textarea>`;
  }
  const type = inputType(field);
  const checked = field.type === "boolean" && value === true ? " checked" : "";
  return `<input type="${type}" ${common} value="${escapeHtml(formatted)}"${checked}${placeholder}>`;
}

function renderFieldPlaceholder(field: FieldDefinition): string {
  if (
    field.placeholder === undefined ||
    field.type === "boolean" ||
    field.type === "link" ||
    field.type === "select" ||
    field.type === "table"
  ) {
    return "";
  }
  return ` placeholder="${escapeHtml(field.placeholder)}"`;
}

function renderLinkOptions(options: readonly LinkOption[], currentValue: string): string {
  const rendered = [`<option value=""></option>`];
  const seen = new Set<string>();
  if (currentValue && !options.some((option) => option.value === currentValue)) {
    rendered.push(`<option value="${escapeHtml(currentValue)}" selected>${escapeHtml(currentValue)}</option>`);
    seen.add(currentValue);
  }
  for (const option of options) {
    if (seen.has(option.value)) {
      continue;
    }
    seen.add(option.value);
    rendered.push(
      `<option value="${escapeHtml(option.value)}"${option.value === currentValue ? " selected" : ""}>${escapeHtml(option.label)}</option>`
    );
  }
  return rendered.join("");
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
