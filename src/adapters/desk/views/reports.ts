import { type DocTypeDefinition, type FieldDefinition, type ListFilterBuilderField, type ListFilterInputType } from "../../../core/types.js";
import { REPORT_FORMULA_MAX_DEPTH, type ReportDefinition, type ReportFilterExpression, type ReportFilterOperator, isReportFilterGroup } from "../../../core/reports.js";
import { type ReportRunResult } from "../../../application/report-service.js";
import { type SavedReport } from "../../../application/saved-report-service.js";
import { deskReportFieldLabel, deskReportSumSummaryLabel, deskReportSumSummaryName, isDeskGroupableReportField, isDeskNumericReportField } from "../report-builder.js";
import { fieldOptions } from "../meta-options.js";
import { escapeHtml, formatCompoundFilterVisualValue, formatFormValue, formatValue, inputType, inputTypeForFieldType, labelFor, renderClientScripts, renderCompoundFilterFieldOptions, renderCompoundFilterMatchOptions, renderReportChartBody, renderTableCell, slug } from "./shared.js";

export function renderReportList(
  reports: readonly ReportDefinition[],
  options: { readonly builderDoctypes?: readonly DocTypeDefinition[] } = {}
): string {
  const rows = reports
    .map(
      (report) => `<tr>
        ${renderTableCell("Report", `<a href="/desk/reports/${encodeURIComponent(report.name)}">${escapeHtml(report.label ?? report.name)}</a>`)}
        ${renderTableCell("DocType", escapeHtml(report.doctype))}
        ${renderTableCell("Module", escapeHtml(report.module ?? ""))}
        ${renderTableCell("Description", escapeHtml(report.description ?? ""))}
      </tr>`
    )
    .join("");
  const builderRows = (options.builderDoctypes ?? [])
    .map(
      (doctype) => `<tr>
        ${renderTableCell("Build Report", `<a href="/desk/report-builder/${encodeURIComponent(doctype.name)}">${escapeHtml(labelFor(doctype))}</a>`)}
        ${renderTableCell("DocType", escapeHtml(doctype.name))}
        ${renderTableCell("Fields", String(doctype.fields.filter((field) => !field.hidden).length))}
      </tr>`
    )
    .join("");
  const builder = options.builderDoctypes
    ? `<section class="panel report-builder-list">
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Build Report</th><th>DocType</th><th>Fields</th></tr></thead>
          <tbody>${builderRows || `<tr><td colspan="3" class="empty">No readable DocTypes.</td></tr>`}</tbody>
        </table>
      </div>
    </section>`
    : "";
  return `<section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>Report</th><th>DocType</th><th>Module</th><th>Description</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="empty">No readable reports.</td></tr>`}</tbody>
      </table>
    </div>
  </section>${builder}`;
}

export function renderSavedReportBuilder(
  doctype: DocTypeDefinition,
  savedReports: readonly SavedReport[],
  options: { readonly error?: string } = {}
): string {
  const rows = savedReports
    .map((saved) => {
      const href = `/desk/report-builder/${encodeURIComponent(doctype.name)}/${encodeURIComponent(saved.id)}`;
      const exportHref = `${href}/export.csv`;
      return `<tr>
        ${renderTableCell("Saved Report", `<a href="${href}">${escapeHtml(saved.label)}</a>`)}
        ${renderTableCell("Columns", escapeHtml(saved.definition.columns.map((column) => column.label ?? column.name).join(", ")))}
        ${renderTableCell("Updated", escapeHtml(saved.updatedAt))}
        ${renderTableCell("Actions", `
          <a class="button" href="${exportHref}">Export CSV</a>
          <form class="inline-action" method="post" action="${href}/delete">
            <button class="button danger" type="submit">Delete</button>
          </form>
        `)}
      </tr>`;
    })
    .join("");
  const visibleFields = doctype.fields.filter((field) => !field.hidden);
  const defaultColumns = new Set(doctype.listView?.columns ?? visibleFields.slice(0, 3).map((field) => field.name));
  const columnOptions = visibleFields
    .map((field) => renderReportBuilderCheckbox("column", field, defaultColumns.has(field.name)))
    .join("");
  const filterOptions = visibleFields
    .filter(isDeskGroupableReportField)
    .map(renderReportBuilderFilterControls)
    .join("");
  const reportFilterExpressionBuilder = renderReportFilterExpressionBuilder(
    visibleFields.filter(isDeskGroupableReportField)
  );
  const numericFields = visibleFields.filter(isDeskNumericReportField);
  const summaryOptions = [
    renderReportBuilderValueCheckbox("summaryCount", "1", "Records", false),
    ...numericFields.map((field) => renderReportBuilderCheckbox("summary", field, false))
  ].join("");
  const formulaFieldOptions = renderReportBuilderFieldOptions(numericFields);
  const formulaFieldMetadata = numericFields.map((field) => ({
    name: field.name,
    label: deskReportFieldLabel(field)
  }));
  const formulaControls = `<div class="report-formula-builder" data-cf-frappe-report-formula-builder data-formula-max-depth="${REPORT_FORMULA_MAX_DEPTH}" data-formula-fields="${escapeHtml(JSON.stringify(formulaFieldMetadata))}">${[
    `<label class="field"><span>Formula Label</span><input name="formulaLabel"></label>`,
    renderReportBuilderFormulaOperandControls("formulaLeft", "Formula Left", formulaFieldOptions, 2),
    renderReportBuilderFormulaOperatorControl("formula", "Formula"),
    renderReportBuilderFormulaOperandControls("formulaRight", "Formula Right", formulaFieldOptions, 2)
  ].join("")}</div>`;
  const groupOptions = renderReportBuilderFieldOptions(
    visibleFields.filter(isDeskGroupableReportField)
  );
  const chartSummaryOptions = [
    `<option value="record_count">Records</option>`,
    ...numericFields.map(
      (field) =>
        `<option value="${escapeHtml(deskReportSumSummaryName(field))}">${escapeHtml(deskReportSumSummaryLabel(field))}</option>`
    )
  ].join("");
  const orderOptions = [
    `<option value=""></option>`,
    ...visibleFields
      .filter(isDeskGroupableReportField)
      .map((field) => `<option value="${escapeHtml(field.name)}">${escapeHtml(deskReportFieldLabel(field))}</option>`)
  ].join("");
  return `${options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : ""}
  <form class="panel form report-builder-form" method="post" action="/desk/report-builder/${encodeURIComponent(doctype.name)}">
    <div class="fields cols-1">
      <label class="field"><span>Label</span><input name="label" required></label>
    </div>
    <fieldset class="choice-grid">
      <legend>Columns</legend>
      ${columnOptions}
    </fieldset>
    <fieldset class="choice-grid">
      <legend>Filters</legend>
      ${filterOptions}
    </fieldset>
    ${reportFilterExpressionBuilder}
    <fieldset class="choice-grid">
      <legend>Summaries</legend>
      ${summaryOptions}
    </fieldset>
    <div class="fields">
      ${formulaControls}
    </div>
    <div class="fields">
      <label class="field"><span>Group By</span><select name="groupBy">${groupOptions}</select></label>
      <label class="field"><span>Chart Type</span><select name="chartType">
        <option value=""></option>
        <option value="bar">Bar</option>
        <option value="line">Line</option>
        <option value="pie">Pie</option>
      </select></label>
      <label class="field"><span>Chart Value</span><select name="chartSummary">${chartSummaryOptions}</select></label>
    </div>
    <div class="fields">
      <label class="field"><span>Chart Sort</span><select name="chartOrderBy">
        <option value="key">Group Key</option>
        <option value="label">Group Label</option>
        <option value="value">Value</option>
      </select></label>
      <label class="field"><span>Chart Order</span><select name="chartOrder">
        <option value="asc">Ascending</option>
        <option value="desc">Descending</option>
      </select></label>
      <label class="field"><span>Chart Points</span><input name="chartMaxPoints" type="number" min="1" max="50"></label>
    </div>
    <div class="fields">
      <label class="field"><span>Chart Palette</span><input name="chartPalette" placeholder="#1f6feb, #2e7d32"></label>
      <label class="field"><span>Chart Values</span><select name="chartShowValues">
        <option value="true" selected>Show</option>
        <option value="false">Hide</option>
      </select></label>
    </div>
    <div class="fields">
      <label class="field"><span>X Axis Label</span><input name="chartXAxisLabel"></label>
      <label class="field"><span>Y Axis Label</span><input name="chartYAxisLabel"></label>
    </div>
    <div class="fields">
      <label class="field"><span>Order By</span><select name="orderBy">${orderOptions}</select></label>
      <label class="field"><span>Order</span><select name="order">
        <option value="asc">Ascending</option>
        <option value="desc">Descending</option>
      </select></label>
    </div>
    <div class="actions"><button class="button primary" type="submit">Save Report</button></div>
  </form>
  <section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr><th>Saved Report</th><th>Columns</th><th>Updated</th><th>Actions</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="empty">No saved reports.</td></tr>`}</tbody>
      </table>
    </div>
  </section>
  ${renderClientScripts(doctype.name, "report-builder", [])}`;
}

