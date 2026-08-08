import type { FC } from "hono/jsx";
import { type ClientScriptDefinition } from "../../../core/client-script.js";
import { type DocTypeDefinition, type DocumentSnapshot, type FieldDefinition, type JsonValue, type ListDocumentsFilter, type ListFilterBuilderField, type ListFilterControlDefinition, type ListFilterExpression, type ListFilterGroup, type ListFilterOperator, type ResolvedListView } from "../../../core/types.js";
import { type DocumentImportMode, type DocumentImportResult } from "../../../application/document-import-service.js";
import { type SavedListFilter } from "../../../application/saved-list-filter-service.js";
import { isListFilterGroup } from "../../../core/list-view.js";
import { formatCompoundFilterVisualValue, formatFormValue, formatValue, labelFor, renderClientScripts, renderCompoundFilterFieldOptions, renderCompoundFilterMatchOptions, slug } from "./shared.js";
import { ActionBar, SelectOptions, UnsafeRawHtml, renderFragment, type SelectOptionSpec } from "../ui/primitives.js";

export const DESK_QUICK_FILTER_OPERATOR_QUERY_PREFIX = "quick_filter_operator:";

export const DESK_QUICK_FILTER_VALUE_QUERY_PREFIX = "quick_filter_value:";

export interface ListBulkAction {
  readonly id: string;
  readonly label: string;
  readonly action: string;
  readonly names: readonly string[];
  readonly variant?: "danger";
}

type ListViewOptions = {
  readonly savedFilters?: readonly SavedListFilter[] | undefined;
  readonly selectedSavedFilterId?: string | undefined;
  readonly filterExpression?: ListFilterExpression | undefined;
  readonly exportHref?: string | undefined;
  readonly clientScripts?: readonly ClientScriptDefinition[] | undefined;
  readonly realtimeRoute?: string | undefined;
  readonly bulkActions?: readonly ListBulkAction[] | undefined;
  readonly bulkReturnHref?: string | undefined;
  readonly importModes?: readonly DocumentImportMode[] | undefined;
  readonly importReturnHref?: string | undefined;
  readonly importResult?: DocumentImportResult | undefined;
  readonly canCreate?: boolean | undefined;
};

export function renderListView(
  doctype: DocTypeDefinition,
  listView: ResolvedListView,
  documents: readonly DocumentSnapshot[],
  filters: readonly ListDocumentsFilter[] = [],
  options: {
    readonly savedFilters?: readonly SavedListFilter[];
    readonly selectedSavedFilterId?: string;
    readonly filterExpression?: ListFilterExpression;
    readonly exportHref?: string;
    readonly clientScripts?: readonly ClientScriptDefinition[];
    readonly realtimeRoute?: string;
    readonly bulkActions?: readonly ListBulkAction[];
    readonly bulkReturnHref?: string;
    readonly importModes?: readonly DocumentImportMode[];
    readonly importReturnHref?: string;
    readonly importResult?: DocumentImportResult;
    readonly canCreate?: boolean;
  } = {}
): string {
  return renderFragment(
    <ListView doctype={doctype} listView={listView} documents={documents} filters={filters} options={options} />
  );
}

