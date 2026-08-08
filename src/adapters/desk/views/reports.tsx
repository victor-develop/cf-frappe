import type { FC } from "hono/jsx";
import { html, raw } from "hono/html";
import { type DocTypeDefinition, type FieldDefinition, type ListFilterBuilderField, type ListFilterInputType } from "../../../core/types.js";
import { REPORT_FORMULA_MAX_DEPTH, type ReportDefinition, type ReportFilterExpression, type ReportFilterOperator, isReportFilterGroup } from "../../../core/reports.js";
import { type ReportRunResult } from "../../../application/report-service.js";
import { type SavedReport } from "../../../application/saved-report-service.js";
import { deskReportFieldLabel, deskReportSumSummaryLabel, deskReportSumSummaryName, isDeskGroupableReportField, isDeskNumericReportField } from "../report-builder.js";
import { formatCompoundFilterVisualValue, formatFormValue, formatValue, inputTypeForFieldType, labelFor, renderClientScripts, renderReportChartBody, slug } from "./shared.js";
import { ActionBar, Field, FormRow, Notice, Panel, SelectOptions, Toolbar, UnsafeRawHtml, renderFragment, type SelectOptionSpec } from "../ui/primitives.js";

/**
 * A fragment of pre-escaped markup produced by hono's `html` tagged template.
 * Used only where the Desk test suite asserts BARE boolean attributes
 * (`required`, `checked`, `selected`) byte-for-byte, which hono/jsx cannot
 * produce (it serializes them as `required=""`). Interpolations inside
 * `html\`\`` are escaped exactly like hono/jsx attributes/text.
 */
type RawFragment = ReturnType<typeof html>;

export function renderReportList(
  reports: readonly ReportDefinition[],
  options: { readonly builderDoctypes?: readonly DocTypeDefinition[] } = {}
): string {
  return renderFragment(<ReportList reports={reports} options={options} />);
}

