import { type ClientScriptDefinition } from "../../../core/client-script.js";
import { type DocTypeDefinition, type DocumentSnapshot, type FieldDefinition, type JsonValue, type ListDocumentsFilter, type ListFilterBuilderField, type ListFilterControlDefinition, type ListFilterExpression, type ListFilterGroup, type ListFilterOperator, type ResolvedListView } from "../../../core/types.js";
import { type DocumentImportMode, type DocumentImportResult } from "../../../application/document-import-service.js";
import { type SavedListFilter } from "../../../application/saved-list-filter-service.js";
import { isListFilterGroup } from "../../../core/list-view.js";
import { escapeHtml, formatCompoundFilterVisualValue, formatFormValue, formatValue, inputType, labelFor, renderClientScripts, renderCompoundFilterFieldOptions, renderCompoundFilterMatchOptions, slug } from "./shared.js";

export const DESK_QUICK_FILTER_OPERATOR_QUERY_PREFIX = "quick_filter_operator:";

export const DESK_QUICK_FILTER_VALUE_QUERY_PREFIX = "quick_filter_value:";

export interface ListBulkAction {
  readonly id: string;
  readonly label: string;
  readonly action: string;
  readonly names: readonly string[];
  readonly variant?: "danger";
}

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
  const fields = listView.columns;
  const filterFields = listView.filterFields;
  const filterControlsByField = new Map<string, ListFilterControlDefinition[]>();
  for (const control of listView.filterControls) {
    const controls = filterControlsByField.get(control.field) ?? [];
    controls.push(control);
    filterControlsByField.set(control.field, controls);
  }
  const filterForm = filterFields
    .map((field) => renderFilterControlsForField(field, filters, filterControlsByField.get(field.name) ?? []))
    .join("");
  const compoundFilterForm = renderCompoundFilterBuilder(listView, options.filterExpression);
  const orderForm = renderListOrderControls(listView);
  const canSaveFilter = Boolean(filterForm || compoundFilterForm);
  const savedFilterControl = canSaveFilter
    ? `<label class="field" for="saved-filter-label"><span>Saved filter name</span><input id="saved-filter-label" name="saved_filter_label" type="text"></label>`
    : "";
  const saveFilterButton = canSaveFilter
    ? `<button class="button" type="submit" formmethod="post" formaction="/desk/${encodeURIComponent(doctype.name)}/saved-filters">Save filter</button>`
    : "";
  const savedFilterPanel = renderSavedFilters(doctype, options.savedFilters ?? [], options.selectedSavedFilterId);
  const header = fields.map((field) => `<th>${escapeHtml(field.label ?? field.name)}</th>`).join("");
  const bulkActions = options.bulkActions ?? [];
  const importModes = options.importModes ?? [];
  const selectableNames = new Set(bulkActions.flatMap((action) => action.names));
  const hasBulkActions = selectableNames.size > 0;
  const bulkActionFormId = "bulk-document-action";
  const newAction = options.canCreate === false
    ? ""
    : `<a class="button primary" href="/desk/${encodeURIComponent(doctype.name)}/new">New ${escapeHtml(labelFor(doctype))}</a>`;
  const fieldLabels = fields.map((field) => field.label ?? field.name);
  const rows = documents
    .map((document) => {
      const cells = fields
        .map((field, index) => `<td data-label="${escapeHtml(fieldLabels[index] ?? field.name)}">${renderListCellValue(field, document.data[field.name])}</td>`)
        .join("");
      const selectable = selectableNames.has(document.name);
      return `<tr>
        ${hasBulkActions ? renderBulkDocumentActionCell(document, selectable, bulkActionFormId) : ""}
        <td data-label="Name"><a href="/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(document.name)}">${escapeHtml(document.name)}</a></td>
        ${cells}
        <td data-label="Version"><span class="version-pill">v${String(document.version)}</span></td>
        <td data-label="Updated"><time datetime="${escapeHtml(document.updatedAt)}">${escapeHtml(document.updatedAt)}</time></td>
      </tr>`;
    })
    .join("");
  const recordCount = `${String(documents.length)} ${documents.length === 1 ? "record" : "records"}`;
  const bulkControls = hasBulkActions
    ? `<form id="${bulkActionFormId}" method="post" action="${escapeHtml(bulkActions[0]?.action ?? "")}">${options.bulkReturnHref ? `<input type="hidden" name="returnTo" value="${escapeHtml(options.bulkReturnHref)}">` : ""}</form>${bulkActions.map((action) => renderListBulkActionButton(action, bulkActionFormId)).join("")}`
    : "";
  const filterDisclosureOpen = filters.length > 0 || options.filterExpression !== undefined ? " open" : "";
  const filterTools = filterForm || compoundFilterForm || orderForm
    ? `<details class="desk-disclosure list-filters"${filterDisclosureOpen}>
        <summary><span>Filters and sort</span><small>${renderListFilterSummary(filters, options.filterExpression)}</small></summary>
        <form class="form list-filter-form" method="get"><div class="fields">${filterForm}${compoundFilterForm}${orderForm}${savedFilterControl}</div><div class="actions"><button class="button primary" type="submit">Filter</button>${saveFilterButton}<a class="button" href="/desk/${encodeURIComponent(doctype.name)}?default_filters=0">Clear</a></div></form>
      </details>`
    : "";
  const importTools = importModes.length > 0
    ? `<details class="desk-disclosure list-import-disclosure"${options.importResult ? " open" : ""}>
        <summary><span>Import CSV</span><small>Create or update records from a pasted CSV.</small></summary>
        ${renderListImportPanel(doctype, importModes, options.importResult, options.importReturnHref)}
      </details>`
    : "";
  return `<section class="toolbar list-toolbar">
    <div class="toolbar-main">
      ${newAction}
      ${options.exportHref ? `<a class="button" href="${escapeHtml(options.exportHref)}">Export CSV</a>` : ""}
      ${bulkControls}
    </div>
    <div class="toolbar-aside"><span class="record-count">${recordCount}</span></div>
  </section>
  ${filters.length > 0 || options.filterExpression !== undefined ? `<div class="active-filter-bar">${renderActiveListFilters(filters, options.filterExpression)}</div>` : ""}
  <section class="panel list-table-panel">
    <div class="table-wrap">
      <table class="document-table">
        <thead><tr>${hasBulkActions ? "<th>Select</th>" : ""}<th>Name</th>${header}<th>Version</th><th>Updated</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="${fields.length + (hasBulkActions ? 4 : 3)}" class="empty">No documents yet.</td></tr>`}</tbody>
      </table>
    </div>
  </section>
  ${savedFilterPanel}
  ${filterTools}
  ${importTools}
  ${renderClientScripts(doctype.name, "list", options.clientScripts ?? [], undefined, undefined, options.realtimeRoute)}`;
}

function renderListCellValue(field: FieldDefinition, value: JsonValue | undefined): string {
  const formatted = formatValue(value);
  if (formatted === "") {
    return `<span class="empty">-</span>`;
  }
  if (field.type === "select" || field.name.toLowerCase().includes("state") || field.name.toLowerCase().includes("status")) {
    return `<span class="value-chip value-chip-${escapeHtml(slug(formatted) || "value")}">${escapeHtml(formatted)}</span>`;
  }
  return escapeHtml(formatted);
}

function renderListFilterSummary(
  filters: readonly ListDocumentsFilter[],
  expression: ListFilterExpression | undefined
): string {
  const count = filters.length + (expression === undefined ? 0 : 1);
  return count === 0 ? "Ready when needed" : `${String(count)} active`;
}

function renderActiveListFilters(
  filters: readonly ListDocumentsFilter[],
  expression: ListFilterExpression | undefined
): string {
  const chips = filters
    .map((filter) => {
      const operator = filter.operator ?? "eq";
      return `<span class="filter-chip">${escapeHtml(filter.field)} ${escapeHtml(operator)} ${escapeHtml(formatValue(filter.value))}</span>`;
    })
    .join("");
  const expressionChip = expression === undefined ? "" : `<span class="filter-chip">Advanced expression</span>`;
  return `${chips}${expressionChip}`;
}

function renderListImportPanel(
  doctype: DocTypeDefinition,
  modes: readonly DocumentImportMode[],
  result: DocumentImportResult | undefined,
  returnHref: string | undefined
): string {
  const action = `/desk/${encodeURIComponent(doctype.name)}/import.csv`;
  const templateHref = `/desk/${encodeURIComponent(doctype.name)}/import-template.csv`;
  const selectedMode = result?.mode ?? modes[0];
  const modeOptions = modes
    .map((mode) => `<option value="${mode}"${selectedMode === mode ? " selected" : ""}>${mode === "create" ? "Create" : "Update"}</option>`)
    .join("");
  return `<section class="panel list-import">
    ${result ? renderListImportResult(result) : ""}
    <form class="form" method="post" action="${action}">
      ${returnHref ? `<input type="hidden" name="returnTo" value="${escapeHtml(returnHref)}">` : ""}
      <div class="fields">
        <label class="field" for="import-mode"><span>Import Mode</span><select id="import-mode" name="mode">
          ${modeOptions}
        </select></label>
        <label class="field wide" for="import-csv"><span>CSV</span><textarea id="import-csv" name="csv" rows="6" required></textarea></label>
      </div>
      <div class="actions"><a class="button" href="${templateHref}">Download template</a><button class="button" type="submit">Import CSV</button></div>
    </form>
  </section>`;
}

function renderListImportResult(result: DocumentImportResult): string {
  const failureRows = result.failed
    .map((failure) => `<li>Row ${String(failure.row)}${failure.name ? ` (${escapeHtml(failure.name)})` : ""}: ${escapeHtml(failure.message)}</li>`)
    .join("");
  return `<div class="${result.failed.length > 0 ? "error" : "notice"}" role="status">
    Imported ${String(result.succeeded.length)} of ${String(result.total)} ${escapeHtml(result.doctype)} rows.
    ${failureRows ? `<ul class="import-failures">${failureRows}</ul>` : ""}
  </div>`;
}

function renderCompoundFilterBuilder(
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
    <fieldset class="compound-filter-builder" data-cf-frappe-compound-filter-builder data-filter-fields="${escapeHtml(JSON.stringify(listView.filterBuilderFields))}">
      <legend>Compound filters</legend>
      <div class="compound-filter-visual">
        ${renderCompoundFilterGroup(listView.filterBuilderFields, visualGroup, true)}
      </div>
      <template data-cf-frappe-filter-row-template>${renderCompoundFilterRow(listView.filterBuilderFields, undefined)}</template>
      <template data-cf-frappe-filter-group-template>${renderCompoundFilterGroup(listView.filterBuilderFields, { kind: "group", match: "all", filters: [] }, false)}</template>
      <label class="field wide" for="filter-expression"><span>Advanced JSON</span><textarea id="filter-expression" name="filter_expression" rows="5">${escapeHtml(value)}</textarea></label>
      ${expression === undefined ? "" : `<div class="filter-expression-preview">${renderListFilterExpression(expression)}</div>`}
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

function renderCompoundFilterGroup(
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
          ? renderCompoundFilterRow(fields, undefined)
          : isListFilterGroup(item)
            ? renderCompoundFilterGroup(fields, item, false)
            : renderCompoundFilterRow(fields, item)
      )
      .join("")}</div>
  </div>`;
}

