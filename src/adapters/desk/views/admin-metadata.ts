import { type CustomFieldState } from "../../../core/custom-fields.js";
import { type DocTypeDefinition, type DocumentData, FIELD_TYPES, type FieldDefinition, type FieldPropertyOverrides, type NamedWorkflowDefinition, type NamedWorkflowTransition, type NamingSeriesStrategy } from "../../../core/types.js";
import { type FieldPropertyOverrideState } from "../../../core/field-property-overrides.js";
import { type NamedWorkflowDefinitionState, isWorkflowStateField } from "../../../core/workflow.js";
import { type NamingConfigurationState } from "../../../core/naming-configuration.js";
import { type NamingPreview } from "../../../application/naming-service.js";
import { doctypeOptions, fetchFromOptions, fieldOptions, stringOptions } from "../meta-options.js";
import { renderDocTypeDatalistControl, renderDocTypeSelectControl, renderFetchFromControl, renderFieldSelectControl, renderRoleMultiSelectorControl } from "../meta-controls.js";
import { escapeHtml, renderTableCell, uniqueSortedStrings } from "./shared.js";

export interface CustomFieldAdminState {
  readonly doctypes: readonly DocTypeDefinition[];
  readonly selectedDoctype: string;
  readonly doctype?: DocTypeDefinition;
  readonly draftField?: FieldDefinition;
  readonly state?: CustomFieldState;
  readonly error?: string;
}