const ReportList: FC<{
  reports: readonly ReportDefinition[];
  options: { readonly builderDoctypes?: readonly DocTypeDefinition[] | undefined };
}> = ({ reports, options }) => (
  <>
    <Panel>
      <div class="table-wrap">
        <table class="responsive-table">
          <thead><tr><th>Report</th><th>DocType</th><th>Module</th><th>Description</th></tr></thead>
          <tbody>
            {reports.length === 0 ? (
              <tr><td colspan={4} class="empty">No readable reports.</td></tr>
            ) : (
              reports.map((report) => (
                <tr>
                  <td data-label="Report"><a href={`/desk/reports/${encodeURIComponent(report.name)}`}>{report.label ?? report.name}</a></td>
                  <td data-label="DocType">{report.doctype}</td>
                  <td data-label="Module">{report.module ?? ""}</td>
                  <td data-label="Description">{report.description ?? ""}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Panel>
    {options.builderDoctypes ? (
      <Panel variant="report-builder-list">
        <div class="table-wrap">
          <table class="responsive-table">
            <thead><tr><th>Build Report</th><th>DocType</th><th>Fields</th></tr></thead>
            <tbody>
              {options.builderDoctypes.length === 0 ? (
                <tr><td colspan={3} class="empty">No readable DocTypes.</td></tr>
              ) : (
                options.builderDoctypes.map((doctype) => (
                  <tr>
                    <td data-label="Build Report"><a href={`/desk/report-builder/${encodeURIComponent(doctype.name)}`}>{labelFor(doctype)}</a></td>
                    <td data-label="DocType">{doctype.name}</td>
                    <td data-label="Fields">{String(doctype.fields.filter((field) => !field.hidden).length)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    ) : null}
  </>
);

export function renderSavedReportBuilder(
  doctype: DocTypeDefinition,
  savedReports: readonly SavedReport[],
  options: { readonly error?: string } = {}
): string {
  return renderFragment(<SavedReportBuilder doctype={doctype} savedReports={savedReports} options={options} />);
}

const SavedReportBuilder: FC<{
  doctype: DocTypeDefinition;
  savedReports: readonly SavedReport[];
  options: { readonly error?: string | undefined };
}> = ({ doctype, savedReports, options }) => {
  const visibleFields = doctype.fields.filter((field) => !field.hidden);
  const defaultColumns = new Set(doctype.listView?.columns ?? visibleFields.slice(0, 3).map((field) => field.name));
  const groupableFields = visibleFields.filter(isDeskGroupableReportField);
  const numericFields = visibleFields.filter(isDeskNumericReportField);
  return (
    <>
      {options.error ? <Notice tone="error">{options.error}</Notice> : null}
      <form class="panel form report-builder-form" method="post" action={`/desk/report-builder/${encodeURIComponent(doctype.name)}`}>
        <FormRow columns={1}>
          <Field label="Label">{html`<input name="label" required>`}</Field>
        </FormRow>
        <fieldset class="choice-grid">
          <legend>Columns</legend>
          {visibleFields.map((field) => (
            <ReportBuilderCheckbox name="column" field={field} checked={defaultColumns.has(field.name)} />
          ))}
        </fieldset>
        <fieldset class="choice-grid">
          <legend>Filters</legend>
          {groupableFields.map((field) => (
            <ReportBuilderFilterControls field={field} />
          ))}
        </fieldset>
        <ReportFilterExpressionBuilder fields={groupableFields} />
        <fieldset class="choice-grid">
          <legend>Summaries</legend>
          <ReportBuilderValueCheckbox name="summaryCount" value="1" label="Records" checked={false} />
          {numericFields.map((field) => (
            <ReportBuilderCheckbox name="summary" field={field} checked={false} />
          ))}
        </fieldset>
        <FormRow>
          <div
            class="report-formula-builder"
            data-cf-frappe-report-formula-builder=""
            data-formula-max-depth={REPORT_FORMULA_MAX_DEPTH}
            data-formula-fields={JSON.stringify(numericFields.map((field) => ({ name: field.name, label: deskReportFieldLabel(field) })))}
          >
            <Field label="Formula Label"><input name="formulaLabel" /></Field>
            <ReportBuilderFormulaOperandControls prefix="formulaLeft" label="Formula Left" fields={numericFields} depth={2} />
            <ReportBuilderFormulaOperatorControl prefix="formula" label="Formula" />
            <ReportBuilderFormulaOperandControls prefix="formulaRight" label="Formula Right" fields={numericFields} depth={2} />
          </div>
        </FormRow>
        <FormRow>
          <Field label="Group By">
            <select name="groupBy"><ReportBuilderFieldOptions fields={groupableFields} /></select>
          </Field>
          <Field label="Chart Type">
            <select name="chartType">
              <option value=""></option>
              <option value="bar">Bar</option>
              <option value="line">Line</option>
              <option value="pie">Pie</option>
            </select>
          </Field>
          <Field label="Chart Value">
            <select name="chartSummary">
              <option value="record_count">Records</option>
              {numericFields.map((field) => (
                <option value={deskReportSumSummaryName(field)}>{deskReportSumSummaryLabel(field)}</option>
              ))}
            </select>
          </Field>
        </FormRow>
        <FormRow>
          <Field label="Chart Sort">
            <select name="chartOrderBy">
              <option value="key">Group Key</option>
              <option value="label">Group Label</option>
              <option value="value">Value</option>
            </select>
          </Field>
          <Field label="Chart Order">
            <select name="chartOrder">
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </Field>
          <Field label="Chart Points"><input name="chartMaxPoints" type="number" min="1" max="50" /></Field>
        </FormRow>
        <FormRow>
          <Field label="Chart Palette"><input name="chartPalette" placeholder="#1f6feb, #2e7d32" /></Field>
          <Field label="Chart Values">
            <select name="chartShowValues">
              <SelectOptions
                options={[
                  { value: "true", label: "Show", selected: true },
                  { value: "false", label: "Hide" }
                ]}
              />
            </select>
          </Field>
        </FormRow>
        <FormRow>
          <Field label="X Axis Label"><input name="chartXAxisLabel" /></Field>
          <Field label="Y Axis Label"><input name="chartYAxisLabel" /></Field>
        </FormRow>
        <FormRow>
          <Field label="Order By">
            <select name="orderBy"><ReportBuilderFieldOptions fields={groupableFields} /></select>
          </Field>
          <Field label="Order">
            <select name="order">
              <option value="asc">Ascending</option>
              <option value="desc">Descending</option>
            </select>
          </Field>
        </FormRow>
        <ActionBar>
          <button class="button primary" type="submit">Save Report</button>
        </ActionBar>
      </form>
      <Panel>
        <div class="table-wrap">
          <table class="responsive-table">
            <thead><tr><th>Saved Report</th><th>Columns</th><th>Updated</th><th>Actions</th></tr></thead>
            <tbody>
              {savedReports.length === 0 ? (
                <tr><td colspan={4} class="empty">No saved reports.</td></tr>
              ) : (
                savedReports.map((saved) => {
                  const href = `/desk/report-builder/${encodeURIComponent(doctype.name)}/${encodeURIComponent(saved.id)}`;
                  return (
                    <tr>
                      <td data-label="Saved Report"><a href={href}>{saved.label}</a></td>
                      <td data-label="Columns">{saved.definition.columns.map((column) => column.label ?? column.name).join(", ")}</td>
                      <td data-label="Updated">{saved.updatedAt}</td>
                      <td data-label="Actions">
                        <a class="button" href={`${href}/export.csv`}>Export CSV</a>
                        <form class="inline-action" method="post" action={`${href}/delete`}>
                          <button class="button danger" type="submit">Delete</button>
                        </form>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>
      <UnsafeRawHtml
        reason="output of shared.ts renderClientScripts; all attribute values escaped internally"
        html={renderClientScripts(doctype.name, "report-builder", [])}
      />
    </>
  );
};

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
  return renderFragment(<SavedReportView saved={saved} result={result} options={options} />);
}

const SavedReportView: FC<{
  saved: SavedReport;
  result: ReportRunResult;
  options: {
    readonly listHref: string;
    readonly exportHref: string;
    readonly printHref?: string | undefined;
    readonly pdfHref?: string | undefined;
    readonly deleteAction: string;
    readonly drilldownBaseHref?: string | undefined;
  };
}> = ({ saved, result, options }) => (
  <>
    <section class="toolbar saved-report-toolbar">
      <a class="button" href={options.listHref}>Back</a>
      <a class="button" href={options.exportHref}>Export CSV</a>
      {options.printHref ? <a class="button" href={options.printHref}>Print</a> : null}
      {options.pdfHref ? <a class="button" href={options.pdfHref}>PDF</a> : null}
      <form class="inline-action" method="post" action={options.deleteAction}>
        <button class="button danger" type="submit">Delete</button>
      </form>
    </section>
    <Panel variant="saved-report-meta">
      <dl>
        <div><dt>DocType</dt><dd>{saved.doctype}</dd></div>
        <div><dt>Columns</dt><dd>{saved.definition.columns.map((column) => column.label ?? column.name).join(", ")}</dd></div>
        <SavedReportMetaItem label="Summaries" values={saved.definition.summaries?.map((summary) => summary.label ?? summary.name)} />
        <SavedReportMetaItem label="Groups" values={saved.definition.groups?.map((group) => group.label ?? group.name)} />
        <SavedReportMetaItem label="Charts" values={saved.definition.charts?.map((chart) => chart.label ?? chart.name)} />
        <div><dt>Updated</dt><dd>{saved.updatedAt}</dd></div>
      </dl>
    </Panel>
    <ReportView
      result={result}
      options={{
        exportHref: options.exportHref,
        printHref: options.printHref,
        pdfHref: options.pdfHref,
        drilldownBaseHref: options.drilldownBaseHref
      }}
    />
  </>
);

const SavedReportMetaItem: FC<{ label: string; values: readonly string[] | undefined }> = ({ label, values }) => {
  const text = values?.filter(Boolean).join(", ");
  return text ? <div><dt>{label}</dt><dd>{text}</dd></div> : null;
};

const ReportBuilderCheckbox: FC<{ name: string; field: FieldDefinition; checked: boolean }> = ({ name, field, checked }) => (
  <ReportBuilderValueCheckbox name={name} value={field.name} label={deskReportFieldLabel(field)} checked={checked} />
);

const ReportBuilderValueCheckbox: FC<{ name: string; value: string; label: string; checked: boolean }> = ({
  name,
  value,
  label,
  checked
}) => (
  <label class="choice">
    {html`<input type="checkbox" name="${name}" value="${value}"${checked ? raw(" checked") : ""}>`}
    <span>{label}</span>
  </label>
);

const ReportBuilderFilterControls: FC<{ field: FieldDefinition }> = ({ field }) => (
  <div class="report-builder-filter">
    <ReportBuilderCheckbox name="filter" field={field} checked={false} />
    <Field label="Operator">
      <select name={`filterOperator:${field.name}`}>
        <SelectOptions
          options={reportBuilderFilterOperatorsFor(field).map((operator) => ({
            value: operator.value,
            label: operator.label,
            selected: operator.selected
          }))}
        />
      </select>
    </Field>
    <ReportBuilderFilterDefaultControl field={field} />
    <label class="choice">
      <input type="checkbox" name={`filterRequired:${field.name}`} value="1" />
      <span>Required</span>
    </label>
    {isReportBuilderRangeFilterField(field) ? <ReportBuilderRangeFilterControls field={field} /> : null}
  </div>
);

function isReportBuilderRangeFilterField(field: FieldDefinition): boolean {
  return field.type === "integer" || field.type === "number" || field.type === "date" || field.type === "datetime";
}

const ReportBuilderRangeFilterControls: FC<{ field: FieldDefinition }> = ({ field }) => {
  const label = deskReportFieldLabel(field);
  const type = inputTypeForFieldType(field.type);
  return (
    <div class="report-builder-range-filter">
      <ReportBuilderValueCheckbox name="filterRangeMin" value={field.name} label={`${label} from`} checked={false} />
      <Field label="From Default"><input name={`filterRangeMinDefault:${field.name}`} type={type} /></Field>
      <ReportBuilderValueCheckbox name="filterRangeMax" value={field.name} label={`${label} to`} checked={false} />
      <Field label="To Default"><input name={`filterRangeMaxDefault:${field.name}`} type={type} /></Field>
    </div>
  );
};

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

const ReportBuilderFilterDefaultControl: FC<{ field: FieldDefinition }> = ({ field }) => {
  const name = `filterDefault:${field.name}`;
  if (field.type === "select") {
    return (
      <Field label="Default">
        <select name={name}>{reportSelectOptions(field.options ?? [], "")}</select>
      </Field>
    );
  }
  if (field.type === "boolean") {
    return (
      <Field label="Default">
        <select name={name}>
          <option value=""></option>
          <option value="true">True</option>
          <option value="false">False</option>
        </select>
      </Field>
    );
  }
  return (
    <Field label="Default">
      <input name={name} type={inputTypeForFieldType(field.type)} />
    </Field>
  );
};

const ReportFilterExpressionBuilder: FC<{ fields: readonly FieldDefinition[] }> = ({ fields }) => {
  const builderFields: readonly ReportFilterExpressionBuilderField[] = fields.map((field) => ({
    field: field.name,
    label: deskReportFieldLabel(field),
    inputType: reportFilterExpressionInputType(field),
    operators: []
  }));
  if (builderFields.length === 0) {
    return null;
  }
  return (
    <fieldset
      class="compound-filter-builder report-filter-expression-builder"
      data-cf-frappe-compound-filter-builder=""
      data-filter-expression-kind="report"
      data-filter-fields={JSON.stringify(builderFields)}
    >
      <legend>Filter Expression</legend>
      <div class="compound-filter-visual">
        <ReportFilterExpressionGroup fields={builderFields} group={EMPTY_REPORT_FILTER_GROUP} root={true} />
      </div>
      <template data-cf-frappe-filter-row-template=""><ReportFilterExpressionRow fields={builderFields} filter={undefined} /></template>
      <template data-cf-frappe-filter-group-template=""><ReportFilterExpressionGroup fields={builderFields} group={EMPTY_REPORT_FILTER_GROUP} root={false} /></template>
      <label class="field wide" for="report-filter-expression"><span>Advanced JSON</span><textarea id="report-filter-expression" name="filter_expression" rows={5}></textarea></label>
    </fieldset>
  );
};

const EMPTY_REPORT_FILTER_GROUP: Extract<ReportFilterExpression, { readonly kind: "group" }> = {
  kind: "group",
  match: "all",
  filters: []
};

const ReportFilterExpressionGroup: FC<{
  fields: readonly ReportFilterExpressionBuilderField[];
  group: Extract<ReportFilterExpression, { readonly kind: "group" }>;
  root: boolean;
}> = ({ fields, group, root }) => {
  const items = group.filters.length > 0 ? group.filters : [undefined];
  return (
    <div class={`compound-filter-group${root ? " compound-filter-root" : ""}`} data-cf-frappe-filter-group="">
      <div class="compound-filter-group-head">
        <label class="field compact"><span>Match</span>
          <select data-cf-frappe-filter-match="">
            <SelectOptions
              options={[
                { value: "all", label: "All", selected: group.match === "all" },
                { value: "any", label: "Any", selected: group.match === "any" }
              ]}
            />
          </select>
        </label>
        <div class="compound-filter-group-actions">
          <button class="button" type="button" data-cf-frappe-add-filter="">Add condition</button>
          <button class="button" type="button" data-cf-frappe-add-filter-group="">Add group</button>
          {root ? null : <button class="button" type="button" data-cf-frappe-remove-filter-group="">Remove group</button>}
        </div>
      </div>
      <div class="compound-filter-items compound-filter-rows" data-cf-frappe-filter-items="" data-cf-frappe-filter-rows="">
        {items.map((item) =>
          item === undefined ? (
            <ReportFilterExpressionRow fields={fields} filter={undefined} />
          ) : isReportFilterGroup(item) ? (
            <ReportFilterExpressionGroup fields={fields} group={item} root={false} />
          ) : (
            <ReportFilterExpressionRow fields={fields} filter={item} />
          )
        )}
      </div>
    </div>
  );
};

const ReportFilterExpressionRow: FC<{
  fields: readonly ReportFilterExpressionBuilderField[];
  filter: Exclude<ReportFilterExpression, { readonly kind: "group" }> | undefined;
}> = ({ fields, filter }) => {
  const filterName = filter?.filter ?? "";
  const builderField = fields.find((field) => field.field === filterName);
  const type = builderField?.inputType ?? "text";
  return (
    <div class="compound-filter-row" data-cf-frappe-filter-row="">
      <label class="field compact"><span>Filter</span>
        <select data-cf-frappe-filter-field="">
          <SelectOptions
            options={[
              { value: "" },
              ...fields.map((field) => ({ value: field.field, selected: field.field === filterName }))
            ]}
          />
        </select>
      </label>
      <label class="field grow"><span>Value</span><input data-cf-frappe-filter-value="" type={type} value={filter === undefined ? "" : formatCompoundFilterVisualValue(filter.value)} /></label>
      <button class="button" type="button" data-cf-frappe-remove-filter="">Remove</button>
    </div>
  );
};

interface ReportFilterExpressionBuilderField extends ListFilterBuilderField {
  readonly label: string;
}

function reportFilterExpressionInputType(field: FieldDefinition): ListFilterInputType {
  return field.type === "boolean" ? "boolean" : inputTypeForFieldType(field.type) as ListFilterInputType;
}

const ReportBuilderFieldOptions: FC<{ fields: readonly FieldDefinition[] }> = ({ fields }) => (
  <>
    <option value=""></option>
    {fields.map((field) => (
      <option value={field.name}>{deskReportFieldLabel(field)}</option>
    ))}
  </>
);

const ReportBuilderFormulaOperandControls: FC<{
  prefix: string;
  label: string;
  fields: readonly FieldDefinition[];
  depth: number;
}> = ({ prefix, label, fields, depth }) => (
  <div class="report-formula-operand" data-cf-frappe-formula-operand="" data-formula-prefix={prefix} data-formula-label={label} data-formula-depth={depth}>
    <Field label={`${label} Type`}>
      <select name={`${prefix}Kind`} data-cf-frappe-formula-kind="">
        <option value="field">Field</option>
        <option value="literal">Number</option>
        {depth <= REPORT_FORMULA_MAX_DEPTH ? <option value="nested">Nested formula</option> : null}
      </select>
    </Field>
    <Field label={label}>
      <select name={prefix}><ReportBuilderFieldOptions fields={fields} /></select>
    </Field>
    <Field label={`${label} Number`}><input name={`${prefix}Literal`} type="number" step="any" /></Field>
    <div class="report-formula-nested" data-cf-frappe-formula-nested=""></div>
  </div>
);

const ReportBuilderFormulaOperatorControl: FC<{ prefix: string; label: string }> = ({ prefix, label }) => (
  <Field label={`${label} Operator`}>
    <select name={`${prefix}Operator`}>
      <option value=""></option>
      <option value="add">Add</option>
      <option value="subtract">Subtract</option>
      <option value="multiply">Multiply</option>
      <option value="divide">Divide</option>
    </select>
  </Field>
);

export function renderReportView(
  result: ReportRunResult,
  options: {
    readonly exportHref?: string;
    readonly printHref?: string;
    readonly pdfHref?: string;
    readonly drilldownBaseHref?: string;
  } = {}
): string {
  return renderFragment(<ReportView result={result} options={options} />);
}

type ReportViewOptions = {
  readonly exportHref?: string | undefined;
  readonly printHref?: string | undefined;
  readonly pdfHref?: string | undefined;
  readonly drilldownBaseHref?: string | undefined;
};

const ReportView: FC<{ result: ReportRunResult; options: ReportViewOptions }> = ({ result, options }) => {
  const hasControls = result.filters.length > 0 || result.order.options.length > 0;
  const hasActions = Boolean(options.exportHref) || Boolean(options.printHref) || Boolean(options.pdfHref);
  const actions = (
    <>
      {options.exportHref ? <a class="button" href={options.exportHref}>Export CSV</a> : null}
      {options.printHref ? <a class="button" href={options.printHref}>Print</a> : null}
      {options.pdfHref ? <a class="button" href={options.pdfHref}>PDF</a> : null}
    </>
  );
  return (
    <>
      {hasControls ? (
        <form class="panel form report-filters" method="get">
          <FormRow>
            {result.filters.map((filter) => reportFilterControl(filter))}
            <ReportOrderControls order={result.order} />
          </FormRow>
          <ActionBar>
            <button class="button primary" type="submit">Run</button>
            {actions}
          </ActionBar>
        </form>
      ) : hasActions ? (
        <Toolbar>{actions}</Toolbar>
      ) : null}
      <ReportSummary summary={result.summary} />
      <ReportCharts charts={result.charts} drilldownBaseHref={options.drilldownBaseHref} />
      <ReportGroups groups={result.groups} />
      <Panel>
        <div class="table-wrap">
          <table class="responsive-table">
            <thead><tr>{result.columns.map((column) => <th>{column.label ?? column.name}</th>)}</tr></thead>
            <tbody>
              {result.rows.length === 0 ? (
                <tr><td colspan={result.columns.length} class="empty">No rows matched.</td></tr>
              ) : (
                result.rows.map((row) => (
                  <tr>{result.columns.map((column) => <td data-label={column.label ?? column.name}>{formatValue(row[column.name])}</td>)}</tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
};

/**
 * Report filter controls carry a BARE `required` attribute (asserted
 * byte-for-byte by the desk tests), which hono/jsx cannot emit, so this
 * control is built with hono's escaping `html` tagged template instead.
 */
function reportFilterControl(filter: ReportRunResult["filters"][number]): RawFragment {
  const id = `filter-${slug(filter.name)}`;
  const name = `filter_${filter.name}`;
  const label = filter.label;
  const value = formatFormValue(filter.value);
  const required = filter.required ? raw(" required") : raw("");
  if (filter.operator === "between" || filter.operator === "not_between") {
    const values = Array.isArray(filter.value) ? filter.value : [];
    const type = inputTypeForFieldType(filter.type);
    return html`<label class="field" for="${id}-min"><span>${label} from</span><input id="${id}-min" name="${name}" type="${type}" value="${formatFormValue(values[0])}"${required}></label><label class="field" for="${id}-max"><span>${label} to</span><input id="${id}-max" name="${name}" type="${type}" value="${formatFormValue(values[1])}"${required}></label>`;
  }
  if (filter.type === "select") {
    return html`<label class="field" for="${id}"><span>${label}</span><select id="${id}" name="${name}"${required}>${reportSelectOptions(filter.options, value)}</select></label>`;
  }
  if (filter.type === "boolean") {
    const options = [
      html`<option value=""></option>`,
      html`<option value="true"${value === "true" ? raw(" selected") : ""}>True</option>`,
      html`<option value="false"${value === "false" ? raw(" selected") : ""}>False</option>`
    ];
    return html`<label class="field" for="${id}"><span>${label}</span><select id="${id}" name="${name}"${required}>${options}</select></label>`;
  }
  if (filter.type === "longText" || filter.type === "json") {
    return html`<label class="field" for="${id}"><span>${label}</span><textarea id="${id}" name="${name}"${required}>${value}</textarea></label>`;
  }
  const type = inputTypeForFieldType(filter.type);
  return html`<label class="field" for="${id}"><span>${label}</span><input id="${id}" name="${name}" type="${type}" value="${value}"${required}></label>`;
}

const ReportOrderControls: FC<{ order: ReportRunResult["order"] }> = ({ order }) => {
  if (order.options.length === 0) {
    return null;
  }
  const selectedOrderBy = order.orderBy ?? "";
  return (
    <>
      <label class="field" for="report-order-by"><span>Order By</span>
        <select id="report-order-by" name="order_by">
          <SelectOptions
            options={[
              { value: "" },
              ...order.options.map((option) => ({
                value: option.name,
                label: option.label,
                selected: option.name === selectedOrderBy
              }))
            ]}
          />
        </select>
      </label>
      <label class="field" for="report-order"><span>Order</span>
        <select id="report-order" name="order">
          <SelectOptions
            options={[
              { value: "asc", label: "Ascending", selected: order.order === "asc" },
              { value: "desc", label: "Descending", selected: order.order === "desc" }
            ]}
          />
        </select>
      </label>
    </>
  );
};

/**
 * Mirrors {@link SelectOptions} for contexts that are themselves built with
 * the `html` tagged template (bare `selected`, escaped values/labels).
 */
function reportSelectOptions(options: readonly string[], value: string): readonly RawFragment[] {
  const rendered = [html`<option value=""></option>`];
  if (value && !options.includes(value)) {
    rendered.push(html`<option value="${value}" selected>${value}</option>`);
  }
  rendered.push(
    ...options.map((option) => html`<option value="${option}"${option === value ? raw(" selected") : ""}>${option}</option>`)
  );
  return rendered;
}

const ReportCharts: FC<{ charts: ReportRunResult["charts"]; drilldownBaseHref: string | undefined }> = ({
  charts,
  drilldownBaseHref
}) => {
  if (charts.length === 0) {
    return null;
  }
  return (
    <section class="report-charts">
      {charts.map((chart) => (
        <Panel variant="report-chart">
          <UnsafeRawHtml
            reason="output of shared.ts renderReportChartBody; SVG chart markup with labels/values escaped internally"
            html={renderReportChartBody(chart, drilldownBaseHref, chart.label)}
          />
        </Panel>
      ))}
    </section>
  );
};

const ReportSummary: FC<{ summary: ReportRunResult["summary"] }> = ({ summary }) => {
  if (summary.length === 0) {
    return null;
  }
  return (
    <section class="panel report-summary" aria-label="Report summary">
      <ul>
        {summary.map((item) => (
          <li><span>{item.label}</span><strong>{formatValue(item.value)}</strong></li>
        ))}
      </ul>
    </section>
  );
};

const ReportGroups: FC<{ groups: ReportRunResult["groups"] }> = ({ groups }) => {
  if (groups.length === 0) {
    return null;
  }
  return (
    <>
      {groups.map((group) => (
        <Panel variant="report-group" title={group.label}>
          <div class="table-wrap">
            <table class="responsive-table">
              <thead>
                <tr><th>{group.field}</th>{(group.rows[0]?.summaries ?? []).map((summary) => <th>{summary.label}</th>)}</tr>
              </thead>
              <tbody>
                {group.rows.length === 0 ? (
                  <tr><td colspan={2} class="empty">No rows matched.</td></tr>
                ) : (
                  group.rows.map((row) => (
                    <tr>
                      <td data-label={group.field}>{row.label}</td>
                      {row.summaries.map((summary) => <td data-label={summary.label}>{formatValue(summary.value)}</td>)}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Panel>
      ))}
    </>
  );
};
