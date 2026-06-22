import {
  CHILD_TABLE_ROW_INDEX_FIELD,
  type DocTypeDefinition,
  type DocumentData,
  type DocumentSnapshot,
  type FieldDefinition,
  type JsonValue,
  type LinkOption,
  type ListDocumentsFilter,
  type ListFilterOperator,
  type ResolvedFormSection,
  type ResolvedFormView,
  type ResolvedListView
} from "../../core/types";
import type { ReportDefinition } from "../../core/reports";
import type { DocumentAssignments, DocumentTimeline } from "../../application/document-history-service";
import type { ReportRunResult } from "../../application/report-service";
import type { SavedListFilter } from "../../application/saved-list-filter-service";
import type { PrintFormatDefinition } from "../../core/print-format";

export type FormLinkOptions = Readonly<Record<string, readonly LinkOption[]>>;
export type FormTableDefinitions = Readonly<Record<string, DocTypeDefinition>>;
export type FormLifecycleAction = "submit" | "cancel";

export interface DeskLayoutOptions {
  readonly title: string;
  readonly body: string;
  readonly active?: string;
  readonly activeReport?: string;
  readonly doctypes: readonly DocTypeDefinition[];
  readonly reports?: readonly ReportDefinition[];
  readonly message?: string;
}

export function renderDeskLayout(options: DeskLayoutOptions): string {
  const nav = options.doctypes
    .map(
      (doctype) =>
        `<a class="nav-link${doctype.name === options.active ? " is-active" : ""}" href="/desk/${encodeURIComponent(doctype.name)}">${escapeHtml(labelFor(doctype))}</a>`
    )
    .join("");
  const reportNav = (options.reports ?? [])
    .map(
      (report) =>
        `<a class="nav-link${report.name === options.activeReport ? " is-active" : ""}" href="/desk/reports/${encodeURIComponent(report.name)}">${escapeHtml(report.label ?? report.name)}</a>`
    )
    .join("");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title)} - cf-frappe Desk</title>
  <style>${deskCss()}</style>
</head>
<body>
  <a class="skip-link" href="#main">Skip to content</a>
  <aside class="sidebar" aria-label="Desk navigation">
    <a class="brand" href="/desk">cf-frappe</a>
    <nav>
      ${nav ? `<p class="nav-heading">DocTypes</p>${nav}` : ""}
      ${reportNav ? `<p class="nav-heading">Reports</p>${reportNav}` : ""}
    </nav>
  </aside>
  <main id="main" class="main">
    <header class="topbar">
      <div>
        <p class="kicker">Desk</p>
        <h1>${escapeHtml(options.title)}</h1>
      </div>
    </header>
    ${options.message ? `<p class="notice" role="status">${escapeHtml(options.message)}</p>` : ""}
    ${options.body}
  </main>
</body>
</html>`;
}

export function renderDeskHome(
  doctypes: readonly DocTypeDefinition[],
  reports: readonly ReportDefinition[] = []
): string {
  const rows = doctypes
    .map(
      (doctype) => `<tr>
        <td><a href="/desk/${encodeURIComponent(doctype.name)}">${escapeHtml(labelFor(doctype))}</a></td>
        <td>${escapeHtml(doctype.module ?? "")}</td>
        <td>${String(doctype.fields.length)}</td>
        <td>${escapeHtml(doctype.description ?? "")}</td>
      </tr>`
    )
    .join("");
  return `<section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>DocType</th><th>Module</th><th>Fields</th><th>Description</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="empty">No readable DocTypes.</td></tr>`}</tbody>
      </table>
    </div>
  </section>
  ${renderReportList(reports)}`;
}