export function renderSavedReportView(
  saved: SavedReport,
  result: ReportRunResult,
  options: {
    readonly listHref: string;
    readonly exportHref: string;
    readonly printHref?: string;
    readonly pdfHref?: string;
    readonly deleteAction: string;
    readonly drilldownBaseHref?: string;
  }
): string {
  return `<section class="toolbar saved-report-toolbar">
    <a class="button" href="${escapeHtml(options.listHref)}">Back</a>
    <a class="button" href="${escapeHtml(options.exportHref)}">Export CSV</a>
    ${options.printHref ? `<a class="button" href="${escapeHtml(options.printHref)}">Print</a>` : ""}
    ${options.pdfHref ? `<a class="button" href="${escapeHtml(options.pdfHref)}">PDF</a>` : ""}
    <form class="inline-action" method="post" action="${escapeHtml(options.deleteAction)}">
      <button class="button danger" type="submit">Delete</button>
    </form>
  </section>
  <section class="panel saved-report-meta">
    <dl>
      <div><dt>DocType</dt><dd>${escapeHtml(saved.doctype)}</dd></div>
      <div><dt>Columns</dt><dd>${escapeHtml(saved.definition.columns.map((column) => column.label ?? column.name).join(", "))}</dd></div>
      ${renderSavedReportDefinitionMeta(saved.definition)}
      <div><dt>Updated</dt><dd>${escapeHtml(saved.updatedAt)}</dd></div>
    </dl>
  </section>
  ${renderReportView(result, {
    exportHref: options.exportHref,
    ...(options.printHref === undefined ? {} : { printHref: options.printHref }),
    ...(options.pdfHref === undefined ? {} : { pdfHref: options.pdfHref }),
    ...(options.drilldownBaseHref === undefined ? {} : { drilldownBaseHref: options.drilldownBaseHref })
  })}`;
}