function renderCompoundFilterRow(
  fields: readonly ListFilterBuilderField[],
  filter: ListDocumentsFilter | undefined
): string {
  const fieldName = filter?.field ?? "";
  const operator = filter?.operator ?? "eq";
  const builderField = fields.find((field) => field.field === fieldName);
  const inputType = compoundFilterValueInputType(builderField?.inputType, operator);
  return `<div class="compound-filter-row" data-cf-frappe-filter-row>
    <label class="field compact"><span>Field</span><select data-cf-frappe-filter-field>${renderCompoundFilterFieldOptions(fields, fieldName)}</select></label>
    <label class="field compact"><span>Operator</span><select data-cf-frappe-filter-operator>${renderCompoundFilterOperatorOptions(fields, builderField, operator)}</select></label>
    <label class="field grow"><span>Value</span><input data-cf-frappe-filter-value type="${escapeHtml(inputType)}" value="${escapeHtml(filter === undefined ? "" : formatCompoundFilterVisualValue(filter.value))}"></label>
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

function renderCompoundFilterOperatorOptions(
  fields: readonly ListFilterBuilderField[],
  selectedField: ListFilterBuilderField | undefined,
  selected: ListFilterOperator
): string {
  const operators = selectedField?.operators ?? uniqueListFilterOperators(fields);
  return operators
    .map((operator) =>
      `<option value="${escapeHtml(operator.operator)}"${operator.operator === selected ? " selected" : ""}>${escapeHtml(operator.label)}</option>`
    )
    .join("");
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

function renderListFilterExpression(expression: ListFilterExpression): string {
  if (isListFilterGroup(expression)) {
    const label = expression.match === "all" ? "All" : "Any";
    return `<section class="filter-expression-group"><strong>${label}</strong><ul>${expression.filters
      .map((filter) => `<li>${renderListFilterExpression(filter)}</li>`)
      .join("")}</ul></section>`;
  }
  return `<span class="filter-expression-leaf">${escapeHtml(expression.field)} ${escapeHtml(expression.operator ?? "eq")} ${escapeHtml(formatValue(expression.value))}</span>`;
}

function renderListOrderControls(listView: ResolvedListView): string {
  return `<label class="field" for="list-order-by"><span>Order By</span><select id="list-order-by" name="order_by">${renderListOrderOptions(listView)}</select></label>
  <label class="field" for="list-order"><span>Direction</span><select id="list-order" name="order">${renderListOrderDirectionOptions(listView.order)}</select></label>`;
}

function renderListOrderOptions(listView: ResolvedListView): string {
  return listView.orderOptions
    .map(
      (option) =>
        `<option value="${escapeHtml(option.name)}"${option.name === listView.orderBy ? " selected" : ""}>${escapeHtml(option.label)}</option>`
    )
    .join("");
}

function renderListOrderDirectionOptions(order: ResolvedListView["order"]): string {
  return [
    { value: "desc", label: "Descending" },
    { value: "asc", label: "Ascending" }
  ]
    .map((option) => `<option value="${option.value}"${option.value === order ? " selected" : ""}>${option.label}</option>`)
    .join("");
}

function renderBulkDocumentActionCell(document: DocumentSnapshot, selectable: boolean, formId: string): string {
  if (!selectable) {
    return `<td data-label="Select"></td>`;
  }
  const name = escapeHtml(document.name);
  return `<td data-label="Select"><input class="bulk-select" form="${formId}" name="document" type="checkbox" value="${name}" aria-label="Select ${name}"><input form="${formId}" name="expectedVersion:${name}" type="hidden" value="${String(document.version)}"></td>`;
}

function renderListBulkActionButton(action: ListBulkAction, formId: string): string {
  const classes = action.variant === "danger" ? "button danger" : "button";
  return `<button class="${classes}" type="submit" form="${formId}" formaction="${escapeHtml(action.action)}">${escapeHtml(action.label)}</button>`;
}

function renderSavedFilters(
  doctype: DocTypeDefinition,
  savedFilters: readonly SavedListFilter[],
  selectedId: string | undefined
): string {
  if (savedFilters.length === 0) {
    return "";
  }
  const items = savedFilters
    .map((filter) => {
      const href = `/desk/${encodeURIComponent(doctype.name)}?saved_filter=${encodeURIComponent(filter.id)}`;
      const deleteAction = `/desk/${encodeURIComponent(doctype.name)}/saved-filters/${encodeURIComponent(filter.id)}/delete`;
      return `<li>
        <a class="saved-filter-link${filter.id === selectedId ? " is-active" : ""}" href="${href}">${escapeHtml(filter.label)}</a>
        <form class="inline-action" method="post">
          <button class="button" type="submit" formaction="${deleteAction}">Delete</button>
        </form>
      </li>`;
    })
    .join("");
  return `<section class="panel saved-filters" aria-label="Saved filters">
    <h2>Saved filters</h2>
    <ul>${items}</ul>
  </section>`;
}

function renderFilterControl(
  field: FieldDefinition,
  filters: readonly ListDocumentsFilter[],
  control: ListFilterControlDefinition
): string {
  const id = `filter-${slug(field.name)}`;
  const label = escapeHtml(renderFilterLabel(field, control));
  const operator = control.operator;
  const value = currentFilterValue(filters, field.name, operator);
  const common = `id="${id}-${operator}" name="${escapeHtml(control.queryKey)}"`;
  if (field.type === "select") {
    const options = [`<option value=""></option>`]
      .concat(
        (field.options ?? []).map(
          (option) =>
            `<option value="${escapeHtml(option)}"${option === value ? " selected" : ""}>${escapeHtml(option)}</option>`
        )
      )
      .join("");
    return `<label class="field" for="${id}-${operator}"><span>${label}</span><select ${common}>${options}</select></label>`;
  }
  if (field.type === "boolean") {
    const options = [
      `<option value=""></option>`,
      `<option value="true"${value === "true" ? " selected" : ""}>True</option>`,
      `<option value="false"${value === "false" ? " selected" : ""}>False</option>`
    ].join("");
    return `<label class="field" for="${id}-${operator}"><span>${label}</span><select ${common}>${options}</select></label>`;
  }
  return `<label class="field" for="${id}-${operator}"><span>${label}</span><input type="${control.inputType}" ${common} value="${escapeHtml(value)}"></label>`;
}

function renderFilterControlsForField(
  field: FieldDefinition,
  filters: readonly ListDocumentsFilter[],
  controls: readonly ListFilterControlDefinition[]
): string {
  const choiceControls = quickFilterChoiceControls(controls);
  if (choiceControls) {
    const activeControl = activeQuickFilterControl(field.name, filters, choiceControls);
    if (activeControl) {
      return renderQuickFilterChoiceControl(field, filters, choiceControls, activeControl);
    }
  }
  return controls.map((control) => renderFilterControl(field, filters, control)).join("");
}

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

function renderQuickFilterChoiceControl(
  field: FieldDefinition,
  filters: readonly ListDocumentsFilter[],
  controls: readonly [ListFilterControlDefinition, ListFilterControlDefinition],
  activeControl: ListFilterControlDefinition
): string {
  const id = `filter-${slug(field.name)}`;
  const label = escapeHtml(field.label ?? field.name);
  const value = currentFilterValue(filters, field.name, activeControl.operator);
  const operatorName = escapeHtml(`${DESK_QUICK_FILTER_OPERATOR_QUERY_PREFIX}${field.name}`);
  const valueName = escapeHtml(`${DESK_QUICK_FILTER_VALUE_QUERY_PREFIX}${field.name}`);
  const operatorOptions = controls
    .map((control) =>
      `<option value="${escapeHtml(control.operator)}"${control.operator === activeControl.operator ? " selected" : ""}>${escapeHtml(control.operatorLabel)}</option>`
    )
    .join("");
  return `<fieldset class="quick-filter-choice"><legend>${label}</legend>
    <label class="field compact" for="${id}-operator"><span>Operator</span><select id="${id}-operator" name="${operatorName}">${operatorOptions}</select></label>
    ${renderQuickFilterChoiceValueControl(field, activeControl, id, valueName, value)}
  </fieldset>`;
}

function renderQuickFilterChoiceValueControl(
  field: FieldDefinition,
  control: ListFilterControlDefinition,
  id: string,
  name: string,
  value: string
): string {
  const common = `id="${id}-value" name="${name}"`;
  if (field.type === "select") {
    const options = [`<option value=""></option>`]
      .concat(
        (field.options ?? []).map(
          (option) =>
            `<option value="${escapeHtml(option)}"${option === value ? " selected" : ""}>${escapeHtml(option)}</option>`
        )
      )
      .join("");
    return `<label class="field grow" for="${id}-value"><span>Value</span><select ${common}>${options}</select></label>`;
  }
  if (field.type === "boolean") {
    const options = [
      `<option value=""></option>`,
      `<option value="true"${value === "true" ? " selected" : ""}>True</option>`,
      `<option value="false"${value === "false" ? " selected" : ""}>False</option>`
    ].join("");
    return `<label class="field grow" for="${id}-value"><span>Value</span><select ${common}>${options}</select></label>`;
  }
  return `<label class="field grow" for="${id}-value"><span>Value</span><input type="${control.inputType}" ${common} value="${escapeHtml(value)}"></label>`;
}

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
