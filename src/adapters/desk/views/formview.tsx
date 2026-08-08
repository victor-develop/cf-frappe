import type { FC } from "hono/jsx";
import { CHILD_TABLE_ROW_INDEX_FIELD, type DocTypeDefinition, type DocumentSnapshot, type FieldDefinition, type JsonValue, type LinkOption, type ResolvedFormSection, type ResolvedFormView } from "../../../core/types.js";
import { type ClientScriptDefinition } from "../../../core/client-script.js";
import { type DocumentAssignments, type DocumentFollowers, type DocumentTags, type DocumentTimeline } from "../../../application/document-history-service.js";
import { type DocumentSharePermission, type DocumentShareState } from "../../../core/document-shares.js";
import { type PrintFormatDefinition } from "../../../core/print-format.js";
import { type RelatedDocTypeResource, type RelatedResourcesView } from "../../../application/related-resource-service.js";
import { formatFormValue, formatValue, inputType, labelFor, renderClientScripts, slug } from "./shared.js";
import { ActionBar, Notice, SelectOptions, UnsafeRawHtml, renderFragment, type SelectOptionSpec } from "../ui/primitives.js";

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
  return renderFragment(
    <RelatedResources resources={resources} printPdfEnabled={Boolean(options.printPdfEnabled)} />
  );
}