function renderSavedReportDefinitionMeta(definition: SavedReport["definition"]): string {
  return [
    renderSavedReportMetaItem("Summaries", definition.summaries?.map((summary) => summary.label ?? summary.name)),
    renderSavedReportMetaItem("Groups", definition.groups?.map((group) => group.label ?? group.name)),
    renderSavedReportMetaItem("Charts", definition.charts?.map((chart) => chart.label ?? chart.name))
  ].join("");
}

function renderSavedReportMetaItem(label: string, values: readonly string[] | undefined): string {
  const text = values?.filter(Boolean).join(", ");
  return text ? `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(text)}</dd></div>` : "";
}

function renderReportBuilderCheckbox(name: string, field: FieldDefinition, checked: boolean): string {
  return renderReportBuilderValueCheckbox(name, field.name, deskReportFieldLabel(field), checked);
}

function renderReportBuilderValueCheckbox(name: string, value: string, label: string, checked: boolean): string {
  return `<label class="choice">
    <input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(value)}"${checked ? " checked" : ""}>
    <span>${escapeHtml(label)}</span>
  </label>`;
}

function renderReportBuilderFilterControls(field: FieldDefinition): string {
  const name = escapeHtml(field.name);
  const rangeControls = isReportBuilderRangeFilterField(field) ? renderReportBuilderRangeFilterControls(field) : "";
  return `<div class="report-builder-filter">
    ${renderReportBuilderCheckbox("filter", field, false)}
    <label class="field"><span>Operator</span><select name="filterOperator:${name}">
      ${reportBuilderFilterOperatorOptions(field)}
    </select></label>
    ${renderReportBuilderFilterDefaultControl(field)}
    <label class="choice">
      <input type="checkbox" name="filterRequired:${name}" value="1">
      <span>Required</span>
    </label>
    ${rangeControls}
  </div>`;
}