export function renderReportList(reports: readonly ReportDefinition[]): string {
  const rows = reports
    .map(
      (report) => `<tr>
        <td><a href="/desk/reports/${encodeURIComponent(report.name)}">${escapeHtml(report.label ?? report.name)}</a></td>
        <td>${escapeHtml(report.doctype)}</td>
        <td>${escapeHtml(report.module ?? "")}</td>
        <td>${escapeHtml(report.description ?? "")}</td>
      </tr>`
    )
    .join("");
  return `<section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Report</th><th>DocType</th><th>Module</th><th>Description</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="empty">No readable reports.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

export function renderReportView(result: ReportRunResult): string {
  const filterForm = (result.report.filters ?? [])
    .map((filter) => {
      const id = `filter-${slug(filter.name)}`;
      return `<label class="field" for="${id}"><span>${escapeHtml(filter.label ?? filter.name)}</span><input id="${id}" name="filter_${escapeHtml(filter.name)}" type="text"></label>`;
    })
    .join("");
  const headers = result.columns.map((column) => `<th>${escapeHtml(column.label ?? column.name)}</th>`).join("");
  const rows = result.rows
    .map(
      (row) =>
        `<tr>${result.columns
          .map((column) => `<td>${escapeHtml(formatValue(row[column.name]))}</td>`)
          .join("")}</tr>`
    )
    .join("");
  return `${filterForm ? `<form class="panel form report-filters" method="get"><div class="fields">${filterForm}</div><div class="actions"><button class="button primary" type="submit">Run</button></div></form>` : ""}
  <section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr>${headers}</tr></thead>
        <tbody>${rows || `<tr><td colspan="${result.columns.length}" class="empty">No rows matched.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
}

export function renderListView(
  doctype: DocTypeDefinition,
  listView: ResolvedListView,
  documents: readonly DocumentSnapshot[],
  filters: readonly ListDocumentsFilter[] = [],
  options: {
    readonly savedFilters?: readonly SavedListFilter[];
    readonly selectedSavedFilterId?: string;
  } = {}
): string {
  const fields = listView.columns;
  const filterFields = listView.filterFields;
  const filterForm = filterFields.map((field) => renderFilterField(field, filters)).join("");
  const savedFilterPanel = renderSavedFilters(doctype, options.savedFilters ?? [], options.selectedSavedFilterId);
  const header = fields.map((field) => `<th>${escapeHtml(field.label ?? field.name)}</th>`).join("");
  const rows = documents
    .map((document) => {
      const cells = fields
        .map((field) => `<td>${escapeHtml(formatValue(document.data[field.name]))}</td>`)
        .join("");
      return `<tr>
        <td><a href="/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(document.name)}">${escapeHtml(document.name)}</a></td>
        ${cells}
        <td>${String(document.version)}</td>
        <td>${escapeHtml(document.updatedAt)}</td>
      </tr>`;
    })
    .join("");
  return `<section class="toolbar">
    <a class="button primary" href="/desk/${encodeURIComponent(doctype.name)}/new">New ${escapeHtml(labelFor(doctype))}</a>
  </section>
  ${savedFilterPanel}
  ${filterForm ? `<form class="panel form list-filters" method="get"><div class="fields">${filterForm}<label class="field" for="saved-filter-label"><span>Saved filter name</span><input id="saved-filter-label" name="saved_filter_label" type="text"></label></div><div class="actions"><button class="button primary" type="submit">Filter</button><button class="button" type="submit" formmethod="post" formaction="/desk/${encodeURIComponent(doctype.name)}/saved-filters">Save filter</button><a class="button" href="/desk/${encodeURIComponent(doctype.name)}?default_filters=0">Clear</a></div></form>` : ""}
  <section class="panel">
    <div class="table-wrap">
      <table>
        <thead><tr><th>Name</th>${header}<th>Version</th><th>Updated</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="${fields.length + 3}" class="empty">No documents yet.</td></tr>`}</tbody>
      </table>
    </div>
  </section>`;
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
    readonly printFormats?: readonly PrintFormatDefinition[];
  }
): string {
  const action =
    options.mode === "create"
      ? `/desk/${encodeURIComponent(doctype.name)}`
      : `/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(options.document?.name ?? "")}`;
  const title = options.mode === "create" ? `New ${labelFor(doctype)}` : options.document?.name ?? doctype.name;
  const canSave = options.mode === "create" || options.document?.docstatus === "draft";
  const sections = formView.sections
    .map((section) =>
      renderFormSection(
        section,
        options.document,
        options.mode,
        options.linkOptions ?? {},
        options.tableDefinitions ?? {}
      )
    )
    .join("");
  const commands =
    options.mode === "update" && options.document?.docstatus === "draft" && doctype.commands?.length
      ? `<section class="command-row" aria-label="Commands">${doctype.commands
          .map(
            (command) =>
              `<button class="button" formmethod="post" formaction="/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(options.document?.name ?? "")}/command/${encodeURIComponent(command.name)}">${escapeHtml(command.name)}</button>`
          )
          .join("")}</section>`
      : "";
  const lifecycleActions =
    options.mode === "update" && options.document && options.lifecycleActions?.length
      ? `<section class="command-row" aria-label="Lifecycle actions">${options.lifecycleActions
          .map((action) => {
            const label = action === "submit" ? "Submit" : "Cancel Document";
            return `<button class="button" formmethod="post" formaction="/desk/${encodeURIComponent(doctype.name)}/${encodeURIComponent(options.document!.name)}/${action}">${escapeHtml(label)}</button>`;
          })
          .join("")}</section>`
      : "";
  const printLinks =
    options.mode === "update" && options.document && options.printFormats?.length
      ? `<section class="command-row" aria-label="Print formats">${options.printFormats
          .map(
            (format) =>
              `<a class="button" href="/desk/print/${encodeURIComponent(format.name)}/${encodeURIComponent(options.document!.name)}">${escapeHtml(format.label ?? format.name)}</a>`
          )
          .join("")}</section>`
      : "";
  const versionField = options.document
    ? `<input type="hidden" name="expectedVersion" value="${String(options.document.version)}">`
    : "";
  return `<form class="panel form" method="post" action="${action}">
    <div class="form-head">
      <h2>${escapeHtml(title)}</h2>
      ${options.document ? `<p>v${String(options.document.version)} · ${escapeHtml(options.document.docstatus)}</p>` : ""}
    </div>
    ${versionField}
    ${options.error ? `<p class="error" role="alert">${escapeHtml(options.error)}</p>` : ""}
    ${sections}
    <div class="actions">
      <a class="button" href="/desk/${encodeURIComponent(doctype.name)}">Cancel</a>
      ${canSave ? `<button class="button primary" type="submit">${options.mode === "create" ? "Create" : "Save"}</button>` : ""}
    </div>
    ${commands}
    ${lifecycleActions}
    ${printLinks}
  </form>`;
}

