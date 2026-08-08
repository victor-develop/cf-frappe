import type { Child, FC } from "hono/jsx";
import { type CustomFieldState } from "../../../core/custom-fields.js";
import { type DocTypeDefinition, type DocumentData, FIELD_TYPES, type FieldDefinition, type FieldPropertyOverrides, type NamedWorkflowDefinition, type NamedWorkflowTransition, type NamingSeriesStrategy } from "../../../core/types.js";
import { type FieldPropertyOverrideState } from "../../../core/field-property-overrides.js";
import { type NamedWorkflowDefinitionState, isWorkflowStateField } from "../../../core/workflow.js";
import { type NamingConfigurationState } from "../../../core/naming-configuration.js";
import { type NamingPreview } from "../../../application/naming-service.js";
import { doctypeOptions, fetchFromOptions, fieldOptions, stringOptions } from "../meta-options.js";
import { renderDocTypeDatalistControl, renderDocTypeSelectControl, renderFetchFromControl, renderFieldSelectControl, renderRoleMultiSelectorControl } from "../meta-controls.js";
import { uniqueSortedStrings } from "./shared.js";
import { ActionBar, Field, FormRow, Notice, Panel, SelectOptions, UnsafeRawHtml, renderFragment, type SelectOptionSpec } from "../ui/primitives.js";

/**
 * Shared meta-controls helpers (select/datalist controls) still render
 * pre-escaped HTML strings because they are consumed by other, not yet
 * converted domains. Injecting their output verbatim is the same intentional
 * raw-HTML sink the old string renderer had.
 */
const MetaControl: FC<{ html: string }> = ({ html }) => (
  <UnsafeRawHtml
    reason="pre-escaped form control markup from the shared meta-controls string helpers (escaped internally via escapeHtml)"
    html={html}
  />
);

/** `<td data-label>` cell mirroring shared.ts renderTableCell. */
const Cell: FC<{ label: string; children?: Child }> = ({ label, children }) => (
  <td data-label={label}>{children}</td>
);

export interface CustomFieldAdminState {
  readonly doctypes: readonly DocTypeDefinition[];
  readonly selectedDoctype: string;
  readonly doctype?: DocTypeDefinition;
  readonly draftField?: FieldDefinition;
  readonly state?: CustomFieldState;
  readonly error?: string;
}

export function renderCustomFieldAdmin(state: CustomFieldAdminState): string {
  return renderFragment(<CustomFieldAdmin state={state} />);
}