function isReportBuilderRangeFilterField(field: FieldDefinition): boolean {
  return field.type === "integer" || field.type === "number" || field.type === "date" || field.type === "datetime";
}

function renderReportBuilderRangeFilterControls(field: FieldDefinition): string {
  const name = escapeHtml(field.name);
  const label = deskReportFieldLabel(field);
  const inputType = inputTypeForFieldType(field.type);
  return `<div class="report-builder-range-filter">
    ${renderReportBuilderValueCheckbox("filterRangeMin", field.name, `${label} from`, false)}
    <label class="field"><span>From Default</span><input name="filterRangeMinDefault:${name}" type="${inputType}"></label>
    ${renderReportBuilderValueCheckbox("filterRangeMax", field.name, `${label} to`, false)}
    <label class="field"><span>To Default</span><input name="filterRangeMaxDefault:${name}" type="${inputType}"></label>
  </div>`;
}

function reportBuilderFilterOperatorOptions(field: FieldDefinition): string {
  return reportBuilderFilterOperatorsFor(field)
    .map(
      (operator) =>
        `<option value="${operator.value}"${operator.selected ? " selected" : ""}>${escapeHtml(operator.label)}</option>`
    )
    .join("");
}

function reportBuilderFilterOperatorsFor(
  field: FieldDefinition
): readonly { readonly value: ReportFilterOperator; readonly label: string; readonly selected?: boolean }[] {
  if (field.type === "text" || field.type === "longText") {
    return [
      { value: "contains", label: "Contains", selected: true },
      { value: "eq", label: "Equals" },
      { value: "ne", label: "Not equals" }
    ];
  }
  if (field.type === "link") {
    return [
      { value: "eq", label: "Equals", selected: true },
      { value: "ne", label: "Not equals" },
      { value: "contains", label: "Contains" }
    ];
  }
  if (field.type === "integer" || field.type === "number" || field.type === "date" || field.type === "datetime") {
    return [
      { value: "eq", label: "Equals", selected: true },
      { value: "ne", label: "Not equals" },
      { value: "gte", label: "At least" },
      { value: "lte", label: "At most" }
    ];
  }
  return [
    { value: "eq", label: "Equals", selected: true },
    { value: "ne", label: "Not equals" }
  ];
}

function renderReportBuilderFilterDefaultControl(field: FieldDefinition): string {
  const name = `filterDefault:${escapeHtml(field.name)}`;
  if (field.type === "select") {
    return `<label class="field"><span>Default</span><select name="${name}">${renderReportSelectOptions(field.options ?? [], "")}</select></label>`;
  }
  if (field.type === "boolean") {
    return `<label class="field"><span>Default</span><select name="${name}">
      <option value=""></option>
      <option value="true">True</option>
      <option value="false">False</option>
    </select></label>`;
  }
  const type = inputTypeForFieldType(field.type);
  return `<label class="field"><span>Default</span><input name="${name}" type="${type}"></label>`;
}