const ListView: FC<{
  doctype: DocTypeDefinition;
  listView: ResolvedListView;
  documents: readonly DocumentSnapshot[];
  filters: readonly ListDocumentsFilter[];
  options: ListViewOptions;
}> = ({ doctype, listView, documents, filters, options }) => {
  const fields = listView.columns;
  const filterFields = listView.filterFields;
  const filterControlsByField = new Map<string, ListFilterControlDefinition[]>();
  for (const control of listView.filterControls) {
    const controls = filterControlsByField.get(control.field) ?? [];
    controls.push(control);
    filterControlsByField.set(control.field, controls);
  }
  const hasQuickFilterControls = filterFields.some(
    (field) => (filterControlsByField.get(field.name) ?? []).length > 0
  );
  const hasCompoundFilterBuilder = listView.filterBuilderFields.length > 0;
  const canSaveFilter = hasQuickFilterControls || hasCompoundFilterBuilder;
  const bulkActions = options.bulkActions ?? [];
  const importModes = options.importModes ?? [];
  const selectableNames = new Set(bulkActions.flatMap((action) => action.names));
  const hasBulkActions = selectableNames.size > 0;
  const bulkActionFormId = "bulk-document-action";
  const fieldLabels = fields.map((field) => field.label ?? field.name);
  const recordCount = `${String(documents.length)} ${documents.length === 1 ? "record" : "records"}`;
  const hasActiveFilters = filters.length > 0 || options.filterExpression !== undefined;
  return (
    <>
      <section class="toolbar list-toolbar">
        <div class="toolbar-main">
          {options.canCreate === false ? null : (
            <a class="button primary" href={`/desk/${encodeURIComponent(doctype.name)}/new`}>New {labelFor(doctype)}</a>
          )}
          {options.exportHref ? <a class="button" href={options.exportHref}>Export CSV</a> : null}
          {hasBulkActions ? (
            <>
              <form id={bulkActionFormId} method="post" action={bulkActions[0]?.action ?? ""}>
                {options.bulkReturnHref ? <input type="hidden" name="returnTo" value={options.bulkReturnHref} /> : null}
              </form>
              {bulkActions.map((action) => (
                <button
                  class={action.variant === "danger" ? "button danger" : "button"}
                  type="submit"
                  form={bulkActionFormId}
                  formaction={action.action}
                >{action.label}</button>
              ))}
            </>
          ) : null}
        </div>
        <div class="toolbar-aside"><span class="record-count">{recordCount}</span></div>
      </section>
      {hasActiveFilters ? (
        <div class="active-filter-bar">
          <ActiveListFilters filters={filters} expression={options.filterExpression} />
        </div>
      ) : null}
      <section class="panel list-table-panel">
        <div class="table-wrap">
          <table class="document-table">
            <thead>
              <tr>{hasBulkActions ? <th>Select</th> : null}<th>Name</th>{fields.map((field) => <th>{field.label ?? field.name}</th>)}<th>Version</th><th>Updated</th></tr>
            </thead>
            <tbody>
              {documents.length === 0 ? (
                <tr><td colspan={fields.length + (hasBulkActions ? 4 : 3)} class="empty">No documents yet.</td></tr>
              ) : (
                documents.map((document) => (
                  <tr>
                    {hasBulkActions ? (
                      <BulkDocumentActionCell
                        document={document}
                        selectable={selectableNames.has(document.name)}
                        formId={bulkActionFormId}
                      />
                    ) : null}
                    <td data-label="Name"><a href={`/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(document.name)}`}>{document.name}</a></td>
                    {fields.map((field, index) => (
                      <td data-label={fieldLabels[index] ?? field.name}><ListCellValue field={field} value={document.data[field.name]} /></td>
                    ))}
                    <td data-label="Version"><span class="version-pill">v{String(document.version)}</span></td>
                    <td data-label="Updated"><time datetime={document.updatedAt}>{document.updatedAt}</time></td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
      <SavedFiltersPanel
        doctype={doctype}
        savedFilters={options.savedFilters ?? []}
        selectedId={options.selectedSavedFilterId}
      />
      {/* Order controls always exist, so the disclosure always renders (mirrors the legacy truthiness check). */}
      <details class="desk-disclosure list-filters" open={hasActiveFilters}>
        <summary><span>Filters and sort</span><small>{listFilterSummary(filters, options.filterExpression)}</small></summary>
        <form class="form list-filter-form" method="get">
          <div class="fields">
            {filterFields.map((field) => (
              <FilterControlsForField field={field} filters={filters} controls={filterControlsByField.get(field.name) ?? []} />
            ))}
            {hasCompoundFilterBuilder ? (
              <UnsafeRawHtml
                reason="compound filter builder markup requires bare data-cf-frappe-* attributes (cloned as templates by client.js and asserted byte-for-byte by desk tests) that hono/jsx cannot serialize; all interpolated values are escaped internally"
                html={renderCompoundFilterBuilderHtml(listView, options.filterExpression)}
              />
            ) : null}
            <ListOrderControls listView={listView} />
            {canSaveFilter ? (
              <label class="field" for="saved-filter-label"><span>Saved filter name</span><input id="saved-filter-label" name="saved_filter_label" type="text" /></label>
            ) : null}
          </div>
          <ActionBar>
            <button class="button primary" type="submit">Filter</button>
            {canSaveFilter ? (
              <button class="button" type="submit" formmethod="post" formaction={`/desk/${encodeURIComponent(doctype.name)}/saved-filters`}>Save filter</button>
            ) : null}
            <a class="button" href={`/desk/${encodeURIComponent(doctype.name)}?default_filters=0`}>Clear</a>
          </ActionBar>
        </form>
      </details>
      {importModes.length > 0 ? (
        <details class="desk-disclosure list-import-disclosure" open={options.importResult !== undefined}>
          <summary><span>Import CSV</span><small>Create or update records from a pasted CSV.</small></summary>
          <ListImportPanel
            doctype={doctype}
            modes={importModes}
            result={options.importResult}
            returnHref={options.importReturnHref}
          />
        </details>
      ) : null}
      <UnsafeRawHtml
        reason="pre-built desk client runtime script tags from shared renderClientScripts; attributes escaped internally"
        html={renderClientScripts(doctype.name, "list", options.clientScripts ?? [], undefined, undefined, options.realtimeRoute)}
      />
    </>
  );
};

const ListCellValue: FC<{ field: FieldDefinition; value: JsonValue | undefined }> = ({ field, value }) => {
  const formatted = formatValue(value);
  if (formatted === "") {
    return <span class="empty">-</span>;
  }
  if (field.type === "select" || field.name.toLowerCase().includes("state") || field.name.toLowerCase().includes("status")) {
    return <span class={`value-chip value-chip-${slug(formatted) || "value"}`}>{formatted}</span>;
  }
  return <>{formatted}</>;
};

function listFilterSummary(
  filters: readonly ListDocumentsFilter[],
  expression: ListFilterExpression | undefined
): string {
  const count = filters.length + (expression === undefined ? 0 : 1);
  return count === 0 ? "Ready when needed" : `${String(count)} active`;
}

const ActiveListFilters: FC<{
  filters: readonly ListDocumentsFilter[];
  expression: ListFilterExpression | undefined;
}> = ({ filters, expression }) => (
  <>
    {filters.map((filter) => (
      <span class="filter-chip">{`${filter.field} ${filter.operator ?? "eq"} ${formatValue(filter.value)}`}</span>
    ))}
    {expression === undefined ? null : <span class="filter-chip">Advanced expression</span>}
  </>
);

const ListImportPanel: FC<{
  doctype: DocTypeDefinition;
  modes: readonly DocumentImportMode[];
  result: DocumentImportResult | undefined;
  returnHref: string | undefined;
}> = ({ doctype, modes, result, returnHref }) => {
  const action = `/desk/${encodeURIComponent(doctype.name)}/import.csv`;
  const templateHref = `/desk/${encodeURIComponent(doctype.name)}/import-template.csv`;
  const selectedMode = result?.mode ?? modes[0];
  const modeOptions: readonly SelectOptionSpec[] = modes.map((mode) => ({
    value: mode,
    label: mode === "create" ? "Create" : "Update",
    selected: selectedMode === mode
  }));
  return (
    <section class="panel list-import">
      {result ? <ListImportResult result={result} /> : null}
      <form class="form" method="post" action={action}>
        {returnHref ? <input type="hidden" name="returnTo" value={returnHref} /> : null}
        <div class="fields">
          <label class="field" for="import-mode"><span>Import Mode</span><select id="import-mode" name="mode"><SelectOptions options={modeOptions} /></select></label>
          <label class="field wide" for="import-csv"><span>CSV</span><textarea id="import-csv" name="csv" rows={6} required></textarea></label>
        </div>
        <ActionBar>
          <a class="button" href={templateHref}>Download template</a>
          <button class="button" type="submit">Import CSV</button>
        </ActionBar>
      </form>
    </section>
  );
};

const ListImportResult: FC<{ result: DocumentImportResult }> = ({ result }) => (
  <div class={result.failed.length > 0 ? "error" : "notice"} role="status">
    Imported {String(result.succeeded.length)} of {String(result.total)} {result.doctype} rows.
    {result.failed.length > 0 ? (
      <ul class="import-failures">
        {result.failed.map((failure) => (
          <li>Row {String(failure.row)}{failure.name ? ` (${failure.name})` : ""}: {failure.message}</li>
        ))}
      </ul>
    ) : null}
  </div>
);

/**
 * Escapes text through hono/jsx's default escaper (the same five entities the
 * legacy escapeHtml emitted) for interpolation into the raw compound-filter
 * markup below, which cannot be expressed as JSX (see the UnsafeRawHtml
 * reason where it is embedded).
 */
function escapeRawText(value: string): string {
  return renderFragment(<>{value}</>);
}

function renderCompoundFilterBuilderHtml(
  listView: ResolvedListView,
  expression: ListFilterExpression | undefined
): string {
  if (listView.filterBuilderFields.length === 0) {
    return "";
  }
  const value = expression === undefined ? "" : JSON.stringify(expression, null, 2);
  const visualGroup = compoundFilterVisualGroup(expression);
  return `<details class="nested-disclosure compound-filter-disclosure"${expression === undefined ? "" : " open"}>
    <summary>Advanced filters</summary>
    <fieldset class="compound-filter-builder" data-cf-frappe-compound-filter-builder data-filter-fields="${escapeRawText(JSON.stringify(listView.filterBuilderFields))}">
      <legend>Compound filters</legend>
      <div class="compound-filter-visual">
        ${renderCompoundFilterGroupHtml(listView.filterBuilderFields, visualGroup, true)}
      </div>
      <template data-cf-frappe-filter-row-template>${renderCompoundFilterRowHtml(listView.filterBuilderFields, undefined)}</template>
      <template data-cf-frappe-filter-group-template>${renderCompoundFilterGroupHtml(listView.filterBuilderFields, { kind: "group", match: "all", filters: [] }, false)}</template>
      <label class="field wide" for="filter-expression"><span>Advanced JSON</span><textarea id="filter-expression" name="filter_expression" rows="5">${escapeRawText(value)}</textarea></label>
      ${expression === undefined ? "" : `<div class="filter-expression-preview">${renderFragment(<ListFilterExpressionView expression={expression} />)}</div>`}
    </fieldset>
  </details>`;
}

function compoundFilterVisualGroup(expression: ListFilterExpression | undefined): ListFilterGroup {
  if (expression === undefined) {
    return { kind: "group", match: "all", filters: [] };
  }
  if (!isListFilterGroup(expression)) {
    return { kind: "group", match: "all", filters: [expression] };
  }
  return expression;
}

function renderCompoundFilterGroupHtml(
  fields: readonly ListFilterBuilderField[],
  group: ListFilterGroup,
  root: boolean
): string {
  const items = group.filters.length > 0 ? group.filters : [undefined];
  return `<div class="compound-filter-group${root ? " compound-filter-root" : ""}" data-cf-frappe-filter-group>
    <div class="compound-filter-group-head">
      <label class="field compact"><span>Match</span><select data-cf-frappe-filter-match>${renderCompoundFilterMatchOptions(group.match)}</select></label>
      <div class="compound-filter-group-actions">
        <button class="button" type="button" data-cf-frappe-add-filter>Add condition</button>
        <button class="button" type="button" data-cf-frappe-add-filter-group>Add group</button>
        ${root ? "" : `<button class="button" type="button" data-cf-frappe-remove-filter-group>Remove group</button>`}
      </div>
    </div>
    <div class="compound-filter-items compound-filter-rows" data-cf-frappe-filter-items data-cf-frappe-filter-rows>${items
      .map((item) =>
        item === undefined
          ? renderCompoundFilterRowHtml(fields, undefined)
          : isListFilterGroup(item)
            ? renderCompoundFilterGroupHtml(fields, item, false)
            : renderCompoundFilterRowHtml(fields, item)
      )
      .join("")}</div>
  </div>`;
}

function renderCompoundFilterRowHtml(
  fields: readonly ListFilterBuilderField[],
  filter: ListDocumentsFilter | undefined
): string {
  const fieldName = filter?.field ?? "";
  const operator = filter?.operator ?? "eq";
  const builderField = fields.find((field) => field.field === fieldName);
  const inputType = compoundFilterValueInputType(builderField?.inputType, operator);
  return `<div class="compound-filter-row" data-cf-frappe-filter-row>
    <label class="field compact"><span>Field</span><select data-cf-frappe-filter-field>${renderCompoundFilterFieldOptions(fields, fieldName)}</select></label>
    <label class="field compact"><span>Operator</span><select data-cf-frappe-filter-operator>${compoundFilterOperatorOptionsHtml(fields, builderField, operator)}</select></label>
    <label class="field grow"><span>Value</span><input data-cf-frappe-filter-value type="${escapeRawText(inputType)}" value="${escapeRawText(filter === undefined ? "" : formatCompoundFilterVisualValue(filter.value))}"></label>
    <button class="button" type="button" data-cf-frappe-remove-filter>Remove</button>
  </div>`;
}

function compoundFilterValueInputType(
  inputType: ListFilterBuilderField["inputType"] | undefined,
  operator: ListFilterOperator
): string {
  if (operator === "in" || operator === "not_in" || operator === "between" || operator === "not_between") {
    return "text";
  }
  return inputType === "number" || inputType === "date" || inputType === "datetime-local" ? inputType : "text";
}

function compoundFilterOperatorOptionsHtml(
  fields: readonly ListFilterBuilderField[],
  selectedField: ListFilterBuilderField | undefined,
  selected: ListFilterOperator
): string {
  const operators = selectedField?.operators ?? uniqueListFilterOperators(fields);
  return renderFragment(
    <SelectOptions
      options={operators.map((operator) => ({
        value: operator.operator,
        label: operator.label,
        selected: operator.operator === selected
      }))}
    />
  );
}

function uniqueListFilterOperators(fields: readonly ListFilterBuilderField[]): ListFilterBuilderField["operators"] {
  const seen = new Set<ListFilterOperator>();
  return fields.flatMap((field) =>
    field.operators.filter((operator) => {
      if (seen.has(operator.operator)) {
        return false;
      }
      seen.add(operator.operator);
      return true;
    })
  );
}

const ListFilterExpressionView: FC<{ expression: ListFilterExpression }> = ({ expression }) => {
  if (isListFilterGroup(expression)) {
    const label = expression.match === "all" ? "All" : "Any";
    return (
      <section class="filter-expression-group"><strong>{label}</strong><ul>{expression.filters.map((filter) => <li><ListFilterExpressionView expression={filter} /></li>)}</ul></section>
    );
  }
  return <span class="filter-expression-leaf">{`${expression.field} ${expression.operator ?? "eq"} ${formatValue(expression.value)}`}</span>;
};

const ListOrderControls: FC<{ listView: ResolvedListView }> = ({ listView }) => {
  const orderOptions: readonly SelectOptionSpec[] = listView.orderOptions.map((option) => ({
    value: option.name,
    label: option.label,
    selected: option.name === listView.orderBy
  }));
  const directionOptions: readonly SelectOptionSpec[] = [
    { value: "desc", label: "Descending", selected: listView.order === "desc" },
    { value: "asc", label: "Ascending", selected: listView.order === "asc" }
  ];
  return (
    <>
      <label class="field" for="list-order-by"><span>Order By</span><select id="list-order-by" name="order_by"><SelectOptions options={orderOptions} /></select></label>
      <label class="field" for="list-order"><span>Direction</span><select id="list-order" name="order"><SelectOptions options={directionOptions} /></select></label>
    </>
  );
};

const BulkDocumentActionCell: FC<{ document: DocumentSnapshot; selectable: boolean; formId: string }> = ({
  document,
  selectable,
  formId
}) => {
  if (!selectable) {
    return <td data-label="Select"></td>;
  }
  return (
    <td data-label="Select"><input class="bulk-select" form={formId} name="document" type="checkbox" value={document.name} aria-label={`Select ${document.name}`} /><input form={formId} name={`expectedVersion:${document.name}`} type="hidden" value={String(document.version)} /></td>
  );
};

const SavedFiltersPanel: FC<{
  doctype: DocTypeDefinition;
  savedFilters: readonly SavedListFilter[];
  selectedId: string | undefined;
}> = ({ doctype, savedFilters, selectedId }) => {
  if (savedFilters.length === 0) {
    return null;
  }
  return (
    <section class="panel saved-filters" aria-label="Saved filters">
      <h2>Saved filters</h2>
      <ul>
        {savedFilters.map((filter) => (
          <li>
            <a
              class={`saved-filter-link${filter.id === selectedId ? " is-active" : ""}`}
              href={`/desk/${encodeURIComponent(doctype.name)}?saved_filter=${encodeURIComponent(filter.id)}`}
            >{filter.label}</a>
            <form class="inline-action" method="post">
              <button class="button" type="submit" formaction={`/desk/${encodeURIComponent(doctype.name)}/saved-filters/${encodeURIComponent(filter.id)}/delete`}>Delete</button>
            </form>
          </li>
        ))}
      </ul>
    </section>
  );
};

const FilterControl: FC<{
  field: FieldDefinition;
  filters: readonly ListDocumentsFilter[];
  control: ListFilterControlDefinition;
}> = ({ field, filters, control }) => {
  const id = `filter-${slug(field.name)}`;
  const label = renderFilterLabel(field, control);
  const operator = control.operator;
  const value = currentFilterValue(filters, field.name, operator);
  if (field.type === "select") {
    return (
      <label class="field" for={`${id}-${operator}`}><span>{label}</span><select id={`${id}-${operator}`} name={control.queryKey}><SelectOptions options={selectFieldOptions(field, value)} /></select></label>
    );
  }
  if (field.type === "boolean") {
    return (
      <label class="field" for={`${id}-${operator}`}><span>{label}</span><select id={`${id}-${operator}`} name={control.queryKey}><SelectOptions options={booleanFieldOptions(value)} /></select></label>
    );
  }
  return (
    <label class="field" for={`${id}-${operator}`}><span>{label}</span><input type={control.inputType} id={`${id}-${operator}`} name={control.queryKey} value={value} /></label>
  );
};

function selectFieldOptions(field: FieldDefinition, value: string): readonly SelectOptionSpec[] {
  return [
    { value: "" },
    ...(field.options ?? []).map((option) => ({ value: option, selected: option === value }))
  ];
}

function booleanFieldOptions(value: string): readonly SelectOptionSpec[] {
  return [
    { value: "" },
    { value: "true", label: "True", selected: value === "true" },
    { value: "false", label: "False", selected: value === "false" }
  ];
}

const FilterControlsForField: FC<{
  field: FieldDefinition;
  filters: readonly ListDocumentsFilter[];
  controls: readonly ListFilterControlDefinition[];
}> = ({ field, filters, controls }) => {
  const choiceControls = quickFilterChoiceControls(controls);
  if (choiceControls) {
    const activeControl = activeQuickFilterControl(field.name, filters, choiceControls);
    if (activeControl) {
      return (
        <QuickFilterChoiceControl field={field} filters={filters} controls={choiceControls} activeControl={activeControl} />
      );
    }
  }
  return (
    <>
      {controls.map((control) => (
        <FilterControl field={field} filters={filters} control={control} />
      ))}
    </>
  );
};

function quickFilterChoiceControls(
  controls: readonly ListFilterControlDefinition[]
): readonly [ListFilterControlDefinition, ListFilterControlDefinition] | undefined {
  if (controls.length !== 2) {
    return undefined;
  }
  const negative = controls.find((control) => control.operator === "ne");
  const primary = controls.find((control) => control.operator === "eq" || control.operator === "contains");
  if (!primary || !negative) {
    return undefined;
  }
  return [primary, negative];
}

function activeQuickFilterControl(
  field: string,
  filters: readonly ListDocumentsFilter[],
  controls: readonly [ListFilterControlDefinition, ListFilterControlDefinition]
): ListFilterControlDefinition | undefined {
  const activeControls = controls.filter((control) =>
    filters.some((filter) => filter.field === field && (filter.operator ?? "eq") === control.operator)
  );
  if (activeControls.length > 1) {
    return undefined;
  }
  return activeControls[0] ?? controls[0];
}

const QuickFilterChoiceControl: FC<{
  field: FieldDefinition;
  filters: readonly ListDocumentsFilter[];
  controls: readonly [ListFilterControlDefinition, ListFilterControlDefinition];
  activeControl: ListFilterControlDefinition;
}> = ({ field, filters, controls, activeControl }) => {
  const id = `filter-${slug(field.name)}`;
  const value = currentFilterValue(filters, field.name, activeControl.operator);
  const operatorName = `${DESK_QUICK_FILTER_OPERATOR_QUERY_PREFIX}${field.name}`;
  const valueName = `${DESK_QUICK_FILTER_VALUE_QUERY_PREFIX}${field.name}`;
  const operatorOptions: readonly SelectOptionSpec[] = controls.map((control) => ({
    value: control.operator,
    label: control.operatorLabel,
    selected: control.operator === activeControl.operator
  }));
  return (
    <fieldset class="quick-filter-choice">
      <legend>{field.label ?? field.name}</legend>
      <label class="field compact" for={`${id}-operator`}><span>Operator</span><select id={`${id}-operator`} name={operatorName}><SelectOptions options={operatorOptions} /></select></label>
      <QuickFilterChoiceValueControl field={field} control={activeControl} id={id} name={valueName} value={value} />
    </fieldset>
  );
};

const QuickFilterChoiceValueControl: FC<{
  field: FieldDefinition;
  control: ListFilterControlDefinition;
  id: string;
  name: string;
  value: string;
}> = ({ field, control, id, name, value }) => {
  if (field.type === "select") {
    return (
      <label class="field grow" for={`${id}-value`}><span>Value</span><select id={`${id}-value`} name={name}><SelectOptions options={selectFieldOptions(field, value)} /></select></label>
    );
  }
  if (field.type === "boolean") {
    return (
      <label class="field grow" for={`${id}-value`}><span>Value</span><select id={`${id}-value`} name={name}><SelectOptions options={booleanFieldOptions(value)} /></select></label>
    );
  }
  return (
    <label class="field grow" for={`${id}-value`}><span>Value</span><input type={control.inputType} id={`${id}-value`} name={name} value={value} /></label>
  );
};

function renderFilterLabel(field: FieldDefinition, control: ListFilterControlDefinition): string {
  const label = field.label ?? field.name;
  if (control.labelSuffix === "is not") {
    return `Exclude ${label}`;
  }
  return control.labelSuffix ? `${label} ${control.labelSuffix}` : label;
}

function currentFilterValue(
  filters: readonly ListDocumentsFilter[],
  field: string,
  operator: ListFilterOperator
): string {
  const filter = filters.find((item) => item.field === field && (item.operator ?? "eq") === operator);
  if (!filter) {
    return "";
  }
  return formatFormValue(filter.value);
}