const RelatedResources: FC<{
  resources: RelatedResourcesView;
  printPdfEnabled: boolean;
}> = ({ resources, printPdfEnabled }) => {
  const count = resources.doctypes.length + resources.printFormats.length;
  return (
    <section class="panel related-resources" aria-label="Related resources">
      <div class="form-head">
        <h2>Related</h2>
        <p>{`${String(count)} ${count === 1 ? "resource" : "resources"}`}</p>
      </div>
      <div class="related-resource-groups">
        {resources.doctypes.length === 0 ? null : (
          <section class="related-resource-group">
            <h3>Linked DocTypes</h3>
            <ul class="related-resource-list">
              {resources.doctypes.map((resource) => (
                <li>
                  <a class="related-resource-link" href={relatedDocTypeHref(resource, resources.documentName)}>
                    <span>
                      <strong>{resource.doctypeLabel}</strong>
                      <small>{`${resource.direction === "incoming" ? "Incoming" : "Outgoing"} via ${resource.fieldLabel}`}</small>
                    </span>
                    <span class="related-resource-kind">DocType</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
        {resources.printFormats.length === 0 ? null : (
          <section class="related-resource-group">
            <h3>Print Formats</h3>
            <ul class="related-resource-list">
              {resources.printFormats.map((format) => {
                const href = resources.documentName === undefined
                  ? `/desk/printing/formats/${encodeURIComponent(format.name)}`
                  : `/desk/print/${encodeURIComponent(format.name)}/${encodeURIComponent(resources.documentName)}`;
                return (
                  <li>
                    <div class="related-resource-link related-resource-print">
                      <a href={href}>
                        <strong>{format.label}</strong>
                        {format.description === undefined ? null : <small>{format.description}</small>}
                      </a>
                      <span class="related-resource-actions">
                        <span class="related-resource-kind">Print Format</span>
                        {resources.documentName !== undefined && printPdfEnabled ? (
                          <a class="button" href={`${href}/pdf`}>PDF</a>
                        ) : null}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </section>
  );
};

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

type FormViewOptions = {
  readonly mode: "create" | "update";
  readonly document?: DocumentSnapshot | undefined;
  readonly error?: string | undefined;
  readonly linkOptions?: FormLinkOptions | undefined;
  readonly tableDefinitions?: FormTableDefinitions | undefined;
  readonly lifecycleActions?: readonly FormLifecycleAction[] | undefined;
  readonly workflowActions?: readonly FormWorkflowAction[] | undefined;
  readonly domainCommands?: readonly FormDomainCommandAction[] | undefined;
  readonly printFormats?: readonly PrintFormatDefinition[] | undefined;
  readonly printPdfEnabled?: boolean | undefined;
  readonly clientScripts?: readonly ClientScriptDefinition[] | undefined;
  readonly realtimeRoute?: string | undefined;
  readonly canUpdate?: boolean | undefined;
  readonly canDuplicate?: boolean | undefined;
  readonly canAmend?: boolean | undefined;
};

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
  return renderFragment(<FormView doctype={doctype} formView={formView} options={options} />);
}

const FormView: FC<{
  doctype: DocTypeDefinition;
  formView: ResolvedFormView;
  options: FormViewOptions;
}> = ({ doctype, formView, options }) => {
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
  /** Rendered twice (action bar + bottom `.actions`), so built per call. */
  const formActions = () => (
    <>
      <a class="button" href={`/desk/${encodeURIComponent(doctype.name)}`}>Cancel</a>
      {canSave ? (
        <button class="button primary" type="submit">{options.mode === "create" ? "Create" : "Save"}</button>
      ) : null}
      {updateDocument !== undefined && options.canDuplicate ? (
        <button class="button" type="submit" formmethod="post" formaction={`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(updateDocument.name)}/duplicate`}>Duplicate</button>
      ) : null}
      {updateDocument?.docstatus === "cancelled" && options.canAmend ? (
        <button class="button" type="submit" formmethod="post" formaction={`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(updateDocument.name)}/amend`}>Amend</button>
      ) : null}
    </>
  );
  return (
    <>
      <form class="panel form document-form" method="post" action={action}>
        <div class="form-action-bar">
          <div>
            <strong>{title}</strong>
            <span>{options.document ? `${options.document.docstatus} · v${String(options.document.version)}` : doctype.name}</span>
          </div>
          <div class="form-action-buttons">{formActions()}</div>
        </div>
        <div class="form-head">
          <h2>{title}</h2>
          {options.document ? (
            <p><span class="status-pill">{options.document.docstatus}</span> <span>v{String(options.document.version)}</span></p>
          ) : (
            <p>{doctype.name}</p>
          )}
        </div>
        {options.document ? <input type="hidden" name="expectedVersion" value={String(options.document.version)} /> : null}
        {options.error ? <Notice tone="error">{options.error}</Notice> : null}
        {formView.sections.map((section) => (
          <FormSection
            section={section}
            document={options.document}
            linkOptions={options.linkOptions ?? {}}
            tableDefinitions={options.tableDefinitions ?? {}}
            workflowInitialStates={workflowInitialStates}
          />
        ))}
        <ActionBar>{formActions()}</ActionBar>
        {updateDocument?.docstatus === "draft" && domainCommands.length ? (
          <section class="command-row" aria-label="Commands">
            {domainCommands.map((command) => (
              <button class="button" formmethod="post" formaction={`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(updateDocument.name)}/command/${encodeURIComponent(command.name)}`}>{command.name}</button>
            ))}
          </section>
        ) : null}
        {updateDocument !== undefined && options.workflowActions?.length
          ? groupWorkflowActions(options.workflowActions).map(([workflowName, actions]) => (
              <section class="command-row" aria-label={`${actions[0]?.workflowLabel ?? workflowName} workflow actions`}>
                <strong>{actions[0]?.workflowLabel ?? workflowName}</strong>
                {actions.map((workflow) => (
                  <button class="button" formmethod="post" formaction={`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(updateDocument.name)}/workflows/${encodeURIComponent(workflow.workflow)}/transition/${encodeURIComponent(workflow.action)}`}>{workflow.label}</button>
                ))}
              </section>
            ))
          : null}
        {updateDocument !== undefined && options.lifecycleActions?.length ? (
          <section class="command-row" aria-label="Lifecycle actions">
            {options.lifecycleActions.map((lifecycleAction) => (
              <button class="button" formmethod="post" formaction={`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(updateDocument.name)}/${lifecycleAction}`}>{lifecycleAction === "submit" ? "Submit" : "Cancel Document"}</button>
            ))}
          </section>
        ) : null}
        {updateDocument !== undefined && options.printFormats?.length ? (
          <section class="command-row" aria-label="Print formats">
            {options.printFormats.map((format) => (
              <PrintFormatLinks format={format} document={updateDocument} pdfEnabled={Boolean(options.printPdfEnabled)} />
            ))}
          </section>
        ) : null}
      </form>
      <UnsafeRawHtml
        reason="output of shared renderClientScripts; builds <script> tags and escapes every attribute value internally via escapeHtml"
        html={renderClientScripts(
          doctype.name,
          "form",
          options.clientScripts ?? [],
          options.document?.name,
          options.document?.tenantId,
          options.realtimeRoute,
          options.document
        )}
      />
    </>
  );
};

const PrintFormatLinks: FC<{
  format: PrintFormatDefinition;
  document: DocumentSnapshot;
  pdfEnabled: boolean;
}> = ({ format, document, pdfEnabled }) => {
  const baseHref = `/desk/print/${encodeURIComponent(format.name)}/${encodeURIComponent(document.name)}`;
  const label = format.label ?? format.name;
  return (
    <>
      <a class="button" href={baseHref}>{label}</a>
      {pdfEnabled ? <a class="button" href={`${baseHref}/pdf`}>{`${label} PDF`}</a> : null}
    </>
  );
};

type DocumentTimelineOptions = {
  readonly allowComment?: boolean | undefined;
  readonly allowAssign?: boolean | undefined;
  readonly allowTag?: boolean | undefined;
  readonly allowFollow?: boolean | undefined;
  readonly allowShare?: boolean | undefined;
  readonly actorId?: string | undefined;
  readonly assignments?: DocumentAssignments | undefined;
  readonly tags?: DocumentTags | undefined;
  readonly followers?: DocumentFollowers | undefined;
  readonly shares?: DocumentSharePanelState | undefined;
};

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
  return renderFragment(<DocumentTimelineView timeline={timeline} options={options} />);
}

const DocumentTimelineView: FC<{
  timeline: DocumentTimeline;
  options: DocumentTimelineOptions;
}> = ({ timeline, options }) => (
  <section class="panel timeline" aria-labelledby="document-timeline">
    <div class="timeline-head">
      <h2 id="document-timeline">Timeline</h2>
      <p>{`v${String(timeline.version)} · ${timeline.docstatus}`}</p>
    </div>
    {options.tags ? <TagPanel timeline={timeline} tags={options.tags} allowTag={options.allowTag ?? false} /> : null}
    {options.followers ? (
      <FollowerPanel
        timeline={timeline}
        followers={options.followers}
        allowFollow={options.allowFollow ?? false}
        actorId={options.actorId}
      />
    ) : null}
    {options.shares ? (
      <SharePanel timeline={timeline} shares={options.shares} allowShare={options.allowShare ?? false} />
    ) : null}
    {options.assignments ? (
      <AssignmentPanel timeline={timeline} assignments={options.assignments} allowAssign={options.allowAssign ?? false} />
    ) : null}
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>#</th><th>Event</th><th>Actor</th><th>Occurred</th></tr></thead>
        <tbody>
          {timeline.entries.length === 0 ? (
            <tr><td colspan={4} class="empty">No events yet.</td></tr>
          ) : (
            timeline.entries.map((entry) => (
              <tr>
                <td data-label="#">{String(entry.sequence)}</td>
                <td data-label="Event"><strong>{entry.summary}</strong><small>{entry.type}</small><TimelineChanges changes={entry.changes} /></td>
                <td data-label="Actor">{entry.actorId}</td>
                <td data-label="Occurred">{entry.occurredAt}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
    {options.allowComment ? <CommentForm timeline={timeline} /> : null}
  </section>
);

const TimelineChanges: FC<{ changes: DocumentTimeline["entries"][number]["changes"] }> = ({ changes }) => {
  if (changes.length === 0) {
    return null;
  }
  return (
    <ul class="timeline-changes">
      {changes.map((change) => (
        <li>
          <span>{change.field}</span>
          <span>{formatValue(change.oldValue)}</span>
          <span aria-hidden="true">{"→"}</span>
          <span>{formatValue(change.newValue)}</span>
        </li>
      ))}
    </ul>
  );
};

const SharePanel: FC<{
  timeline: DocumentTimeline;
  shares: DocumentSharePanelState;
  allowShare: boolean;
}> = ({ timeline, shares, allowShare }) => (
  <div class="timeline-shares">
    <h3 id="document-shares">Shares</h3>
    <ul class="share-list">
      {shares.grants.length === 0 ? (
        <li class="empty">No shares.</li>
      ) : (
        shares.grants.map((grant) => (
          <li>
            <span>{grant.userId}</span>
            <small>{grant.permissions.join(", ")}</small>
            {allowShare ? (
              <InlineActionForm
                version={timeline.version}
                action={`/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/shares/${encodeURIComponent(grant.userId)}/remove`}
                label="Revoke"
              />
            ) : null}
          </li>
        ))
      )}
    </ul>
    {allowShare ? <ShareForm timeline={timeline} delegablePermissions={shares.delegablePermissions} /> : null}
  </div>
);

const ShareForm: FC<{
  timeline: DocumentTimeline;
  delegablePermissions: readonly DocumentSharePermission[];
}> = ({ timeline, delegablePermissions }) => (
  <form class="timeline-share-form" method="post">
    <input type="hidden" name="expectedVersion" value={String(timeline.version)} />
    <label class="field" for="timeline-share-user"><span>User</span><input id="timeline-share-user" name="user" type="text" /></label>
    <fieldset class="choice-grid">
      <legend>Permissions</legend>
      {delegablePermissions.map((permission) => (
        <label class="choice"><input type="checkbox" name="permission" value={permission} checked={permission === "read" ? true : undefined} /> <span>{sharePermissionLabel(permission)}</span></label>
      ))}
    </fieldset>
    <button class="button primary" type="submit" formaction={`/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/shares`}>Share</button>
  </form>
);

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

const AssignmentPanel: FC<{
  timeline: DocumentTimeline;
  assignments: DocumentAssignments;
  allowAssign: boolean;
}> = ({ timeline, assignments, allowAssign }) => (
  <div class="timeline-assignments">
    <h3 id="document-assignments">Assignments</h3>
    <ul class="assignment-list">
      {assignments.assignees.length === 0 ? (
        <li class="empty">No assignees.</li>
      ) : (
        assignments.assignees.map((assignee) => (
          <li>
            <span>{assignee}</span>
            {allowAssign ? (
              <InlineActionForm
                version={timeline.version}
                action={`/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/assignments/${encodeURIComponent(assignee)}/remove`}
                label="Unassign"
              />
            ) : null}
          </li>
        ))
      )}
    </ul>
    {allowAssign ? (
      <form class="timeline-assignment-form" method="post">
        <input type="hidden" name="expectedVersion" value={String(timeline.version)} />
        <label class="field" for="timeline-assignee"><span>Assign</span><input id="timeline-assignee" name="assignee" type="text" /></label>
        <button class="button primary" type="submit" formaction={`/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/assignments`}>Assign</button>
      </form>
    ) : null}
  </div>
);

const TagPanel: FC<{
  timeline: DocumentTimeline;
  tags: DocumentTags;
  allowTag: boolean;
}> = ({ timeline, tags, allowTag }) => (
  <div class="timeline-tags">
    <h3 id="document-tags">Tags</h3>
    <ul class="tag-list">
      {tags.tags.length === 0 ? (
        <li class="empty">No tags.</li>
      ) : (
        tags.tags.map((tag) => (
          <li>
            <span>{tag}</span>
            {allowTag ? (
              <InlineActionForm
                version={timeline.version}
                action={`/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/tags/${encodeURIComponent(tag)}/remove`}
                label="Remove"
              />
            ) : null}
          </li>
        ))
      )}
    </ul>
    {allowTag ? (
      <form class="timeline-tag-form" method="post">
        <input type="hidden" name="expectedVersion" value={String(timeline.version)} />
        <label class="field" for="timeline-tag"><span>Tag</span><input id="timeline-tag" name="tag" type="text" /></label>
        <button class="button primary" type="submit" formaction={`/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/tags`}>Add tag</button>
      </form>
    ) : null}
  </div>
);

const FollowerPanel: FC<{
  timeline: DocumentTimeline;
  followers: DocumentFollowers;
  actorId: string | undefined;
  allowFollow: boolean;
}> = ({ timeline, followers, actorId, allowFollow }) => {
  const isFollowing = actorId !== undefined && followers.followers.includes(actorId);
  return (
    <div class="timeline-followers">
      <h3 id="document-followers">Followers</h3>
      <ul class="follower-list">
        {followers.followers.length === 0 ? (
          <li class="empty">No followers.</li>
        ) : (
          followers.followers.map((followerId) => (
            <li>
              <span>{followerId}</span>
              {allowFollow && followerId === actorId ? (
                <InlineActionForm
                  version={timeline.version}
                  action={`/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/followers/${encodeURIComponent(followerId)}/remove`}
                  label="Unfollow"
                />
              ) : null}
            </li>
          ))
        )}
      </ul>
      {allowFollow && actorId && !isFollowing ? (
        <form class="timeline-follower-form" method="post">
          <input type="hidden" name="expectedVersion" value={String(timeline.version)} />
          <button class="button primary" type="submit" formaction={`/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/followers`}>Follow</button>
        </form>
      ) : null}
    </div>
  );
};

/** Small post form (`form.inline-action`) shared by revoke/unassign/untag/unfollow rows. */
const InlineActionForm: FC<{ version: number; action: string; label: string }> = ({ version, action, label }) => (
  <form class="inline-action" method="post">
    <input type="hidden" name="expectedVersion" value={String(version)} />
    <button class="button" type="submit" formaction={action}>{label}</button>
  </form>
);

const CommentForm: FC<{ timeline: DocumentTimeline }> = ({ timeline }) => (
  <form class="timeline-comment" method="post">
    <input type="hidden" name="expectedVersion" value={String(timeline.version)} />
    <label class="field" for="timeline-comment"><span>Comment</span><textarea id="timeline-comment" name="comment_text"></textarea></label>
    <div class="actions">
      <button class="button primary" type="submit" formaction={`/desk/${encodeURIComponent(timeline.doctype)}/${encodeURIComponent(timeline.name)}/comments`}>Add comment</button>
    </div>
  </form>
);

const FormSection: FC<{
  section: ResolvedFormSection;
  document: DocumentSnapshot | undefined;
  linkOptions: FormLinkOptions;
  tableDefinitions: FormTableDefinitions;
  workflowInitialStates: ReadonlyMap<string, string>;
}> = ({ section, document, linkOptions, tableDefinitions, workflowInitialStates }) => (
  <section class="form-section">
    {section.heading ? <h3>{section.heading}</h3> : null}
    <div class={`fields cols-${section.columns}`}>
      {section.fields.map((field) => (
        <FormField
          field={field}
          value={document?.data[field.name] ?? workflowInitialStates.get(field.name)}
          linkOptions={linkOptions[field.name] ?? []}
          tableDefinition={tableDefinitions[field.name]}
          allLinkOptions={linkOptions}
          tableDefinitions={tableDefinitions}
          protectedWorkflowState={workflowInitialStates.has(field.name)}
        />
      ))}
    </div>
  </section>
);

const FormField: FC<{
  field: FieldDefinition;
  value: JsonValue | undefined;
  linkOptions: readonly LinkOption[];
  tableDefinition: DocTypeDefinition | undefined;
  allLinkOptions: FormLinkOptions;
  tableDefinitions: FormTableDefinitions;
  protectedWorkflowState: boolean;
}> = ({ field, value, linkOptions, tableDefinition, allLinkOptions, tableDefinitions, protectedWorkflowState }) => {
  const nonEditable = field.readOnly === true || protectedWorkflowState;
  if (field.type === "table") {
    return (
      <TableField
        field={field}
        value={value}
        child={tableDefinition}
        linkOptions={allLinkOptions}
        tableDefinitions={tableDefinitions}
        definitionPath={field.name}
        inputPath={field.name}
        nonEditable={nonEditable}
      />
    );
  }
  const id = `field-${slug(field.name)}`;
  const labelText = <span>{field.label ?? field.name}{field.required ? " *" : ""}</span>;
  /**
   * Shared control attributes; property order here IS the serialized
   * attribute order the desk tests assert (id, name, data-*, then flags).
   * hono/jsx renders boolean `true` as e.g. `required=""`; the desk suite's
   * flag assertions are space-prefixed substrings/regexes that accept that.
   */
  const common = {
    id,
    name: nonEditable ? undefined : field.name,
    "data-cf-frappe-field-type": field.type,
    "data-cf-frappe-workflow-state": protectedWorkflowState ? "protected" : undefined,
    "data-cf-frappe-hidden-depends-on": field.hiddenDependsOn === undefined ? undefined : JSON.stringify(field.hiddenDependsOn),
    required: field.required ? true : undefined,
    readonly: nonEditable && field.type !== "link" && field.type !== "select" && field.type !== "boolean" ? true : undefined,
    disabled: nonEditable && (field.type === "link" || field.type === "select" || field.type === "boolean") ? true : undefined
  };
  const placeholder = fieldPlaceholder(field);
  const formatted = formatFormValue(value);
  const help = <FieldHelp field={field} />;
  if (protectedWorkflowState) {
    return (
      <label class="field" for={id}>{labelText}<input type="text" {...common} value={formatted} placeholder={placeholder} />{help}</label>
    );
  }
  if (field.type === "link") {
    return (
      <label class="field" for={id}>{labelText}<select {...common}><SelectOptions options={linkOptionSpecs(linkOptions, formatted)} /></select>{help}</label>
    );
  }
  if (field.type === "select") {
    return (
      <label class="field" for={id}>{labelText}<select {...common}><SelectOptions options={selectOptionSpecs(field, formatted)} /></select>{help}</label>
    );
  }
  if (field.type === "longText" || field.type === "json") {
    return (
      <label class="field" for={id}>{labelText}<textarea {...common} placeholder={placeholder}>{formatted}</textarea>{help}</label>
    );
  }
  if (field.type === "boolean") {
    return (
      <label class="field checkbox-field" for={id}><input type={inputType(field)} {...common} value="true" checked={value === true ? true : undefined} placeholder={placeholder} />{labelText}{help}</label>
    );
  }
  return (
    <label class="field" for={id}>{labelText}<input type={inputType(field)} {...common} value={formatted} placeholder={placeholder} />{help}</label>
  );
};

const TableField: FC<{
  field: FieldDefinition;
  value: JsonValue | undefined;
  child: DocTypeDefinition | undefined;
  linkOptions: FormLinkOptions;
  tableDefinitions: FormTableDefinitions;
  definitionPath: string;
  inputPath: string;
  nonEditable?: boolean | undefined;
}> = ({ field, value, child, linkOptions, tableDefinitions, definitionPath, inputPath, nonEditable = false }) => {
  const labelText = <>{field.label ?? field.name}{field.required ? " *" : ""}</>;
  const help = <FieldHelp field={field} />;
  if (!child) {
    const id = `field-${slug(field.name)}`;
    return (
      <label class="field" for={id}><span>{labelText}</span><textarea id={id} name={nonEditable ? undefined : field.name} data-cf-frappe-field-type={field.type} readonly={nonEditable ? true : undefined}>{formatFormValue(value)}</textarea>{help}</label>
    );
  }
  const rows = Array.isArray(value) ? value.filter(isJsonObject) : [];
  const renderRows = rows.length > 0 ? rows : [{}];
  const childFields = child.fields.filter((childField) => !childField.hidden && !childField.readOnly);
  return (
    <fieldset class="field table-field" disabled={nonEditable ? true : undefined}>
      <legend>{labelText}</legend>
      <div class="table-wrap">
        <table>
          <thead><tr>{childFields.map((childField) => <th>{childField.label ?? childField.name}</th>)}</tr></thead>
          <tbody>
            {renderRows.map((row, rowIndex) => (
              <TableRow
                definitionPath={definitionPath}
                inputPath={inputPath}
                rowIndex={rowIndex}
                originIndex={rows.length > 0 ? rowIndex : undefined}
                row={row}
                childFields={childFields}
                linkOptions={linkOptions}
                tableDefinitions={tableDefinitions}
              />
            ))}
            {rows.length > 0 ? (
              <TableRow
                definitionPath={definitionPath}
                inputPath={inputPath}
                rowIndex={rows.length}
                originIndex={undefined}
                row={{}}
                childFields={childFields}
                linkOptions={linkOptions}
                tableDefinitions={tableDefinitions}
                blank={true}
              />
            ) : null}
          </tbody>
        </table>
      </div>
      {help}
    </fieldset>
  );
};

const FieldHelp: FC<{ field: FieldDefinition }> = ({ field }) => (
  <>
    {[field.readOnly ? "Read only" : "", field.description ?? ""]
      .filter((item) => item.length > 0)
      .map((item) => <small>{item}</small>)}
  </>
);

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

const TableRow: FC<{
  definitionPath: string;
  inputPath: string;
  rowIndex: number;
  originIndex: number | undefined;
  row: Record<string, JsonValue>;
  childFields: readonly FieldDefinition[];
  linkOptions: FormLinkOptions;
  tableDefinitions: FormTableDefinitions;
  /** Trailing empty row appended after existing rows; never carries a marker cell fallback. */
  blank?: boolean | undefined;
}> = ({ definitionPath, inputPath, rowIndex, originIndex, row, childFields, linkOptions, tableDefinitions, blank = false }) => {
  const marker = originIndex === undefined ? null : (
    <input type="hidden" name={`${inputPath}[${rowIndex}].${CHILD_TABLE_ROW_INDEX_FIELD}`} value={String(originIndex)} />
  );
  if (childFields.length === 0 && !blank) {
    return <tr><td>{marker}</td></tr>;
  }
  return (
    <tr>
      {childFields.map((childField, cellIndex) => (
        <td>{cellIndex === 0 ? marker : null}<TableCellInput
          definitionPath={definitionPath}
          inputPath={inputPath}
          rowIndex={rowIndex}
          field={childField}
          value={blank ? undefined : row[childField.name]}
          linkOptions={linkOptions[`${definitionPath}.${childField.name}`] ?? []}
          allLinkOptions={linkOptions}
          tableDefinitions={tableDefinitions}
        /></td>
      ))}
    </tr>
  );
};

const TableCellInput: FC<{
  definitionPath: string;
  inputPath: string;
  rowIndex: number;
  field: FieldDefinition;
  value: JsonValue | undefined;
  linkOptions: readonly LinkOption[];
  allLinkOptions: FormLinkOptions;
  tableDefinitions: FormTableDefinitions;
}> = ({ definitionPath, inputPath, rowIndex, field, value, linkOptions, allLinkOptions, tableDefinitions }) => {
  const fieldDefinitionPath = `${definitionPath}.${field.name}`;
  const name = `${inputPath}[${rowIndex}].${field.name}`;
  if (field.type === "table") {
    return (
      <TableField
        field={field}
        value={value}
        child={tableDefinitions[fieldDefinitionPath]}
        linkOptions={allLinkOptions}
        tableDefinitions={tableDefinitions}
        definitionPath={fieldDefinitionPath}
        inputPath={name}
      />
    );
  }
  const id = `field-${slug(name)}`;
  const placeholder = fieldPlaceholder(field);
  const formatted = formatFormValue(value);
  if (field.type === "link") {
    return (
      <select id={id} name={name} data-cf-frappe-field-type={field.type}><SelectOptions options={linkOptionSpecs(linkOptions, formatted)} /></select>
    );
  }
  if (field.type === "select") {
    return (
      <select id={id} name={name} data-cf-frappe-field-type={field.type}><SelectOptions options={selectOptionSpecs(field, formatted)} /></select>
    );
  }
  if (field.type === "longText" || field.type === "json") {
    return <textarea id={id} name={name} data-cf-frappe-field-type={field.type} placeholder={placeholder}>{formatted}</textarea>;
  }
  return (
    <input
      type={inputType(field)}
      id={id}
      name={name}
      data-cf-frappe-field-type={field.type}
      value={formatted}
      checked={field.type === "boolean" && value === true ? true : undefined}
      placeholder={placeholder}
    />
  );
};

function fieldPlaceholder(field: FieldDefinition): string | undefined {
  if (
    field.placeholder === undefined ||
    field.type === "boolean" ||
    field.type === "link" ||
    field.type === "select" ||
    field.type === "table"
  ) {
    return undefined;
  }
  return field.placeholder;
}

function selectOptionSpecs(field: FieldDefinition, currentValue: string): readonly SelectOptionSpec[] {
  return (field.options ?? []).map((option) => ({ value: option, selected: option === currentValue }));
}

function linkOptionSpecs(options: readonly LinkOption[], currentValue: string): readonly SelectOptionSpec[] {
  const specs: SelectOptionSpec[] = [{ value: "" }];
  const seen = new Set<string>();
  if (currentValue && !options.some((option) => option.value === currentValue)) {
    specs.push({ value: currentValue, selected: true });
    seen.add(currentValue);
  }
  for (const option of options) {
    if (seen.has(option.value)) {
      continue;
    }
    seen.add(option.value);
    specs.push({ value: option.value, label: option.label, selected: option.value === currentValue });
  }
  return specs;
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