function renderReportFilterExpressionBuilder(fields: readonly FieldDefinition[]): string {
  const builderFields: readonly ReportFilterExpressionBuilderField[] = fields.map((field) => ({
    field: field.name,
    label: deskReportFieldLabel(field),
    inputType: reportFilterExpressionInputType(field),
    operators: []
  }));
  if (builderFields.length === 0) {
    return "";
  }
  return `<fieldset class="compound-filter-builder report-filter-expression-builder" data-cf-frappe-compound-filter-builder data-filter-expression-kind="report" data-filter-fields="${escapeHtml(JSON.stringify(builderFields))}">
    <legend>Filter Expression</legend>
    <div class="compound-filter-visual">
      ${renderReportFilterExpressionGroup(builderFields, { kind: "group", match: "all", filters: [] }, true)}
    </div>
    <template data-cf-frappe-filter-row-template>${renderReportFilterExpressionRow(builderFields, undefined)}</template>
    <template data-cf-frappe-filter-group-template>${renderReportFilterExpressionGroup(builderFields, { kind: "group", match: "all", filters: [] }, false)}</template>
    <label class="field wide" for="report-filter-expression"><span>Advanced JSON</span><textarea id="report-filter-expression" name="filter_expression" rows="5"></textarea></label>
  </fieldset>`;
}