export function renderDocumentTimeline(
  timeline: DocumentTimeline,
  options: {
    readonly allowComment?: boolean;
    readonly allowAssign?: boolean;
    readonly assignments?: DocumentAssignments;
  } = {}
): string {
  const rows = timeline.entries
    .map(
      (entry) => `<tr>
        <td>${String(entry.sequence)}</td>
        <td><strong>${escapeHtml(entry.summary)}</strong><small>${escapeHtml(entry.type)}</small></td>
        <td>${escapeHtml(entry.actorId)}</td>
        <td>${escapeHtml(entry.occurredAt)}</td>
      </tr>`
    )
    .join("");
  const commentForm = options.allowComment ? renderCommentForm(timeline) : "";
  const assignmentPanel = options.assignments
    ? renderAssignmentPanel(timeline, options.assignments, { allowAssign: options.allowAssign ?? false })
    : "";
  return `<section class="panel timeline" aria-labelledby="document-timeline">
    <div class="timeline-head">
      <h2 id="document-timeline">Timeline</h2>
      <p>v${String(timeline.version)} · ${escapeHtml(timeline.docstatus)}</p>
    </div>
    ${assignmentPanel}
    <div class="table-wrap">
      <table>
        <thead><tr><th>#</th><th>Event</th><th>Actor</th><th>Occurred</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="4" class="empty">No events yet.</td></tr>`}</tbody>
      </table>
    </div>
    ${commentForm}
  </section>`;
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

export function renderNotFound(message: string): string {
  return `<section class="panel"><p class="empty">${escapeHtml(message)}</p></section>`;
}

export function renderErrorPanel(message: string): string {
  return `<section class="panel"><p class="error" role="alert">${escapeHtml(message)}</p></section>`;
}

function renderFormSection(
  section: ResolvedFormSection,
  document: DocumentSnapshot | undefined,
  mode: "create" | "update",
  linkOptions: FormLinkOptions,
  tableDefinitions: FormTableDefinitions
): string {
  const fields = section.fields
    .map((field) =>
      renderField(
        field,
        document?.data[field.name],
        mode,
        linkOptions[field.name] ?? [],
        tableDefinitions[field.name],
        linkOptions
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
  mode: "create" | "update",
  linkOptions: readonly LinkOption[],
  tableDefinition: DocTypeDefinition | undefined,
  allLinkOptions: FormLinkOptions
): string {
  const id = `field-${slug(field.name)}`;
  const label = escapeHtml(field.label ?? field.name);
  const required = field.required ? " required" : "";
  const readonly = field.readOnly || (mode === "update" && field.readOnly) ? " readonly" : "";
  const common = `id="${id}" name="${escapeHtml(field.name)}"${required}${readonly}`;
  const formatted = formatFormValue(value);
  const help = field.readOnly ? `<small>Read only</small>` : "";
  if (field.type === "table") {
    return renderTableField(field, value, tableDefinition, allLinkOptions);
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
    return `<label class="field" for="${id}"><span>${label}${field.required ? " *" : ""}</span><textarea ${common}>${escapeHtml(formatted)}</textarea>${help}</label>`;
  }
  const type = inputType(field);
  const checked = field.type === "boolean" && value === true ? " checked" : "";
  return `<label class="field" for="${id}"><span>${label}${field.required ? " *" : ""}</span><input type="${type}" ${common} value="${escapeHtml(formatted)}"${checked}>${help}</label>`;
}

function renderTableField(
  field: FieldDefinition,
  value: JsonValue | undefined,
  child: DocTypeDefinition | undefined,
  linkOptions: FormLinkOptions
): string {
  const label = escapeHtml(field.label ?? field.name);
  if (!child) {
    return `<label class="field" for="field-${slug(field.name)}"><span>${label}${field.required ? " *" : ""}</span><textarea id="field-${slug(field.name)}" name="${escapeHtml(field.name)}">${escapeHtml(formatFormValue(value))}</textarea></label>`;
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
        tableField: field.name,
        rowIndex,
        ...(rows.length > 0 ? { originIndex: rowIndex } : {}),
        row,
        childFields,
        linkOptions
      })
    )
    .join("");
  const nextRow = rows.length > 0 ? renderBlankTableRow(field.name, rows.length, childFields, linkOptions) : "";
  return `<fieldset class="field table-field">
    <legend>${label}${field.required ? " *" : ""}</legend>
    <div class="table-wrap">
      <table>
        <thead><tr>${headers}</tr></thead>
        <tbody>${body}${nextRow}</tbody>
      </table>
    </div>
  </fieldset>`;
}

function renderTableRow(options: {
  readonly tableField: string;
  readonly rowIndex: number;
  readonly originIndex?: number;
  readonly row: Record<string, JsonValue>;
  readonly childFields: readonly FieldDefinition[];
  readonly linkOptions: FormLinkOptions;
}): string {
  const marker =
    options.originIndex === undefined ? "" : renderTableRowOrigin(options.tableField, options.rowIndex, options.originIndex);
  if (options.childFields.length === 0) {
    return `<tr><td>${marker}</td></tr>`;
  }
  return `<tr>${options.childFields
    .map((childField, cellIndex) => {
      const input = renderTableCellInput(
        options.tableField,
        options.rowIndex,
        childField,
        options.row[childField.name],
        options.linkOptions[`${options.tableField}.${childField.name}`] ?? []
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
  tableField: string,
  rowIndex: number,
  childFields: readonly FieldDefinition[],
  linkOptions: FormLinkOptions
): string {
  return `<tr>${childFields
    .map((childField) =>
      `<td>${renderTableCellInput(tableField, rowIndex, childField, undefined, linkOptions[`${tableField}.${childField.name}`] ?? [])}</td>`
    )
    .join("")}</tr>`;
}

function renderTableCellInput(
  tableField: string,
  rowIndex: number,
  field: FieldDefinition,
  value: JsonValue | undefined,
  linkOptions: readonly LinkOption[]
): string {
  const name = `${tableField}[${rowIndex}].${field.name}`;
  const id = `field-${slug(name)}`;
  const common = `id="${id}" name="${escapeHtml(name)}"`;
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
    return `<textarea ${common}>${escapeHtml(formatted)}</textarea>`;
  }
  const type = inputType(field);
  const checked = field.type === "boolean" && value === true ? " checked" : "";
  return `<input type="${type}" ${common} value="${escapeHtml(formatted)}"${checked}>`;
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

function inputType(field: FieldDefinition): string {
  switch (field.type) {
    case "integer":
    case "number":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime-local";
    case "boolean":
      return "checkbox";
    default:
      return "text";
  }
}

function renderFilterField(field: FieldDefinition, filters: readonly ListDocumentsFilter[]): string {
  const id = `filter-${slug(field.name)}`;
  const label = escapeHtml(field.label ?? field.name);
  const operator = filterOperatorForField(field);
  const name = `filter_${field.name}${operator === "eq" ? "" : `__${operator}`}`;
  const value = currentFilterValue(filters, field.name, operator);
  const common = `id="${id}" name="${escapeHtml(name)}"`;
  if (field.type === "select") {
    const options = [`<option value=""></option>`]
      .concat(
        (field.options ?? []).map(
          (option) =>
            `<option value="${escapeHtml(option)}"${option === value ? " selected" : ""}>${escapeHtml(option)}</option>`
        )
      )
      .join("");
    return `<label class="field" for="${id}"><span>${label}</span><select ${common}>${options}</select></label>`;
  }
  if (field.type === "boolean") {
    const options = [
      `<option value=""></option>`,
      `<option value="true"${value === "true" ? " selected" : ""}>True</option>`,
      `<option value="false"${value === "false" ? " selected" : ""}>False</option>`
    ].join("");
    return `<label class="field" for="${id}"><span>${label}</span><select ${common}>${options}</select></label>`;
  }
  return `<label class="field" for="${id}"><span>${label}</span><input type="${inputType(field)}" ${common} value="${escapeHtml(value)}"></label>`;
}

function filterOperatorForField(field: FieldDefinition): ListFilterOperator {
  return field.type === "text" || field.type === "longText" || field.type === "link" ? "contains" : "eq";
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

function labelFor(doctype: DocTypeDefinition): string {
  return doctype.label ?? doctype.name;
}

function formatValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function formatFormValue(value: JsonValue | undefined): string {
  return formatValue(value);
}

function isJsonObject(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function slug(value: string): string {
  return value.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-+|-+$/g, "");
}

function deskCss(): string {
  return `
:root {
  color-scheme: light;
  --bg: #f7f8fa;
  --surface: #ffffff;
  --border: #d9dee7;
  --text: #1f2937;
  --muted: #5b6472;
  --primary: #185abc;
  --primary-dark: #123f83;
  --danger: #b42318;
  --focus: #b45309;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100dvh;
  background: var(--bg);
  color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 16px;
  line-height: 1.5;
}
a { color: var(--primary); }
a:focus-visible, button:focus-visible, input:focus-visible, textarea:focus-visible, select:focus-visible {
  outline: 3px solid var(--focus);
  outline-offset: 2px;
}
.skip-link {
  position: absolute;
  left: 12px;
  top: -48px;
  background: var(--surface);
  padding: 8px 12px;
  border: 1px solid var(--border);
  z-index: 2;
}
.skip-link:focus { top: 12px; }
.sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  width: 240px;
  padding: 20px 14px;
  border-right: 1px solid var(--border);
  background: var(--surface);
  overflow-y: auto;
}
.brand {
  display: block;
  margin: 0 8px 20px;
  color: var(--text);
  font-weight: 700;
  text-decoration: none;
}
.nav-link {
  display: block;
  min-height: 44px;
  padding: 10px 12px;
  border-radius: 6px;
  color: var(--text);
  text-decoration: none;
}
.nav-link:hover, .nav-link.is-active { background: #e9eef7; }
.nav-heading {
  margin: 18px 12px 6px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
  text-transform: uppercase;
}
.main { margin-left: 240px; padding: 24px; }
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.kicker {
  margin: 0 0 4px;
  color: var(--muted);
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
}
h1, h2 { margin: 0; letter-spacing: 0; }
h1 { font-size: 28px; line-height: 1.2; }
h2 { font-size: 20px; line-height: 1.3; }
h3 { margin: 0 0 12px; font-size: 16px; line-height: 1.35; letter-spacing: 0; }
.toolbar { margin-bottom: 16px; }
.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 8px;
}
.table-wrap { overflow-x: auto; }
table {
  width: 100%;
  border-collapse: collapse;
}
th, td {
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  text-align: left;
  vertical-align: top;
}
th {
  color: var(--muted);
  font-size: 13px;
  font-weight: 700;
}
tr:last-child td { border-bottom: 0; }
.empty { color: var(--muted); }
.notice, .error {
  padding: 10px 12px;
  border-radius: 6px;
  background: #fff7ed;
  border: 1px solid #fed7aa;
}
.error {
  color: var(--danger);
  background: #fef3f2;
  border-color: #fecdca;
}
.form { padding: 18px; max-width: 860px; }
.timeline { margin-top: 16px; max-width: 860px; }
.list-filters { max-width: none; margin-bottom: 16px; }
.list-filters .actions { justify-content: flex-start; }
.saved-filters {
  max-width: none;
  margin-bottom: 16px;
  padding: 14px 18px;
}
.saved-filters h2 { margin-bottom: 10px; font-size: 16px; }
.saved-filters ul {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.saved-filters li {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.saved-filter-link {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text);
  text-decoration: none;
}
.saved-filter-link.is-active { background: #e9eef7; border-color: var(--primary); }
.form-head, .timeline-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}
.timeline-head { padding: 18px 18px 0; }
.form-head p, .timeline-head p { margin: 0; color: var(--muted); }
.timeline strong { display: block; }
.timeline small { color: var(--muted); }
.timeline-assignments {
  padding: 0 18px 18px;
  border-bottom: 1px solid var(--border);
}
.assignment-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.assignment-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 44px;
}
.inline-action { margin: 0; }
.timeline-assignment-form {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: end;
  gap: 12px;
  margin-top: 12px;
}
.timeline-comment {
  padding: 16px 18px 18px;
  border-top: 1px solid var(--border);
}
.timeline-comment textarea { min-height: 88px; }
.form-section + .form-section {
  margin-top: 20px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
}
.fields {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.fields.cols-1 { grid-template-columns: 1fr; }
.field { display: grid; gap: 6px; }
.field span { font-weight: 650; }
.field small { color: var(--muted); }
input, select, textarea {
  width: 100%;
  min-height: 44px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  color: var(--text);
  padding: 9px 10px;
  font: inherit;
}
textarea { min-height: 120px; resize: vertical; }
input[readonly], textarea[readonly] { background: #f3f4f6; color: var(--muted); }
.actions, .command-row {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}
.command-row {
  justify-content: flex-start;
  border-top: 1px solid var(--border);
  padding-top: 16px;
}
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 44px;
  padding: 8px 14px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--surface);
  color: var(--text);
  font: inherit;
  font-weight: 650;
  text-decoration: none;
  cursor: pointer;
}
.button.primary {
  border-color: var(--primary);
  background: var(--primary);
  color: #fff;
}
.button.primary:hover { background: var(--primary-dark); }
@media (max-width: 760px) {
  .sidebar {
    position: static;
    width: auto;
    border-right: 0;
    border-bottom: 1px solid var(--border);
  }
  .main { margin-left: 0; padding: 16px; }
  .topbar, .form-head { align-items: flex-start; flex-direction: column; }
  .fields { grid-template-columns: 1fr; }
  .timeline-assignment-form { grid-template-columns: 1fr; }
}`;
}