const CustomFieldAdmin: FC<{ state: CustomFieldAdminState }> = ({ state }) => {
  const version = state.state?.version ?? 0;
  const doctype = state.doctype ?? state.doctypes.find((item) => item.name === state.selectedDoctype);
  const draft = state.draftField;
  const fetchFromChoices = fetchFromOptions(doctype, state.doctypes, draft?.fetchFrom ?? "");
  const doctypeChoices = doctypeOptions(state.doctypes);
  const entries = state.state?.fields ?? [];
  return (
    <>
      <form class="panel form" method="get" action="/desk/admin/custom-fields">
        <FormRow columns={1}>
          <MetaControl html={renderDocTypeSelectControl({
            label: "DocType",
            name: "doctype",
            value: state.selectedDoctype,
            options: doctypeOptions(state.doctypes, state.selectedDoctype)
          })} />
        </FormRow>
        <ActionBar><button class="button primary" type="submit">Load</button></ActionBar>
      </form>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <form class="panel form" method="post" action="/desk/admin/custom-fields">
        <input type="hidden" name="doctype" value={state.selectedDoctype} />
        <input type="hidden" name="expectedVersion" value={String(version)} />
        <div class="form-head"><h2>Add Custom Field</h2><p>v{String(version)}</p></div>
        <FormRow>
          <Field label="Field Name"><input name="name" value={draft?.name ?? ""} /></Field>
          <Field label="Label"><input name="label" value={draft?.label ?? ""} /></Field>
          <Field label="Description"><input name="description" value={draft?.description ?? ""} /></Field>
          <Field label="Placeholder"><input name="placeholder" value={draft?.placeholder ?? ""} /></Field>
          <Field label="Type"><select name="type"><SelectOptions options={customFieldTypeOptions(draft?.type)} /></select></Field>
          <Field label="Options"><input name="options" value={(draft?.options ?? []).join(", ")} /></Field>
          <MetaControl html={renderDocTypeDatalistControl({
            label: "Link To",
            name: "linkTo",
            value: draft?.linkTo ?? "",
            options: doctypeChoices,
            datalistId: "custom-field-doctype-options"
          })} />
          <MetaControl html={renderDocTypeDatalistControl({
            label: "Table Of",
            name: "tableOf",
            value: draft?.tableOf ?? "",
            options: doctypeChoices,
            datalistId: "custom-field-table-doctype-options"
          })} />
          <MetaControl html={renderFetchFromControl({
            label: "Fetch From",
            name: "fetchFrom",
            value: draft?.fetchFrom ?? "",
            options: fetchFromChoices,
            datalistId: "custom-field-fetch-from-options"
          })} />
          <Field label="Minimum"><input name="min" type="number" step="any" value={draft?.min === undefined ? "" : String(draft.min)} /></Field>
          <Field label="Maximum"><input name="max" type="number" step="any" value={draft?.max === undefined ? "" : String(draft.max)} /></Field>
          <Field label="Mandatory Depends On JSON" variant="wide"><textarea name="mandatoryDependsOn" rows={4}>{draft?.mandatoryDependsOn === undefined ? "" : JSON.stringify(draft.mandatoryDependsOn)}</textarea></Field>
          <Field label="Read Only Depends On JSON" variant="wide"><textarea name="readOnlyDependsOn" rows={4}>{draft?.readOnlyDependsOn === undefined ? "" : JSON.stringify(draft.readOnlyDependsOn)}</textarea></Field>
          <Field label="Hidden Depends On JSON" variant="wide"><textarea name="hiddenDependsOn" rows={4}>{draft?.hiddenDependsOn === undefined ? "" : JSON.stringify(draft.hiddenDependsOn)}</textarea></Field>
          <Field label="Default JSON"><textarea name="defaultValue">{draft?.defaultValue === undefined ? "" : JSON.stringify(draft.defaultValue)}</textarea></Field>
        </FormRow>
        <div class="choices">
          <CustomFieldCheckbox name="required" label="Required" checked={draft?.required} />
          <CustomFieldCheckbox name="readOnly" label="Read Only" checked={draft?.readOnly} />
          <CustomFieldCheckbox name="hidden" label="Hidden" checked={draft?.hidden} />
          <CustomFieldCheckbox name="printHide" label="Print Hide" checked={draft?.printHide} />
          <CustomFieldCheckbox name="printHideIfNoValue" label="Print Hide If Empty" checked={draft?.printHideIfNoValue} />
          <CustomFieldCheckbox name="unique" label="Unique" checked={draft?.unique} />
          <CustomFieldCheckbox name="noCopy" label="No Copy" checked={draft?.noCopy} />
          <CustomFieldCheckbox name="allowOnSubmit" label="Allow On Submit" checked={draft?.allowOnSubmit} />
          <CustomFieldCheckbox name="fetchIfEmpty" label="Fetch If Empty" checked={draft?.fetchIfEmpty} />
          <CustomFieldCheckbox name="inFormView" label="Form View" checked={draft?.inFormView} />
          <CustomFieldCheckbox name="inListView" label="List View" checked={draft?.inListView} />
          <CustomFieldCheckbox name="inListFilter" label="List Filter" checked={draft?.inListFilter} />
        </div>
        <ActionBar><button class="button primary" type="submit">Save Field</button></ActionBar>
      </form>
      <section class="panel">
        <div class="table-wrap">
          <table class="responsive-table">
            <thead><tr><th>Field</th><th>Label</th><th>Type</th><th>Details</th><th>Flags</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead>
            <tbody>
              {entries.length === 0 ? (
                <tr><td colspan={8} class="empty">No custom fields configured.</td></tr>
              ) : (
                entries.map((entry) => (
                  <tr>
                    <Cell label="Field">{entry.field.name}</Cell>
                    <Cell label="Label">{entry.field.label ?? ""}</Cell>
                    <Cell label="Type">{entry.field.type}</Cell>
                    <Cell label="Details"><CustomFieldDetails field={entry.field} /></Cell>
                    <Cell label="Flags">{renderCustomFieldFlags(entry.field)}</Cell>
                    <Cell label="Status">{entry.enabled ? "enabled" : "disabled"}</Cell>
                    <Cell label="Updated"><time datetime={entry.updatedAt}>{entry.updatedAt}</time></Cell>
                    <Cell label="Actions">
                      {entry.enabled ? (
                        <form class="inline-action" method="post" action={`/desk/admin/custom-fields/${encodeURIComponent(state.selectedDoctype)}/${encodeURIComponent(entry.field.name)}/disable`}>
                          <input type="hidden" name="expectedVersion" value={String(version)} />
                          <button class="button danger" type="submit">Disable</button>
                        </form>
                      ) : (
                        ""
                      )}
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
  return renderFragment(<FieldPropertyAdmin state={state} />);
}

const FieldPropertyAdmin: FC<{ state: FieldPropertyAdminState }> = ({ state }) => {
  const doctype = state.doctype ?? state.doctypes.find((item) => item.name === state.selectedDoctype);
  const selectedField = state.selectedField || doctype?.fields[0]?.name || "";
  const version = state.state?.version ?? 0;
  const current = state.state?.fields.find((entry) => entry.fieldName === selectedField);
  const overrides = state.draftOverrides ?? current?.overrides ?? {};
  const fetchFromChoices = fetchFromOptions(doctype, state.doctypes, overrides.fetchFrom ?? "");
  const entries = state.state?.fields ?? [];
  return (
    <>
      <form class="panel form" method="get" action="/desk/admin/field-properties">
        <FormRow>
          <MetaControl html={renderDocTypeSelectControl({
            label: "DocType",
            name: "doctype",
            value: state.selectedDoctype,
            options: doctypeOptions(state.doctypes, state.selectedDoctype)
          })} />
          <MetaControl html={renderFieldSelectControl({
            label: "Field",
            name: "field",
            value: selectedField,
            options: fieldOptions(doctype, selectedField)
          })} />
        </FormRow>
        <ActionBar><button class="button primary" type="submit">Load</button></ActionBar>
      </form>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <form class="panel form" method="post" action="/desk/admin/field-properties">
        <input type="hidden" name="doctype" value={state.selectedDoctype} />
        <input type="hidden" name="fieldName" value={selectedField} />
        <input type="hidden" name="expectedVersion" value={String(version)} />
        <div class="form-head"><h2>Field Properties</h2><p>v{String(version)}</p></div>
        <FormRow>
          <Field label="Label"><input name="label" value={overrides.label ?? ""} /></Field>
          <Field label="Description"><input name="description" value={overrides.description ?? ""} /></Field>
          <Field label="Placeholder"><input name="placeholder" value={overrides.placeholder ?? ""} /></Field>
          <Field label="Required"><select name="required"><SelectOptions options={booleanOverrideOptions(overrides.required)} /></select></Field>
          <Field label="Mandatory Depends On JSON" variant="wide"><textarea name="mandatoryDependsOn" rows={4}>{overrides.mandatoryDependsOn === undefined ? "" : JSON.stringify(overrides.mandatoryDependsOn)}</textarea></Field>
          <Field label="Read Only"><select name="readOnly"><SelectOptions options={booleanOverrideOptions(overrides.readOnly)} /></select></Field>
          <Field label="Read Only Depends On JSON" variant="wide"><textarea name="readOnlyDependsOn" rows={4}>{overrides.readOnlyDependsOn === undefined ? "" : JSON.stringify(overrides.readOnlyDependsOn)}</textarea></Field>
          <Field label="Hidden"><select name="hidden"><SelectOptions options={booleanOverrideOptions(overrides.hidden)} /></select></Field>
          <Field label="Hidden Depends On JSON" variant="wide"><textarea name="hiddenDependsOn" rows={4}>{overrides.hiddenDependsOn === undefined ? "" : JSON.stringify(overrides.hiddenDependsOn)}</textarea></Field>
          <Field label="Print Hide"><select name="printHide"><SelectOptions options={booleanOverrideOptions(overrides.printHide)} /></select></Field>
          <Field label="Print Hide If Empty"><select name="printHideIfNoValue"><SelectOptions options={booleanOverrideOptions(overrides.printHideIfNoValue)} /></select></Field>
          <Field label="No Copy"><select name="noCopy"><SelectOptions options={booleanOverrideOptions(overrides.noCopy)} /></select></Field>
          <Field label="Allow On Submit"><select name="allowOnSubmit"><SelectOptions options={booleanOverrideOptions(overrides.allowOnSubmit)} /></select></Field>
          <MetaControl html={renderFetchFromControl({
            label: "Fetch From",
            name: "fetchFrom",
            value: overrides.fetchFrom ?? "",
            options: fetchFromChoices,
            datalistId: "field-property-fetch-from-options"
          })} />
          <Field label="Fetch If Empty"><select name="fetchIfEmpty"><SelectOptions options={booleanOverrideOptions(overrides.fetchIfEmpty)} /></select></Field>
          <Field label="Form View"><select name="inFormView"><SelectOptions options={booleanOverrideOptions(overrides.inFormView)} /></select></Field>
          <Field label="Global Search"><select name="inGlobalSearch"><SelectOptions options={booleanOverrideOptions(overrides.inGlobalSearch)} /></select></Field>
          <Field label="List View"><select name="inListView"><SelectOptions options={booleanOverrideOptions(overrides.inListView)} /></select></Field>
          <Field label="List Filter"><select name="inListFilter"><SelectOptions options={booleanOverrideOptions(overrides.inListFilter)} /></select></Field>
          <Field label="Options"><input name="options" value={(overrides.options ?? []).join(", ")} /></Field>
          <Field label="Minimum"><input name="min" type="number" step="any" value={overrides.min === undefined ? "" : String(overrides.min)} /></Field>
          <Field label="Maximum"><input name="max" type="number" step="any" value={overrides.max === undefined ? "" : String(overrides.max)} /></Field>
          <Field label="Default JSON"><textarea name="defaultValue">{overrides.defaultValue === undefined ? "" : JSON.stringify(overrides.defaultValue)}</textarea></Field>
        </FormRow>
        <ActionBar>
          <button class="button primary" type="submit">Save Properties</button>
          {current ? (
            <button class="button danger" type="submit" formaction={`/desk/admin/field-properties/${encodeURIComponent(state.selectedDoctype)}/${encodeURIComponent(selectedField)}/clear`}>Clear Override</button>
          ) : (
            ""
          )}
        </ActionBar>
      </form>
      <section class="panel">
        <div class="table-wrap">
          <table class="responsive-table">
            <thead><tr><th>Field</th><th>Overrides</th><th>Updated</th><th>Actions</th></tr></thead>
            <tbody>
              {entries.length === 0 ? (
                <tr><td colspan={4} class="empty">No field property overrides configured.</td></tr>
              ) : (
                entries.map((entry) => (
                  <tr>
                    <Cell label="Field">{entry.fieldName}</Cell>
                    <Cell label="Overrides">{renderFieldPropertyOverrides(entry.overrides)}</Cell>
                    <Cell label="Updated"><time datetime={entry.updatedAt}>{entry.updatedAt}</time></Cell>
                    <Cell label="Actions">
                      <form class="inline-action" method="post" action={`/desk/admin/field-properties/${encodeURIComponent(state.selectedDoctype)}/${encodeURIComponent(entry.fieldName)}/clear`}>
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
  return renderFragment(<WorkflowAdmin state={state} />);
}

const WorkflowAdmin: FC<{ state: WorkflowAdminState }> = ({ state }) => {
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
  const entries = state.state ?? [];
  return (
    <>
      <form class="panel form" method="get" action="/desk/admin/workflows">
        <FormRow columns={1}>
          <MetaControl html={renderDocTypeSelectControl({
            label: "DocType",
            name: "doctype",
            value: state.selectedDoctype,
            options: doctypeOptions(state.doctypes, state.selectedDoctype)
          })} />
          <Field label="Workflow"><input name="workflow" value={selectedWorkflowName} placeholder="lifecycle" /></Field>
        </FormRow>
        <ActionBar><button class="button primary" type="submit">Load</button></ActionBar>
      </form>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <form class="panel form" method="post" action="/desk/admin/workflows">
        <input type="hidden" name="doctype" value={state.selectedDoctype} />
        <input type="hidden" name="expectedVersion" value={String(version)} />
        <div class="form-head"><h2>{workflow === undefined ? "New Workflow" : "Workflow Definition"}</h2><p>v{String(version)}</p></div>
        <FormRow>
          <Field label="Name"><input name="name" value={selectedWorkflowName} /></Field>
          <Field label="Label"><input name="label" value={workflow?.label ?? ""} /></Field>
          <WorkflowStateFieldControl doctype={doctype} selected={workflow?.stateField ?? ""} />
          <WorkflowInitialStateControl states={workflowStates} selected={workflow?.initialState ?? ""} />
          <Field label="States"><textarea name="states">{states}</textarea></Field>
        </FormRow>
        <WorkflowTransitionControls transitions={workflow?.transitions ?? []} states={workflowStates} roleSuggestions={roleSuggestions} />
        <ActionBar>
          <button class="button primary" type="submit">Save Workflow</button>
          {workflow ? (
            <button class="button danger" type="submit" formaction={`/desk/admin/workflows/${encodeURIComponent(state.selectedDoctype)}/${encodeURIComponent(workflow.name)}/clear`}>Clear Workflow</button>
          ) : (
            ""
          )}
        </ActionBar>
      </form>
      <section class="panel">
        <div class="table-wrap">
          <table class="responsive-table">
            <thead><tr><th>Name</th><th>Label</th><th>State Field</th><th>Source</th><th>Version</th><th>Actions</th></tr></thead>
            <tbody>
              {entries.length === 0 ? (
                <tr><td colspan={6} class="empty">No workflows configured.</td></tr>
              ) : (
                entries.map((entry) => (
                  <tr>
                    <Cell label="Name">{entry.workflowName}</Cell>
                    <Cell label="Label">{entry.workflow?.label ?? ""}</Cell>
                    <Cell label="State Field">{entry.workflow?.stateField ?? ""}</Cell>
                    <Cell label="Source">{entry.cleared ? "cleared" : entry.version === 0 ? "static" : "runtime"}</Cell>
                    <Cell label="Version">{String(entry.version)}</Cell>
                    <Cell label="Actions"><a class="button" href={workflowAdminHref(state.selectedDoctype, entry.workflowName)}>Edit</a></Cell>
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
  return renderFragment(<NamingAdmin state={state} />);
}

const NamingAdmin: FC<{ state: NamingAdminState }> = ({ state }) => {
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
  const candidates = state.preview?.candidates ?? [];
  return (
    <>
      <form class="panel form" method="get" action="/desk/admin/naming">
        <FormRow columns={1}>
          <MetaControl html={renderDocTypeSelectControl({
            label: "DocType",
            name: "doctype",
            value: state.selectedDoctype,
            options: doctypeOptions(state.doctypes, state.selectedDoctype)
          })} />
        </FormRow>
        <ActionBar><button class="button primary" type="submit">Load</button></ActionBar>
      </form>
      {state.error ? <Notice tone="error">{state.error}</Notice> : null}
      <form class="panel form" method="post" action="/desk/admin/naming">
        <input type="hidden" name="doctype" value={state.selectedDoctype} />
        <input type="hidden" name="expectedVersion" value={String(version)} />
        <div class="form-head"><h2>Naming Strategy</h2><p>{state.state?.source ?? "default"} v{String(version)}</p></div>
        <FormRow>
          <Field label="Pattern" variant="wide"><input name="pattern" value={strategy.pattern} placeholder="RET-{YYYY}-{sequence:6}" /></Field>
          <Field label="Counter"><input name="counter" value={strategy.counter ?? ""} placeholder="returns" /></Field>
          <Field label="Generated Field">
            <select name="targetField"><SelectOptions options={namingTargetFieldOptions(targetFields, strategy.targetField)} /></select>
          </Field>
          <Field label="Default Padding"><input name="padding" type="number" min="1" max="18" value={String(strategy.padding ?? 6)} /></Field>
          <Field label="Start"><input name="start" type="number" min="1" value={String(strategy.start ?? 1)} /></Field>
          <Field label="Step"><input name="step" type="number" min="1" value={String(strategy.step ?? 1)} /></Field>
          <Field label="Reset"><select name="reset"><SelectOptions options={namingResetOptions(strategy.reset ?? "never")} /></select></Field>
          <Field label="Max Attempts"><input name="maxAttempts" type="number" min="1" max="10000" value={String(strategy.maxAttempts ?? 10000)} /></Field>
          <Field label="Exclusions JSON" variant="wide"><textarea name="exclusions" rows={6}>{JSON.stringify(strategy.exclusions ?? [], null, 2)}</textarea></Field>
        </FormRow>
        <fieldset class="panel-section"><legend>Counter Scope Fields</legend>
          <div class="quick-filter-choice">
            {scopeFields.length === 0 ? (
              <p class="empty">No scalar fields are available.</p>
            ) : (
              scopeFields.map((field) => (
                <label><input type="checkbox" name="scopeField" value={field.name} checked={selectedScopes.has(field.name)} /> <span>{field.label ?? field.name}</span></label>
              ))
            )}
          </div>
        </fieldset>
        <ActionBar>
          <button class="button primary" type="submit">Save Strategy</button>
          {state.state?.runtimeStrategy === undefined ? (
            ""
          ) : (
            <button class="button danger" type="submit" formaction={`/desk/admin/naming/${encodeURIComponent(state.selectedDoctype)}/clear`}>Clear Runtime Strategy</button>
          )}
        </ActionBar>
      </form>
      <form class="panel form" method="post" action="/desk/admin/naming/preview">
        <input type="hidden" name="doctype" value={state.selectedDoctype} />
        <div class="form-head"><h2>Preview</h2><p>Does not consume numbers</p></div>
        <FormRow>
          <Field label="Scope / Token Data JSON" variant="wide"><textarea name="data" rows={5}>{JSON.stringify(previewData, null, 2)}</textarea></Field>
          <Field label="Count"><input name="count" type="number" min="1" max="100" value={String(state.preview?.candidates.length ?? 5)} /></Field>
        </FormRow>
        <ActionBar><button class="button primary" type="submit">Preview IDs</button></ActionBar>
      </form>
      <Panel title="Upcoming IDs" meta={namingCounterSummary(state.preview)}>
        <div class="table-wrap"><table class="responsive-table">
          <thead><tr><th>Sequence</th><th>Generated ID</th></tr></thead>
          <tbody>
            {candidates.length === 0 ? (
              <tr><td colspan={2} class="empty">Provide required token or scope data to preview this strategy.</td></tr>
            ) : (
              candidates.map((candidate) => (
                <tr>
                  <Cell label="Sequence">{String(candidate.value)}</Cell>
                  <Cell label="Generated ID"><code>{candidate.name}</code></Cell>
                </tr>
              ))
            )}
          </tbody>
        </table></div>
      </Panel>
      <form class="panel form" method="post" action="/desk/admin/naming/counter">
        <input type="hidden" name="doctype" value={state.selectedDoctype} />
        <input type="hidden" name="expectedVersion" value={String(state.preview?.counterVersion ?? 0)} />
        <div class="form-head"><h2>Advance Counter</h2><p>Forward only</p></div>
        <FormRow>
          <Field label="Current Value"><input name="current" type="number" min="0" value={String(state.preview?.current ?? 0)} /></Field>
          <Field label="Scope / Token Data JSON" variant="wide"><textarea name="data" rows={5}>{JSON.stringify(previewData, null, 2)}</textarea></Field>
        </FormRow>
        <ActionBar><button class="button" type="submit">Advance Counter</button></ActionBar>
      </form>
    </>
  );
};

function namingTargetFieldOptions(
  targetFields: readonly FieldDefinition[],
  selected: string | undefined
): readonly SelectOptionSpec[] {
  return [
    { value: "", label: "Document name only" },
    ...targetFields.map((field) => ({
      value: field.name,
      label: field.label ?? field.name,
      selected: field.name === selected
    }))
  ];
}

function namingResetOptions(selected: string): readonly SelectOptionSpec[] {
  return [
    ["never", "Never"],
    ["year", "Every year"],
    ["month", "Every month"],
    ["day", "Every day"]
  ].map(([value, label]) => ({ value: value ?? "", label, selected: selected === value }));
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

function booleanOverrideOptions(value: boolean | undefined): readonly SelectOptionSpec[] {
  return [
    { value: "", label: "Inherit", selected: value === undefined },
    { value: "true", label: "True", selected: value === true },
    { value: "false", label: "False", selected: value === false }
  ];
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

const WorkflowStateFieldControl: FC<{ doctype: DocTypeDefinition | undefined; selected: string }> = ({
  doctype,
  selected
}) => {
  const options = fieldOptions(doctype, selected, isWorkflowStateField);
  if (options.length > 0) {
    return (
      <MetaControl html={renderFieldSelectControl({
        label: "State Field",
        name: "stateField",
        value: selected,
        options
      })} />
    );
  }
  return <Field label="State Field"><input name="stateField" value={selected} /></Field>;
};

const WorkflowInitialStateControl: FC<{ states: readonly string[]; selected: string }> = ({ states, selected }) => {
  if (states.length === 0) {
    return <Field label="Initial State"><input name="initialState" value={selected} /></Field>;
  }
  return (
    <Field label="Initial State"><select name="initialState"><SelectOptions options={stringOptionSpecs(states, selected, true)} /></select></Field>
  );
};

const WorkflowTransitionControls: FC<{
  transitions: readonly NamedWorkflowTransition[];
  states: readonly string[];
  roleSuggestions: readonly string[];
}> = ({ transitions, states, roleSuggestions }) => {
  const rows = transitions.length === 0 ? [undefined, undefined, undefined] : [...transitions, undefined];
  return (
    <fieldset class="admin-row-builder workflow-transition-builder">
      <legend>Transitions</legend>
      <div class="admin-row-list">
        {rows.map((transition, index) => (
          <WorkflowTransitionControlRow transition={transition} index={index} states={states} roleSuggestions={roleSuggestions} />
        ))}
      </div>
    </fieldset>
  );
};

const WorkflowTransitionControlRow: FC<{
  transition: NamedWorkflowTransition | undefined;
  index: number;
  states: readonly string[];
  roleSuggestions: readonly string[];
}> = ({ transition, index, states, roleSuggestions }) => {
  const action = transition?.action ?? "";
  const from = transition?.from ?? "";
  const to = transition?.to ?? "";
  const roles = (transition?.roles ?? []).join(", ");
  const allowWhen = transition?.allowWhen === undefined ? "" : JSON.stringify(transition.allowWhen, null, 2);
  const eventType = transition?.eventType ?? "";
  const fromControl = states.length === 0
    ? <input name="transitionFrom" value={from} />
    : <select name="transitionFrom"><SelectOptions options={stringOptionSpecs(states, from, true)} /></select>;
  const toControl = states.length === 0
    ? <input name="transitionTo" value={to} />
    : <select name="transitionTo"><SelectOptions options={stringOptionSpecs(states, to, true)} /></select>;
  return (
    <div class="admin-row" data-cf-frappe-workflow-transition-row="">
      <Field label={`Action ${String(index + 1)}`} variant="compact"><input name="transitionAction" value={action} /></Field>
      <Field label="From" variant="compact">{fromControl}</Field>
      <Field label="To" variant="compact">{toControl}</Field>
      <MetaControl html={renderRoleMultiSelectorControl({
        label: "Roles",
        name: "transitionRoles",
        value: roles,
        options: stringOptions(roleSuggestions, roles),
        datalistId: index === 0 ? "workflow-role-suggestions" : `workflow-role-suggestions-${String(index)}`,
        className: "field compact"
      })} />
      <Field label="Allow When JSON" variant="compact"><textarea name="transitionAllowWhen" rows={3}>{allowWhen}</textarea></Field>
      <Field label="Event Type" variant="compact"><input name="transitionEventType" value={eventType} /></Field>
    </div>
  );
};

function stringOptionSpecs(values: readonly string[], selected: string, includeBlank = false): readonly SelectOptionSpec[] {
  const specs: SelectOptionSpec[] = includeBlank ? [{ value: "", label: "", selected: selected === "" }] : [];
  const seen = new Set<string>();
  if (selected && !values.includes(selected)) {
    specs.push({ value: selected, selected: true });
    seen.add(selected);
  }
  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }
    seen.add(value);
    specs.push({ value, selected: value === selected });
  }
  return specs;
}

function customFieldTypeOptions(selected = ""): readonly SelectOptionSpec[] {
  return FIELD_TYPES.map((type) => ({ value: type, selected: type === selected }));
}

const CustomFieldCheckbox: FC<{ name: string; label: string; checked?: boolean | undefined }> = ({
  name,
  label,
  checked = false
}) => (
  <label class="choice"><input type="checkbox" name={name} value="1" checked={checked} /><span>{label}</span></label>
);

const CustomFieldDetails: FC<{ field: FieldDefinition }> = ({ field }) => {
  const items = [
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
  ].filter(Boolean);
  return (
    <>
      {items.map((item, index) => (
        <>
          {index > 0 ? <br /> : null}
          {item}
        </>
      ))}
    </>
  );
};

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