function renderReportFilterExpressionGroup(
  fields: readonly ReportFilterExpressionBuilderField[],
  group: Extract<ReportFilterExpression, { readonly kind: "group" }>,
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
          ? renderReportFilterExpressionRow(fields, undefined)
          : isReportFilterGroup(item)
            ? renderReportFilterExpressionGroup(fields, item, false)
            : renderReportFilterExpressionRow(fields, item)
      )
      .join("")}</div>
  </div>`;
}

function renderReportFilterExpressionRow(
  fields: readonly ReportFilterExpressionBuilderField[],
  filter: Exclude<ReportFilterExpression, { readonly kind: "group" }> | undefined
): string {
  const filterName = filter?.filter ?? "";
  const builderField = fields.find((field) => field.field === filterName);
  const inputType = builderField?.inputType ?? "text";
  return `<div class="compound-filter-row" data-cf-frappe-filter-row>
    <label class="field compact"><span>Filter</span><select data-cf-frappe-filter-field>${renderCompoundFilterFieldOptions(fields, filterName)}</select></label>
    <label class="field grow"><span>Value</span><input data-cf-frappe-filter-value type="${escapeHtml(inputType)}" value="${escapeHtml(filter === undefined ? "" : formatCompoundFilterVisualValue(filter.value))}"></label>
    <button class="button" type="button" data-cf-frappe-remove-filter>Remove</button>
  </div>`;
}

interface ReportFilterExpressionBuilderField extends ListFilterBuilderField {
  readonly label: string;
}

function reportFilterExpressionInputType(field: FieldDefinition): ListFilterInputType {
  return field.type === "boolean" ? "boolean" : inputTypeForFieldType(field.type) as ListFilterInputType;
}

function renderReportBuilderFieldOptions(fields: readonly FieldDefinition[]): string {
  return [
    `<option value=""></option>`,
    ...fields.map((field) => `<option value="${escapeHtml(field.name)}">${escapeHtml(deskReportFieldLabel(field))}</option>`)
  ].join("");
}

function renderReportBuilderFormulaOperandControls(
  prefix: string,
  label: string,
  fieldOptions: string,
  depth: number
): string {
  const nestedKindOption = depth <= REPORT_FORMULA_MAX_DEPTH ? `<option value="nested">Nested formula</option>` : "";
  return `<div class="report-formula-operand" data-cf-frappe-formula-operand data-formula-prefix="${escapeHtml(prefix)}" data-formula-label="${escapeHtml(label)}" data-formula-depth="${depth}">
      <label class="field"><span>${escapeHtml(label)} Type</span><select name="${escapeHtml(prefix)}Kind" data-cf-frappe-formula-kind>
        <option value="field">Field</option>
        <option value="literal">Number</option>
        ${nestedKindOption}
      </select></label>
      <label class="field"><span>${escapeHtml(label)}</span><select name="${escapeHtml(prefix)}">${fieldOptions}</select></label>
      <label class="field"><span>${escapeHtml(label)} Number</span><input name="${escapeHtml(prefix)}Literal" type="number" step="any"></label>
      <div class="report-formula-nested" data-cf-frappe-formula-nested></div>
    </div>`;
}

function renderReportBuilderFormulaOperatorControl(prefix: string, label: string): string {
  return `<label class="field"><span>${escapeHtml(label)} Operator</span><select name="${escapeHtml(prefix)}Operator">
        <option value=""></option>
        <option value="add">Add</option>
        <option value="subtract">Subtract</option>
        <option value="multiply">Multiply</option>
        <option value="divide">Divide</option>
      </select></label>`;
}

export function renderReportView(
  result: ReportRunResult,
  options: {
    readonly exportHref?: string;
    readonly printHref?: string;
    readonly pdfHref?: string;
    readonly drilldownBaseHref?: string;
  } = {}
): string {
  const filterForm = result.filters.map(renderReportFilterControl).join("");
  const orderForm = renderReportOrderControls(result.order);
  const controls = `${filterForm}${orderForm}`;
  const headers = result.columns.map((column) => `<th>${escapeHtml(column.label ?? column.name)}</th>`).join("");
  const rows = result.rows
    .map(
      (row) =>
        `<tr>${result.columns
          .map((column) => renderTableCell(column.label ?? column.name, escapeHtml(formatValue(row[column.name]))))
          .join("")}</tr>`
    )
    .join("");
  const exportAction = options.exportHref
    ? `<a class="button" href="${escapeHtml(options.exportHref)}">Export CSV</a>`
    : "";
  const printAction = options.printHref
    ? `<a class="button" href="${escapeHtml(options.printHref)}">Print</a>`
    : "";
  const pdfAction = options.pdfHref
    ? `<a class="button" href="${escapeHtml(options.pdfHref)}">PDF</a>`
    : "";
  const actions = `${exportAction}${printAction}${pdfAction}`;
  return `${controls ? `<form class="panel form report-filters" method="get"><div class="fields">${controls}</div><div class="actions"><button class="button primary" type="submit">Run</button>${actions}</div></form>` : actions ? `<section class="toolbar">${actions}</section>` : ""}
  ${renderReportSummary(result.summary)}
  ${renderReportCharts(result.charts, options.drilldownBaseHref)}
  ${renderReportGroups(result.groups)}
  <section class="panel">
    <div class="table-wrap">
      <table class="responsive-table">
        <thead><tr>${headers}</tr></thead>
        <tbody>${rows || `<tr><td colspan="${result.columns.length}" class="empty">No rows matched.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

function renderReportFilterControl(filter: ReportRunResult["filters"][number]): string {
  const id = `filter-${slug(filter.name)}`;
  const name = `filter_${escapeHtml(filter.name)}`;
  const label = escapeHtml(filter.label);
  const value = formatFormValue(filter.value);
  const required = filter.required ? " required" : "";
  if (filter.operator === "between" || filter.operator === "not_between") {
    const values = Array.isArray(filter.value) ? filter.value : [];
    const type = inputTypeForFieldType(filter.type);
    return [
      `<label class="field" for="${id}-min"><span>${label} from</span><input id="${id}-min" name="${name}" type="${type}" value="${escapeHtml(formatFormValue(values[0]))}"${required}></label>`,
      `<label class="field" for="${id}-max"><span>${label} to</span><input id="${id}-max" name="${name}" type="${type}" value="${escapeHtml(formatFormValue(values[1]))}"${required}></label>`
    ].join("");
  }
  if (filter.type === "select") {
    return `<label class="field" for="${id}"><span>${label}</span><select id="${id}" name="${name}"${required}>${renderReportSelectOptions(filter.options, value)}</select></label>`;
  }
  if (filter.type === "boolean") {
    const options = [
      `<option value=""></option>`,
      `<option value="true"${value === "true" ? " selected" : ""}>True</option>`,
      `<option value="false"${value === "false" ? " selected" : ""}>False</option>`
    ].join("");
    return `<label class="field" for="${id}"><span>${label}</span><select id="${id}" name="${name}"${required}>${options}</select></label>`;
  }
  if (filter.type === "longText" || filter.type === "json") {
    return `<label class="field" for="${id}"><span>${label}</span><textarea id="${id}" name="${name}"${required}>${escapeHtml(value)}</textarea></label>`;
  }
  const type = inputTypeForFieldType(filter.type);
  return `<label class="field" for="${id}"><span>${label}</span><input id="${id}" name="${name}" type="${type}" value="${escapeHtml(value)}"${required}></label>`;
}

function renderReportOrderControls(order: ReportRunResult["order"]): string {
  if (order.options.length === 0) {
    return "";
  }
  const selectedOrderBy = order.orderBy ?? "";
  const orderByOptions = [
    `<option value=""></option>`,
    ...order.options.map((option) =>
      `<option value="${escapeHtml(option.name)}"${option.name === selectedOrderBy ? " selected" : ""}>${escapeHtml(option.label)}</option>`
    )
  ].join("");
  const orderOptions = [
    `<option value="asc"${order.order === "asc" ? " selected" : ""}>Ascending</option>`,
    `<option value="desc"${order.order === "desc" ? " selected" : ""}>Descending</option>`
  ].join("");
  return `<label class="field" for="report-order-by"><span>Order By</span><select id="report-order-by" name="order_by">${orderByOptions}</select></label>
    <label class="field" for="report-order"><span>Order</span><select id="report-order" name="order">${orderOptions}</select></label>`;
}

function renderReportSelectOptions(options: readonly string[], value: string): string {
  const rendered = [`<option value=""></option>`];
  if (value && !options.includes(value)) {
    rendered.push(`<option value="${escapeHtml(value)}" selected>${escapeHtml(value)}</option>`);
  }
  rendered.push(
    ...options.map((option) =>
      `<option value="${escapeHtml(option)}"${option === value ? " selected" : ""}>${escapeHtml(option)}</option>`
    )
  );
  return rendered.join("");
}

function renderReportCharts(charts: ReportRunResult["charts"], drilldownBaseHref: string | undefined): string {
  if (charts.length === 0) {
    return "";
  }
  return `<section class="report-charts">${charts.map((chart) => renderReportChart(chart, drilldownBaseHref)).join("")}</section>`;
}

function renderReportChart(chart: ReportRunResult["charts"][number], drilldownBaseHref: string | undefined): string {
  return `<section class="panel report-chart">${renderReportChartBody(chart, drilldownBaseHref, chart.label)}</section>`;
}

function renderReportSummary(summary: ReportRunResult["summary"]): string {
  if (summary.length === 0) {
    return "";
  }
  const items = summary
    .map(
      (item) =>
        `<li><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(formatValue(item.value))}</strong></li>`
    )
    .join("");
  return `<section class="panel report-summary" aria-label="Report summary"><ul>${items}</ul></section>`;
}

function renderReportGroups(groups: ReportRunResult["groups"]): string {
  if (groups.length === 0) {
    return "";
  }
  return groups
    .map((group) => {
      const summaryHeaders = (group.rows[0]?.summaries ?? [])
        .map((summary) => `<th>${escapeHtml(summary.label)}</th>`)
        .join("");
      const rows = group.rows
        .map(
          (row) =>
            `<tr>${renderTableCell(group.field, escapeHtml(row.label))}${row.summaries
              .map((summary) => renderTableCell(summary.label, escapeHtml(formatValue(summary.value))))
              .join("")}</tr>`
        )
        .join("");
      return `<section class="panel report-group">
        <h2>${escapeHtml(group.label)}</h2>
        <div class="table-wrap">
          <table class="responsive-table">
            <thead><tr><th>${escapeHtml(group.field)}</th>${summaryHeaders}</tr></thead>
            <tbody>${rows || `<tr><td colspan="2" class="empty">No rows matched.</td></tr>`}</tbody>
          </table>
        </div>
      </section>`;
    })
    .join("");
}