export function renderCustomFieldAdmin(state: CustomFieldAdminState): string {
  const version = state.state?.version ?? 0;
  const doctype = state.doctype ?? state.doctypes.find((item) => item.name === state.selectedDoctype);
  const draft = state.draftField;
  const fetchFromChoices = fetchFromOptions(doctype, state.doctypes, draft?.fetchFrom ?? "");
  const doctypeChoices = doctypeOptions(state.doctypes);
  const rows = state.state?.fields
    .map((entry) => {
      const field = entry.field;
      const action = entry.enabled
        ? `<form class="inline-action" method="post" action="/desk/admin/custom-fields/${encodeURIComponent(state.selectedDoctype)}/${encodeURIComponent(field.name)}/disable">
            <input type="hidden" name="expectedVersion" value="${String(version)}">
            <button class="button danger" type="submit">Disable</button>
          </form>`
        : "";
      return `<tr>
        ${renderTableCell("Field", escapeHtml(field.name))}
        ${renderTableCell("Label", escapeHtml(field.label ?? ""))}
        ${renderTableCell("Type", escapeHtml(field.type))}
        ${renderTableCell("Details", renderCustomFieldDetails(field))}
        ${renderTableCell("Flags", escapeHtml(renderCustomFieldFlags(field)))}
        ${renderTableCell("Status", entry.enabled ? "enabled" : "disabled")}
        ${renderTableCell("Updated", `<time datetime="${escapeHtml(entry.updatedAt)}">${escapeHtml(entry.updatedAt)}</time>`)}
        ${renderTableCell("Actions", action)}
      </tr>`;
    })
    .join("");
  return `<form class="panel form" method="get" action="/desk/admin/custom-fields">
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
  <form class="panel form" method="post" action="/desk/admin/custom-fields">
    <input type="hidden" name="doctype" value="${escapeHtml(state.selectedDoctype)}">
    <input type="hidden" name="expectedVersion" value="${String(version)}">
    <div class="form-head"><h2>Add Custom Field</h2><p>v${String(version)}</p></div>
    <div class="fields">
      <label class="field"><span>Field Name</span><input name="name" value="${escapeHtml(draft?.name ?? "")}"></label>
      <label class="field"><span>Label</span><input name="label" value="${escapeHtml(draft?.label ?? "")}"></label>
      <label class="field"><span>Description</span><input name="description" value="${escapeHtml(draft?.description ?? "")}"></label>
      <label class="field"><span>Placeholder</span><input name="placeholder" value="${escapeHtml(draft?.placeholder ?? "")}"></label>
      <label class="field"><span>Type</span><select name="type">${renderCustomFieldTypeOptions(draft?.type)}</select></label>
      <label class="field"><span>Options</span><input name="options" value="${escapeHtml((draft?.options ?? []).join(", "))}"></label>
      ${renderDocTypeDatalistControl({
        label: "Link To",
        name: "linkTo",
        value: draft?.linkTo ?? "",
        options: doctypeChoices,
        datalistId: "custom-field-doctype-options"
      })}
      ${renderDocTypeDatalistControl({
        label: "Table Of",
        name: "tableOf",
        value: draft?.tableOf ?? "",
        options: doctypeChoices,
        datalistId: "custom-field-table-doctype-options"
      })}
      ${renderFetchFromControl({
        label: "Fetch From",
        name: "fetchFrom",
        value: draft?.fetchFrom ?? "",
        options: fetchFromChoices,
        datalistId: "custom-field-fetch-from-options"
      })}
      <label class="field"><span>Minimum</span><input name="min" type="number" step="any" value="${escapeHtml(draft?.min === undefined ? "" : String(draft.min))}"></label>
      <label class="field"><span>Maximum</span><input name="max" type="number" step="any" value="${escapeHtml(draft?.max === undefined ? "" : String(draft.max))}"></label>
      <label class="field wide"><span>Mandatory Depends On JSON</span><textarea name="mandatoryDependsOn" rows="4">${escapeHtml(draft?.mandatoryDependsOn === undefined ? "" : JSON.stringify(draft.mandatoryDependsOn))}</textarea></label>
      <label class="field wide"><span>Read Only Depends On JSON</span><textarea name="readOnlyDependsOn" rows="4">${escapeHtml(draft?.readOnlyDependsOn === undefined ? "" : JSON.stringify(draft.readOnlyDependsOn))}</textarea></label>
      <label class="field wide"><span>Hidden Depends On JSON</span><textarea name="hiddenDependsOn" rows="4">${escapeHtml(draft?.hiddenDependsOn === undefined ? "" : JSON.stringify(draft.hiddenDependsOn))}</textarea></label>
      <label class="field"><span>Default JSON</span><textarea name="defaultValue">${escapeHtml(draft?.defaultValue === undefined ? "" : JSON.stringify(draft.defaultValue))}</textarea></label>
    </div>
    <div class="choices">
      ${renderCustomFieldCheckbox("required", "Required", draft?.required)}
      ${renderCustomFieldCheckbox("readOnly", "Read Only", draft?.readOnly)}
      ${renderCustomFieldCheckbox("hidden", "Hidden", draft?.hidden)}
      ${renderCustomFieldCheckbox("printHide", "Print Hide", draft?.printHide)}
      ${renderCustomFieldCheckbox("printHideIfNoValue", "Print Hide If Empty", draft?.printHideIfNoValue)}
      ${renderCustomFieldCheckbox("unique", "Unique", draft?.unique)}
      ${renderCustomFieldCheckbox("noCopy", "No Copy", draft?.noCopy)}
      ${renderCustomFieldCheckbox("allowOnSubmit", "Allow On Submit", draft?.allowOnSubmit)}
      ${renderCustomFieldCheckbox("fetchIfEmpty", "Fetch If Empty", draft?.fetchIfEmpty)}
      ${renderCustomFieldCheckbox("inFormView", "Form View", draft?.inFormView)}
      ${renderCustomFieldCheckbox("inListView", "List View", draft?.inListView)}
      ${renderCustomFieldCheckbox("inListFilter", "List Filter", draft?.inListFilter)}
    </div>
    <div class="actions"><button class="button primary" type="submit">Save Field</button></div>
  </form>
  <section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>Field</th><th>Label</th><th>Type</th><th>Details</th><th>Flags</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="8" class="empty">No custom fields configured.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

export interface FieldPropertyAdminState {
  readonly doctypes: readonly DocTypeDefinition[];
  readonly selectedDoctype: string;
  readonly selectedField: string;
  readonly doctype?: DocTypeDefinition;
  readonly draftOverrides?: FieldPropertyOverrides;
  readonly state?: FieldPropertyOverrideState;
  readonly error?: string;
}

export function renderFieldPropertyAdmin(state: FieldPropertyAdminState): string {
  const doctype = state.doctype ?? state.doctypes.find((item) => item.name === state.selectedDoctype);
  const selectedField = state.selectedField || doctype?.fields[0]?.name || "";
  const version = state.state?.version ?? 0;
  const current = state.state?.fields.find((entry) => entry.fieldName === selectedField);
  const overrides = state.draftOverrides ?? current?.overrides ?? {};
  const fetchFromChoices = fetchFromOptions(doctype, state.doctypes, overrides.fetchFrom ?? "");
  const rows = state.state?.fields
    .map((entry) => `<tr>
      ${renderTableCell("Field", escapeHtml(entry.fieldName))}
      ${renderTableCell("Overrides", escapeHtml(renderFieldPropertyOverrides(entry.overrides)))}
      ${renderTableCell("Updated", `<time datetime="${escapeHtml(entry.updatedAt)}">${escapeHtml(entry.updatedAt)}</time>`)}
      ${renderTableCell("Actions", `
        <form class="inline-action" method="post" action="/desk/admin/field-properties/${encodeURIComponent(state.selectedDoctype)}/${encodeURIComponent(entry.fieldName)}/clear">
          <input type="hidden" name="expectedVersion" value="${String(version)}">
          <button class="button danger" type="submit">Clear</button>
        </form>
      `)}
    </tr>`)
    .join("");
  return `<form class="panel form" method="get" action="/desk/admin/field-properties">
    <div class="fields">
      ${renderDocTypeSelectControl({
        label: "DocType",
        name: "doctype",
        value: state.selectedDoctype,
        options: doctypeOptions(state.doctypes, state.selectedDoctype)
      })}
      ${renderFieldSelectControl({
        label: "Field",
        name: "field",
        value: selectedField,
        options: fieldOptions(doctype, selectedField)
      })}
    </div>
    <div class="actions"><button class="button primary" type="submit">Load</button></div>
  </form>
  ${state.error ? `<p class="error" role="alert">${escapeHtml(state.error)}</p>` : ""}
  <form class="panel form" method="post" action="/desk/admin/field-properties">
    <input type="hidden" name="doctype" value="${escapeHtml(state.selectedDoctype)}">
    <input type="hidden" name="fieldName" value="${escapeHtml(selectedField)}">
    <input type="hidden" name="expectedVersion" value="${String(version)}">
    <div class="form-head"><h2>Field Properties</h2><p>v${String(version)}</p></div>
    <div class="fields">
      <label class="field"><span>Label</span><input name="label" value="${escapeHtml(overrides.label ?? "")}"></label>
      <label class="field"><span>Description</span><input name="description" value="${escapeHtml(overrides.description ?? "")}"></label>
      <label class="field"><span>Placeholder</span><input name="placeholder" value="${escapeHtml(overrides.placeholder ?? "")}"></label>
      <label class="field"><span>Required</span><select name="required">${renderBooleanOverrideOptions(overrides.required)}</select></label>
      <label class="field wide"><span>Mandatory Depends On JSON</span><textarea name="mandatoryDependsOn" rows="4">${escapeHtml(overrides.mandatoryDependsOn === undefined ? "" : JSON.stringify(overrides.mandatoryDependsOn))}</textarea></label>
      <label class="field"><span>Read Only</span><select name="readOnly">${renderBooleanOverrideOptions(overrides.readOnly)}</select></label>
      <label class="field wide"><span>Read Only Depends On JSON</span><textarea name="readOnlyDependsOn" rows="4">${escapeHtml(overrides.readOnlyDependsOn === undefined ? "" : JSON.stringify(overrides.readOnlyDependsOn))}</textarea></label>
      <label class="field"><span>Hidden</span><select name="hidden">${renderBooleanOverrideOptions(overrides.hidden)}</select></label>
      <label class="field wide"><span>Hidden Depends On JSON</span><textarea name="hiddenDependsOn" rows="4">${escapeHtml(overrides.hiddenDependsOn === undefined ? "" : JSON.stringify(overrides.hiddenDependsOn))}</textarea></label>
      <label class="field"><span>Print Hide</span><select name="printHide">${renderBooleanOverrideOptions(overrides.printHide)}</select></label>
      <label class="field"><span>Print Hide If Empty</span><select name="printHideIfNoValue">${renderBooleanOverrideOptions(overrides.printHideIfNoValue)}</select></label>
      <label class="field"><span>No Copy</span><select name="noCopy">${renderBooleanOverrideOptions(overrides.noCopy)}</select></label>
      <label class="field"><span>Allow On Submit</span><select name="allowOnSubmit">${renderBooleanOverrideOptions(overrides.allowOnSubmit)}</select></label>
      ${renderFetchFromControl({
        label: "Fetch From",
        name: "fetchFrom",
        value: overrides.fetchFrom ?? "",
        options: fetchFromChoices,
        datalistId: "field-property-fetch-from-options"
      })}
      <label class="field"><span>Fetch If Empty</span><select name="fetchIfEmpty">${renderBooleanOverrideOptions(overrides.fetchIfEmpty)}</select></label>
      <label class="field"><span>Form View</span><select name="inFormView">${renderBooleanOverrideOptions(overrides.inFormView)}</select></label>
      <label class="field"><span>Global Search</span><select name="inGlobalSearch">${renderBooleanOverrideOptions(overrides.inGlobalSearch)}</select></label>
      <label class="field"><span>List View</span><select name="inListView">${renderBooleanOverrideOptions(overrides.inListView)}</select></label>
      <label class="field"><span>List Filter</span><select name="inListFilter">${renderBooleanOverrideOptions(overrides.inListFilter)}</select></label>
      <label class="field"><span>Options</span><input name="options" value="${escapeHtml((overrides.options ?? []).join(", "))}"></label>
      <label class="field"><span>Minimum</span><input name="min" type="number" step="any" value="${escapeHtml(overrides.min === undefined ? "" : String(overrides.min))}"></label>
      <label class="field"><span>Maximum</span><input name="max" type="number" step="any" value="${escapeHtml(overrides.max === undefined ? "" : String(overrides.max))}"></label>
      <label class="field"><span>Default JSON</span><textarea name="defaultValue">${escapeHtml(overrides.defaultValue === undefined ? "" : JSON.stringify(overrides.defaultValue))}</textarea></label>
    </div>
    <div class="actions">
      <button class="button primary" type="submit">Save Properties</button>
      ${current ? `<button class="button danger" type="submit" formaction="/desk/admin/field-properties/${encodeURIComponent(state.selectedDoctype)}/${encodeURIComponent(selectedField)}/clear">Clear Override</button>` : ""}
    </div>
  </form>
  <section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>Field</th><th>Overrides</th><th>Updated</th><th>Actions</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="empty">No field property overrides configured.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

export interface WorkflowAdminState {
  readonly doctypes: readonly DocTypeDefinition[];
  readonly selectedDoctype: string;
  readonly selectedWorkflowName?: string;
  readonly doctype?: DocTypeDefinition;
  readonly roleSuggestions?: readonly string[];
  readonly draftWorkflow?: NamedWorkflowDefinition;
  readonly state?: readonly NamedWorkflowDefinitionState[];
  readonly error?: string;
}

export function renderWorkflowAdmin(state: WorkflowAdminState): string {
  const selectedState = state.state?.find((entry) => entry.workflowName === state.selectedWorkflowName) ??
    state.state?.find((entry) => entry.workflow !== undefined);
  const version = selectedState?.version ?? 0;
  const workflow = state.draftWorkflow ?? selectedState?.workflow;
  const selectedWorkflowName = workflow?.name ?? state.selectedWorkflowName ?? "";
  const doctype = state.doctype ?? state.doctypes.find((item) => item.name === state.selectedDoctype);
  const states = workflow?.states.join("\n") ?? "";
  const workflowStates = workflow?.states ?? [];
  const roleSuggestions = uniqueSortedStrings([
    ...(state.roleSuggestions ?? []),
    ...(workflow?.transitions.flatMap((transition) => transition.roles ?? []) ?? [])
  ]);
  const rows = state.state
    ?.map((entry) => `<tr>
      ${renderTableCell("Name", escapeHtml(entry.workflowName))}
      ${renderTableCell("Label", escapeHtml(entry.workflow?.label ?? ""))}
      ${renderTableCell("State Field", escapeHtml(entry.workflow?.stateField ?? ""))}
      ${renderTableCell("Source", entry.cleared ? "cleared" : entry.version === 0 ? "static" : "runtime")}
      ${renderTableCell("Version", String(entry.version))}
      ${renderTableCell("Actions", `<a class="button" href="${escapeHtml(workflowAdminHref(state.selectedDoctype, entry.workflowName))}">Edit</a>`)}
    </tr>`)
    .join("");
  return `<form class="panel form" method="get" action="/desk/admin/workflows">
    <div class="fields cols-1">
      ${renderDocTypeSelectControl({
        label: "DocType",
        name: "doctype",
        value: state.selectedDoctype,
        options: doctypeOptions(state.doctypes, state.selectedDoctype)
      })}
      <label class="field"><span>Workflow</span><input name="workflow" value="${escapeHtml(selectedWorkflowName)}" placeholder="lifecycle"></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Load</button></div>
  </form>
  ${state.error ? `<p class="error" role="alert">${escapeHtml(state.error)}</p>` : ""}
  <form class="panel form" method="post" action="/desk/admin/workflows">
    <input type="hidden" name="doctype" value="${escapeHtml(state.selectedDoctype)}">
    <input type="hidden" name="expectedVersion" value="${String(version)}">
    <div class="form-head"><h2>${workflow === undefined ? "New Workflow" : "Workflow Definition"}</h2><p>v${String(version)}</p></div>
    <div class="fields">
      <label class="field"><span>Name</span><input name="name" value="${escapeHtml(selectedWorkflowName)}"></label>
      <label class="field"><span>Label</span><input name="label" value="${escapeHtml(workflow?.label ?? "")}"></label>
      ${renderWorkflowStateFieldControl(doctype, workflow?.stateField ?? "")}
      ${renderWorkflowInitialStateControl(workflowStates, workflow?.initialState ?? "")}
      <label class="field"><span>States</span><textarea name="states">${escapeHtml(states)}</textarea></label>
    </div>
    ${renderWorkflowTransitionControls(workflow?.transitions ?? [], workflowStates, roleSuggestions)}
    <div class="actions">
      <button class="button primary" type="submit">Save Workflow</button>
      ${workflow ? `<button class="button danger" type="submit" formaction="/desk/admin/workflows/${encodeURIComponent(state.selectedDoctype)}/${encodeURIComponent(workflow.name)}/clear">Clear Workflow</button>` : ""}
    </div>
  </form>
  <section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>Name</th><th>Label</th><th>State Field</th><th>Source</th><th>Version</th><th>Actions</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" class="empty">No workflows configured.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

export interface NamingAdminState {
  readonly doctypes: readonly DocTypeDefinition[];
  readonly selectedDoctype: string;
  readonly doctype?: DocTypeDefinition;
  readonly state?: NamingConfigurationState;
  readonly preview?: NamingPreview;
  readonly draftStrategy?: NamingSeriesStrategy;
  readonly previewData?: DocumentData;
  readonly error?: string;
}

export function renderNamingAdmin(state: NamingAdminState): string {
  const doctype = state.doctype ?? state.doctypes.find((item) => item.name === state.selectedDoctype);
  const effective = state.draftStrategy ?? state.state?.runtimeStrategy ?? state.state?.effectiveStrategy;
  const strategy: NamingSeriesStrategy = effective?.kind === "series"
    ? effective
    : {
        kind: "series",
        pattern: `${state.selectedDoctype || "DOC"}-{sequence:6}`,
        counter: namingDefaultCounter(state.selectedDoctype)
      };
  const version = state.state?.version ?? 0;
  const previewData = state.previewData ?? {};
  const targetFields = (doctype?.fields ?? []).filter((field) =>
    field.type === "text" && field.readOnly === true && field.noCopy === true
  );
  const scopeFields = (doctype?.fields ?? []).filter((field) =>
    field.type !== "table" && field.type !== "json" && field.type !== "longText"
  );
  const selectedScopes = new Set(strategy.scopeFields ?? []);
  const previewRows = state.preview?.candidates.map((candidate) => `<tr>
    ${renderTableCell("Sequence", String(candidate.value))}
    ${renderTableCell("Generated ID", `<code>${escapeHtml(candidate.name)}</code>`)}
  </tr>`).join("") ?? "";
  return `<form class="panel form" method="get" action="/desk/admin/naming">
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
  <form class="panel form" method="post" action="/desk/admin/naming">
    <input type="hidden" name="doctype" value="${escapeHtml(state.selectedDoctype)}">
    <input type="hidden" name="expectedVersion" value="${String(version)}">
    <div class="form-head"><h2>Naming Strategy</h2><p>${escapeHtml(state.state?.source ?? "default")} v${String(version)}</p></div>
    <div class="fields">
      <label class="field wide"><span>Pattern</span><input name="pattern" value="${escapeHtml(strategy.pattern)}" placeholder="RET-{YYYY}-{sequence:6}"></label>
      <label class="field"><span>Counter</span><input name="counter" value="${escapeHtml(strategy.counter ?? "")}" placeholder="returns"></label>
      <label class="field"><span>Generated Field</span><select name="targetField">
        <option value="">Document name only</option>
        ${targetFields.map((field) => `<option value="${escapeHtml(field.name)}"${field.name === strategy.targetField ? " selected" : ""}>${escapeHtml(field.label ?? field.name)}</option>`).join("")}
      </select></label>
      <label class="field"><span>Default Padding</span><input name="padding" type="number" min="1" max="18" value="${escapeHtml(String(strategy.padding ?? 6))}"></label>
      <label class="field"><span>Start</span><input name="start" type="number" min="1" value="${escapeHtml(String(strategy.start ?? 1))}"></label>
      <label class="field"><span>Step</span><input name="step" type="number" min="1" value="${escapeHtml(String(strategy.step ?? 1))}"></label>
      <label class="field"><span>Reset</span><select name="reset">${renderNamingResetOptions(strategy.reset ?? "never")}</select></label>
      <label class="field"><span>Max Attempts</span><input name="maxAttempts" type="number" min="1" max="10000" value="${escapeHtml(String(strategy.maxAttempts ?? 10000))}"></label>
      <label class="field wide"><span>Exclusions JSON</span><textarea name="exclusions" rows="6">${escapeHtml(JSON.stringify(strategy.exclusions ?? [], null, 2))}</textarea></label>
    </div>
    <fieldset class="panel-section"><legend>Counter Scope Fields</legend>
      <div class="quick-filter-choice">
        ${scopeFields.map((field) => `<label><input type="checkbox" name="scopeField" value="${escapeHtml(field.name)}"${selectedScopes.has(field.name) ? " checked" : ""}> <span>${escapeHtml(field.label ?? field.name)}</span></label>`).join("") || `<p class="empty">No scalar fields are available.</p>`}
      </div>
    </fieldset>
    <div class="actions">
      <button class="button primary" type="submit">Save Strategy</button>
      ${state.state?.runtimeStrategy === undefined ? "" : `<button class="button danger" type="submit" formaction="/desk/admin/naming/${encodeURIComponent(state.selectedDoctype)}/clear">Clear Runtime Strategy</button>`}
    </div>
  </form>
  <form class="panel form" method="post" action="/desk/admin/naming/preview">
    <input type="hidden" name="doctype" value="${escapeHtml(state.selectedDoctype)}">
    <div class="form-head"><h2>Preview</h2><p>Does not consume numbers</p></div>
    <div class="fields">
      <label class="field wide"><span>Scope / Token Data JSON</span><textarea name="data" rows="5">${escapeHtml(JSON.stringify(previewData, null, 2))}</textarea></label>
      <label class="field"><span>Count</span><input name="count" type="number" min="1" max="100" value="${String(state.preview?.candidates.length ?? 5)}"></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Preview IDs</button></div>
  </form>
  <section class="panel">
    <div class="form-head"><h2>Upcoming IDs</h2><p>${escapeHtml(namingCounterSummary(state.preview))}</p></div>
    <div class="table-wrap"><table class="responsive-table">
      <thead><tr><th>Sequence</th><th>Generated ID</th></tr></thead>
      <tbody>${previewRows || `<tr><td colspan="2" class="empty">Provide required token or scope data to preview this strategy.</td></tr>`}</tbody>
    </table></div>
  </section>
  <form class="panel form" method="post" action="/desk/admin/naming/counter">
    <input type="hidden" name="doctype" value="${escapeHtml(state.selectedDoctype)}">
    <input type="hidden" name="expectedVersion" value="${String(state.preview?.counterVersion ?? 0)}">
    <div class="form-head"><h2>Advance Counter</h2><p>Forward only</p></div>
    <div class="fields">
      <label class="field"><span>Current Value</span><input name="current" type="number" min="0" value="${escapeHtml(String(state.preview?.current ?? 0))}"></label>
      <label class="field wide"><span>Scope / Token Data JSON</span><textarea name="data" rows="5">${escapeHtml(JSON.stringify(previewData, null, 2))}</textarea></label>
    </div>
    <div class="actions"><button class="button" type="submit">Advance Counter</button></div>
  </form>`;
}

function renderNamingResetOptions(selected: string): string {
  return [
    ["never", "Never"],
    ["year", "Every year"],
    ["month", "Every month"],
    ["day", "Every day"]
  ].map(([value, label]) => `<option value="${value}"${selected === value ? " selected" : ""}>${label}</option>`).join("");
}

function namingDefaultCounter(doctype: string): string {
  const normalized = doctype.toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || "documents";
}

function namingCounterSummary(preview: NamingPreview | undefined): string {
  if (preview === undefined) {
    return "Counter not loaded";
  }
  const scope = preview.scope ? `, scope ${preview.scope}` : "";
  return `${preview.counter}${scope}, current ${String(preview.current ?? "not started")}, v${String(preview.counterVersion)}`;
}

function renderBooleanOverrideOptions(value: boolean | undefined): string {
  return [
    `<option value=""${value === undefined ? " selected" : ""}>Inherit</option>`,
    `<option value="true"${value === true ? " selected" : ""}>True</option>`,
    `<option value="false"${value === false ? " selected" : ""}>False</option>`
  ].join("");
}

function renderFieldPropertyOverrides(overrides: FieldPropertyOverrideState["fields"][number]["overrides"]): string {
  return [
    overrides.label === undefined ? "" : `label: ${overrides.label}`,
    overrides.description === undefined ? "" : `description: ${overrides.description}`,
    overrides.placeholder === undefined ? "" : `placeholder: ${overrides.placeholder}`,
    overrides.required === undefined ? "" : `required: ${String(overrides.required)}`,
    overrides.mandatoryDependsOn === undefined ? "" : `mandatory depends on: ${JSON.stringify(overrides.mandatoryDependsOn)}`,
    overrides.readOnly === undefined ? "" : `read only: ${String(overrides.readOnly)}`,
    overrides.readOnlyDependsOn === undefined ? "" : `read only depends on: ${JSON.stringify(overrides.readOnlyDependsOn)}`,
    overrides.hidden === undefined ? "" : `hidden: ${String(overrides.hidden)}`,
    overrides.hiddenDependsOn === undefined ? "" : `hidden depends on: ${JSON.stringify(overrides.hiddenDependsOn)}`,
    overrides.printHide === undefined ? "" : `print hide: ${String(overrides.printHide)}`,
    overrides.printHideIfNoValue === undefined ? "" : `print hide if empty: ${String(overrides.printHideIfNoValue)}`,
    overrides.noCopy === undefined ? "" : `no copy: ${String(overrides.noCopy)}`,
    overrides.allowOnSubmit === undefined ? "" : `allow on submit: ${String(overrides.allowOnSubmit)}`,
    overrides.fetchFrom === undefined ? "" : `fetch from: ${overrides.fetchFrom}`,
    overrides.fetchIfEmpty === undefined ? "" : `fetch if empty: ${String(overrides.fetchIfEmpty)}`,
    overrides.inFormView === undefined ? "" : `form: ${String(overrides.inFormView)}`,
    overrides.inGlobalSearch === undefined ? "" : `search: ${String(overrides.inGlobalSearch)}`,
    overrides.inListView === undefined ? "" : `list: ${String(overrides.inListView)}`,
    overrides.inListFilter === undefined ? "" : `filter: ${String(overrides.inListFilter)}`,
    overrides.options === undefined ? "" : `options: ${overrides.options.join(", ")}`,
    overrides.min === undefined ? "" : `min: ${String(overrides.min)}`,
    overrides.max === undefined ? "" : `max: ${String(overrides.max)}`,
    overrides.defaultValue === undefined ? "" : `default: ${JSON.stringify(overrides.defaultValue)}`
  ].filter(Boolean).join("; ");
}

function workflowAdminHref(doctype: string, workflowName: string): string {
  return `/desk/admin/workflows?doctype=${encodeURIComponent(doctype)}&workflow=${encodeURIComponent(workflowName)}`;
}

function renderWorkflowStateFieldControl(doctype: DocTypeDefinition | undefined, selected: string): string {
  const options = fieldOptions(doctype, selected, isWorkflowStateField);
  if (options.length > 0) {
    return renderFieldSelectControl({
      label: "State Field",
      name: "stateField",
      value: selected,
      options
    });
  }
  return `<label class="field"><span>State Field</span><input name="stateField" value="${escapeHtml(selected)}"></label>`;
}

function renderWorkflowInitialStateControl(states: readonly string[], selected: string): string {
  if (states.length === 0) {
    return `<label class="field"><span>Initial State</span><input name="initialState" value="${escapeHtml(selected)}"></label>`;
  }
  return `<label class="field"><span>Initial State</span><select name="initialState">${renderStringOptions(states, selected, true)}</select></label>`;
}

function renderWorkflowTransitionControls(
  transitions: readonly NamedWorkflowTransition[],
  states: readonly string[],
  roleSuggestions: readonly string[]
): string {
  const rows = (transitions.length === 0 ? [undefined, undefined, undefined] : [...transitions, undefined])
    .map((transition, index) => renderWorkflowTransitionControlRow(transition, index, states, roleSuggestions))
    .join("");
  return `<fieldset class="admin-row-builder workflow-transition-builder">
    <legend>Transitions</legend>
    <div class="admin-row-list">${rows}</div>
  </fieldset>`;
}

function renderWorkflowTransitionControlRow(
  transition: NamedWorkflowTransition | undefined,
  index: number,
  states: readonly string[],
  roleSuggestions: readonly string[]
): string {
  const action = transition?.action ?? "";
  const from = transition?.from ?? "";
  const to = transition?.to ?? "";
  const roles = (transition?.roles ?? []).join(", ");
  const allowWhen = transition?.allowWhen === undefined ? "" : JSON.stringify(transition.allowWhen, null, 2);
  const eventType = transition?.eventType ?? "";
  const stateOptionsFrom = states.length === 0
    ? ""
    : `<select name="transitionFrom">${renderStringOptions(states, from, true)}</select>`;
  const stateOptionsTo = states.length === 0
    ? ""
    : `<select name="transitionTo">${renderStringOptions(states, to, true)}</select>`;
  const fromControl = stateOptionsFrom || `<input name="transitionFrom" value="${escapeHtml(from)}">`;
  const toControl = stateOptionsTo || `<input name="transitionTo" value="${escapeHtml(to)}">`;
  return `<div class="admin-row" data-cf-frappe-workflow-transition-row>
    <label class="field compact"><span>Action ${String(index + 1)}</span><input name="transitionAction" value="${escapeHtml(action)}"></label>
    <label class="field compact"><span>From</span>${fromControl}</label>
    <label class="field compact"><span>To</span>${toControl}</label>
    ${renderRoleMultiSelectorControl({
      label: "Roles",
      name: "transitionRoles",
      value: roles,
      options: stringOptions(roleSuggestions, roles),
      datalistId: index === 0 ? "workflow-role-suggestions" : `workflow-role-suggestions-${String(index)}`,
      className: "field compact"
    })}
    <label class="field compact"><span>Allow When JSON</span><textarea name="transitionAllowWhen" rows="3">${escapeHtml(allowWhen)}</textarea></label>
    <label class="field compact"><span>Event Type</span><input name="transitionEventType" value="${escapeHtml(eventType)}"></label>
  </div>`;
}

function renderStringOptions(values: readonly string[], selected: string, includeBlank = false): string {
  const options = includeBlank ? [`<option value=""${selected === "" ? " selected" : ""}></option>`] : [];
  const seen = new Set<string>();
  if (selected && !values.includes(selected)) {
    options.push(`<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}</option>`);
    seen.add(selected);
  }
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    options.push(`<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(value)}</option>`);
  }
  return options.join("");
}

function renderCustomFieldTypeOptions(selected = ""): string {
  return FIELD_TYPES
    .map((type) => `<option value="${escapeHtml(type)}"${type === selected ? " selected" : ""}>${escapeHtml(type)}</option>`)
    .join("");
}

function renderCustomFieldCheckbox(name: string, label: string, checked = false): string {
  return `<label class="choice"><input type="checkbox" name="${escapeHtml(name)}" value="1"${checked ? " checked" : ""}><span>${escapeHtml(label)}</span></label>`;
}

function renderCustomFieldDetails(field: FieldDefinition): string {
  return [
    field.description ? `description: ${field.description}` : "",
    field.placeholder ? `placeholder: ${field.placeholder}` : "",
    field.mandatoryDependsOn ? `mandatory depends on: ${JSON.stringify(field.mandatoryDependsOn)}` : "",
    field.readOnlyDependsOn ? `read only depends on: ${JSON.stringify(field.readOnlyDependsOn)}` : "",
    field.hiddenDependsOn ? `hidden depends on: ${JSON.stringify(field.hiddenDependsOn)}` : "",
    field.options && field.options.length > 0 ? `options: ${field.options.join(", ")}` : "",
    field.linkTo ? `link: ${field.linkTo}` : "",
    field.tableOf ? `table: ${field.tableOf}` : "",
    field.fetchFrom ? `fetch from: ${field.fetchFrom}` : "",
    field.min !== undefined ? `min: ${String(field.min)}` : "",
    field.max !== undefined ? `max: ${String(field.max)}` : "",
    field.defaultValue !== undefined ? `default: ${JSON.stringify(field.defaultValue)}` : ""
  ].filter(Boolean).map(escapeHtml).join("<br>");
}

function renderCustomFieldFlags(field: FieldDefinition): string {
  return [
    field.required ? "required" : "",
    field.mandatoryDependsOn ? "mandatory depends on" : "",
    field.readOnly ? "read only" : "",
    field.readOnlyDependsOn ? "read only depends on" : "",
    field.hiddenDependsOn ? "hidden depends on" : "",
    field.hidden ? "hidden" : "",
    field.printHide ? "print hide" : "",
    field.printHideIfNoValue ? "print hide if empty" : "",
    field.unique ? "unique" : "",
    field.noCopy ? "no copy" : "",
    field.allowOnSubmit ? "allow on submit" : "",
    field.fetchFrom ? `fetch from ${field.fetchFrom}` : "",
    field.fetchIfEmpty ? "fetch if empty" : "",
    field.inFormView ? "form" : "",
    field.inListView ? "list" : "",
    field.inListFilter ? "filter" : ""
  ].filter(Boolean).join(", ");
}
